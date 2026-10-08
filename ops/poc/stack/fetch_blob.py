import base64
import codecs
import gzip
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from urllib.parse import urlsplit


BUCKET = "softwareheritage"
KEY_PREFIX = "content/"
REGION = "us-east-1"
ENDPOINT_URL = "https://s3.amazonaws.com"
BUCKET_HOST = f"{BUCKET}.s3.amazonaws.com"
KEY_PATH = re.compile(r"^/content/[0-9a-f]{40}$")
TIMEOUT_SECONDS = 15
MAXIMUM_ATTEMPTS = 50
MAXIMUM_BLOB_BYTES = 256 * 1024
MAXIMUM_TOTAL_BYTES = 16 * 1024 * 1024
MAXIMUM_TEMPORARY_BYTES = 32 * 1024 * 1024
MAXIMUM_REQUESTS = 200
MAXIMUM_REQUEST_BYTES = 64 * 1024
READ_BYTES = 64 * 1024
ROW_KEYS = {
    "stableRowId", "swhBlobId", "swhContentId", "sourceEncoding", "byteLength",
}
LIMIT_KEYS = {
    "blobAttempts", "successfulBlobs", "perBlobBytes", "totalBlobBytes",
    "temporaryDiskBytes", "requestLimit", "networkByteLimit",
}


@dataclass(frozen=True)
class BlobLimits:
    attempts: int
    successes: int
    per_blob_bytes: int
    total_blob_bytes: int
    temporary_disk_bytes: int
    request_limit: int
    network_byte_limit: int


SIGNED_LIMITS = BlobLimits(
    MAXIMUM_ATTEMPTS, MAXIMUM_ATTEMPTS, MAXIMUM_BLOB_BYTES,
    MAXIMUM_TOTAL_BYTES, MAXIMUM_TEMPORARY_BYTES, MAXIMUM_REQUESTS, MAXIMUM_BLOB_BYTES,
)


class BlobFetchError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _fail(code):
    raise BlobFetchError(code)


def _hex(value, length):
    if not isinstance(value, str) or len(value) != length:
        _fail("ROW_IDENTITY_REJECTED")
    if any(character not in "0123456789abcdef" for character in value):
        _fail("ROW_IDENTITY_REJECTED")
    return value


def _parse_limits(value):
    if value is None:
        return SIGNED_LIMITS
    if not isinstance(value, dict) or set(value) != LIMIT_KEYS:
        _fail("LIMIT_SHAPE")
    maxima = {
        "blobAttempts": MAXIMUM_ATTEMPTS,
        "successfulBlobs": MAXIMUM_ATTEMPTS,
        "perBlobBytes": MAXIMUM_BLOB_BYTES,
        "totalBlobBytes": MAXIMUM_TOTAL_BYTES,
        "temporaryDiskBytes": MAXIMUM_TEMPORARY_BYTES,
        "requestLimit": MAXIMUM_REQUESTS,
        "networkByteLimit": MAXIMUM_BLOB_BYTES,
    }
    for key, maximum in maxima.items():
        if isinstance(value[key], bool) or not isinstance(value[key], int) or value[key] < 1:
            _fail("LIMIT_VALUE")
        if value[key] > maximum:
            _fail("LIMIT_RAISED")
    return BlobLimits(
        value["blobAttempts"], value["successfulBlobs"], value["perBlobBytes"],
        value["totalBlobBytes"], value["temporaryDiskBytes"],
        value["requestLimit"], value["networkByteLimit"],
    )


def _validate_rows(rows, limits):
    if not isinstance(rows, list) or not rows or len(rows) > limits.attempts:
        _fail("BLOB_ATTEMPTS")
    if len(rows) > limits.successes:
        _fail("SUCCESSFUL_BLOBS")
    parsed = []
    for row in rows:
        if not isinstance(row, dict) or set(row) != ROW_KEYS:
            _fail("ROW_SHAPE_REJECTED")
        size = row["byteLength"]
        if row["sourceEncoding"] != "UTF-8":
            _fail("ENCODING_REJECTED")
        if isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= limits.per_blob_bytes:
            _fail("DECLARED_SIZE_REJECTED")
        parsed.append({
            "stableRowId": _hex(row["stableRowId"], 64),
            "swhBlobId": _hex(row["swhBlobId"], 40),
            "swhContentId": _hex(row["swhContentId"], 40),
            "sourceEncoding": "UTF-8",
            "byteLength": size,
        })
    for key in ("stableRowId", "swhBlobId", "swhContentId"):
        identities = [row[key] for row in parsed]
        if len(set(identities)) != len(identities):
            _fail("ROW_DUPLICATE")
    if sum(row["byteLength"] for row in parsed) > limits.total_blob_bytes:
        _fail("TOTAL_BLOB_BYTES")
    return parsed


