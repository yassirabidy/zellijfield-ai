"""Model file manager for Zellijfield AI, run inside the wan2gp container by zf_model_server.py.

Everything goes through WanGP's own code, so no file names or URLs are hard-coded here:
- the expected files come from shared/model_dropdowns.py (the same lists WanGP's status uses);
- downloads run wgp.load_models() and stop right after its download phase, before any weights
  are loaded, so exactly the files a generation would fetch are fetched.

Commands (one JSON object per line on stdout, prefixed with EVENT_PREFIX; WanGP's own output
is interleaved and ignored by the server):
  status <model_type>...
  download <model_type> [--dry-run]
  remove <model_type> [--keep <model_type> ...]
"""

import argparse
import json
import os
import sys

WANGP_ROOT = "/opt/wan2gp"
# Folders WanGP downloads into (bind-mounted from models/ on the host). Nothing outside them is
# ever deleted.
MANAGED_ROOTS = [os.path.realpath(os.path.join(WANGP_ROOT, d)) for d in ("ckpts", "loras")]
EVENT_PREFIX = "ZF-EVENT "
MODEL_TYPE_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-")


def emit(event, **data):
    sys.stdout.write(EVENT_PREFIX + json.dumps({"event": event, **data}) + "\n")
    sys.stdout.flush()


def model_type_arg(value):
    if not value or len(value) > 100 or not set(value) <= MODEL_TYPE_CHARS:
        raise argparse.ArgumentTypeError("invalid model type")
    return value


def load_wgp():
    sys.path.insert(0, WANGP_ROOT)
    os.chdir(WANGP_ROOT)
    from shared import api

    session = api.init(root=WANGP_ROOT, config_path="/config/wgp_config.json", cli_args=["--settings", "/config/settings"])
    return session._ensure_runtime().module


def entry_paths(wgp, deps, model_type):
    """Resolved local paths of a model's expected files that exist on disk."""
    md = wgp.model_dropdowns
    entries = md.get_expected_core_file_entries_for_status(deps, model_type) + md.get_expected_secondary_file_entries_for_status(deps, model_type)
    paths = set()
    for entry in entries:
        if "path" in entry:
            local = entry["path"] if os.path.isfile(entry["path"]) else None
        else:
            local = deps.get_local_model_filename(entry["filename"], extra_paths=entry.get("extra_paths"))
        if local:
            paths.add(os.path.realpath(local))
    return paths


def status_label(wgp, deps, model_type):
    md = wgp.model_dropdowns
    if deps.get_model_def(model_type) is None:
        return "unknown-model"
    code = md.get_model_download_status(deps, model_type)
    return {md.MODEL_FILE_STATUS_EXPECTED: "available", md.MODEL_FILE_STATUS_PARTIAL: "partial"}.get(code, "missing")


def cmd_status(wgp, args):
    deps = wgp._get_dropdown_deps()
    result = {}
    for model_type in args.model_types:
        label = status_label(wgp, deps, model_type)
        paths = entry_paths(wgp, deps, model_type) if label != "unknown-model" else set()
        result[model_type] = {"status": label, "bytes": sum(os.path.getsize(p) for p in paths)}
    emit("status", models=result)


class _DownloadsDone(Exception):
    pass


def cmd_download(wgp, args):
    deps = wgp._get_dropdown_deps()
    if deps.get_model_def(args.model_type) is None:
        emit("error", message=f"Unknown model_type: {args.model_type}")
        return 2

    def on_progress(report):
        if report:
            emit("progress", file=report.get("filename"), completed=report.get("completed"), total=report.get("total"),
                 speed=report.get("speed"), file_index=report.get("file_index"), file_count=report.get("file_count"))

    if args.dry_run:
        # Report what would be fetched instead of fetching it.
        wgp.download_file = lambda url, filename, **_: emit("would-download", url=url.split("|")[0], target=filename)
        wgp.process_files_def = lambda repoId=None, sourceFolderList=None, fileList=None, targetFolderList=None, **_: emit(
            "would-download", repo=repoId, folders=sourceFolderList, files=fileList)

    # load_models() calls check_download_cancelled() once its downloads are finished and before it
    # loads any weights; stop there.
    original_check = wgp.check_download_cancelled

    def check_then_stop(gen):
        original_check(gen)
        if sys._getframe(1).f_code.co_name == "load_models":
            raise _DownloadsDone()

    wgp.check_download_cancelled = check_then_stop
    emit("started", model_type=args.model_type)
    try:
        wgp.load_models(args.model_type, gen={"download_progress_callback": on_progress})
    except _DownloadsDone:
        emit("done", model_type=args.model_type, status=status_label(wgp, deps, args.model_type))
        return 0
    emit("error", message="WanGP finished loading without reaching the end of its download phase")
    return 1


def cmd_remove(wgp, args):
    deps = wgp._get_dropdown_deps()
    if deps.get_model_def(args.model_type) is None:
        emit("error", message=f"Unknown model_type: {args.model_type}")
        return 2
    target = entry_paths(wgp, deps, args.model_type)
    # Files shared with another model that is (partly) installed stay, e.g. a common text encoder.
    shared = set()
    for other in args.keep:
        if other != args.model_type and deps.get_model_def(other) is not None and status_label(wgp, deps, other) != "missing":
            shared |= entry_paths(wgp, deps, other)
    removed, kept, freed = [], [], 0
    for path in sorted(target):
        if path in shared:
            kept.append(os.path.basename(path))
            continue
        if not any(path.startswith(root + os.sep) for root in MANAGED_ROOTS):
            kept.append(os.path.basename(path))
            continue
        freed += os.path.getsize(path)
        os.remove(path)
        removed.append(os.path.basename(path))
    emit("removed", model_type=args.model_type, removed=removed, kept_shared=kept, bytes_freed=freed,
         status=status_label(wgp, deps, args.model_type))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("status")
    p.add_argument("model_types", nargs="+", type=model_type_arg)
    p = sub.add_parser("download")
    p.add_argument("model_type", type=model_type_arg)
    p.add_argument("--dry-run", action="store_true")
    p = sub.add_parser("remove")
    p.add_argument("model_type", type=model_type_arg)
    p.add_argument("--keep", nargs="*", type=model_type_arg, default=[])
    args = parser.parse_args()

    try:
        wgp = load_wgp()
        handler = {"status": cmd_status, "download": cmd_download, "remove": cmd_remove}[args.command]
        return handler(wgp, args) or 0
    except Exception as exc:  # reported to the studio, which shows it to the user
        emit("error", message=f"{type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
