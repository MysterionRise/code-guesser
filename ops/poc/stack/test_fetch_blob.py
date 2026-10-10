import base64
import gzip
import hashlib
import io
import json
import os
import tempfile
import types
import unittest
from unittest.mock import patch

try:
    from fetch_blob import BlobFetchError, _main, fetch_selected_blobs, fetch_selected_blobs_with_counters
except (ModuleNotFoundError, ImportError):
    class BlobFetchError(Exception):
        def __init__(self, code):
            super().__init__(code)
            self.code = code

    def fetch_selected_blobs(*_args, **_kwargs):
        return []

    def fetch_selected_blobs_with_counters(*_args, **_kwargs):
        return [], {}

    def _main(*_args, **_kwargs):
        return 1


MAXIMUM_BLOB_BYTES = 256 * 1024


def limits(**overrides):
    value = {
        "blobAttempts": 50,
        "successfulBlobs": 50,
        "perBlobBytes": MAXIMUM_BLOB_BYTES,
        "totalBlobBytes": 16 * 1024 * 1024,
        "temporaryDiskBytes": 32 * 1024 * 1024,
        "requestLimit": 600,
        "networkByteLimit": MAXIMUM_BLOB_BYTES,
    }
    value.update(overrides)
    return value


BUCKET_HOST = "softwareheritage.s3.amazonaws.com"


def prepared_request(key, method="GET", url=None, query=""):
    return types.SimpleNamespace(
        method=method,
        url=url or f"https://{BUCKET_HOST}/{key}{query}",
        headers={"authorization": "AWS4-HMAC-SHA256 Credential=secret", "x-amz-date": "now"},
    )


def blob_id(content):
    return hashlib.sha1(content).hexdigest()


def content_id(content):
    header = f"blob {len(content)}\0".encode("ascii")
    return hashlib.sha1(header + content).hexdigest()


def selected_row(content=b"print('hello')\n", **overrides):
    value = {
        "stableRowId": hashlib.sha256(content).hexdigest(),
        "swhBlobId": blob_id(content),
        "swhContentId": content_id(content),
        "sourceEncoding": "UTF-8",
        "byteLength": len(content),
    }
    value.update(overrides)
    return value


class StreamingBody:
    def __init__(self, content):
        self._stream = io.BytesIO(gzip.compress(content))
        self.read_sizes = []
        self.closed = False

    def read(self, amount=None):
        self.read_sizes.append(amount)
        if not isinstance(amount, int) or amount <= 0:
            raise AssertionError("unbounded read")
        return self._stream.read(amount)

    def close(self):
        self.closed = True
        self._stream.close()


class RawBody(StreamingBody):
    def __init__(self, content):
        self._stream = io.BytesIO(content)
        self.read_sizes = []
        self.closed = False


class FakeEvents:
    def __init__(self):
        self.registrations = []

    def register(self, event_name, handler):
        self.registrations.append((event_name, handler))

    def emit(self, emitted_name, **kwargs):
        for registered_name, handler in self.registrations:
            if registered_name == emitted_name:
                handler(**kwargs)


class FakeS3:
    def __init__(self, contents=None, responses=None, failure=None, sends_per_call=1, prepare=None):
        self.contents = contents or {}
        self.responses = responses or {}
        self.failure = failure
        self.sends_per_call = sends_per_call
        self.prepare = prepare or prepared_request
        self.calls = []
        self.bodies = []
        self.meta = types.SimpleNamespace(events=FakeEvents())

    def get_object(self, **request):
        self.calls.append(request)
        if self.failure is not None:
            raise self.failure
        key = request["Key"]
        for _send in range(self.sends_per_call):
            self.meta.events.emit(
                "before-send.s3.GetObject", request=self.prepare(key), event_name="before-send.s3.GetObject",
            )
        if key in self.responses:
            response = self.responses[key]
            if "Body" in response:
                self.bodies.append(response["Body"])
            return response
        compressed = gzip.compress(self.contents[key])
        body = StreamingBody(self.contents[key])
        self.bodies.append(body)
        return {
            "Body": body,
            "ContentLength": len(compressed),
            "ResponseMetadata": {"HTTPStatusCode": 200, "HTTPHeaders": {}},
        }


