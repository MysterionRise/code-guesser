import json
import os
import unittest

import bounded_http
import fetch_blob
import stream_metadata


PROFILE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "profiles", "local-real-rounds.v2.json")


def signed_profile():
    with open(PROFILE_PATH, encoding="utf-8") as stream:
        return json.load(stream)


class SignedCeilingTests(unittest.TestCase):
    """Each worker maximum is the signed profile ceiling the Node orchestrator hands it, never a stale copy."""

    def setUp(self):
        self.profile = signed_profile()
        self.capacity = self.profile["capacity"]

    def test_metadata_worker_accepts_exactly_the_signed_metadata_budget(self):
        self.assertEqual(stream_metadata.MAXIMUM_ROWS, self.capacity["stackRowsPerLanguage"])
        self.assertEqual(stream_metadata.MAXIMUM_BLOB_BYTES, self.capacity["perBlobBytes"])
        self.assertEqual(stream_metadata.MAXIMUM_REQUESTS, self.capacity["requestCount"])
        self.assertEqual(stream_metadata.MAXIMUM_NETWORK_BYTES, self.capacity["stackMetadataBytes"])
        self.assertEqual(stream_metadata.MAXIMUM_TEMPORARY_BYTES, self.capacity["temporaryDiskBytes"])
        self.assertEqual(
            list(stream_metadata.EXTENSIONS),
            [configuration["language"] for configuration in self.profile["stack"]["configurations"]],
        )

    def test_http_budget_accepts_exactly_the_signed_request_and_metadata_byte_ceilings(self):
        self.assertEqual(bounded_http.MAXIMUM_REQUESTS, self.capacity["requestCount"])
        self.assertEqual(bounded_http.MAXIMUM_NETWORK_BYTES, self.capacity["stackMetadataBytes"])
        budget = bounded_http.NetworkBudget(self.capacity["requestCount"], self.capacity["stackMetadataBytes"])
        self.assertEqual(budget.request_limit, self.capacity["requestCount"])
        self.assertEqual(budget.byte_limit, self.capacity["stackMetadataBytes"])

    def test_blob_worker_accepts_exactly_the_signed_blob_ceilings(self):
        self.assertEqual(fetch_blob.MAXIMUM_ATTEMPTS, self.capacity["blobAttempts"])
        self.assertEqual(fetch_blob.MAXIMUM_ATTEMPTS, self.capacity["successfulBlobs"])
        self.assertEqual(fetch_blob.MAXIMUM_BLOB_BYTES, self.capacity["perBlobBytes"])
        self.assertEqual(fetch_blob.MAXIMUM_TOTAL_BYTES, self.capacity["totalBlobBytes"])
        self.assertEqual(fetch_blob.MAXIMUM_TEMPORARY_BYTES, self.capacity["temporaryDiskBytes"])
        self.assertEqual(fetch_blob.MAXIMUM_REQUESTS, self.capacity["requestCount"])


if __name__ == "__main__":
    unittest.main()
