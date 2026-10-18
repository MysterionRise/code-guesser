import json
import os
import unittest

import bounded_http
import bounded_parquet
import fetch_blob
import limits
import stream_metadata


HERE = os.path.dirname(os.path.abspath(__file__))
PROFILE_PATH = os.path.join(HERE, "..", "profiles", "local-real-rounds.v5.json")
# The v1.0 data run's profile (#129): every check that holds for v5 holds for it too.
PROFILE_PATHS = (PROFILE_PATH, os.path.join(HERE, "..", "profiles", "local-real-rounds.v6.json"))


def load(path):
    with open(path, encoding="utf-8") as stream:
        return json.load(stream)


class SharedLimitTests(unittest.TestCase):
    """Each worker maximum comes from ops/poc/limits.json, the file the Node preparer reads too."""

    def setUp(self):
        self.profiles = [load(path) for path in PROFILE_PATHS]
        self.capacity = load(limits.LIMITS_PATH)["ceilings"]

    def test_profile_stays_within_the_shared_ceilings_and_pins_the_shared_revision(self):
        for profile in self.profiles:
            for key, value in profile["capacity"].items():
                self.assertLessEqual(value, self.capacity[key], key)
            self.assertEqual(profile["stack"]["revision"], limits.STACK_REVISION)
        self.assertEqual(bounded_http.PINNED_REVISION, limits.STACK_REVISION)
        self.assertEqual(stream_metadata.PINNED_REVISION, limits.STACK_REVISION)

    def test_metadata_worker_accepts_exactly_the_shared_metadata_budget(self):
        self.assertEqual(stream_metadata.MAXIMUM_ROWS, self.capacity["stackRowsPerLanguage"])
        self.assertEqual(stream_metadata.MAXIMUM_BLOB_BYTES, self.capacity["perBlobBytes"])
        self.assertEqual(stream_metadata.MAXIMUM_REQUESTS, self.capacity["requestCount"])
        self.assertEqual(stream_metadata.MAXIMUM_NETWORK_BYTES, self.capacity["stackMetadataBytes"])
        self.assertEqual(stream_metadata.MAXIMUM_TEMPORARY_BYTES, self.capacity["temporaryDiskBytes"])
        # The worker knows every language a profile may read (v1.0 adds rarer ones); the profile reads some of them,
        # in the worker's order, with the same extensions.
        for profile in self.profiles:
            configured = [configuration["language"] for configuration in profile["stack"]["configurations"]]
            self.assertEqual([language for language in stream_metadata.EXTENSIONS if language in configured], configured)
            for configuration in profile["stack"]["configurations"]:
                self.assertEqual(list(stream_metadata.EXTENSIONS[configuration["language"]]), configuration["extensions"])
        self.assertEqual(list(bounded_parquet.DIRECTORIES), list(stream_metadata.EXTENSIONS))

    def test_http_budget_accepts_exactly_the_shared_request_and_metadata_byte_ceilings(self):
        self.assertEqual(bounded_http.MAXIMUM_REQUESTS, self.capacity["requestCount"])
        self.assertEqual(bounded_http.MAXIMUM_NETWORK_BYTES, self.capacity["stackMetadataBytes"])
        budget = bounded_http.NetworkBudget(self.capacity["requestCount"], self.capacity["stackMetadataBytes"])
        self.assertEqual(budget.request_limit, self.capacity["requestCount"])
        self.assertEqual(budget.byte_limit, self.capacity["stackMetadataBytes"])

    def test_blob_worker_accepts_exactly_the_shared_blob_ceilings(self):
        self.assertEqual(fetch_blob.MAXIMUM_ATTEMPTS, self.capacity["blobAttempts"])
        self.assertEqual(fetch_blob.MAXIMUM_SUCCESSFUL_BLOBS, self.capacity["successfulBlobs"])
        self.assertEqual(fetch_blob.MAXIMUM_BLOB_BYTES, self.capacity["perBlobBytes"])
        self.assertEqual(fetch_blob.MAXIMUM_TOTAL_BYTES, self.capacity["totalBlobBytes"])
        self.assertEqual(fetch_blob.MAXIMUM_TEMPORARY_BYTES, self.capacity["temporaryDiskBytes"])
        self.assertEqual(fetch_blob.MAXIMUM_REQUESTS, self.capacity["requestCount"])


if __name__ == "__main__":
    unittest.main()
