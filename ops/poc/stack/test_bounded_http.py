import unittest

import httpx

from bounded_http import (
    BoundedHttpError, BoundedHttpTransport, NetworkBudget, REDIRECT_HOSTS,
    create_client, install_bounded_backend, measure_tree,
)


REVISION = "e565caa3a78c2423bd374333a472b049eb090e47"
HOST = "https://huggingface.co"


class FakeInner:
    def __init__(self, responses=None, failure=None):
        self.responses = list(responses or [])
        self.failure = failure
        self.requests = []

    def handle_request(self, request):
        self.requests.append(request)
        if self.failure is not None:
            raise self.failure
        status, headers, body = self.responses.pop(0)
        # Build from a stream so no content-length is implied unless the case declares one.
        return httpx.Response(status, headers=headers, stream=httpx.ByteStream(body), request=request)

    def close(self):
        pass


def client_with(inner, request_limit=10, byte_limit=1024):
    budget = NetworkBudget(request_limit, byte_limit)
    return create_client(budget, inner=inner), budget


class BoundedHttpTests(unittest.TestCase):
    def assert_code(self, code, callback):
        with self.assertRaises(BoundedHttpError) as caught:
            callback()
        self.assertEqual(caught.exception.code, code)
        self.assertEqual(str(caught.exception), code)

    def test_allows_only_https_get_and_head_on_exact_dataset_endpoints(self):
        allowed = [
            f"{HOST}/api/datasets/bigcode/the-stack-v2",
            f"{HOST}/api/datasets/bigcode/the-stack-v2/revision/{REVISION}",
            f"{HOST}/api/datasets/bigcode/the-stack-v2/tree/{REVISION}",
            f"{HOST}/api/datasets/bigcode/the-stack-v2/tree/{REVISION}/data/Python?recursive=true&expand=false",
            f"{HOST}/datasets/bigcode/the-stack-v2/resolve/{REVISION}/README.md",
            f"{HOST}/datasets/bigcode/the-stack-v2/resolve/{REVISION}/data/Python/train-00000.parquet",
            f"{HOST}/datasets/bigcode/the-stack-v2/raw/{REVISION}/README.md",
        ]
        for url in allowed:
            for method in ("GET", "HEAD"):
                inner = FakeInner([(200, {"content-length": "2"}, b"ok")])
                client, budget = client_with(inner)
                response = client.request(method, url, headers={"authorization": "Bearer external"})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content, b"ok")
                self.assertEqual(len(inner.requests), 1)
                self.assertEqual(inner.requests[0].headers.get("authorization"), "Bearer external")
                self.assertEqual(budget.counters(), {
                    "networkBytes": 2, "peakTemporaryDiskBytes": 0, "redirectsFollowed": 0, "requests": 1,
                })

    def test_rejects_other_hosts_schemes_ports_methods_paths_and_query_credentials(self):
        rejected = [
            ("HOST_REJECTED", "GET", "https://datasets-server.huggingface.co/parquet?dataset=bigcode/the-stack-v2"),
            ("HOST_REJECTED", "GET", "https://cdn-lfs.huggingface.co/datasets/bigcode/the-stack-v2/resolve/x"),
            ("HOST_REJECTED", "GET", "https://hf.co/api/datasets/bigcode/the-stack-v2"),
            ("HOST_REJECTED", "GET", "http://huggingface.co/api/datasets/bigcode/the-stack-v2"),
            ("HOST_REJECTED", "GET", "https://huggingface.co:8443/api/datasets/bigcode/the-stack-v2"),
            ("HOST_REJECTED", "GET", "https://user:secret@huggingface.co/api/datasets/bigcode/the-stack-v2"),
            ("WRITE_METHOD_REJECTED", "POST", f"{HOST}/api/datasets/bigcode/the-stack-v2/paths-info/{REVISION}"),
            ("WRITE_METHOD_REJECTED", "PUT", f"{HOST}/api/datasets/bigcode/the-stack-v2"),
            ("ENDPOINT_REJECTED", "GET", f"{HOST}/api/datasets/bigcode/the-stack-v2/revision/main"),
            ("ENDPOINT_REJECTED", "GET", f"{HOST}/api/datasets/bigcode/the-stack"),
            ("ENDPOINT_REJECTED", "GET", f"{HOST}/datasets/bigcode/the-stack-v2/resolve/main/README.md"),
            ("ENDPOINT_REJECTED", "GET", f"{HOST}/api/models/bigcode/the-stack-v2"),
            ("ENDPOINT_REJECTED", "GET", f"{HOST}/api/datasets/bigcode/the-stack-v2/tree/{REVISION}/../secret"),
            ("ENDPOINT_REJECTED", "GET", f"{HOST}/api/whoami-v2"),
            ("QUERY_REJECTED", "GET", f"{HOST}/api/datasets/bigcode/the-stack-v2?token=secret"),
            ("QUERY_REJECTED", "GET", f"{HOST}/datasets/bigcode/the-stack-v2/resolve/{REVISION}/README.md?X-Amz-Signature=abc"),
        ]
        for code, method, url in rejected:
            inner = FakeInner([(200, {}, b"ok")])
            client, budget = client_with(inner)
            self.assert_code(code, lambda m=method, u=url: client.request(m, u))
            self.assertEqual(inner.requests, [])
            self.assertEqual(budget.counters()["requests"], 0)

    def test_counts_requests_and_fails_closed_at_the_request_limit(self):
        inner = FakeInner([(200, {}, b"a")] * 3)
        client, budget = client_with(inner, request_limit=2)
        client.get(f"{HOST}/api/datasets/bigcode/the-stack-v2")
        client.get(f"{HOST}/api/datasets/bigcode/the-stack-v2")
        self.assert_code("REQUEST_COUNT", lambda: client.get(f"{HOST}/api/datasets/bigcode/the-stack-v2"))
        self.assertEqual(len(inner.requests), 2)
        self.assertEqual(budget.counters()["requests"], 2)

    def test_meters_declared_and_streamed_bytes_against_the_network_limit(self):
        declared = FakeInner([(200, {"content-length": "11"}, b"0123456789a")])
        client, budget = client_with(declared, byte_limit=10)
        self.assert_code("NETWORK_BYTES", lambda: client.get(f"{HOST}/api/datasets/bigcode/the-stack-v2"))
        self.assertEqual(budget.counters()["networkBytes"], 0)

        undeclared = FakeInner([(200, {}, b"0123456789a")])
        client, budget = client_with(undeclared, byte_limit=10)
        self.assert_code("NETWORK_BYTES", lambda: client.get(f"{HOST}/api/datasets/bigcode/the-stack-v2"))
        self.assertLessEqual(budget.counters()["networkBytes"], 11)

        exact = FakeInner([(200, {}, b"0123456789"), (200, {"content-length": "1"}, b"x")])
        client, budget = client_with(exact, byte_limit=10)
        self.assertEqual(client.get(f"{HOST}/api/datasets/bigcode/the-stack-v2").content, b"0123456789")
        self.assertEqual(budget.counters()["networkBytes"], 10)
        self.assert_code("NETWORK_BYTES", lambda: client.get(f"{HOST}/api/datasets/bigcode/the-stack-v2"))
        self.assertEqual(budget.counters()["networkBytes"], 10)

    def test_raises_on_unsupported_status_without_body_read_so_backoff_never_retries(self):
        for status in (401, 403, 404, 408, 429, 500, 503):
            inner = FakeInner([(status, {"retry-after": "1", "content-length": "6"}, b"secret")] * 2)
            client, budget = client_with(inner)
            self.assert_code("UNSUPPORTED_STATUS", lambda: client.get(f"{HOST}/api/datasets/bigcode/the-stack-v2"))
            self.assertEqual(len(inner.requests), 1)
            self.assertEqual(budget.counters()["networkBytes"], 0)

    def test_passes_an_absent_entry_404_on_the_pinned_file_endpoints_through_body_free(self):
        # The Hub client decides "no loading script" from a 404 on the file endpoints; the
        # answer passes through with its headers, no body, and no bytes charged.
        for method in ("HEAD", "GET"):
            inner = FakeInner([(404, {"x-error-code": "EntryNotFound", "content-length": "6"}, b"secret")] * 2)
            client, budget = client_with(inner)
            response = client.request(method, f"{HOST}/datasets/bigcode/the-stack-v2/resolve/{REVISION}/the-stack-v2.py")
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.headers.get("x-error-code"), "EntryNotFound")
            self.assertEqual(response.content, b"")
            self.assertEqual(len(inner.requests), 1)
            self.assertEqual(budget.counters(), {
                "networkBytes": 0, "peakTemporaryDiskBytes": 0, "redirectsFollowed": 0, "requests": 1,
            })
        # Every other status on the file endpoints, and a 404 on the API family, still fail closed.
        for status in (401, 403, 410, 429, 500):
            inner = FakeInner([(status, {"content-length": "6"}, b"secret")] * 2)
            client, budget = client_with(inner)
            self.assert_code("UNSUPPORTED_STATUS", lambda: client.head(
                f"{HOST}/datasets/bigcode/the-stack-v2/resolve/{REVISION}/the-stack-v2.py"))
            self.assertEqual(len(inner.requests), 1)
        inner = FakeInner([(404, {"x-error-code": "EntryNotFound"}, b"")] * 2)
        client, budget = client_with(inner)
        self.assert_code("UNSUPPORTED_STATUS", lambda: client.get(f"{HOST}/api/datasets/bigcode/the-stack-v2"))
        self.assertEqual(len(inner.requests), 1)

    def test_redirects_follow_only_the_observed_hugging_face_cdn_host(self):
        # Observed under authorization on 2026-10-08: a HEAD on the pinned
        # resolve endpoint answered 302 with this exact target host.
        self.assertEqual(REDIRECT_HOSTS, frozenset({"us.aws.cdn.hf.co"}))

        followed = FakeInner([
            (302, {"location": "https://us.aws.cdn.hf.co/repos/x?X-Amz-Signature=abc&Expires=1"}, b""),
            (206, {"content-length": "10"}, b"0123456789"),
        ])
        client, budget = client_with(followed)
        response = client.get(
            f"{HOST}/datasets/bigcode/the-stack-v2/resolve/{REVISION}/data/Python/train-00000-of-00009.parquet",
            headers={"authorization": "Bearer external", "cookie": "session=1", "range": "bytes=0-9"},
        )
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.content, b"0123456789")
        follow = followed.requests[1]
        self.assertEqual(follow.url.host, "us.aws.cdn.hf.co")
        self.assertEqual(follow.url.query, b"X-Amz-Signature=abc&Expires=1")
        self.assertNotIn("authorization", follow.headers)
        self.assertNotIn("cookie", follow.headers)
        self.assertEqual(follow.headers.get("host"), "us.aws.cdn.hf.co")
        self.assertEqual(follow.headers.get("range"), "bytes=0-9")
        self.assertEqual(budget.counters()["redirectsFollowed"], 1)

        for unobserved in ["cdn-lfs-us-1.hf.co", "cdn-lfs.hf.co", "cas-bridge.xethub.hf.co", "huggingface.co"]:
            inner = FakeInner([
                (302, {"location": f"https://{unobserved}/repos/x?X-Amz-Signature=abc"}, b""),
                (200, {}, b"never"),
            ])
            client, budget = client_with(inner)
            self.assert_code("REDIRECT_REJECTED", lambda: client.get(
                f"{HOST}/datasets/bigcode/the-stack-v2/resolve/{REVISION}/data/Python/train-00000-of-00009.parquet",
                headers={"authorization": "Bearer external", "range": "bytes=0-9"},
            ))
            self.assertEqual(len(inner.requests), 1)
            self.assertEqual(budget.counters()["redirectsFollowed"], 0)

    def test_follows_one_redirect_to_an_allowlisted_host_with_origin_credentials_stripped(self):
        import bounded_http
        original = bounded_http.REDIRECT_HOSTS
        bounded_http.REDIRECT_HOSTS = frozenset({"cdn.example.test"})
        try:
            inner = FakeInner([
                (302, {"location": "https://cdn.example.test/repos/x?X-Amz-Signature=abc"}, b""),
                (206, {"content-length": "10"}, b"0123456789"),
            ])
            client, budget = client_with(inner)
            response = client.get(
                f"{HOST}/datasets/bigcode/the-stack-v2/resolve/{REVISION}/data/Python/train-00000.parquet",
                headers={"authorization": "Bearer external", "cookie": "session=1", "range": "bytes=0-9"},
            )
            self.assertEqual(response.status_code, 206)
            self.assertEqual(response.content, b"0123456789")
            self.assertEqual(len(inner.requests), 2)
            follow = inner.requests[1]
            self.assertEqual(str(follow.url), "https://cdn.example.test/repos/x?X-Amz-Signature=abc")
            self.assertNotIn("authorization", follow.headers)
            self.assertNotIn("cookie", follow.headers)
            # The rebuilt request addresses the target host; the origin Host header never carries over.
            self.assertEqual(follow.headers.get("host"), "cdn.example.test")
            self.assertEqual(follow.headers.get("range"), "bytes=0-9")
            self.assertEqual(budget.counters(), {
                "networkBytes": 10, "peakTemporaryDiskBytes": 0, "redirectsFollowed": 1, "requests": 2,
            })

            for location in [
                "https://other.example.test/x",
                "http://cdn.example.test/x",
                "https://cdn.example.test:8443/x",
                "https://user:pw@cdn.example.test/x",
                "/relative/x",
            ]:
                inner = FakeInner([(302, {"location": location}, b""), (200, {}, b"never")])
                client, budget = client_with(inner)
                self.assert_code("REDIRECT_REJECTED", lambda: client.get(
                    f"{HOST}/datasets/bigcode/the-stack-v2/resolve/{REVISION}/README.md"))
                self.assertEqual(len(inner.requests), 1)

            chained = FakeInner([
                (302, {"location": "https://cdn.example.test/x"}, b""),
                (302, {"location": "https://cdn.example.test/y"}, b""),
                (200, {}, b"never"),
            ])
            client, budget = client_with(chained)
            self.assert_code("REDIRECT_REJECTED", lambda: client.get(
                f"{HOST}/datasets/bigcode/the-stack-v2/resolve/{REVISION}/README.md"))
            self.assertEqual(len(chained.requests), 2)

            missing = FakeInner([(302, {}, b""), (200, {}, b"never")])
            client, budget = client_with(missing)
            self.assert_code("REDIRECT_REJECTED", lambda: client.get(
                f"{HOST}/datasets/bigcode/the-stack-v2/resolve/{REVISION}/README.md"))
        finally:
            bounded_http.REDIRECT_HOSTS = original

    def test_network_exceptions_fail_closed_without_retry_and_without_detail(self):
        for failure in (httpx.ConnectTimeout("Bearer leaked"), httpx.ReadError("account@example.test"),
                        httpx.RemoteProtocolError("x"), RuntimeError("secret")):
            inner = FakeInner(failure=failure)
            client, budget = client_with(inner)
            with self.assertRaises(BoundedHttpError) as caught:
                client.get(f"{HOST}/api/datasets/bigcode/the-stack-v2")
            self.assertEqual(caught.exception.code, "NETWORK_FAILED")
            self.assertNotIsInstance(caught.exception, httpx.TransportError)
            self.assertNotIn("leaked", str(caught.exception))
            self.assertEqual(len(inner.requests), 1)

    def test_installs_sync_factory_with_redirects_disabled_and_async_fails_closed(self):
        installed = {}
        budget = NetworkBudget(3, 100)
        install_bounded_backend(
            budget, inner=FakeInner([(200, {}, b"ok")]),
            set_client_factory=lambda factory: installed.setdefault("sync", factory),
            set_async_client_factory=lambda factory: installed.setdefault("async", factory),
        )
        self.assertEqual(set(installed), {"sync", "async"})
        client = installed["sync"]()
        self.assertIsInstance(client, httpx.Client)
        self.assertFalse(client.follow_redirects)
        self.assertIsInstance(client._transport, BoundedHttpTransport)
        self.assertEqual(client.timeout, httpx.Timeout(15.0))
        self.assertEqual(client.get(f"{HOST}/api/datasets/bigcode/the-stack-v2").content, b"ok")
        self.assert_code("ASYNC_CLIENT_REJECTED", installed["async"])

    def test_measures_allocated_bytes_without_following_symlinks(self):
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as root:
            with open(os.path.join(root, "data.bin"), "wb") as handle:
                handle.write(b"\0" * (512 * 1024))
            os.makedirs(os.path.join(root, "nested"))
            with open(os.path.join(root, "nested", "more.bin"), "wb") as handle:
                handle.write(b"\1" * (256 * 1024))
            os.symlink("/", os.path.join(root, "escape"))
            measured = measure_tree(root)
            self.assertGreaterEqual(measured, 768 * 1024)
            self.assertLess(measured, 2 * 1024 * 1024)
            self.assertEqual(measure_tree(os.path.join(root, "missing")), 0)


if __name__ == "__main__":
    unittest.main()