class FakeSession:
    def __init__(self, client):
        self.s3 = client
        self.calls = []

    def client(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return self.s3


class FetchSelectedBlobTests(unittest.TestCase):
    def assert_code(self, code, callback):
        try:
            callback()
        except Exception as caught:
            self.assertIsInstance(caught, BlobFetchError)
            self.assertEqual(str(caught), code)
            self.assertEqual(caught.code, code)
        else:
            self.fail(f"BlobFetchError({code}) not raised")

    def run_fetch(self, rows, client):
        session = FakeSession(client)
        calls = []

        def factory():
            calls.append(())
            return session

        result = fetch_selected_blobs(rows, session_factory=factory)
        return result, calls, session

    def test_reads_only_exact_bucket_keys_with_external_session_and_streaming_gzip(self):
        first = b"print('first')\n"
        second = b"export const second = true;\n"
        rows = [selected_row(first), selected_row(second)]
        client = FakeS3({f"content/{blob_id(value)}": value for value in (first, second)})

        result, factory_calls, session = self.run_fetch(rows, client)

        self.assertEqual(factory_calls, [()])
        self.assertEqual(len(session.calls), 1)
        args, kwargs = session.calls[0]
        self.assertEqual(args, ("s3",))
        self.assertEqual(set(kwargs), {"region_name", "endpoint_url", "config"})
        self.assertEqual(kwargs["region_name"], "us-east-1")
        self.assertEqual(kwargs["endpoint_url"], "https://s3.amazonaws.com")
        config = kwargs["config"]
        self.assertEqual(config.retries, {"total_max_attempts": 1, "mode": "standard"})
        self.assertEqual((config.connect_timeout, config.read_timeout, config.max_pool_connections), (15, 15, 1))
        # The content bucket serves objects anonymously; no AWS signing material is ever attached.
        from botocore import UNSIGNED
        self.assertIs(config.signature_version, UNSIGNED)
        self.assertEqual(config.s3, {"addressing_style": "virtual"})
        self.assertEqual(
            [name for name, _handler in client.meta.events.registrations], ["before-send.s3.GetObject"],
        )
        self.assertEqual(client.calls, [
            {"Bucket": "softwareheritage", "Key": f"content/{blob_id(first)}"},
            {"Bucket": "softwareheritage", "Key": f"content/{blob_id(second)}"},
        ])
        self.assertEqual([entry["stableRowId"] for entry in result],
                         [row["stableRowId"] for row in rows])
        self.assertEqual([base64.b64decode(entry["contentBase64"]) for entry in result],
                         [first, second])
        self.assertTrue(all(body.closed for body in client.bodies))
        self.assertTrue(all(size > 0 for body in client.bodies for size in body.read_sizes))
        self.assertFalse(hasattr(client, "generate_presigned_url"))

    def test_enforces_exact_profile_lowered_limits_and_uses_zero_temporary_disk(self):
        first = b"1234"
        second = b"5678"
        rows = [selected_row(first), selected_row(second)]
        failures = [
            ("BLOB_ATTEMPTS", limits(blobAttempts=1)),
            ("SUCCESSFUL_BLOBS", limits(successfulBlobs=1)),
            ("DECLARED_SIZE_REJECTED", limits(perBlobBytes=3)),
            ("TOTAL_BLOB_BYTES", limits(totalBlobBytes=7)),
            ("LIMIT_RAISED", limits(blobAttempts=51)),
            ("LIMIT_RAISED", limits(requestLimit=601)),
            ("LIMIT_RAISED", limits(networkByteLimit=MAXIMUM_BLOB_BYTES + 1)),
            ("LIMIT_VALUE", limits(temporaryDiskBytes=0)),
            ("LIMIT_VALUE", limits(requestLimit=0)),
            ("LIMIT_SHAPE", {**limits(), "endpoint": "https://forbidden.test"}),
            ("LIMIT_SHAPE", {key: value for key, value in limits().items() if key != "requestLimit"}),
        ]
        for code, bounded in failures:
            calls = []
            self.assert_code(code, lambda configured=bounded: fetch_selected_blobs(
                rows, limits=configured, session_factory=lambda: calls.append(True)
            ))
            self.assertEqual(calls, [])

        client = FakeS3({f"content/{blob_id(value)}": value for value in (first, second)})
        with tempfile.TemporaryDirectory() as temporary:
            before = os.listdir(temporary)
            with patch.dict(os.environ, {"TMPDIR": temporary}):
                result = fetch_selected_blobs(
                    rows, limits=limits(temporaryDiskBytes=1),
                    session_factory=lambda: FakeSession(client),
                )
            self.assertEqual(len(result), 2)
            self.assertEqual(os.listdir(temporary), before)

    def test_rejects_nonselected_shape_identity_encoding_size_duplicates_and_attempt_overrun(self):
        valid = selected_row()
        other = selected_row(b"other")
        failures = [
            ("ROW_SHAPE_REJECTED", [{**valid, "credential": "secret"}]),
            ("ROW_IDENTITY_REJECTED", [{**valid, "stableRowId": "bad"}]),
            ("ROW_IDENTITY_REJECTED", [{**valid, "swhBlobId": "A" * 40}]),
            ("ROW_IDENTITY_REJECTED", [{**valid, "swhContentId": "bad"}]),
            ("ENCODING_REJECTED", [{**valid, "sourceEncoding": "latin-1"}]),
            ("DECLARED_SIZE_REJECTED", [{**valid, "byteLength": 0}]),
            ("DECLARED_SIZE_REJECTED", [{**valid, "byteLength": MAXIMUM_BLOB_BYTES + 1}]),
            ("ROW_DUPLICATE", [valid, valid]),
            ("ROW_DUPLICATE", [valid, {**other, "stableRowId": valid["stableRowId"]}]),
            ("ROW_DUPLICATE", [valid, {**other, "swhBlobId": valid["swhBlobId"]}]),
            ("ROW_DUPLICATE", [valid, {**other, "swhContentId": valid["swhContentId"]}]),
            ("BLOB_ATTEMPTS", [
                selected_row(f"value {index}".encode()) for index in range(51)
            ]),
        ]
        for code, rows in failures:
            calls = []
            self.assert_code(code, lambda values=rows: fetch_selected_blobs(
                values, session_factory=lambda: calls.append(True)
            ))
            self.assertEqual(calls, [])

    def test_rejects_decompression_decoding_identity_and_declared_size_mismatches(self):
        bad_utf8 = b"\xff"
        valid = b"print('valid')\n"
        cases = []
        invalid_gzip_body = RawBody(b"not-gzip")
        cases.append(("DECOMPRESSION_FAILED", selected_row(valid), {
            "Body": invalid_gzip_body,
            "ResponseMetadata": {"HTTPStatusCode": 200, "HTTPHeaders": {}},
        }))
        cases.extend([
            ("DECODING_FAILED", selected_row(bad_utf8), None),
            ("BLOB_ID_MISMATCH", selected_row(valid, swhBlobId="a" * 40), None),
            ("CONTENT_ID_MISMATCH", selected_row(valid, swhContentId="b" * 40), None),
            ("SIZE_MISMATCH", selected_row(valid, byteLength=len(valid) + 1), None),
        ])
        for code, row, response in cases:
            key = f"content/{row['swhBlobId']}"
            client = FakeS3(
                contents={key: bad_utf8 if code == "DECODING_FAILED" else valid},
                responses={key: response} if response is not None else None,
            )
            self.assert_code(code, lambda r=row, c=client: self.run_fetch([r], c))
            if client.bodies:
                self.assertTrue(client.bodies[0].closed)

    def test_rejects_decompressed_overrun_redirect_status_and_provider_failure_stably(self):
        bomb = b"x" * (MAXIMUM_BLOB_BYTES + 1)
        row = selected_row(bomb, byteLength=MAXIMUM_BLOB_BYTES)
        key = f"content/{row['swhBlobId']}"
        clients = [
            ("BLOB_BYTES", FakeS3({key: bomb})),
            ("REDIRECT_REJECTED", FakeS3(responses={key: {
                "Body": StreamingBody(b"x"), "WebsiteRedirectLocation": "https://elsewhere.test",
                "ResponseMetadata": {"HTTPStatusCode": 200, "HTTPHeaders": {}},
            }})),
            ("REDIRECT_REJECTED", FakeS3(responses={key: {
                "Body": StreamingBody(b"x"),
                "ResponseMetadata": {"HTTPStatusCode": 200, "HTTPHeaders": {"location": "hidden"}},
            }})),
            ("BLOB_UNAVAILABLE", FakeS3(responses={key: {
                "Body": StreamingBody(b"x"),
                "ResponseMetadata": {"HTTPStatusCode": 403, "HTTPHeaders": {}},
            }})),
            ("BLOB_UNAVAILABLE", FakeS3(failure=RuntimeError("AWS secret account@example.test"))),
        ]
        for code, client in clients:
            self.assert_code(code, lambda c=client: self.run_fetch([row], c))
            self.assertTrue(all(body.closed for body in client.bodies))
            if client.failure is not None:
                self.assertEqual(client.bodies, [])

    def test_rejects_streamed_total_overrun_after_admissible_declared_sizes(self):
        first = b"1234"
        second = b"56789"
        rows = [selected_row(first), selected_row(second, byteLength=4)]
        client = FakeS3({f"content/{blob_id(value)}": value for value in (first, second)})

        self.assert_code("TOTAL_BLOB_BYTES", lambda: fetch_selected_blobs(
            rows, limits=limits(perBlobBytes=10, totalBlobBytes=8),
            session_factory=lambda: FakeSession(client),
        ))

        self.assertEqual(len(client.calls), 2)
        self.assertTrue(all(body.closed for body in client.bodies))

    def test_before_send_guard_allows_exactly_one_send_per_get_object(self):
        content = b"print('guarded')\n"
        key = f"content/{blob_id(content)}"
        single = FakeS3({key: content})
        result, _calls, _session = self.run_fetch([selected_row(content)], single)
        self.assertEqual(len(result), 1)

        resent = FakeS3({key: content}, sends_per_call=2)
        self.assert_code("REQUEST_COUNT", lambda: self.run_fetch([selected_row(content)], resent))
        self.assertEqual(len(resent.calls), 1)
        self.assertEqual(resent.bodies, [])

    def test_before_send_rejects_unexpected_host_path_method_scheme_or_presigned_query(self):
        content = b"print('endpoint')\n"
        key = f"content/{blob_id(content)}"
        rejected = [
            lambda k: prepared_request(k, url=f"https://softwareheritage.s3.eu-west-1.amazonaws.com/{k}"),
            lambda k: prepared_request(k, url=f"https://s3.amazonaws.com/softwareheritage/{k}"),
            lambda k: prepared_request(k, url=f"http://{BUCKET_HOST}/{k}"),
            lambda k: prepared_request(k, url=f"https://{BUCKET_HOST}:8443/{k}"),
            lambda k: prepared_request(k, url=f"https://user:pass@{BUCKET_HOST}/{k}"),
            lambda k: prepared_request(k, url=f"https://{BUCKET_HOST}/other/{k[8:]}"),
            lambda k: prepared_request(k, url=f"https://{BUCKET_HOST}/{k}/extra"),
            lambda k: prepared_request(k, query="?X-Amz-Signature=abc&X-Amz-Credential=secret"),
            lambda k: prepared_request(k, method="PUT"),
            lambda k: prepared_request(k, method="HEAD"),
        ]
        for prepare in rejected:
            client = FakeS3({key: content}, prepare=prepare)
            self.assert_code("ENDPOINT_REJECTED", lambda c=client: self.run_fetch([selected_row(content)], c))
            self.assertEqual(client.bodies, [])

    def test_meters_compressed_network_bytes_and_rejects_declared_or_streamed_overrun(self):
        content = b"print('network metering is exact')\n"
        compressed = len(gzip.compress(content))
        key = f"content/{blob_id(content)}"
        row = selected_row(content)

        client = FakeS3({key: content})
        results, counters = fetch_selected_blobs_with_counters(
            [row], limits=limits(), session_factory=lambda: FakeSession(client),
        )
        self.assertEqual(len(results), 1)
        self.assertEqual(counters, {
            "networkBytes": compressed, "peakTemporaryDiskBytes": 0, "redirectsFollowed": 0, "requests": 1,
        })

        declared = FakeS3({key: content})
        self.assert_code("NETWORK_BYTES", lambda: fetch_selected_blobs(
            [row], limits=limits(networkByteLimit=compressed - 1), session_factory=lambda: FakeSession(declared),
        ))
        self.assertTrue(all(body.closed for body in declared.bodies))
        self.assertTrue(all(body.read_sizes == [] for body in declared.bodies))

        undeclared = FakeS3(responses={key: {
            "Body": StreamingBody(content),
            "ResponseMetadata": {"HTTPStatusCode": 200, "HTTPHeaders": {}},
        }})
        self.assert_code("NETWORK_BYTES", lambda: fetch_selected_blobs(
            [row], limits=limits(networkByteLimit=compressed - 1), session_factory=lambda: FakeSession(undeclared),
        ))
        self.assertTrue(all(body.closed for body in undeclared.bodies))

    def test_enforces_the_request_budget_across_rows(self):
        first = b"print('first')\n"
        second = b"print('second')\n"
        rows = [selected_row(first), selected_row(second)]
        client = FakeS3({f"content/{blob_id(value)}": value for value in (first, second)})

        self.assert_code("REQUEST_COUNT", lambda: fetch_selected_blobs(
            rows, limits=limits(requestLimit=1), session_factory=lambda: FakeSession(client),
        ))
        self.assertEqual(len(client.calls), 2)
        self.assertEqual(len(client.bodies), 1)
        self.assertTrue(client.bodies[0].closed)

    def test_bounded_cli_accepts_only_rows_and_limits_and_emits_canonical_ndjson(self):
        content = b"print('cli')\n"
        row = selected_row(content)
        client = FakeS3({f"content/{blob_id(content)}": content})
        stdin = io.BytesIO(json.dumps({"rows": [row], "limits": limits()}).encode("utf-8"))
        stdout = io.StringIO()
        stderr = io.StringIO()

        try:
            exit_code = _main(
                stdin=stdin, stdout=stdout, stderr=stderr,
                session_factory=lambda: FakeSession(client),
            )
        except Exception as caught:
            self.fail(f"bounded CLI raised {type(caught).__name__}")

        self.assertEqual(exit_code, 0)
        self.assertEqual(stderr.getvalue(), "")
        text = stdout.getvalue()
        self.assertTrue(text.endswith("\n"))
        self.assertNotIn(" ", text)
        line, trailer = text.splitlines()
        self.assertEqual(base64.b64decode(json.loads(line)["contentBase64"]), content)
        self.assertEqual(line, json.dumps(json.loads(line), separators=(",", ":")))
        self.assertEqual(json.loads(trailer), {"counters": {
            "networkBytes": len(gzip.compress(content)), "peakTemporaryDiskBytes": 0,
            "redirectsFollowed": 0, "requests": 1,
        }})
        self.assertEqual(trailer, json.dumps(json.loads(trailer), separators=(",", ":"), sort_keys=True))

        for value, code in [
            (b"x" * 65_537, "REQUEST_BYTES"),
            (json.dumps({"rows": [row], "limits": limits(), "url": "hidden"}).encode("utf-8"),
             "REQUEST_MALFORMED"),
        ]:
            output = io.StringIO()
            errors = io.StringIO()
            self.assertEqual(_main(
                stdin=io.BytesIO(value), stdout=output, stderr=errors,
                session_factory=lambda: self.fail("must not create session"),
            ), 1)
            self.assertEqual(errors.getvalue(), code + "\n")
            self.assertEqual(output.getvalue(), "")

    def test_exposes_only_stable_non_sensitive_errors(self):
        error = BlobFetchError("BLOB_UNAVAILABLE")
        self.assertEqual(error.code, "BLOB_UNAVAILABLE")
        self.assertEqual(str(error), "BLOB_UNAVAILABLE")
        self.assertNotIn("secret", str(error).lower())


if __name__ == "__main__":
    unittest.main()
