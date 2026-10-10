import datetime
import hashlib
import json
import os
import re
import sys
import tempfile


PINNED_REVISION = "e565caa3a78c2423bd374333a472b049eb090e47"
MAXIMUM_ROWS = 10_000
MAXIMUM_BLOB_BYTES = 256 * 1024
MAXIMUM_REQUESTS = 600
MAXIMUM_NETWORK_BYTES = 96 * 1024 * 1024
MAXIMUM_TEMPORARY_BYTES = 32 * 1024 * 1024
DISK_CHECK_INTERVAL = 256
REQUEST_KEYS = {
    "configuration", "revision", "rowLimit", "perBlobByteLimit",
    "requestLimit", "networkByteLimit", "temporaryDiskBytes",
}
PROVIDER_KEYS = {
    "blob_id", "directory_id", "path", "content_id", "detected_licenses",
    "license_type", "repo_name", "snapshot_id", "revision_id", "branch_name",
    "visit_date", "revision_date", "committer_date", "github_id",
    "star_events_count", "fork_events_count", "gha_license_id",
    "gha_event_created_at", "gha_created_at", "gha_language", "src_encoding",
    "language", "is_vendor", "is_generated", "length_bytes", "extension",
}
CACHE_KEYS = ("HF_HOME", "HF_DATASETS_CACHE", "HUGGINGFACE_HUB_CACHE", "HF_TOKEN_PATH", "TMPDIR")
HUB_HARDENING = {
    "HF_HUB_DISABLE_XET": "1",
    "HF_HUB_DISABLE_TELEMETRY": "1",
    "HF_HUB_DISABLE_IMPLICIT_TOKEN": "1",
    "HF_HUB_DISABLE_PROGRESS_BARS": "1",
    "HF_HUB_ETAG_TIMEOUT": "15",
    "HF_HUB_DOWNLOAD_TIMEOUT": "15",
}
# Revision 12 FR-025/FR-028: the five configured language subsets and their exact extensions.
EXTENSIONS = {
    "Python": (".py",),
    "TypeScript": (".ts", ".tsx"),
    "Go": (".go",),
    "Rust": (".rs",),
    "Ruby": (".rb",),
}
HEX_40 = re.compile(r"^[0-9a-f]{40}$")
REPOSITORY = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


class MetadataStreamError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _fail(code):
    raise MetadataStreamError(code)


def _parse_request(value, environment):
    if not isinstance(value, dict) or set(value) != REQUEST_KEYS:
        _fail("REQUEST_MALFORMED")
    configuration = value["configuration"]
    if configuration not in EXTENSIONS:
        _fail("CONFIGURATION_REJECTED")
    if value["revision"] != PINNED_REVISION:
        _fail("REVISION_REJECTED")
    row_limit = _bounded_integer(value["rowLimit"], MAXIMUM_ROWS, "ROW_LIMIT_REJECTED")
    byte_limit = _bounded_integer(
        value["perBlobByteLimit"], MAXIMUM_BLOB_BYTES, "BYTE_LIMIT_REJECTED"
    )
    request_limit = _bounded_integer(value["requestLimit"], MAXIMUM_REQUESTS, "REQUEST_LIMIT_REJECTED")
    network_limit = _bounded_integer(
        value["networkByteLimit"], MAXIMUM_NETWORK_BYTES, "NETWORK_LIMIT_REJECTED"
    )
    disk_limit = _bounded_integer(
        value["temporaryDiskBytes"], MAXIMUM_TEMPORARY_BYTES, "DISK_LIMIT_REJECTED"
    )
    token = environment.get("HF_TOKEN")
    if not isinstance(token, str) or not token.strip():
        _fail("TOKEN_MISSING")
    return configuration, row_limit, byte_limit, token, request_limit, network_limit, disk_limit


def _bounded_integer(value, maximum, code):
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
        _fail(code)
    return value


def _text(value, code):
    if not isinstance(value, str) or not value or value.strip() != value:
        _fail(code)
    return value


def _identifier(value):
    parsed = _text(value, "IDENTIFIER_REJECTED")
    if not HEX_40.fullmatch(parsed):
        _fail("IDENTIFIER_REJECTED")
    return parsed


