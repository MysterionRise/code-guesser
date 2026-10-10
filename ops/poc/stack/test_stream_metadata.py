import datetime
import io
import json
import os
import unittest

from bounded_http import NetworkBudget
from stream_metadata import MetadataStreamError, stream_metadata


REVISION = "e565caa3a78c2423bd374333a472b049eb090e47"


def row(**overrides):
    value = {
        "blob_id": "a" * 40,
        "directory_id": "b" * 40,
        "path": "/src/example.py",
        "content_id": "c" * 40,
        "detected_licenses": ["MIT"],
        "license_type": "permissive",
        "repo_name": "example/project",
        "snapshot_id": "d" * 40,
        "revision_id": "e" * 40,
        "branch_name": "refs/heads/main",
        "visit_date": datetime.datetime(2023, 9, 6, 10, 44, 38, 631000),
        "revision_date": "2023-09-05T09:30:00",
        "committer_date": datetime.datetime(
            2023, 9, 5, 11, 30, tzinfo=datetime.timezone(datetime.timedelta(hours=2))
        ),
        "github_id": 123,
        "star_events_count": 4,
        "fork_events_count": 2,
        "gha_license_id": "MIT",
        "gha_event_created_at": None,
        "gha_created_at": None,
        "gha_language": "Python",
        "src_encoding": "UTF-8",
        "language": "Python",
        "is_vendor": False,
        "is_generated": False,
        "length_bytes": 128,
        "extension": "py",
    }
    value.update(overrides)
    return value


def request(**overrides):
    value = {
        "configuration": "Python",
        "revision": REVISION,
        "rowLimit": 1,
        "perBlobByteLimit": 262_144,
        "requestLimit": 600,
        "networkByteLimit": 96 * 1024 * 1024,
        "temporaryDiskBytes": 32 * 1024 * 1024,
    }
    value.update(overrides)
    return value


class RecordingInstaller:
    def __init__(self, requests=0, network_bytes=0):
        self.budgets = []
        self.requests = requests
        self.network_bytes = network_bytes

    def __call__(self, budget):
        self.budgets.append(budget)
        for _index in range(self.requests):
            budget.begin_request()
        if self.network_bytes:
            budget.add_bytes(self.network_bytes)


