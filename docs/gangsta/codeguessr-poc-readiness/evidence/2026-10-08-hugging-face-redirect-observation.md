---
heist: codeguessr-poc-readiness
evidence: hugging-face-redirect-observation
observed-at: 2026-10-08T16:36:00Z
credential-material-recorded: false
---

# Hugging Face Redirect Observation

The operator authorized one headers-only observation of the host that the
pinned Stack v2 `resolve` endpoint redirects parquet reads to, so that the
Contract's exact redirect-host requirement could be satisfied with an observed
literal instead of a guess. Two authenticated, read-only requests were made
with the operator's own Hugging Face token supplied through the environment,
automatic redirects disabled, no retry, and no response body read.

1. One GET to the revision-addressed tree listing of `data/Python` at
   immutable revision `e565caa3a78c2423bd374333a472b049eb090e47`. It listed
   nine entries; the parquet shards are named `train-NNNNN-of-00009.parquet`.
   The listing was used only to learn one real shard filename.
2. One HEAD to the pinned `resolve` endpoint for the first shard,
   `train-00000-of-00009.parquet`. It answered HTTP `302`. The `Location`
   header's host is exactly `us.aws.cdn.hf.co`. An `X-Linked-Size` header was
   present; its value was not recorded.

The corrective boundary is exact: `us.aws.cdn.hf.co` becomes the single
literal in `REDIRECT_HOSTS` in `ops/poc/stack/bounded_http.py` and in the
Hugging Face redirect policy of `ops/poc/prepare/request-policy.ts`, each
added test-first. Every other host, scheme, port, userinfo, fragment, or
second hop still fails closed, and no origin credential, cookie, or signing
state is forwarded to the target host.

This observation confirms only the redirect target host. It does not inspect
or approve round content, establish rights, or authorize a full Stack download.

No token, full URL, redirect path, query string, signature, size value,
response body, dataset row, or account data is preserved.
