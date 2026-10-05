"""Bounded HTTP backend for the locked Stack metadata worker.

Every Hugging Face request issued by ``datasets``/``huggingface_hub`` passes
through this transport. It allowlists exact hosts and endpoint families,
permits only HTTPS GET/HEAD, counts requests and received bytes against the
budget the Node preparer handed over, never follows a redirect automatically,
and never returns a retryable status or transport exception to the Hub
client's backoff loop, so no retry can happen outside the signed ceilings.
"""

import os
import re

import httpx


ALLOWED_HOST = "huggingface.co"
DATASET = "bigcode/the-stack-v2"
PINNED_REVISION = "e565caa3a78c2423bd374333a472b049eb090e47"
# Exact hosts a resolve redirect may target. None has been observed under
# authorization yet, so redirects fail closed until an observation adds one.
REDIRECT_HOSTS = frozenset()
MAXIMUM_REQUESTS = 200
MAXIMUM_NETWORK_BYTES = 64 * 1024 * 1024
TIMEOUT_SECONDS = 15.0
READ_METHODS = ("GET", "HEAD")
ORIGIN_ONLY_HEADERS = ("authorization", "cookie", "x-request-id")
CREDENTIAL_QUERY = re.compile(
    r"(?i)(?:^|[?&])(?:token|access_token|authorization|signature|x-amz-[a-z-]+|key|secret|credential)=",
)
ENDPOINT_PATTERNS = tuple(re.compile(pattern) for pattern in (
    rf"^/api/datasets/{re.escape(DATASET)}$",
    rf"^/api/datasets/{re.escape(DATASET)}/revision/{PINNED_REVISION}$",
    rf"^/api/datasets/{re.escape(DATASET)}/tree/{PINNED_REVISION}(?:/[^/]+)*$",
    rf"^/datasets/{re.escape(DATASET)}/(?:resolve|raw)/{PINNED_REVISION}/[^/]+(?:/[^/]+)*$",
))
HUB_HARDENING = {
    "HF_HUB_DISABLE_XET": "1",
    "HF_HUB_DISABLE_TELEMETRY": "1",
    "HF_HUB_DISABLE_IMPLICIT_TOKEN": "1",
    "HF_HUB_DISABLE_PROGRESS_BARS": "1",
    "HF_HUB_ETAG_TIMEOUT": "15",
    "HF_HUB_DOWNLOAD_TIMEOUT": "15",
}


class BoundedHttpError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _fail(code):
    raise BoundedHttpError(code)


def _bounded(value, maximum, code):
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
        _fail(code)
    return value


class NetworkBudget:
    """Request and received-byte counters shared by every request of one worker run."""

    def __init__(self, request_limit, byte_limit):
        self.request_limit = _bounded(request_limit, MAXIMUM_REQUESTS, "REQUEST_LIMIT_REJECTED")
        self.byte_limit = _bounded(byte_limit, MAXIMUM_NETWORK_BYTES, "NETWORK_LIMIT_REJECTED")
        self.requests = 0
        self.network_bytes = 0
        self.redirects_followed = 0
        self.peak_temporary_disk_bytes = 0

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

    def observe_temporary_disk(self, measured):
        self.peak_temporary_disk_bytes = max(self.peak_temporary_disk_bytes, measured)

    def counters(self):
        return {
            "networkBytes": self.network_bytes,
            "peakTemporaryDiskBytes": self.peak_temporary_disk_bytes,
            "redirectsFollowed": self.redirects_followed,
            "requests": self.requests,
        }


class MeteredStream(httpx.SyncByteStream):
    def __init__(self, inner, budget):
        self._inner = inner
        self._budget = budget

    def __iter__(self):
        for chunk in self._inner:
            self._budget.add_bytes(len(chunk))
            yield chunk

    def close(self):
        close = getattr(self._inner, "close", None)
        if callable(close):
            close()