def _date(value, *, optional=False):
    if value is None and optional:
        return None
    if isinstance(value, datetime.datetime):
        moment = value
    elif isinstance(value, str) and value.strip() == value and value:
        try:
            moment = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            _fail("DATE_REJECTED")
    else:
        _fail("DATE_REJECTED")
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=datetime.timezone.utc)
    moment = moment.astimezone(datetime.timezone.utc)
    timespec = "microseconds" if moment.microsecond else "seconds"
    return moment.isoformat(timespec=timespec).replace("+00:00", "Z")


def _path(value):
    """Structural path validation; the configured extension is a screening criterion, not a schema rule."""
    parsed = _text(value, "PATH_REJECTED")
    relative = parsed[1:] if parsed.startswith("/") else parsed
    if not parsed.startswith("/") or "\\" in parsed:
        _fail("PATH_REJECTED")
    if any(part in ("", ".", "..") for part in relative.split("/")):
        _fail("PATH_REJECTED")
    return relative


def _extensions(configuration):
    return EXTENSIONS[configuration]


def _licenses(value):
    """Structural licence validation; an empty or repeated list screens the row out later."""
    if not isinstance(value, list):
        _fail("LICENSE_REJECTED")
    return [_text(item, "LICENSE_REJECTED") for item in value]


def _validate_documented_columns(value, path):
    if value["license_type"] not in ("permissive", "no_license"):
        _fail("ROW_VALUE_REJECTED")
    # The card documents branch_name only as a name; values such as HEAD are data, not drift.
    _text(value["branch_name"], "ROW_VALUE_REJECTED")
    # github_id is null when the GitHub Archive linkage is absent; event counts are always present.
    for name in ("github_id", "star_events_count", "fork_events_count"):
        if value[name] is None and name == "github_id":
            continue
        if isinstance(value[name], bool) or not isinstance(value[name], int) or value[name] < 0:
            _fail("ROW_VALUE_REJECTED")
    for name in ("gha_license_id", "gha_language"):
        if value[name] is not None:
            _text(value[name], "ROW_VALUE_REJECTED")
    _date(value["gha_event_created_at"], optional=True)
    _date(value["gha_created_at"], optional=True)
    # The extension column is typed here (it is empty for extensionless files); whether it
    # agrees with the path is a screening question.
    if not isinstance(value["extension"], str):
        _fail("ROW_VALUE_REJECTED")


def _validate_row(value, configuration, byte_limit):
    """Fails closed on schema or metadata drift (FR-028); returns None for a row that
    merely fails the FR-029 screening and therefore may not proceed to blob retrieval."""
    if not isinstance(value, dict) or set(value) != PROVIDER_KEYS:
        _fail("ROW_SCHEMA_REJECTED")
    if value["language"] != configuration:
        _fail("LANGUAGE_REJECTED")
    for name in ("is_generated", "is_vendor"):
        if not isinstance(value[name], bool):
            _fail("ROW_VALUE_REJECTED")
    encoding = _text(value["src_encoding"], "ROW_VALUE_REJECTED")
    length = value["length_bytes"]
    if isinstance(length, bool) or not isinstance(length, int) or length < 0:
        _fail("LENGTH_REJECTED")
    repository = _text(value["repo_name"], "REPOSITORY_REJECTED")
    if not REPOSITORY.fullmatch(repository):
        _fail("REPOSITORY_REJECTED")
    path = _path(value["path"])
    licenses = _licenses(value["detected_licenses"])
    _validate_documented_columns(value, path)
    screened_out = (
        value["is_generated"] or value["is_vendor"] or encoding != "UTF-8"
        or not 1 <= length <= byte_limit or not licenses or len(set(licenses)) != len(licenses)
        or not path.endswith(_extensions(configuration))
        or value["extension"] != path.rsplit(".", 1)[-1]
    )
    if screened_out:
        return None
    return _project(value, configuration, repository, path, length)


