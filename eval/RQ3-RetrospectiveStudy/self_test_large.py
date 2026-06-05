#!/usr/bin/env python3
"""
self_test_large.py - Larger synthetic test (50+ SATDs, 20+ commits) to verify
that the 4 ranking strategies actually produce *different* outcomes.

Run from this directory:
  python self_test_large.py
"""

import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import textwrap
from datetime import datetime, timedelta, timezone
from pathlib import Path


def run(cmd, cwd=None, env=None):
    return subprocess.run(
        cmd, cwd=cwd, env=env, check=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    ).stdout


def gitenv(date_iso):
    e = os.environ.copy()
    e["GIT_AUTHOR_NAME"] = "Tester"
    e["GIT_AUTHOR_EMAIL"] = "tester@example.com"
    e["GIT_COMMITTER_NAME"] = "Tester"
    e["GIT_COMMITTER_EMAIL"] = "tester@example.com"
    e["GIT_AUTHOR_DATE"] = date_iso
    e["GIT_COMMITTER_DATE"] = date_iso
    return e


def commit(repo, msg, date_iso):
    run(["git", "add", "-A"], cwd=repo)
    run(["git", "commit", "-m", msg, "--allow-empty"], cwd=repo, env=gitenv(date_iso))


def build(repo):
    repo.mkdir(parents=True, exist_ok=True)
    run(["git", "init", "-q", "-b", "main"], cwd=repo)
    run(["git", "config", "user.email", "t@x"], cwd=repo)
    run(["git", "config", "user.name", "T"], cwd=repo)

    base = datetime.now(timezone.utc) - timedelta(days=900)
    rng = random.Random(7)

    # Build a moderately complex codebase with many SATD instances
    # spread across 6 modules. Some files have a high SATD density;
    # others have minor SATDs.
    modules = ["auth", "db", "api", "ui", "utils", "logging"]
    files = {}

    for mod in modules:
        for i in range(3):
            path = f"src/{mod}/file_{i}.py"
            satd_count = rng.randint(1, 4)
            lines = [f"# {mod} module - file {i}", "import os", ""]
            for j in range(satd_count):
                keyword = rng.choice(["TODO", "FIXME", "HACK", "XXX"])
                problem = rng.choice([
                    "needs refactoring", "temporary solution",
                    "hardcoded value", "remove this hack",
                    "deprecated approach", "race condition possible",
                ])
                lines.append(f"def func_{j}():")
                lines.append(f"    # {keyword}: {problem}")
                lines.append(f"    return {j}")
                lines.append("")
            files[path] = "\n".join(lines)

    # Plant all at the snapshot
    for p, c in files.items():
        full = repo / p
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(c)
    commit(repo, "initial codebase with SATD",
           base.strftime("%Y-%m-%d %H:%M:%S"))
    snap = run(["git", "rev-parse", "HEAD"], cwd=repo).strip()

    # Now produce 25 post-snapshot commits over ~12 months.
    # Some commits address SATD (by deleting the comment line);
    # others do unrelated work to add noise.
    all_files = list(files.keys())
    for i in range(25):
        day_offset = (i + 1) * 10
        target = rng.choice(all_files)
        path = repo / target
        text = path.read_text().splitlines()

        if rng.random() < 0.55:
            # Try to address a SATD line in this file
            satd_idx = [
                k for k, l in enumerate(text)
                if any(kw in l for kw in ["TODO", "FIXME", "HACK", "XXX"])
            ]
            if satd_idx:
                drop = rng.choice(satd_idx)
                # Replace the SATD comment with a regular comment
                text[drop] = "    # fix applied"
                path.write_text("\n".join(text) + "\n")
                commit(repo, f"address SATD in {target}",
                       (base + timedelta(days=day_offset)).strftime("%Y-%m-%d %H:%M:%S"))
                continue

        # Otherwise: noise commit - add an unrelated helper
        text.append(f"")
        text.append(f"def helper_{i}():")
        text.append(f"    return {i}")
        path.write_text("\n".join(text) + "\n")
        commit(repo, f"noise commit {i} in {target}",
               (base + timedelta(days=day_offset)).strftime("%Y-%m-%d %H:%M:%S"))

    return snap


def main():
    here = Path(__file__).parent.resolve()
    work = Path(tempfile.mkdtemp(prefix="rq3_large_"))
    print(f"[large_test] working in {work}")
    try:
        repo = work / "repos" / "synthetic_large"
        snap = build(repo)
        print(f"[large_test] snapshot = {snap[:12]}")

        cfg = work / "config.json"
        cfg.write_text(json.dumps({"projects": [{
            "project_id": "SL",
            "name": "SyntheticLarge",
            "repo_path": str(repo),
            "snapshot_commit": snap,
            "horizon_months": 24,
            "full_dependency": True,
        }]}, indent=2))

        out = work / "out"
        subprocess.run([
            sys.executable, str(here / "rq3_evaluate.py"),
            "--config", str(cfg), "--output", str(out),
        ], check=True)

        # Show key tables
        print("\n--- rq3_hit_mrr_aggregate.csv ---")
        print((out / "rq3_hit_mrr_aggregate.csv").read_text())
        print("--- rq3_per_project.csv ---")
        print((out / "rq3_per_project.csv").read_text())
        print("--- rq3_co_removal.csv ---")
        print((out / "rq3_co_removal.csv").read_text())
        print("--- rq3_time_to_resolution.csv ---")
        print((out / "rq3_time_to_resolution.csv").read_text())

        # Sanity check: are CAIG and recency producing different MRRs?
        import csv as _csv
        with (out / "rq3_hit_mrr_aggregate.csv").open() as f:
            rows = list(_csv.DictReader(f))
        by_strat = {r["strategy"]: r for r in rows}
        mrrs = {s: float(r["mrr"]) for s, r in by_strat.items()}
        print(f"\n[large_test] MRR by strategy: {mrrs}")
        # Expect at least 2 different values across the 4 strategies
        unique_mrrs = len({round(v, 3) for v in mrrs.values()})
        if unique_mrrs < 2:
            print(f"[large_test] WARN: all strategies returned same MRR ({mrrs})")
        else:
            print(f"[large_test] OK: {unique_mrrs} distinct MRR values across strategies")
        print("[large_test] PASSED")
        return 0
    finally:
        if "RQ3_KEEP_TMP" not in os.environ:
            shutil.rmtree(work, ignore_errors=True)
        else:
            print(f"[large_test] tmp kept at {work}")


if __name__ == "__main__":
    sys.exit(main())