def _validate_target(url, method):
    if method.upper() not in READ_METHODS:
        _fail("WRITE_METHOD_REJECTED")
    if url.scheme != "https" or url.host != ALLOWED_HOST or url.port is not None or url.userinfo:
        _fail("HOST_REJECTED")
    path = url.path
    if "/../" in f"{path}/" or not any(pattern.fullmatch(path) for pattern in ENDPOINT_PATTERNS):
        _fail("ENDPOINT_REJECTED")
    if url.query and CREDENTIAL_QUERY.search(url.query.decode("ascii", errors="replace")):
        _fail("QUERY_REJECTED")


def _validate_redirect(location):
    if not isinstance(location, str) or not location:
        _fail("REDIRECT_REJECTED")
    try:
        target = httpx.URL(location)
    except Exception:
        _fail("REDIRECT_REJECTED")
    if (target.scheme != "https" or not target.host or target.host not in REDIRECT_HOSTS
            or target.port is not None or target.userinfo):
        _fail("REDIRECT_REJECTED")
    return target


class BoundedHttpTransport(httpx.BaseTransport):
    def __init__(self, budget, inner=None):
        self._budget = budget
        self._inner = httpx.HTTPTransport(retries=0) if inner is None else inner

    def _send(self, request):
        try:
            return self._inner.handle_request(request)
        except BoundedHttpError:
            raise
        except Exception:
            _fail("NETWORK_FAILED")

    def _discard(self, response):
        try:
            response.close()
        except Exception:
            pass

    def _metered(self, response, request):
        declared = response.headers.get("content-length")
        if declared is not None:
            if not declared.isdigit() or int(declared) > self._budget.remaining_bytes():
                self._discard(response)
                _fail("NETWORK_BYTES")
        return httpx.Response(
            response.status_code, headers=response.headers,
            stream=MeteredStream(response.stream, self._budget), request=request,
        )

    def _follow(self, request, response):
        location = response.headers.get("location")
        self._discard(response)
        target = _validate_redirect(location)
        headers = [(key, value) for key, value in request.headers.raw
                   if key.decode("ascii", errors="replace").lower() not in ORIGIN_ONLY_HEADERS]
        follow = httpx.Request(request.method, target, headers=headers)
        self._budget.begin_request()
        self._budget.redirects_followed += 1
        result = self._send(follow)
        if not 200 <= result.status_code < 300:
            self._discard(result)
            _fail("REDIRECT_REJECTED" if 300 <= result.status_code < 400 else "UNSUPPORTED_STATUS")
        return self._metered(result, follow)

    def handle_request(self, request):
        _validate_target(request.url, request.method)
        self._budget.begin_request()
        response = self._send(request)
        if 300 <= response.status_code < 400:
            return self._follow(request, response)
        if not 200 <= response.status_code < 300:
            self._discard(response)
            _fail("UNSUPPORTED_STATUS")
        return self._metered(response, request)

    def close(self):
        close = getattr(self._inner, "close", None)
        if callable(close):
            close()


def create_client(budget, inner=None):
    return httpx.Client(
        transport=BoundedHttpTransport(budget, inner), follow_redirects=False,
        timeout=httpx.Timeout(TIMEOUT_SECONDS),
    )


def _reject_async_client():
    _fail("ASYNC_CLIENT_REJECTED")


def install_bounded_backend(budget, *, inner=None, set_client_factory=None, set_async_client_factory=None):
    if set_client_factory is None or set_async_client_factory is None:
        import huggingface_hub
        set_client_factory = set_client_factory or huggingface_hub.set_client_factory
        set_async_client_factory = set_async_client_factory or huggingface_hub.set_async_client_factory
    set_client_factory(lambda: create_client(budget, inner))
    set_async_client_factory(_reject_async_client)


def measure_tree(root):
    """Allocated bytes under ``root`` without following symlinks; missing roots measure zero."""
    total = 0
    try:
        root_stat = os.lstat(root)
    except OSError:
        return 0
    total += root_stat.st_blocks * 512
    for directory, names, files in os.walk(root, followlinks=False):
        for name in names + files:
            try:
                entry = os.lstat(os.path.join(directory, name))
            except OSError:
                continue
            total += entry.st_blocks * 512
    return total