class StreamMetadataTests(unittest.TestCase):
    def run_stream(self, rows, request_value=None, token="external-token", installer=None):
        calls = []
        output = io.StringIO()
        environment = {"HF_TOKEN": token}

        def loader(*args, **kwargs):
            calls.append((args, kwargs, environment.copy()))
            return iter(rows)

        count = stream_metadata(
            request_value or request(), read_rows_fn=loader,
            environment=environment, output=output,
            install_backend_fn=installer or RecordingInstaller(),
        )
        return count, calls, output.getvalue(), environment

    def rows_of(self, text):
        return [json.loads(line) for line in text.splitlines()[:-1]]

    def trailer_of(self, text):
        return text.splitlines()[-1]

    def assert_code(self, code, callback):
        with self.assertRaises(MetadataStreamError) as caught:
            callback()
        self.assertEqual(caught.exception.code, code)
        self.assertEqual(str(caught.exception), code)

    def test_reads_rows_for_allowed_configurations_with_the_request_budget_and_token(self):
        for configuration, path, extension in [
            ("Python", "/x.py", "py"),
            ("TypeScript", "/x.ts", "ts"),
        ]:
            record = row(
                language=configuration, path=path, extension=extension,
                gha_language=configuration,
            )
            count, calls, _text, _environment = self.run_stream(
                [record], request(configuration=configuration)
            )
            self.assertEqual(count, 1)
            args, kwargs, _environment_seen = calls[0]
            self.assertEqual(kwargs, {})
            self.assertEqual((args[0], args[1], args[3]), (configuration, "external-token", 1))
            self.assertIsInstance(args[2], NetworkBudget)

    def test_accepts_the_five_signed_languages_with_their_exact_extensions(self):
        for configuration, path, extension in [
            ("Go", "/cmd/main.go", "go"),
            ("Rust", "/src/lib.rs", "rs"),
            ("Ruby", "/lib/app.rb", "rb"),
            ("TypeScript", "/src/view.tsx", "tsx"),
        ]:
            record = row(language=configuration, path=path, extension=extension, gha_language=configuration)
            count, _calls, text, _environment = self.run_stream([record], request(configuration=configuration))
            self.assertEqual(count, 1)
            self.assertEqual(self.rows_of(text)[0]["detectedLanguage"], configuration)
        screened = row(language="Go", path="/cmd/main.rs", extension="rs", gha_language="Go")
        count, _calls, _text, _environment = self.run_stream([screened], request(configuration="Go"))
        self.assertEqual(count, 0)
        for configuration in ("JavaScript", "C", "go"):
            self.assert_code("CONFIGURATION_REJECTED", lambda value=configuration: self.run_stream([row()], request(configuration=value)))

    def test_projects_only_documented_fields_in_input_order_and_stops_at_limit(self):
        pulled = []

        def rows():
            for index in range(3):
                pulled.append(index)
                name = f"example{index}.py"
                yield row(
                    blob_id=str(index + 1) * 40, path=f"/src/{name}"
                )

        count, _calls, text, _environment = self.run_stream(rows(), request(rowLimit=2))
        emitted = self.rows_of(text)
        self.assertEqual(count, 2)
        self.assertEqual(pulled, [0, 1])
        self.assertEqual([entry["swhBlobId"] for entry in emitted], ["1" * 40, "2" * 40])
        self.assertEqual(emitted[0]["path"], "src/example0.py")
        self.assertEqual(list(emitted[0]), [
            "stableRowId", "swhBlobId", "swhContentId", "swhDirectoryId",
            "swhSnapshotId", "swhRevisionId", "repository", "path",
            "detectedLicenses", "detectedLanguage", "generated", "vendor",
            "sourceEncoding", "byteLength", "visitDate", "revisionDate",
            "committerDate",
        ])
        self.assertRegex(emitted[0]["stableRowId"], r"^[0-9a-f]{64}$")
        self.assertNotIn("firstCrawlDate", emitted[0])
        self.assertNotIn("lastCrawlDate", emitted[0])

    def test_normalizes_documented_datetime_and_iso_representations_to_utc(self):
        _count, _calls, text, _environment = self.run_stream([row()])
        emitted = self.rows_of(text)[0]
        self.assertEqual(emitted["visitDate"], "2023-09-06T10:44:38.631000Z")
        self.assertEqual(emitted["revisionDate"], "2023-09-05T09:30:00Z")
        self.assertEqual(emitted["committerDate"], "2023-09-05T09:30:00Z")

    def test_rejects_request_shape_configuration_revision_limits_and_missing_token(self):
        failures = [
            ("REQUEST_MALFORMED", request(extra=True), "external-token"),
            ("CONFIGURATION_REJECTED", request(configuration="Java"), "external-token"),
            ("REVISION_REJECTED", request(revision="main"), "external-token"),
            ("ROW_LIMIT_REJECTED", request(rowLimit=0), "external-token"),
            ("ROW_LIMIT_REJECTED", request(rowLimit=True), "external-token"),
            ("ROW_LIMIT_REJECTED", request(rowLimit=10_001), "external-token"),
            ("BYTE_LIMIT_REJECTED", request(perBlobByteLimit=262_145), "external-token"),
            ("REQUEST_MALFORMED", {key: value for key, value in request().items() if key != "requestLimit"},
             "external-token"),
            ("REQUEST_LIMIT_REJECTED", request(requestLimit=0), "external-token"),
            ("REQUEST_LIMIT_REJECTED", request(requestLimit=601), "external-token"),
            ("NETWORK_LIMIT_REJECTED", request(networkByteLimit=96 * 1024 * 1024 + 1), "external-token"),
            ("DISK_LIMIT_REJECTED", request(temporaryDiskBytes=32 * 1024 * 1024 + 1), "external-token"),
            ("TOKEN_MISSING", request(), ""),
        ]
        for code, request_value, token in failures:
            calls = []
            installer = RecordingInstaller()
            self.assert_code(code, lambda rv=request_value, tk=token: stream_metadata(
                rv, read_rows_fn=lambda *_args, **_kwargs: calls.append(True),
                environment={"HF_TOKEN": tk}, output=io.StringIO(), install_backend_fn=installer,
            ))
            self.assertEqual(calls, [])
            self.assertEqual(installer.budgets, [])

    def test_rejects_schema_identity_and_metadata_screening_failures(self):
        failures = [
            ("ROW_SCHEMA_REJECTED", {**row(), "extra": "value"}),
            ("ROW_SCHEMA_REJECTED", {key: value for key, value in row().items()
                                     if key != "blob_id"}),
            ("IDENTIFIER_REJECTED", row(blob_id="bad/id")),
            ("REPOSITORY_REJECTED", row(repo_name="not-a-repository")),
            ("PATH_REJECTED", row(path="/../secret.py")),
            ("PATH_REJECTED", row(path="src/example.py")),
            ("LICENSE_REJECTED", row(detected_licenses="MIT")),
            ("LICENSE_REJECTED", row(detected_licenses=[" MIT"])),
            ("LANGUAGE_REJECTED", row(language="TypeScript")),
            ("ROW_VALUE_REJECTED", row(is_generated="no")),
            ("ROW_VALUE_REJECTED", row(is_vendor=None)),
            ("ROW_VALUE_REJECTED", row(src_encoding=8)),
            ("LENGTH_REJECTED", row(length_bytes="128")),
            ("LENGTH_REJECTED", row(length_bytes=-1)),
            ("DATE_REJECTED", row(visit_date="not-a-date")),
        ]
        for code, bad_row in failures:
            self.assert_code(code, lambda value=bad_row: self.run_stream([value]))

    def test_screens_out_ineligible_rows_without_failing_and_counts_every_inspected_row(self):
        screened_out = [
            row(blob_id="1" * 40, detected_licenses=[]),
            row(blob_id="2" * 40, detected_licenses=["MIT", "MIT"]),
            row(blob_id="3" * 40, is_generated=True),
            row(blob_id="4" * 40, is_vendor=True),
            row(blob_id="5" * 40, src_encoding="ISO-8859-1"),
            row(blob_id="6" * 40, length_bytes=262_145),
            row(blob_id="7" * 40, length_bytes=0),
            row(blob_id="8" * 40, path="/src/example.ts", extension="ts"),
            row(blob_id="a" * 40, extension="txt"),
            row(blob_id="b" * 40, path="/src/EXAMPLE.PY", extension="py"),
            row(blob_id="c" * 40, extension=""),
        ]
        eligible = row(blob_id="9" * 40, github_id=None, branch_name="HEAD")
        rows = [*screened_out[:4], eligible, *screened_out[4:]]

        count, _calls, text, _environment = self.run_stream(rows, request(rowLimit=len(rows)))

        emitted = self.rows_of(text)
        self.assertEqual(count, 1)
        self.assertEqual([entry["swhBlobId"] for entry in emitted], ["9" * 40])
        self.assertEqual(json.loads(self.trailer_of(text))["counters"]["rowsInspected"], len(rows))

    def test_rejects_changed_documented_column_types_and_relationships(self):
        failures = [
            ("ROW_VALUE_REJECTED", row(license_type="unknown")),
            ("ROW_VALUE_REJECTED", row(branch_name="")),
            ("ROW_VALUE_REJECTED", row(branch_name=None)),
            ("ROW_VALUE_REJECTED", row(extension=None)),
            ("ROW_VALUE_REJECTED", row(github_id=True)),
            ("ROW_VALUE_REJECTED", row(github_id="123")),
            ("ROW_VALUE_REJECTED", row(star_events_count=None)),
            ("ROW_VALUE_REJECTED", row(star_events_count=-1)),
            ("ROW_VALUE_REJECTED", row(gha_license_id=7)),
            ("DATE_REJECTED", row(gha_created_at="not-a-date")),
        ]
        for code, bad_row in failures:
            self.assert_code(code, lambda value=bad_row: self.run_stream([value]))

    def test_rejects_early_stop_load_and_iteration_failures_with_stable_codes(self):
        self.assert_code("EARLY_STOP", lambda: self.run_stream([], request(rowLimit=1)))

        def load_failure(*_args, **_kwargs):
            raise RuntimeError("Bearer private-token")

        self.assert_code("DATASET_LOAD_FAILED", lambda: stream_metadata(
            request(), read_rows_fn=load_failure,
            environment={"HF_TOKEN": "external-token"}, output=io.StringIO(),
            install_backend_fn=RecordingInstaller(),
        ))

        def failed_rows():
            raise RuntimeError("account@example.test")
            yield row()

        self.assert_code("STREAM_FAILED", lambda: self.run_stream(failed_rows()))

    def test_uses_and_cleans_isolated_cache_environment_on_success_and_failure(self):
        for rows in ([row()], []):
            observed_paths = []
            environment = {"HF_TOKEN": "external-token", "HF_HOME": "prior-home"}

            def loader(*_args, **_kwargs):
                observed_paths.extend([
                    environment["HF_HOME"], environment["HF_DATASETS_CACHE"],
                    environment["HUGGINGFACE_HUB_CACHE"],
                ])
                self.assertTrue(all(os.path.isdir(path) for path in observed_paths))
                return iter(rows)

            callback = lambda: stream_metadata(
                request(), read_rows_fn=loader, environment=environment,
                output=io.StringIO(), install_backend_fn=RecordingInstaller(),
            )
            if rows:
                callback()
            else:
                self.assert_code("EARLY_STOP", callback)
            self.assertEqual(environment, {"HF_TOKEN": "external-token", "HF_HOME": "prior-home"})
            self.assertTrue(all(not os.path.exists(path) for path in observed_paths))

    def test_installs_the_bounded_backend_with_the_request_budget_before_loading(self):
        order = []
        installer = RecordingInstaller()

        def recording_installer(budget):
            order.append("install")
            installer(budget)

        def loader(*_args, **_kwargs):
            order.append("load")
            return iter([row()])

        stream_metadata(
            request(requestLimit=7, networkByteLimit=4096), read_rows_fn=loader,
            environment={"HF_TOKEN": "external-token"}, output=io.StringIO(),
            install_backend_fn=recording_installer,
        )
        self.assertEqual(order, ["install", "load"])
        self.assertEqual(len(installer.budgets), 1)
        budget = installer.budgets[0]
        self.assertEqual((budget.request_limit, budget.byte_limit), (7, 4096))
        for _index in range(7):
            budget.begin_request()
        with self.assertRaises(Exception) as caught:
            budget.begin_request()
        self.assertEqual(caught.exception.code, "REQUEST_COUNT")
        budget.add_bytes(4096)
        with self.assertRaises(Exception) as caught:
            budget.add_bytes(1)
        self.assertEqual(caught.exception.code, "NETWORK_BYTES")

    def test_emits_a_canonical_counters_trailer_after_the_rows(self):
        installer = RecordingInstaller(requests=2, network_bytes=1000)
        count, _calls, text, _environment = self.run_stream([row()], installer=installer)
        self.assertEqual(count, 1)
        lines = text.splitlines()
        self.assertEqual(len(lines), 2)
        trailer = json.loads(lines[-1])
        self.assertEqual(set(trailer), {"counters"})
        self.assertEqual(list(trailer["counters"]), [
            "networkBytes", "peakTemporaryDiskBytes", "redirectsFollowed", "requests", "rowsInspected",
        ])
        self.assertEqual(trailer["counters"]["rowsInspected"], 1)
        self.assertEqual(trailer["counters"]["networkBytes"], 1000)
        self.assertEqual(trailer["counters"]["requests"], 2)
        self.assertEqual(trailer["counters"]["redirectsFollowed"], 0)
        self.assertIsInstance(trailer["counters"]["peakTemporaryDiskBytes"], int)
        self.assertGreaterEqual(trailer["counters"]["peakTemporaryDiskBytes"], 0)
        self.assertEqual(lines[-1], json.dumps(trailer, separators=(",", ":"), sort_keys=True))

    def test_fails_closed_when_temporary_disk_exceeds_the_ceiling_and_cleans_up(self):
        observed = []

        def loader(*_args, **_kwargs):
            path = os.path.join(environment["HF_HOME"], "oversized.bin")
            with open(path, "wb") as handle:
                handle.write(b"\0" * (2 * 1024 * 1024))
            observed.append(path)
            return iter([row()])

        environment = {"HF_TOKEN": "external-token"}
        self.assert_code("TEMPORARY_DISK", lambda: stream_metadata(
            request(temporaryDiskBytes=1024 * 1024), read_rows_fn=loader,
            environment=environment, output=io.StringIO(), install_backend_fn=RecordingInstaller(),
        ))
        self.assertFalse(os.path.exists(observed[0]))
        self.assertEqual(environment, {"HF_TOKEN": "external-token"})

        def slow_growth(*_args, **_kwargs):
            def rows():
                for index in range(3):
                    if index == 2:
                        with open(os.path.join(environment["HF_HOME"], "late.bin"), "wb") as handle:
                            handle.write(b"\0" * (2 * 1024 * 1024))
                    name = f"example{index}.py"
                    yield row(blob_id=str(index + 1) * 40, path=f"/src/{name}")
            return rows()

        self.assert_code("TEMPORARY_DISK", lambda: stream_metadata(
            request(rowLimit=3, temporaryDiskBytes=1024 * 1024), read_rows_fn=slow_growth,
            environment=environment, output=io.StringIO(), install_backend_fn=RecordingInstaller(),
        ))

    def test_sets_hub_hardening_environment_during_load_and_restores_it(self):
        environment = {"HF_TOKEN": "external-token", "HF_HUB_DISABLE_XET": "0", "TMPDIR": "/prior"}
        observed = {}

        def loader(*_args, **_kwargs):
            observed.update(environment)
            return iter([row()])

        stream_metadata(
            request(), read_rows_fn=loader, environment=environment,
            output=io.StringIO(), install_backend_fn=RecordingInstaller(),
        )
        for key in ("HF_HUB_DISABLE_XET", "HF_HUB_DISABLE_TELEMETRY", "HF_HUB_DISABLE_IMPLICIT_TOKEN",
                    "HF_HUB_DISABLE_PROGRESS_BARS"):
            self.assertEqual(observed[key], "1")
        self.assertEqual(observed["HF_HUB_ETAG_TIMEOUT"], "15")
        self.assertEqual(observed["HF_HUB_DOWNLOAD_TIMEOUT"], "15")
        self.assertTrue(observed["TMPDIR"].startswith(observed["HF_HOME"].rsplit("/", 1)[0]))
        self.assertTrue(observed["HF_TOKEN_PATH"].startswith(observed["HF_HOME"].rsplit("/", 1)[0]))
        self.assertFalse(os.path.exists(observed["HF_TOKEN_PATH"]))
        self.assertEqual(environment, {"HF_TOKEN": "external-token", "HF_HUB_DISABLE_XET": "0", "TMPDIR": "/prior"})


if __name__ == "__main__":
    unittest.main()