def _default_session():
    import boto3
    return boto3.Session()


def _client_configuration():
    from botocore import UNSIGNED
    from botocore.config import Config
    # The Software Heritage content bucket serves objects anonymously (observed 2026-10-08),
    # so requests carry no AWS signing material and no credential can cross to the bucket host.
    return {
        "region_name": REGION,
        "endpoint_url": ENDPOINT_URL,
        "config": Config(
            retries={"total_max_attempts": 1, "mode": "standard"},
            connect_timeout=TIMEOUT_SECONDS, read_timeout=TIMEOUT_SECONDS,
            max_pool_connections=1, signature_version=UNSIGNED,
            s3={"addressing_style": "virtual"},
        ),
    }


class _NetworkBudget:
    def __init__(self, limits):
        self.request_limit = limits.request_limit
        self.byte_limit = limits.network_byte_limit
        self.requests = 0
        self.network_bytes = 0

    def begin_request(self):
        if self.requests >= self.request_limit:
            _fail("REQUEST_COUNT")
        self.requests += 1

    def add_bytes(self, count):
        if count < 0 or self.network_bytes + count > self.byte_limit:
            _fail("NETWORK_BYTES")
        self.network_bytes += count

    def remaining_bytes(self):
        return self.byte_limit - self.network_bytes

    def counters(self):
        return {
            "networkBytes": self.network_bytes,
            "peakTemporaryDiskBytes": 0,
            "redirectsFollowed": 0,
            "requests": self.requests,
        }


class _SendGuard:
    """Runs on botocore's before-send hook: exact endpoint, one send per operation, request budget."""

    def __init__(self, budget):
        self.budget = budget
        self.sends = 0

    def begin_operation(self):
        self.sends = 0

    def __call__(self, request, **_kwargs):
        method = getattr(request, "method", None)
        url = getattr(request, "url", None)
        if method != "GET" or not isinstance(url, str):
            _fail("ENDPOINT_REJECTED")
        parts = urlsplit(url)
        if (parts.scheme != "https" or parts.netloc != BUCKET_HOST or parts.username is not None
                or parts.port is not None or parts.query or parts.fragment
                or not KEY_PATH.fullmatch(parts.path)):
            _fail("ENDPOINT_REJECTED")
        self.sends += 1
        if self.sends > 1:
            _fail("REQUEST_COUNT")
        self.budget.begin_request()


class _MeteredBody:
    def __init__(self, body, budget):
        self._body = body
        self._budget = budget

    def read(self, amount=None):
        chunk = self._body.read(amount)
        self._budget.add_bytes(len(chunk))
        return chunk

    def close(self):
        _close(self._body)


def _create_client(factory, budget):
    try:
        client = factory().client("s3", **_client_configuration())
        guard = _SendGuard(budget)
        client.meta.events.register("before-send.s3.GetObject", guard)
    except Exception:
        _fail("BLOB_UNAVAILABLE")
    return client, guard


def _response_body(client, guard, budget, row):
    guard.begin_operation()
    try:
        response = client.get_object(
            Bucket=BUCKET, Key=KEY_PREFIX + row["swhBlobId"],
        )
    except BlobFetchError:
        raise
    except Exception:
        _fail("BLOB_UNAVAILABLE")
    if not isinstance(response, dict):
        _fail("BLOB_UNAVAILABLE")
    body = response.get("Body")
    metadata = response.get("ResponseMetadata")
    headers = metadata.get("HTTPHeaders") if isinstance(metadata, dict) else None
    if response.get("WebsiteRedirectLocation") is not None:
        _close(body)
        _fail("REDIRECT_REJECTED")
    if isinstance(headers, dict) and any(key.lower() == "location" for key in headers):
        _close(body)
        _fail("REDIRECT_REJECTED")
    if not isinstance(metadata, dict) or metadata.get("HTTPStatusCode") != 200:
        _close(body)
        _fail("BLOB_UNAVAILABLE")
    if not callable(getattr(body, "read", None)) or not callable(getattr(body, "close", None)):
        _fail("BLOB_UNAVAILABLE")
    declared = response.get("ContentLength")
    if declared is not None:
        if isinstance(declared, bool) or not isinstance(declared, int) or declared < 0:
            _close(body)
            _fail("BLOB_UNAVAILABLE")
        if declared > budget.remaining_bytes():
            _close(body)
            _fail("NETWORK_BYTES")
    return _MeteredBody(body, budget)


