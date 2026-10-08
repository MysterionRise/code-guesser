import datetime
import io
import json
import re
import unittest

import httpx
import pyarrow as pa
import pyarrow.parquet as pq

from bounded_http import NetworkBudget, create_client
from bounded_parquet import ParquetReadError, SparseFile, list_first_shard, read_rows


REVISION = "e565caa3a78c2423bd374333a472b049eb090e47"
ORIGIN = "huggingface.co"
CDN = "us.aws.cdn.hf.co"
LISTING = [
    {"type": "file", "path": "data/Python/train-00001-of-00002.parquet"},
    {"type": "directory", "path": "data/Python/extra"},
    {"type": "file", "path": "data/Python/README.md"},
    {"type": "file", "path": "data/Python/train-00000-of-00002.parquet"},
    {"type": "file", "path": "data/TypeScript/train-00000-of-00001.parquet"},
]


def parquet_bytes(rows_per_group, groups, footer_padding=0):
    count = rows_per_group * groups
    table = pa.table({
        "blob_id": pa.array([f"{index:040x}" for index in range(count)]),
        "repo_name": pa.array([f"owner/repo-{index % 7}" for index in range(count)]),
        "length_bytes": pa.array(list(range(count)), pa.int64()),
        "visit_date": pa.array([datetime.datetime(2023, 9, 6, 10, 44, 38)] * count, pa.timestamp("us")),
        "detected_licenses": pa.array([["MIT"]] * count),
    })
    if footer_padding:
        table = table.replace_schema_metadata({"padding": "x" * footer_padding})
    buffer = io.BytesIO()
    pq.write_table(table, buffer, row_group_size=rows_per_group, use_dictionary=["repo_name"], compression="none")
    return buffer.getvalue(), table


class RangeServer:
    """Serves the tree listing from the origin, redirects resolve reads to the CDN, and honours Range there."""

    def __init__(self, data, listing=LISTING, partial=True):
        self.data = data
        self.listing = listing
        self.partial = partial
        self.requests = []

    def _response(self, status, headers, body, request):
        headers = {**headers, "content-length": str(len(body))}
        return httpx.Response(status, headers=headers, stream=httpx.ByteStream(body), request=request)

    def handle_request(self, request):
        self.requests.append(request)
        path = request.url.path
        if request.url.host == ORIGIN and path.startswith("/api/datasets/bigcode/the-stack-v2/tree/"):
            return self._response(200, {}, json.dumps(self.listing).encode("utf-8"), request)
        if request.url.host == ORIGIN and "/resolve/" in path:
            location = f"https://{CDN}/xet-bridge-us/abc/def?Expires=1&Signature=target"
            return httpx.Response(302, headers={"location": location}, stream=httpx.ByteStream(b""), request=request)
        if request.url.host == CDN:
            size = len(self.data)
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", request.headers.get("range", ""))
            if not self.partial or match is None:
                return self._response(200, {}, self.data, request)
            if match.group(1) == "":
                start, end = max(0, size - int(match.group(2))), size - 1
            else:
                start, end = int(match.group(1)), min(int(match.group(2)), size - 1)
            body = self.data[start:end + 1]
            return self._response(206, {"content-range": f"bytes {start}-{end}/{size}"}, body, request)
        return self._response(404, {}, b"", request)

    def close(self):
        pass


def span_of(data, index):
    group = pq.read_metadata(io.BytesIO(data)).row_group(index)
    starts, ends = [], []
    for column_index in range(group.num_columns):
        column = group.column(column_index)
        start = min(offset for offset in (column.dictionary_page_offset, column.data_page_offset) if offset is not None)
        starts.append(start)
        ends.append(start + column.total_compressed_size)
    return min(starts), max(ends)


