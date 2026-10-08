"""Bounded parquet metadata reads for the locked Stack worker.

The worker needs a bounded number of metadata rows from the revision-pinned
parquet shards. It fetches exactly what one row group needs and nothing more:
the tree listing names the first shard, one suffix range yields the shard size
and footer, and each row group is read through one exact byte range. Every
request goes through the bounded HTTP client, the shard is never opened as a
stream, and a complete language shard can never be downloaded.
"""

import io
import json
import re

import pyarrow.parquet as pq

from bounded_http import ALLOWED_HOST, DATASET, PINNED_REVISION


# pyarrow reads at least this much of the file tail while opening the footer.
FOOTER_SUFFIX_BYTES = 64 * 1024
PARQUET_MAGIC = b"PAR1"
LEADING_MAGIC_BYTES = 4
CONTENT_RANGE = re.compile(r"^bytes (\d+)-(\d+)/(\d+)$")
SHARD_PATH = re.compile(r"^data/(Python|TypeScript|Go|Rust|Ruby)/train-\d{5}-of-\d{5}\.parquet$")
CONFIGURATIONS = ("Python", "TypeScript", "Go", "Rust", "Ruby")


class ParquetReadError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _fail(code):
    raise ParquetReadError(code)


def _headers(token, **extra):
    return {"authorization": f"Bearer {token}", **extra}


def list_first_shard(client, configuration, token):
    """Returns the lexicographically first parquet shard path of one configuration."""
    if configuration not in CONFIGURATIONS:
        _fail("CONFIGURATION_REJECTED")
    url = f"https://{ALLOWED_HOST}/api/datasets/{DATASET}/tree/{PINNED_REVISION}/data/{configuration}"
    response = client.get(url, headers=_headers(token, accept="application/json"))
    try:
        entries = json.loads(response.content)
    except ValueError:
        _fail("SHARD_LISTING_REJECTED")
    if not isinstance(entries, list):
        _fail("SHARD_LISTING_REJECTED")
    shards = sorted(
        entry["path"] for entry in entries
        if isinstance(entry, dict) and entry.get("type") == "file" and isinstance(entry.get("path"), str)
        and SHARD_PATH.fullmatch(entry["path"]) and entry["path"].startswith(f"data/{configuration}/")
    )
    if not shards:
        _fail("SHARD_LISTING_REJECTED")
    return shards[0]


def _ranged(client, url, token, range_header):
    """One range GET; returns (start, total, body) and rejects anything but an exact partial answer."""
    response = client.get(url, headers=_headers(token, range=range_header))
    if response.status_code != 206:
        _fail("RANGE_REJECTED")
    match = CONTENT_RANGE.fullmatch(response.headers.get("content-range", ""))
    if not match:
        _fail("RANGE_REJECTED")
    start, end, total = (int(group) for group in match.groups())
    body = response.content
    if start > end or end >= total or len(body) != end - start + 1:
        _fail("RANGE_REJECTED")
    return start, total, body


def _read_tail(client, url, token):
    """Fetches the file tail covering pyarrow's footer read; returns (tail_start, total, tail_bytes)."""
    start, total, tail = _ranged(client, url, token, f"bytes=-{FOOTER_SUFFIX_BYTES}")
    if len(tail) < 8 or tail[-4:] != PARQUET_MAGIC:
        _fail("PARQUET_REJECTED")
    footer_length = int.from_bytes(tail[-8:-4], "little")
    footer_start = total - 8 - footer_length
    if footer_start < LEADING_MAGIC_BYTES:
        _fail("PARQUET_REJECTED")
    if footer_start < start:
        head_start, head_total, head = _ranged(client, url, token, f"bytes={footer_start}-{start - 1}")
        if head_start != footer_start or head_total != total:
            _fail("RANGE_REJECTED")
        tail, start = head + tail, footer_start
    return start, total, tail


def _span(row_group):
    """Byte span [start, end) covering every column chunk of one row group."""
    starts, ends = [], []
    for index in range(row_group.num_columns):
        column = row_group.column(index)
        offsets = [offset for offset in (column.dictionary_page_offset, column.data_page_offset)
                   if offset is not None]
        if not offsets or column.total_compressed_size <= 0:
            _fail("PARQUET_REJECTED")
        starts.append(min(offsets))
        ends.append(min(offsets) + column.total_compressed_size)
    return min(starts), max(ends)


class SparseFile(io.RawIOBase):
    """A seekable read-only view over the byte ranges that were actually fetched."""

    def __init__(self, size, segments):
        super().__init__()
        self._size = size
        self._segments = dict(segments)
        self._position = 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self._position

    def seek(self, offset, whence=io.SEEK_SET):
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self._position, io.SEEK_END: self._size}.get(whence)
        if base is None or base + offset < 0:
            _fail("RANGE_REJECTED")
        self._position = base + offset
        return self._position

    def read(self, size=-1):
        length = self._size - self._position if size is None or size < 0 else size
        for start, blob in self._segments.items():
            if start <= self._position and self._position + length <= start + len(blob):
                offset = self._position - start
                self._position += length
                return blob[offset:offset + length]
        _fail("RANGE_REJECTED")


def _parquet(callback):
    try:
        return callback()
    except ParquetReadError:
        raise
    except Exception as error:  # noqa: BLE001 - only a stable code may leave this module
        code = getattr(error, "code", None)
        if isinstance(code, str) and code.isupper():
            raise
        _fail("PARQUET_REJECTED")


def read_rows(client, configuration, token, row_limit):
    """Yields up to row_limit provider rows from the first shard, one exact row-group range at a time."""
    shard = list_first_shard(client, configuration, token)
    url = f"https://{ALLOWED_HOST}/datasets/{DATASET}/resolve/{PINNED_REVISION}/{shard}"
    tail_start, total, tail = _read_tail(client, url, token)
    metadata = _parquet(lambda: pq.read_metadata(io.BytesIO(tail)))
    if metadata.num_row_groups < 1:
        _fail("PARQUET_REJECTED")
    produced = 0
    for index in range(metadata.num_row_groups):
        if produced >= row_limit:
            return
        span_start, span_end = _parquet(lambda: _span(metadata.row_group(index)))
        if not LEADING_MAGIC_BYTES <= span_start < span_end <= tail_start + len(tail) - 8:
            _fail("PARQUET_REJECTED")
        chunk_start, chunk_total, chunk = _ranged(client, url, token, f"bytes={span_start}-{span_end - 1}")
        if chunk_start != span_start or chunk_total != total:
            _fail("RANGE_REJECTED")
        sparse = SparseFile(total, {tail_start: tail, span_start: chunk})
        table = _parquet(lambda: pq.ParquetFile(sparse).read_row_group(index))
        needed = min(row_limit - produced, table.num_rows)
        for record in _parquet(lambda: table.slice(0, needed).to_pylist()):
            produced += 1
            yield record
