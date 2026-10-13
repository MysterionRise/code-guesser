import io
import json
import os
import sys
import unittest
from unittest.mock import patch

import fetch_blob
import stream_metadata
from limits import CEILINGS


class WorkerMainTests(unittest.TestCase):
    """An unexpected exception leaves each worker as one honest code, never its message."""

    def test_metadata_worker_names_unexpected_failures_without_detail(self):
        stderr = io.StringIO()
        with patch.object(stream_metadata, "stream_metadata", side_effect=RuntimeError("Bearer secret")), \
                patch.object(sys, "stdin", io.StringIO("{}")), patch.object(sys, "stderr", stderr):
            self.assertEqual(stream_metadata._main(), 1)
        self.assertEqual(stderr.getvalue(), "WORKER_UNEXPECTED\n")

    def test_metadata_worker_keeps_a_stable_code_carried_by_a_library_error(self):
        error = RuntimeError("hidden")
        error.code = "DATASET_LOAD_FAILED"
        stderr = io.StringIO()
        with patch.object(stream_metadata, "stream_metadata", side_effect=error), \
                patch.object(sys, "stdin", io.StringIO("{}")), patch.object(sys, "stderr", stderr):
            self.assertEqual(stream_metadata._main(), 1)
        self.assertEqual(stderr.getvalue(), "DATASET_LOAD_FAILED\n")

    def test_blob_worker_names_unexpected_failures_without_detail(self):
        stderr = io.StringIO()
        with patch.object(fetch_blob, "fetch_selected_blobs_with_counters", side_effect=RuntimeError("Bearer secret")):
            self.assertEqual(fetch_blob._main(
                stdin=io.BytesIO(b'{"rows": [], "limits": null}'), stdout=io.StringIO(), stderr=stderr,
            ), 1)
        self.assertEqual(stderr.getvalue(), "WORKER_UNEXPECTED\n")


    def test_metadata_worker_checks_a_request_without_streaming(self):
        valid = json.dumps({
            "configuration": "Rust", "revision": stream_metadata.PINNED_REVISION, "rowLimit": 10_000,
            "perBlobByteLimit": 262_144, "requestLimit": CEILINGS["requestCount"], "networkByteLimit": 96 * 1024 * 1024,
            "temporaryDiskBytes": 32 * 1024 * 1024,
        })
        for request, code, expected in [(valid, 0, ""), (valid.replace(f'"requestLimit": {CEILINGS["requestCount"]}', f'"requestLimit": {CEILINGS["requestCount"] + 1}'), 1, "REQUEST_LIMIT_REJECTED\n")]:
            stderr = io.StringIO()
            with patch.object(stream_metadata, "stream_metadata", side_effect=AssertionError("must not stream")), \
                    patch.object(sys, "stdin", io.StringIO(request)), patch.object(sys, "stdout", io.StringIO()) as stdout, \
                    patch.object(sys, "stderr", stderr), patch.dict(os.environ, {"HF_TOKEN": "offline-check"}):
                self.assertEqual(stream_metadata._main(["--check-request"]), code)
            self.assertEqual(stderr.getvalue(), expected)
            self.assertEqual(stdout.getvalue(), "")

    def test_workers_reject_unknown_arguments(self):
        stderr = io.StringIO()
        with patch.object(sys, "stdin", io.StringIO("{}")), patch.object(sys, "stderr", stderr):
            self.assertEqual(stream_metadata._main(["--stream-everything"]), 1)
        self.assertEqual(stderr.getvalue(), "ARGUMENTS_REJECTED\n")
        errors = io.StringIO()
        self.assertEqual(fetch_blob._main(argv=["--fetch-all"], stdin=io.BytesIO(b"{}"), stdout=io.StringIO(), stderr=errors), 1)
        self.assertEqual(errors.getvalue(), "ARGUMENTS_REJECTED\n")

    def test_blob_worker_checks_a_request_without_fetching(self):
        row = {"stableRowId": "a" * 64, "swhBlobId": "b" * 40, "swhContentId": "c" * 40,
               "sourceEncoding": "UTF-8", "byteLength": 128}
        limits = {"blobAttempts": 50, "successfulBlobs": 50, "perBlobBytes": 262_144, "totalBlobBytes": 16 * 1024 * 1024,
                  "temporaryDiskBytes": 32 * 1024 * 1024, "requestLimit": CEILINGS["requestCount"], "networkByteLimit": 262_144}
        for value, code, expected in [(limits, 0, ""), ({**limits, "requestLimit": CEILINGS["requestCount"] + 1}, 1, "LIMIT_RAISED\n")]:
            stdout, stderr = io.StringIO(), io.StringIO()
            with patch.object(fetch_blob, "fetch_selected_blobs_with_counters", side_effect=AssertionError("must not fetch")):
                self.assertEqual(fetch_blob._main(
                    argv=["--check-request"], stdin=io.BytesIO(json.dumps({"rows": [row], "limits": value}).encode()),
                    stdout=stdout, stderr=stderr,
                ), code)
            self.assertEqual(stderr.getvalue(), expected)
            self.assertEqual(stdout.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
