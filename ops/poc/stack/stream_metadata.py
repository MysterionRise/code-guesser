import datetime
import hashlib
import json
import os
import re
import sys
import tempfile
import unicodedata

from limits import CEILINGS, STACK_REVISION


PINNED_REVISION = STACK_REVISION
MAXIMUM_ROWS = CEILINGS["stackRowsPerLanguage"]
MAXIMUM_BLOB_BYTES = CEILINGS["perBlobBytes"]
MAXIMUM_REQUESTS = CEILINGS["requestCount"]
MAXIMUM_NETWORK_BYTES = CEILINGS["stackMetadataBytes"]
MAXIMUM_TEMPORARY_BYTES = CEILINGS["temporaryDiskBytes"]
DISK_CHECK_INTERVAL = 256
REQUEST_KEYS = {
    "configuration", "revision", "rowLimit", "perBlobByteLimit",
    "requestLimit", "networkByteLimit", "temporaryDiskBytes", "sample",
}
SAMPLE_KEYS = {"licenses", "minimumStarEvents", "popularRepositories", "rowsPerRepository", "ordinaryRows"}
# Bounds on what one language may emit: the decks need a few files from each popular repository and a
# modest sample of ordinary ones, never the whole row group.
MAXIMUM_POPULAR_REPOSITORIES = 100
MAXIMUM_ROWS_PER_REPOSITORY = 10
MAXIMUM_ORDINARY_ROWS = 1000
MAXIMUM_LICENSES = 16
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
# The configured language subsets and their exact extensions. C keeps to `.c` because a `.h`
# header may be C or C++.
EXTENSIONS = {
    "Python": (".py",),
    "Ruby": (".rb",),
    "TypeScript": (".ts", ".tsx"),
    "JavaScript": (".js",),
    "Go": (".go",),
    "Rust": (".rs",),
    "Java": (".java",),
    "C#": (".cs",),
    "Kotlin": (".kt",),
    "Swift": (".swift",),
    "C": (".c",),
    "C++": (".cpp", ".cc", ".cxx", ".hpp"),
    "Haskell": (".hs",),
    "Elm": (".elm",),
    "OCaml": (".ml",),
    "F#": (".fs",),
    "Erlang": (".erl",),
    "Prolog": (".pl", ".pro"),
    "Clojure": (".clj", ".cljc"),
    "Racket": (".rkt",),
    "Julia": (".jl",),
    "MATLAB": (".m",),
    "Ada": (".adb",),
    "Pascal": (".pas", ".pp"),
    "Elixir": (".ex", ".exs"),
    "Crystal": (".cr",),
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
    sample = _parse_sample(value["sample"])
    token = environment.get("HF_TOKEN")
    if not isinstance(token, str) or not token.strip():
        _fail("TOKEN_MISSING")
    return configuration, row_limit, byte_limit, token, request_limit, network_limit, disk_limit, sample


def _parse_sample(value):
    if not isinstance(value, dict) or set(value) != SAMPLE_KEYS:
        _fail("SAMPLE_REJECTED")
    licenses = value["licenses"]
    if (not isinstance(licenses, list) or not 1 <= len(licenses) <= MAXIMUM_LICENSES
            or len(set(licenses)) != len(licenses)):
        _fail("SAMPLE_REJECTED")
    for license_id in licenses:
        _text(license_id, "SAMPLE_REJECTED")
    minimum = _bounded_integer(value["minimumStarEvents"], 2 ** 31, "SAMPLE_REJECTED")
    popular = _bounded_integer(value["popularRepositories"], MAXIMUM_POPULAR_REPOSITORIES, "SAMPLE_REJECTED")
    per_repository = _bounded_integer(value["rowsPerRepository"], MAXIMUM_ROWS_PER_REPOSITORY, "SAMPLE_REJECTED")
    ordinary = _bounded_integer(value["ordinaryRows"], MAXIMUM_ORDINARY_ROWS, "SAMPLE_REJECTED")
    return Sample(frozenset(licenses), minimum, popular, per_repository, ordinary)


class Sample:
    """What one language emits from the rows it inspected. Rows whose licences all sit on the allowlist
    are split by their repository's star events: from the most-starred repositories (ties by name) the
    rows with the lowest stable ids, a few per repository; from every other repository its lowest-id row,
    and of those the lowest ids overall. The choice depends only on the rows, never on their order."""

    def __init__(self, licenses, minimum_star_events, popular_repositories, rows_per_repository, ordinary_rows):
        self.licenses = licenses
        self.minimum_star_events = minimum_star_events
        self.popular_repositories = popular_repositories
        self.rows_per_repository = rows_per_repository
        self.ordinary_rows = ordinary_rows
        self._popular = {}
        self._ordinary = {}

    def offer(self, projected):
        if not set(projected["detectedLicenses"]) <= self.licenses:
            return
        repository = projected["repository"]
        stars = projected["starEventsCount"]
        if stars >= self.minimum_star_events:
            entry = self._popular.setdefault(repository, [0, []])
            entry[0] = max(entry[0], stars)
            entry[1].append(projected)
            entry[1].sort(key=_stable_id)
            del entry[1][self.rows_per_repository:]
            return
        current = self._ordinary.get(repository)
        if current is None or projected["stableRowId"] < current["stableRowId"]:
            self._ordinary[repository] = projected

    def rows(self):
        ranked = sorted(self._popular.items(), key=lambda item: (-item[1][0], item[0]))
        popular = [row for _repository, (_stars, rows) in ranked[:self.popular_repositories] for row in rows]
        # A repository whose rows straddle the threshold counts as popular only.
        ordinary = sorted((row for repository, row in self._ordinary.items() if repository not in self._popular),
                          key=_stable_id)
        return popular + ordinary[:self.ordinary_rows]


def _stable_id(row):
    return row["stableRowId"]


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
    """Structural path validation: a non-empty text rooted at `/` is the documented shape, and anything
    else fails closed. A rooted path that is still unusable as a repository path (a backslash, which a
    Unix file name may hold, or an empty, `.`, or `..` segment) is data, not drift: it returns None and
    the row is screened out. The configured extension is likewise a screening criterion."""
    parsed = _text(value, "PATH_REJECTED")
    if not parsed.startswith("/"):
        _fail("PATH_REJECTED")
    relative = parsed[1:]
    if "\\" in parsed or any(part in ("", ".", "..") for part in relative.split("/")):
        return None
    return relative


def _plain_path(relative):
    """Node validates the emitted path with JavaScript's trim, whose whitespace set differs from
    Python's at the edges (a byte-order mark, the C0 separators). A path either side would trim, or
    one carrying a control character, is a screening rejection rather than an emitted row."""
    return (relative == relative.strip() and not relative.startswith("\ufeff")
            and not relative.endswith("\ufeff")
            and not any(unicodedata.category(character) == "Cc" for character in relative))


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
        path is None
        or value["is_generated"] or value["is_vendor"] or encoding != "UTF-8"
        or not 1 <= length <= byte_limit or not licenses or len(set(licenses)) != len(licenses)
        or not _plain_path(path)
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
        # GitHub Archive star and fork events: the popularity signal the project deck ranks by.
        "starEventsCount": value["star_events_count"],
        "forkEventsCount": value["fork_events_count"],
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
     request_limit, network_limit, disk_limit, sample) = _parse_request(request, active_environment)
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
            for index in range(row_limit):
                try:
                    source_row = next(iterator)
                except StopIteration:
                    _fail("EARLY_STOP")
                except Exception as error:  # noqa: BLE001 - only a stable code leaves the worker
                    _fail(_stable_code(error, "STREAM_FAILED"))
                # Every row is validated, so schema drift anywhere in the inspected rows fails closed.
                projected = _validate_row(source_row, configuration, byte_limit)
                if projected is not None:
                    sample.offer(projected)
                if (index + 1) % DISK_CHECK_INTERVAL == 0:
                    _check_temporary_disk(budget, measure, cache_root, disk_limit)
            _check_temporary_disk(budget, measure, cache_root, disk_limit)
            emitted = sample.rows()
            for projected in emitted:
                active_output.write(json.dumps(projected, ensure_ascii=False, separators=(",", ":")) + "\n")
            # Every inspected row counts against the row ceiling, whether or not it was emitted.
            active_output.write(json.dumps(
                {"counters": {**budget.counters(), "rowsInspected": row_limit}},
                separators=(",", ":"), sort_keys=True,
            ) + "\n")
            return len(emitted)
        finally:
            _restore_environment(active_environment, previous)


def _main(argv=()):
    """`--check-request` validates the request the orchestrator would send and exits without
    any network access; it lets an offline test cross the Node-to-Python boundary."""
    if list(argv) not in ([], ["--check-request"]):
        sys.stderr.write("ARGUMENTS_REJECTED\n")
        return 1
    try:
        request = json.load(sys.stdin)
        if argv:
            _parse_request(request, os.environ)
            return 0
        stream_metadata(request)
        return 0
    except MetadataStreamError as error:
        sys.stderr.write(error.code + "\n")
        return 1
    except Exception as error:
        code = getattr(error, "code", None)
        sys.stderr.write((code if isinstance(code, str) and code.isupper() else "WORKER_UNEXPECTED") + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