def _close(body):
    close = getattr(body, "close", None)
    if callable(close):
        try:
            close()
        except Exception:
            pass


def _decompress(body, remaining, per_blob_bytes):
    content = bytearray()
    ceiling = min(per_blob_bytes, remaining)
    try:
        with gzip.GzipFile(fileobj=body, mode="rb") as stream:
            while True:
                chunk = stream.read(min(READ_BYTES, ceiling - len(content) + 1))
                if not chunk:
                    return content
                content.extend(chunk)
                if len(content) > ceiling:
                    _fail("BLOB_BYTES" if ceiling == per_blob_bytes else "TOTAL_BLOB_BYTES")
    except BlobFetchError:
        content[:] = b"\0" * len(content)
        raise
    except Exception:
        content[:] = b"\0" * len(content)
        _fail("DECOMPRESSION_FAILED")


def _validate_content(row, content):
    try:
        decoder = codecs.getincrementaldecoder("utf-8")("strict")
        for offset in range(0, len(content), READ_BYTES):
            decoder.decode(memoryview(content)[offset:offset + READ_BYTES], final=False)
        decoder.decode(b"", final=True)
    except UnicodeDecodeError:
        _fail("DECODING_FAILED")
    if len(content) != row["byteLength"]:
        _fail("SIZE_MISMATCH")
    if hashlib.sha1(content).hexdigest() != row["swhBlobId"]:
        _fail("BLOB_ID_MISMATCH")
    header = f"blob {len(content)}\0".encode("ascii")
    digest = hashlib.sha1()
    digest.update(header)
    digest.update(content)
    if digest.hexdigest() != row["swhContentId"]:
        _fail("CONTENT_ID_MISMATCH")


def fetch_selected_blobs_with_counters(rows, *, limits=None, session_factory=None):
    bounded = _parse_limits(limits)
    selected = _validate_rows(rows, bounded)
    factory = _default_session if session_factory is None else session_factory
    budget = _NetworkBudget(bounded)
    client, guard = _create_client(factory, budget)
    results = []
    total = 0
    for row in selected:
        body = _response_body(client, guard, budget, row)
        content = None
        try:
            content = _decompress(body, bounded.total_blob_bytes - total, bounded.per_blob_bytes)
            _validate_content(row, content)
            total += len(content)
            results.append({
                "stableRowId": row["stableRowId"],
                "swhBlobId": row["swhBlobId"],
                "contentBase64": base64.b64encode(content).decode("ascii"),
                "byteLength": len(content),
            })
        finally:
            if content is not None:
                content[:] = b"\0" * len(content)
            _close(body)
    return tuple(results), budget.counters()


def fetch_selected_blobs(rows, *, limits=None, session_factory=None):
    results, _counters = fetch_selected_blobs_with_counters(
        rows, limits=limits, session_factory=session_factory,
    )
    return results


def _read_request(stream):
    raw = stream.read(MAXIMUM_REQUEST_BYTES + 1)
    if not isinstance(raw, bytes) or len(raw) > MAXIMUM_REQUEST_BYTES:
        _fail("REQUEST_BYTES")
    try:
        return json.loads(raw.decode("utf-8", errors="strict"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        _fail("REQUEST_MALFORMED")


def _main(*, stdin=None, stdout=None, stderr=None, session_factory=None):
    active_input = sys.stdin.buffer if stdin is None else stdin
    active_output = sys.stdout if stdout is None else stdout
    active_error = sys.stderr if stderr is None else stderr
    try:
        request = _read_request(active_input)
        if not isinstance(request, dict) or set(request) != {"rows", "limits"}:
            _fail("REQUEST_MALFORMED")
        results, counters = fetch_selected_blobs_with_counters(
            request["rows"], limits=request["limits"], session_factory=session_factory,
        )
        for result in results:
            active_output.write(json.dumps(result, separators=(",", ":")) + "\n")
        active_output.write(json.dumps({"counters": counters}, separators=(",", ":"), sort_keys=True) + "\n")
        return 0
    except BlobFetchError as error:
        active_error.write(error.code + "\n")
        return 1
    except Exception:
        active_error.write("REQUEST_MALFORMED\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(_main())