def _project(value, configuration, repository, path, length):
    fields = {
        "swhBlobId": _identifier(value["blob_id"]),
        "swhContentId": _identifier(value["content_id"]),
        "swhDirectoryId": _identifier(value["directory_id"]),
        "swhSnapshotId": _identifier(value["snapshot_id"]),
        "swhRevisionId": _identifier(value["revision_id"]),
        "repository": repository,
        "path": path,
        "detectedLicenses": _licenses(value["detected_licenses"]),
        "detectedLanguage": configuration,
        "generated": False,
        "vendor": False,
        "sourceEncoding": "UTF-8",
        "byteLength": length,
        "visitDate": _date(value["visit_date"]),
        "revisionDate": _date(value["revision_date"]),
        "committerDate": _date(value["committer_date"]),
    }
    canonical = json.dumps(fields, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return {"stableRowId": hashlib.sha256(canonical.encode("utf-8")).hexdigest(), **fields}


def _cache_environment(environment, root):
    previous = {key: environment.get(key) for key in CACHE_KEYS + tuple(HUB_HARDENING)}
    for key, directory in (("HF_HOME", "home"), ("HF_DATASETS_CACHE", "datasets"),
                           ("HUGGINGFACE_HUB_CACHE", "hub"), ("TMPDIR", "tmp")):
        path = os.path.join(root, directory)
        os.makedirs(path, mode=0o700)
        environment[key] = path
    environment["HF_TOKEN_PATH"] = os.path.join(root, "no-token")
    environment.update(HUB_HARDENING)
    return previous


def _restore_environment(environment, previous):
    for key, value in previous.items():
        if value is None:
            environment.pop(key, None)
        else:
            environment[key] = value


def _default_reader(configuration, token, budget, row_limit):
    from bounded_http import create_client
    from bounded_parquet import read_rows
    with create_client(budget) as client:
        yield from read_rows(client, configuration, token, row_limit)


def _default_installer(budget):
    from bounded_http import install_bounded_backend
    install_bounded_backend(budget)


def _default_measure(root):
    from bounded_http import measure_tree
    return measure_tree(root)


def _check_temporary_disk(budget, measure, cache_root, disk_limit):
    measured = measure(cache_root)
    budget.observe_temporary_disk(measured)
    if measured > disk_limit:
        _fail("TEMPORARY_DISK")


def _stable_code(error, fallback):
    code = getattr(error, "code", None)
    return code if isinstance(code, str) and code.isupper() else fallback


def stream_metadata(request, *, read_rows_fn=None, environment=None, output=None,
                    install_backend_fn=None, measure_disk_fn=None):
    from bounded_http import NetworkBudget
    active_environment = os.environ if environment is None else environment
    active_output = sys.stdout if output is None else output
    (configuration, row_limit, byte_limit, token,
     request_limit, network_limit, disk_limit) = _parse_request(request, active_environment)
    reader = _default_reader if read_rows_fn is None else read_rows_fn
    installer = _default_installer if install_backend_fn is None else install_backend_fn
    measure = _default_measure if measure_disk_fn is None else measure_disk_fn
    budget = NetworkBudget(request_limit, network_limit)
    with tempfile.TemporaryDirectory(prefix="codeguessr-stack-metadata-") as cache_root:
        previous = _cache_environment(active_environment, cache_root)
        try:
            installer(budget)
            try:
                iterator = iter(reader(configuration, token, budget, row_limit))
            except Exception as error:  # noqa: BLE001 - only a stable code leaves the worker
                _fail(_stable_code(error, "DATASET_LOAD_FAILED"))
            _check_temporary_disk(budget, measure, cache_root, disk_limit)
            emitted = 0
            for index in range(row_limit):
                try:
                    source_row = next(iterator)
                except StopIteration:
                    _fail("EARLY_STOP")
                except Exception as error:  # noqa: BLE001 - only a stable code leaves the worker
                    _fail(_stable_code(error, "STREAM_FAILED"))
                projected = _validate_row(source_row, configuration, byte_limit)
                if projected is not None:
                    active_output.write(json.dumps(projected, ensure_ascii=False, separators=(",", ":")) + "\n")
                    emitted += 1
                if (index + 1) % DISK_CHECK_INTERVAL == 0:
                    _check_temporary_disk(budget, measure, cache_root, disk_limit)
            _check_temporary_disk(budget, measure, cache_root, disk_limit)
            # Every inspected row counts against the signed row ceiling, whether or not it was emitted.
            active_output.write(json.dumps(
                {"counters": {**budget.counters(), "rowsInspected": row_limit}},
                separators=(",", ":"), sort_keys=True,
            ) + "\n")
            return emitted
        finally:
            _restore_environment(active_environment, previous)


def _main():
    try:
        stream_metadata(json.load(sys.stdin))
        return 0
    except MetadataStreamError as error:
        sys.stderr.write(error.code + "\n")
        return 1
    except Exception as error:
        code = getattr(error, "code", None)
        sys.stderr.write((code if isinstance(code, str) and code.isupper() else "REQUEST_MALFORMED") + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(_main())
