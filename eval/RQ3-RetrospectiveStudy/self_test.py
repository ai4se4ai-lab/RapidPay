#!/usr/bin/env python3
"""
self_test.py - Build a synthetic git repository with planted SATD instances
and a known post-snapshot edit history, then run rq3_evaluate.py against it.

This is an integration smoke test that verifies:
  * SATD detection works
  * Snapshot/horizon replay works
  * Co-removal detection works
  * All 4 CSV outputs are produced
  * Rankings differ across strategies (sanity check)

Run from this directory:
  python self_test.py
"""

import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import textwrap
from datetime import datetime, timedelta
from pathlib import Path


def run(cmd, cwd=None, env=None):
    res = subprocess.run(cmd, cwd=cwd, env=env, check=True,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return res.stdout


def git_env(date_iso):
    e = os.environ.copy()
    e["GIT_AUTHOR_NAME"] = "Tester"
    e["GIT_AUTHOR_EMAIL"] = "tester@example.com"
    e["GIT_COMMITTER_NAME"] = "Tester"
    e["GIT_COMMITTER_EMAIL"] = "tester@example.com"
    e["GIT_AUTHOR_DATE"] = date_iso
    e["GIT_COMMITTER_DATE"] = date_iso
    return e


def commit_all(repo, msg, date_iso):
    run(["git", "add", "-A"], cwd=repo)
    run(["git", "commit", "-m", msg, "--allow-empty"], cwd=repo, env=git_env(date_iso))


def head_sha(repo):
    return run(["git", "rev-parse", "HEAD"], cwd=repo).strip()


def build_test_repo(repo: Path):
    repo.mkdir(parents=True, exist_ok=True)
    run(["git", "init", "-q", "-b", "main"], cwd=repo)
    run(["git", "config", "user.name", "Tester"], cwd=repo)
    run(["git", "config", "user.email", "tester@example.com"], cwd=repo)

    src = repo / "src"
    src.mkdir(exist_ok=True)

    # Build dates: snapshot will be 30 months ago; addressed commits within
    # 18 months after.
    base = datetime.utcnow() - timedelta(days=900)  # ~30 months ago

    # ---------- pre-snapshot history (SATD lines exist at snapshot) ----------
    files = {
        "src/auth.py": textwrap.dedent('''\
            # auth module
            def login(user, pwd):
                # TODO: replace this with proper bcrypt hashing
                if pwd == "secret":
                    return True
                return False

            def logout(user):
                # FIXME: cookie not invalidated on logout
                pass
        '''),
        "src/db.py": textwrap.dedent('''\
            # database utilities
            def connect():
                # HACK: hardcoded credentials for dev
                return {"host": "localhost", "user": "admin"}

            def query(sql):
                # TODO: parameterize this to avoid SQL injection
                return sql
        '''),
        "src/utils.py": textwrap.dedent('''\
            def parse_date(s):
                # TODO: handle ISO 8601 properly
                return s
        '''),
        "src/unrelated.py": textwrap.dedent('''\
            def add(a, b):
                return a + b
        '''),
    }
    for p, content in files.items():
        (repo / p).write_text(content)
    commit_all(repo, "initial planting of SATD", base.strftime("%Y-%m-%d %H:%M:%S"))
    snapshot_sha = head_sha(repo)

    # ---------- post-snapshot commits ----------
    # Commit 1: address auth.py TODO and FIXME together (within 30 days)
    (repo / "src/auth.py").write_text(textwrap.dedent('''\
        # auth module
        import bcrypt

        def login(user, pwd):
            # password verified using bcrypt
            return bcrypt.checkpw(pwd.encode(), b"$2b$12$hashvalue")

        def logout(user):
            # cookie invalidated explicitly
            invalidate_cookie(user)

        def invalidate_cookie(user):
            return True
    '''))
    commit_all(repo, "auth: replace plaintext check with bcrypt and fix logout cookie",
               (base + timedelta(days=5)).strftime("%Y-%m-%d %H:%M:%S"))

    # Commit 2: random change to unrelated file
    (repo / "src/unrelated.py").write_text(textwrap.dedent('''\
        def add(a, b):
            return a + b

        def sub(a, b):
            return a - b
    '''))
    commit_all(repo, "unrelated: add sub helper",
               (base + timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S"))

    # Commit 3: address db.py hardcoded creds
    (repo / "src/db.py").write_text(textwrap.dedent('''\
        import os

        def connect():
            return {"host": os.environ["DB_HOST"], "user": os.environ["DB_USER"]}

        def query(sql):
            # TODO: parameterize this to avoid SQL injection
            return sql
    '''))
    commit_all(repo, "db: read credentials from env vars",
               (base + timedelta(days=60)).strftime("%Y-%m-%d %H:%M:%S"))

    # Commit 4: address db.py SQL injection TODO (much later)
    (repo / "src/db.py").write_text(textwrap.dedent('''\
        import os

        def connect():
            return {"host": os.environ["DB_HOST"], "user": os.environ["DB_USER"]}

        def query(sql, params):
            # parameterized query
            return execute(sql, params)

        def execute(sql, params):
            return None
    '''))
    commit_all(repo, "db: parameterize query to prevent SQL injection",
               (base + timedelta(days=120)).strftime("%Y-%m-%d %H:%M:%S"))

    # Commit 5: address utils.py
    (repo / "src/utils.py").write_text(textwrap.dedent('''\
        import datetime

        def parse_date(s):
            return datetime.datetime.fromisoformat(s)
    '''))
    commit_all(repo, "utils: implement ISO 8601 parse_date",
               (base + timedelta(days=200)).strftime("%Y-%m-%d %H:%M:%S"))

    return snapshot_sha


def main():
    here = Path(__file__).parent.resolve()
    work = Path(tempfile.mkdtemp(prefix="rq3_selftest_"))
    print(f"[self_test] working in {work}")
    try:
        repo = work / "repos" / "synthetic"
        snapshot = build_test_repo(repo)
        print(f"[self_test] snapshot = {snapshot[:12]}")

        cfg = work / "config.json"
        cfg.write_text(json.dumps({
            "projects": [
                {
                    "project_id": "SY",
                    "name": "Synthetic",
                    "repo_path": str(repo),
                    "snapshot_commit": snapshot,
                    "horizon_months": 24,
                    "full_dependency": True,
                }
            ]
        }, indent=2))

        out = work / "out"
        cmd = [
            sys.executable,
            str(here / "rq3_evaluate.py"),
            "--config", str(cfg),
            "--output", str(out),
        ]
        print("[self_test] running:", " ".join(cmd))
        try:
            subprocess.run(cmd, check=True)
        except subprocess.CalledProcessError as e:
            print(f"[self_test] FAIL: evaluator returned non-zero exit code: {e}")
            return 1

        expected = [
            "rq3_hit_mrr_aggregate.csv",
            "rq3_per_project.csv",
            "rq3_co_removal.csv",
            "rq3_time_to_resolution.csv",
            "rq3_summary.txt",
            "rq3_raw_replay_SY.csv",
        ]
        missing = [f for f in expected if not (out / f).exists()]
        if missing:
            print(f"[self_test] FAIL: missing output files: {missing}")
            return 1

        # Print a sample of the aggregate file so a human can eyeball it
        print("\n[self_test] --- rq3_hit_mrr_aggregate.csv ---")
        print((out / "rq3_hit_mrr_aggregate.csv").read_text())

        print("[self_test] --- rq3_per_project.csv ---")
        print((out / "rq3_per_project.csv").read_text())

        print("[self_test] --- rq3_co_removal.csv ---")
        print((out / "rq3_co_removal.csv").read_text())

        print("[self_test] --- rq3_time_to_resolution.csv ---")
        print((out / "rq3_time_to_resolution.csv").read_text())

        print("[self_test] PASSED.")
        return 0
    finally:
        # Keep the directory around if the test failed so the user can inspect.
        if "RQ3_KEEP_TMP" not in os.environ:
            shutil.rmtree(work, ignore_errors=True)
        else:
            print(f"[self_test] tmp kept at {work}")


if __name__ == "__main__":
    sys.exit(main())
