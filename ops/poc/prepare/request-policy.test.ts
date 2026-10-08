import {
  RequestPolicyError,
  authorizeRequest,
  authorizeRedirect,
} from "./request-policy";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const credentials = {
  github: "Bearer github-value",
  huggingFace: "Bearer hugging-face-value",
  softwareHeritage: "AWS4-HMAC-SHA256 signed-value",
  softwareHeritageSessionToken: "session-value",
};

describe("preparation request policy", () => {
  it("allows exact read-only endpoint families for each provider", () => {
    const requests = [
      ["github", "https://api.github.com/search/commits?q=refactor&sort=committer-date"],
      ["github", "https://api.github.com/repos/owner/project/git/trees/" + "a".repeat(40)],
      ["huggingFace", "https://huggingface.co/api/datasets/bigcode/the-stack-v2/revision/" + "a".repeat(40)],
      ["huggingFace", "https://huggingface.co/datasets/bigcode/the-stack-v2/resolve/" + "a".repeat(40) + "/README.md"],
      ["softwareHeritage", "https://softwareheritage.s3.amazonaws.com/content/sha1_git:abc123"],
    ] as const;

    for (const [provider, url] of requests) {
      expect(authorizeRequest({ provider, method: "GET", url }).provider).toBe(provider);
      expect(authorizeRequest({ provider, method: "HEAD", url }).method).toBe("HEAD");
    }
  });

  it("rejects non-HTTPS, write methods, provider mismatches, and nearby paths", () => {
    const cases = [
      { provider: "github", method: "GET", url: "http://api.github.com/search/commits?q=x" },
      { provider: "github", method: "POST", url: "https://api.github.com/search/commits?q=x" },
      { provider: "github", method: "GET", url: "https://huggingface.co/search/commits" },
      { provider: "github", method: "GET", url: "https://api.github.com/users/example" },
      { provider: "huggingFace", method: "GET", url: "https://huggingface.co/api/models/example" },
      { provider: "softwareHeritage", method: "GET", url: "https://softwareheritage.s3.amazonaws.com/private/key" },
    ];

    for (const candidate of cases) {
      expect(() => authorizeRequest(candidate as never)).toThrow(RequestPolicyError);
    }
  });

  it("attaches credentials only to their exact provider host", () => {
    const github = authorizeRequest({
      provider: "github",
      method: "GET",
      url: "https://api.github.com/search/commits?q=x",
    }, credentials);
    const huggingFace = authorizeRequest({
      provider: "huggingFace",
      method: "GET",
      url: "https://huggingface.co/api/datasets/bigcode/the-stack-v2/revision/" + "a".repeat(40),
    }, credentials);
    const softwareHeritage = authorizeRequest({
      provider: "softwareHeritage",
      method: "GET",
      url: "https://softwareheritage.s3.amazonaws.com/content/sha1_git:abc123",
    }, credentials);

    expect(github.headers).toEqual({ authorization: credentials.github });
    expect(huggingFace.headers).toEqual({ authorization: credentials.huggingFace });
    expect(softwareHeritage.headers).toEqual({
      authorization: credentials.softwareHeritage,
      "x-amz-security-token": credentials.softwareHeritageSessionToken,
    });
  });

  it("authorizes only the exact current dataset card with Hugging Face credentials", () => {
    const cardUrl = "https://huggingface.co/datasets/bigcode/the-stack-v2/raw/main/README.md";
    const direct = authorizeRequest({
      provider: "huggingFace",
      method: "GET",
      url: cardUrl,
      headers: { accept: "text/plain; charset=utf-8" },
    }, credentials);
    const redirected = authorizeRedirect({
      provider: "github",
      method: "HEAD",
      url: "https://api.github.com/search/commits?q=x&access_token=origin-secret",
      headers: { authorization: "Bearer origin-secret", cookie: "origin-secret" },
    }, cardUrl, "huggingFace", credentials);

    expect(direct.headers).toEqual({
      accept: "text/plain; charset=utf-8",
      authorization: credentials.huggingFace,
    });
    expect(redirected.method).toBe("HEAD");
    expect(redirected.headers).toEqual({ authorization: credentials.huggingFace });
  });

  it("rejects every nearby mutable dataset card endpoint", () => {
    const nearby = [
      "https://huggingface.co/datasets/bigcode/the-stack-v2/raw/main/TERMS.md",
      "https://huggingface.co/datasets/bigcode/the-stack-v2/raw/main/README.md/extra",
      "https://huggingface.co/datasets/bigcode/the-stack-v2/resolve/main/README.md",
      "https://huggingface.co/datasets/bigcode/the-stack-v2/raw/master/README.md",
      "https://huggingface.co/datasets/bigcode/another/raw/main/README.md",
      "https://huggingface.co/datasets/bigcode/the-stack-v2-extra/raw/main/README.md",
      "https://huggingface.co:444/datasets/bigcode/the-stack-v2/raw/main/README.md",
      "https://huggingface.co/datasets/bigcode/the-stack-v2/raw/main/README.md?download=true",
      "https://huggingface.co/datasets/bigcode/the-stack-v2/raw/main/README.md#terms",
    ];

    for (const url of nearby) {
      expect(() => authorizeRequest({ provider: "huggingFace", method: "GET", url }))
        .toThrow(RequestPolicyError);
    }
  });

  it("rebuilds redirects without origin secrets, cookies, signing state, or signed queries", () => {
    const redirected = authorizeRedirect({
      provider: "github",
      method: "GET",
      url: "https://api.github.com/search/commits?q=x&access_token=origin-secret",
      headers: {
        authorization: "Bearer origin-secret",
        cookie: "session=origin-secret",
        "x-amz-security-token": "origin-secret",
        accept: "application/json",
      },
    }, "https://huggingface.co/api/datasets/bigcode/the-stack-v2/revision/" + "a".repeat(40), "huggingFace", credentials);

    expect(redirected.headers).toEqual({ authorization: credentials.huggingFace });
    expect(redirected.url.search).toBe("");
    expect(() => authorizeRedirect(
      { provider: "github", method: "GET", url: "https://api.github.com/search/commits?q=x" },
      "https://softwareheritage.s3.amazonaws.com/content/x?X-Amz-Signature=secret",
      "softwareHeritage",
      credentials,
    )).toThrow(RequestPolicyError);
  });

  it("follows one observed Hugging Face CDN redirect without forwarding any credential", () => {
    const origin = {
      provider: "huggingFace" as const,
      method: "GET" as const,
      url: "https://huggingface.co/datasets/bigcode/the-stack-v2/resolve/" + "a".repeat(40) + "/data/Python/train-00000-of-00009.parquet",
      headers: { authorization: "Bearer origin-secret", cookie: "session=origin-secret", range: "bytes=0-9" },
    };
    const location = "https://us.aws.cdn.hf.co/repos/ab/cd/ef0123?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=target-signature&Expires=1";

    const redirected = authorizeRedirect(origin, location, "huggingFace", credentials);

    expect(redirected.provider).toBe("huggingFace");
    expect(redirected.method).toBe("GET");
    expect(redirected.url.href).toBe(location);
    expect(redirected.headers).toEqual({});
    expect(Object.isFrozen(redirected.headers)).toBe(true);
    expect(authorizeRedirect({ ...origin, method: "HEAD" }, location, "huggingFace", credentials).method).toBe("HEAD");

    for (const rejected of [
      "http://us.aws.cdn.hf.co/repos/x?X-Amz-Signature=s",
      "https://us.aws.cdn.hf.co:8443/repos/x?X-Amz-Signature=s",
      "https://user:pw@us.aws.cdn.hf.co/repos/x?X-Amz-Signature=s",
      "https://us.aws.cdn.hf.co/repos/x?X-Amz-Signature=s#fragment",
      "https://us.aws.cdn.hf.co/repos/../x?X-Amz-Signature=s",
      "https://cdn-lfs-us-1.hf.co/repos/x?X-Amz-Signature=s",
      "https://cas-bridge.xethub.hf.co/repos/x?X-Amz-Signature=s",
      "https://us.aws.cdn.hf.co.evil.test/repos/x?X-Amz-Signature=s",
      "https://huggingface.co/datasets/bigcode/the-stack-v2/resolve/" + "a".repeat(40) + "/x?X-Amz-Signature=s",
      "/relative/x",
    ]) {
      expect(() => authorizeRedirect(origin, rejected, "huggingFace", credentials)).toThrow(RequestPolicyError);
    }
    expect(() => authorizeRedirect(
      { provider: "github", method: "GET", url: "https://api.github.com/search/commits?q=x" },
      location,
      "huggingFace",
      credentials,
    )).toThrow(RequestPolicyError);
    expect(() => authorizeRedirect(origin, location, "softwareHeritage", credentials)).toThrow(RequestPolicyError);
  });

  it("rejects sensitive headers supplied outside the credential policy", () => {
    for (const [header, value] of [
      ["authorization", "Bearer smuggled"],
      ["cookie", "session=smuggled"],
      ["x-api-key", "smuggled"],
      ["api-key", "smuggled"],
      ["x-auth-token", "smuggled"],
      ["x-client-secret", "smuggled"],
      ["accept", "Bearer smuggled"],
      ["user-agent", "token=smuggled"],
    ] as const) {
      expect(() => authorizeRequest({
        provider: "github",
        method: "GET",
        url: "https://api.github.com/search/commits?q=x",
        headers: { [header]: value },
      })).toThrow(RequestPolicyError);
    }
  });

  it("accepts only exact benign caller headers and normalizes their names", () => {
    const authorized = authorizeRequest({
      provider: "github",
      method: "GET",
      url: "https://api.github.com/search/commits?q=x",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "codeguessr-local-preparer",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    expect(authorized.headers).toEqual({
      accept: "application/vnd.github+json",
      "user-agent": "codeguessr-local-preparer",
      "x-github-api-version": "2022-11-28",
    });
  });
});