class BoundedParquetTests(unittest.TestCase):
    def client_for(self, server, request_limit=20, byte_limit=8 * 1024 * 1024):
        budget = NetworkBudget(request_limit, byte_limit)
        return create_client(budget, inner=server), budget

    def assert_code(self, code, callback):
        with self.assertRaises(ParquetReadError) as caught:
            callback()
        self.assertEqual(caught.exception.code, code)

    def test_lists_the_first_shard_of_the_requested_configuration_only(self):
        client, _budget = self.client_for(RangeServer(b""))
        self.assertEqual(list_first_shard(client, "Python", "t"), "data/Python/train-00000-of-00002.parquet")
        self.assertEqual(list_first_shard(client, "TypeScript", "t"), "data/TypeScript/train-00000-of-00001.parquet")
        for listing in ([], [{"type": "file", "path": "data/Python/README.md"}], {"path": "x"}, [1]):
            client, _budget = self.client_for(RangeServer(b"", listing=listing))
            self.assert_code("SHARD_LISTING_REJECTED", lambda: list_first_shard(client, "Python", "t"))
        self.assert_code("CONFIGURATION_REJECTED", lambda: list_first_shard(client, "JavaScript", "t"))
        rust_listing = [{"type": "file", "path": "data/Rust/train-00000-of-00001.parquet"}]
        client, _budget = self.client_for(RangeServer(b"", listing=rust_listing))
        self.assertEqual(list_first_shard(client, "Rust", "t"), "data/Rust/train-00000-of-00001.parquet")

    def test_reads_one_row_group_through_exact_ranges_and_never_touches_the_rest(self):
        data, table = parquet_bytes(rows_per_group=3000, groups=2)
        self.assertGreater(len(data), 64 * 1024)
        server = RangeServer(data)
        client, budget = self.client_for(server)

        rows = list(read_rows(client, "Python", "secret-token", 5))

        self.assertEqual(rows, table.slice(0, 5).to_pylist())
        span_start, span_end = span_of(data, 0)
        listing_bytes = len(json.dumps(LISTING).encode("utf-8"))
        self.assertEqual(budget.counters(), {
            "networkBytes": listing_bytes + 64 * 1024 + (span_end - span_start),
            "peakTemporaryDiskBytes": 0, "redirectsFollowed": 2, "requests": 5,
        })
        origin = [request for request in server.requests if request.url.host == ORIGIN]
        cdn = [request for request in server.requests if request.url.host == CDN]
        self.assertEqual([request.url.path for request in origin], [
            f"/api/datasets/bigcode/the-stack-v2/tree/{REVISION}/data/Python",
            f"/datasets/bigcode/the-stack-v2/resolve/{REVISION}/data/Python/train-00000-of-00002.parquet",
            f"/datasets/bigcode/the-stack-v2/resolve/{REVISION}/data/Python/train-00000-of-00002.parquet",
        ])
        self.assertTrue(all(request.headers.get("authorization") == "Bearer secret-token" for request in origin))
        self.assertTrue(all("authorization" not in request.headers for request in cdn))
        self.assertEqual([request.headers["range"] for request in cdn], [
            "bytes=-65536", f"bytes={span_start}-{span_end - 1}",
        ])

    def test_continues_into_the_next_row_group_until_the_limit(self):
        data, table = parquet_bytes(rows_per_group=3000, groups=2)
        server = RangeServer(data)
        client, budget = self.client_for(server)

        rows = list(read_rows(client, "Python", "t", 3002))

        self.assertEqual(len(rows), 3002)
        self.assertEqual(rows[3000], table.slice(3000, 1).to_pylist()[0])
        self.assertEqual(budget.counters()["requests"], 7)
        second_start, second_end = span_of(data, 1)
        self.assertEqual(server.requests[-1].headers["range"], f"bytes={second_start}-{second_end - 1}")

    def test_stops_early_when_the_shard_has_fewer_rows_than_the_limit(self):
        data, table = parquet_bytes(rows_per_group=5, groups=1)
        self.assertLess(len(data), 64 * 1024)
        client, budget = self.client_for(RangeServer(data))

        rows = list(read_rows(client, "Python", "t", 10))

        self.assertEqual(rows, table.to_pylist())
        self.assertEqual(budget.counters()["requests"], 5)

    def test_completes_a_footer_larger_than_the_suffix_with_one_more_exact_range(self):
        data, table = parquet_bytes(rows_per_group=10, groups=1, footer_padding=200 * 1024)
        server = RangeServer(data)
        client, budget = self.client_for(server)

        rows = list(read_rows(client, "Python", "t", 3))

        self.assertEqual(rows, table.slice(0, 3).to_pylist())
        self.assertEqual(budget.counters()["requests"], 7)
        footer_length = int.from_bytes(data[-8:-4], "little")
        footer_start = len(data) - 8 - footer_length
        self.assertEqual(server.requests[3].headers["range"], f"bytes={footer_start}-{len(data) - 65536 - 1}")

    def test_rejects_full_answers_corrupt_trailers_and_reads_outside_fetched_ranges(self):
        data, _table = parquet_bytes(rows_per_group=3000, groups=2)
        client, _budget = self.client_for(RangeServer(data, partial=False))
        self.assert_code("RANGE_REJECTED", lambda: list(read_rows(client, "Python", "t", 1)))

        client, _budget = self.client_for(RangeServer(data[:-4] + b"XXXX"))
        self.assert_code("PARQUET_REJECTED", lambda: list(read_rows(client, "Python", "t", 1)))

        client, _budget = self.client_for(RangeServer(b"\x00" * 16))
        self.assert_code("PARQUET_REJECTED", lambda: list(read_rows(client, "Python", "t", 1)))

        sparse = SparseFile(100, {10: b"abcdef"})
        self.assertEqual(sparse.seek(0, io.SEEK_END), 100)
        sparse.seek(10)
        self.assertEqual(sparse.read(3), b"abc")
        self.assertEqual(sparse.tell(), 13)
        self.assert_code("RANGE_REJECTED", lambda: sparse.read(10))
        sparse.seek(0)
        self.assert_code("RANGE_REJECTED", lambda: sparse.read(1))


if __name__ == "__main__":
    unittest.main()
