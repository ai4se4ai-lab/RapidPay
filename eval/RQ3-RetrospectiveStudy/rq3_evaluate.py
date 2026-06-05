#!/usr/bin/env python3
"""
RQ3 Evaluation Script for RapidPay
====================================

Replays 18-24 months of post-snapshot commit history for each subject project
and evaluates the CAIG pipeline using Hit@k, MRR, and co-removal prediction.

Reproduces the tables in Section RQ3 of the paper:
  - Table: Hit@k and MRR for CAIG vs. Baselines
  - Table: Co-Removal Prediction
  - Table: Per-Project CAIG Performance
  - Time-to-Resolution analysis

Usage:
    python rq3_evaluate.py --config config.yaml --output results/
    python rq3_evaluate.py --config config.yaml --output results/ --projects react,scipy
    python rq3_evaluate.py --config config.yaml --output results/ --quick   # fewer commits per project

Outputs (in --output directory):
    rq3_hit_mrr_aggregate.csv          - Table: aggregate Hit@k / MRR
    rq3_per_project.csv                - Table: per-project breakdown
    rq3_co_removal.csv                 - Co-removal prediction results
    rq3_time_to_resolution.csv         - Time-to-resolution counterfactual
    rq3_raw_replay_<project>.csv       - Raw per-commit replay data (for audit)
    rq3_summary.txt                    - Human-readable summary

Author: RapidPay authors
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import re
import subprocess
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

import csv

try:
    import yaml  # type: ignore
except ImportError:
    yaml = None  # type: ignore

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("rq3_eval")


# ---------------------------------------------------------------------------
# Paper-grounded constants
# ---------------------------------------------------------------------------

# CAIG weights from Section RQ3: (eta1, eta2, eta3, eta4) = (0.4, 0.3, 0.15, 0.15)
CAIG_WEIGHTS: Dict[str, float] = {"eta1": 0.4, "eta2": 0.3, "eta3": 0.15, "eta4": 0.15}

# SIR weights from Section: (alpha, beta, gamma) = (0.4, 0.3, 0.3)
SIR_WEIGHTS: Dict[str, float] = {"alpha": 0.4, "beta": 0.3, "gamma": 0.3}

# Sliding window for commit analysis (paper: W=50)
COMMIT_WINDOW_SIZE: int = 50

# Max hops for dependency analysis (paper: k=5)
MAX_HOPS: int = 5

# k values for Hit@k
HIT_K_VALUES: List[int] = [1, 3, 5, 10]

# Co-removal window (paper: 30 days)
CO_REMOVAL_WINDOW_DAYS: int = 30

# Default post-snapshot horizon in months
DEFAULT_HORIZON_MONTHS: int = 18

# Effort score lambda (Section impact)
EFFORT_LAMBDA: float = 0.5

# Levenshtein-similarity threshold for "substantial" modification (Section RQ3)
SUBSTANTIAL_MODIFICATION_RATIO: float = 0.5

# SATD comment markers (matches paper's pattern set P)
SATD_KEYWORDS: List[str] = [
    "TODO", "FIXME", "HACK", "XXX", "BUG", "ISSUE", "DEBT",
    "NOTE", "WARNING", "OPTIMIZE", "REVIEW", "REVISIT", "REFACTOR",
    "WORKAROUND", "TEMPORARY", "KLUDGE",
]

SATD_PHRASE_PATTERNS: List[str] = [
    "needs refactoring", "should be improved", "quick fix",
    "temporary solution", "hacky implementation",
]

# Supported file extensions (paper subjects)
SOURCE_EXTENSIONS: Set[str] = {
    ".py", ".js", ".jsx", ".ts", ".tsx",
    ".java", ".c", ".cpp", ".cc", ".h", ".hpp",
    ".cs", ".go", ".rb", ".php",
}

# Comment markers per language (for line-level SATD detection)
COMMENT_MARKERS: Dict[str, Tuple[str, ...]] = {
    ".py":   ("#", '"""', "'''"),
    ".rb":   ("#",),
    ".js":   ("//", "/*", "*"),
    ".jsx":  ("//", "/*", "*"),
    ".ts":   ("//", "/*", "*"),
    ".tsx":  ("//", "/*", "*"),
    ".java": ("//", "/*", "*"),
    ".c":    ("//", "/*", "*"),
    ".cc":   ("//", "/*", "*"),
    ".cpp":  ("//", "/*", "*"),
    ".h":    ("//", "/*", "*"),
    ".hpp":  ("//", "/*", "*"),
    ".cs":   ("//", "/*", "*"),
    ".go":   ("//", "/*", "*"),
    ".php":  ("//", "#", "/*", "*"),
}

# Compiled SATD-line regex (case-insensitive)
_SATD_REGEX = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in SATD_KEYWORDS) + r")\b",
    re.IGNORECASE,
)
_SATD_PHRASE_REGEX = re.compile(
    "|".join(re.escape(p) for p in SATD_PHRASE_PATTERNS),
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class ProjectConfig:
    """Project configuration: where the repo lives and which snapshot to use."""
    project_id: str
    name: str
    repo_path: str                       # local path to the cloned repository
    snapshot_commit: str                 # commit hash to treat as deployment point
    horizon_months: int = DEFAULT_HORIZON_MONTHS
    full_dependency: bool = True         # True for Python/JS/TS; False for Java/C/etc.

    @property
    def supported_extensions(self) -> Set[str]:
        """Extensions to scan in this project. Falls back to all on full_dependency."""
        return SOURCE_EXTENSIONS


@dataclass
class SATDInstance:
    """A SATD instance detected at the snapshot point."""
    id: str
    file: str           # path relative to repo root
    line: int           # 1-indexed line number at the snapshot
    content: str        # full comment line content
    snapshot_blob: str  # git blob hash of the file at the snapshot (for tracking)

    # Computed scores (filled in later)
    sir_score: float = 0.0
    sir_fanout: float = 0.0
    sir_chainlen: float = 0.0
    sir_reachability: float = 0.0
    effort_score: float = 0.0
    chain_id: Optional[str] = None


@dataclass
class CommitInfo:
    """A post-snapshot commit."""
    hash: str
    author_email: str
    timestamp: datetime
    message: str
    files_modified: List[str] = field(default_factory=list)


@dataclass
class AddressedEvent:
    """A SATD instance addressed by a particular commit."""
    satd_id: str
    commit_hash: str
    commit_index: int           # 0-based index in post-snapshot history
    reason: str                 # "removed", "modified", "refactored"
    days_since_snapshot: float


@dataclass
class RankingSnapshot:
    """A ranking produced by one strategy at one point in time."""
    strategy: str
    commit_hash: str
    commit_index: int
    ranking: List[str]          # ordered list of SATD ids


@dataclass
class HitResult:
    """Per-commit hit result for one strategy."""
    project_id: str
    strategy: str
    commit_hash: str
    commit_index: int
    addressed_ids: List[str]
    rank_of_first_hit: Optional[int]    # 1-indexed; None if no hit in top-N
    hit_at_k: Dict[int, bool]
    # For lead-time analysis (CAIG only): map sid -> rank position
    # (kept lightweight - only top 20 ranks are stored)
    top_ranks: Dict[str, int] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Git helpers
# ---------------------------------------------------------------------------

class GitError(RuntimeError):
    pass


def _git(repo: str, *args: str, check: bool = True, capture: bool = True) -> str:
    """Run a git command. Returns stdout (str)."""
    cmd = ["git", "-C", repo, *args]
    try:
        result = subprocess.run(
            cmd,
            check=check,
            stdout=subprocess.PIPE if capture else None,
            stderr=subprocess.PIPE,
            text=True,
            errors="replace",
        )
    except subprocess.CalledProcessError as e:
        msg = e.stderr.strip() if e.stderr else str(e)
        raise GitError(f"git {' '.join(args)} failed: {msg}") from e
    return result.stdout if capture else ""


def git_commit_exists(repo: str, sha: str) -> bool:
    try:
        _git(repo, "cat-file", "-e", f"{sha}^{{commit}}")
        return True
    except GitError:
        return False


def git_post_snapshot_commits(
    repo: str, snapshot: str, horizon_months: int
) -> List[CommitInfo]:
    """
    Return commits made after `snapshot` within `horizon_months` of the
    snapshot's date, in chronological order (oldest first).

    Importantly, the horizon is measured from the snapshot commit's
    timestamp, not from "now". This matches the paper's RQ3 setup where
    each project is treated as a synthetic deployment point and we replay
    the subsequent maintenance history for a fixed window.
    """
    snapshot_dt = git_commit_datetime(repo, snapshot)
    horizon_dt = snapshot_dt + timedelta(days=int(30.44 * horizon_months))

    fmt = "%H%x1f%ae%x1f%at%x1f%s"
    # Anchor the filter on the SNAPSHOT date, not on `now`:
    #   --after  → commits strictly after the snapshot
    #   --before → commits strictly before the horizon end
    after_iso = snapshot_dt.strftime("%Y-%m-%dT%H:%M:%S%z") or snapshot_dt.isoformat()
    before_iso = horizon_dt.strftime("%Y-%m-%dT%H:%M:%S%z") or horizon_dt.isoformat()
    out = _git(
        repo,
        "log",
        f"{snapshot}..HEAD",
        f"--after={after_iso}",
        f"--before={before_iso}",
        "--reverse",
        f"--pretty=format:{fmt}",
        "--name-only",
    )

    commits: List[CommitInfo] = []
    current: Optional[CommitInfo] = None

    for raw_line in out.splitlines():
        line = raw_line.rstrip()
        if not line:
            if current is not None:
                commits.append(current)
                current = None
            continue
        if "\x1f" in line:
            # New commit header
            if current is not None:
                commits.append(current)
            parts = line.split("\x1f")
            if len(parts) < 4:
                continue
            sha, email, ts, msg = parts[0], parts[1], parts[2], "\x1f".join(parts[3:])
            try:
                dt = datetime.fromtimestamp(int(ts), tz=timezone.utc)
            except ValueError:
                continue
            # Defensive double-check (--after/--before should already filter)
            if dt > horizon_dt or dt < snapshot_dt:
                current = None
                continue
            current = CommitInfo(
                hash=sha,
                author_email=email,
                timestamp=dt,
                message=msg,
                files_modified=[],
            )
        else:
            if current is not None:
                current.files_modified.append(line)

    if current is not None:
        commits.append(current)
    return commits


def git_commit_datetime(repo: str, sha: str) -> datetime:
    out = _git(repo, "show", "-s", "--format=%at", sha).strip()
    return datetime.fromtimestamp(int(out), tz=timezone.utc)


def git_file_at_commit(repo: str, sha: str, path: str) -> Optional[str]:
    """Return file content at a given commit, or None if not present."""
    try:
        return _git(repo, "show", f"{sha}:{path}", check=True)
    except GitError:
        return None


def git_ls_tree_files(repo: str, sha: str) -> List[str]:
    """List all blob paths at the given commit."""
    out = _git(repo, "ls-tree", "-r", "--name-only", sha)
    return [line for line in out.splitlines() if line]


def git_diff_files(repo: str, sha: str) -> List[str]:
    """Return files modified in a commit."""
    out = _git(repo, "diff-tree", "--no-commit-id", "--name-only", "-r", sha)
    return [line for line in out.splitlines() if line]


def git_diff_patch(repo: str, sha: str, path: str) -> str:
    """Return the unified diff for a single file in a commit."""
    try:
        out = _git(repo, "show", "--format=", "--", path, "--no-color", sha + ":" + path)
    except GitError:
        out = ""
    # Fallback to a simpler call
    try:
        out = _git(repo, "show", sha, "--", path)
    except GitError:
        pass
    return out


def git_blame_email(repo: str, sha: str, path: str, line: int) -> Optional[str]:
    """Get the author email for a specific line at a specific commit."""
    try:
        out = _git(repo, "blame", "-L", f"{line},{line}", "--line-porcelain", sha, "--", path)
    except GitError:
        return None
    for raw in out.splitlines():
        if raw.startswith("author-mail "):
            return raw.split(" ", 1)[1].strip("<>")
    return None


# ---------------------------------------------------------------------------
# Levenshtein similarity (small, dependency-free)
# ---------------------------------------------------------------------------

def levenshtein_similarity(a: str, b: str) -> float:
    """Return 1 - normalized Levenshtein distance in [0,1]."""
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0
    if len(a) > len(b):
        a, b = b, a
    # Limit comparison size to keep replay fast
    a = a[:500]
    b = b[:500]
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            curr[j] = min(
                curr[j - 1] + 1,
                prev[j] + 1,
                prev[j - 1] + cost,
            )
        prev = curr
    dist = prev[-1]
    return 1.0 - dist / max(len(a), len(b))


# ---------------------------------------------------------------------------
# SATD detection at the snapshot
# ---------------------------------------------------------------------------

def is_comment_line(content: str, ext: str) -> bool:
    """Heuristic: does this line contain a comment marker for its language?"""
    markers = COMMENT_MARKERS.get(ext, ("//", "#", "/*"))
    return any(m in content for m in markers)


def line_is_satd(content: str, ext: str) -> bool:
    if not is_comment_line(content, ext):
        return False
    if _SATD_REGEX.search(content):
        return True
    if _SATD_PHRASE_REGEX.search(content):
        return True
    return False


def detect_satd_instances(repo: str, snapshot: str, project_id: str) -> List[SATDInstance]:
    """Scan the snapshot tree and return all SATD instances."""
    log.info("[%s] Detecting SATD instances at snapshot %s ...", project_id, snapshot[:8])
    paths = git_ls_tree_files(repo, snapshot)
    instances: List[SATDInstance] = []
    counter = 0
    files_scanned = 0
    for p in paths:
        ext = Path(p).suffix.lower()
        if ext not in SOURCE_EXTENSIONS:
            continue
        content = git_file_at_commit(repo, snapshot, p)
        if content is None:
            continue
        files_scanned += 1
        for idx, line in enumerate(content.splitlines(), start=1):
            if line_is_satd(line, ext):
                counter += 1
                instance_id = f"{project_id}-{counter}"
                instances.append(
                    SATDInstance(
                        id=instance_id,
                        file=p,
                        line=idx,
                        content=line.strip()[:300],
                        snapshot_blob=snapshot,
                    )
                )
    log.info(
        "[%s] Scanned %d files, found %d SATD candidate lines (lexical only).",
        project_id, files_scanned, len(instances),
    )
    return instances


# ---------------------------------------------------------------------------
# Dependency graph + chains
# ---------------------------------------------------------------------------

@dataclass
class DependencyEdge:
    src: str
    dst: str
    rel_type: str    # "call", "data", "control", "module"
    weight: float
    hops: int


# Paper weights per relationship type
REL_WEIGHTS: Dict[str, Tuple[float, float]] = {
    "call":    (0.7, 0.9),
    "data":    (0.6, 0.8),
    "control": (0.5, 0.7),
    "module":  (0.8, 1.0),
}


def build_dependency_graph(
    instances: List[SATDInstance],
    project: ProjectConfig,
) -> Tuple[List[DependencyEdge], Dict[str, List[str]]]:
    """
    Build a (lightweight) SATD dependency graph.

    For paper RQ3 replay, we use the same conservative dependency types
    described in Section IRD:
      - module: SATD instances in the same file or in files connected by an
        import-style relationship (textual matches on simple file-name basis).
      - call/data/control: approximated for full_dependency projects by
        proximity in the same file (within 200 lines).

    This intentionally mirrors what the prototype produces and what the
    paper's Section IRD says it falls back to for non-fully-supported
    languages, ensuring chain construction is reproducible without
    language-specific AST tooling here.
    """
    edges: List[DependencyEdge] = []
    # group by file
    by_file: Dict[str, List[SATDInstance]] = defaultdict(list)
    for s in instances:
        by_file[s.file].append(s)

    # 1) module-level edges: pairs in the same file
    for f, group in by_file.items():
        for i, a in enumerate(group):
            for b in group[i + 1 :]:
                w = (REL_WEIGHTS["module"][0] + REL_WEIGHTS["module"][1]) / 2
                edges.append(DependencyEdge(a.id, b.id, "module", w, 1))
                edges.append(DependencyEdge(b.id, a.id, "module", w, 1))

    # 2) approximate call/data/control via proximity (within 200 lines, same file)
    if project.full_dependency:
        for f, group in by_file.items():
            for i, a in enumerate(group):
                for b in group[i + 1 :]:
                    dist = abs(a.line - b.line)
                    if dist <= 200:
                        # Treat short distance as call-like
                        w = (REL_WEIGHTS["call"][0] + REL_WEIGHTS["call"][1]) / 2
                        edges.append(DependencyEdge(a.id, b.id, "call", w, 1))
                        # Slightly weaker data edge in the reverse direction
                        wd = (REL_WEIGHTS["data"][0] + REL_WEIGHTS["data"][1]) / 2
                        edges.append(DependencyEdge(b.id, a.id, "data", wd, 1))

    # 3) module edges across files that share a common directory prefix of depth>=2
    dirs_to_satd: Dict[Tuple[str, ...], List[SATDInstance]] = defaultdict(list)
    for s in instances:
        parts = Path(s.file).parts[:-1]
        # take the first 3 components as the "module"
        key = parts[:3]
        dirs_to_satd[key].append(s)
    for key, group in dirs_to_satd.items():
        if len(group) > 80:
            # Avoid quadratic explosion in huge directories
            continue
        for i, a in enumerate(group):
            for b in group[i + 1 :]:
                if a.file == b.file:
                    continue
                w = REL_WEIGHTS["module"][0]
                edges.append(DependencyEdge(a.id, b.id, "module", w, 2))
                edges.append(DependencyEdge(b.id, a.id, "module", w, 2))

    # Adjacency list
    adj: Dict[str, List[str]] = defaultdict(list)
    for e in edges:
        adj[e.src].append(e.dst)

    return edges, adj


def find_chains(
    instances: List[SATDInstance], edges: List[DependencyEdge]
) -> Dict[str, str]:
    """Weakly connected components → chain_id per instance."""
    parent: Dict[str, str] = {s.id: s.id for s in instances}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x: str, y: str) -> None:
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[ry] = rx

    for e in edges:
        if e.src in parent and e.dst in parent:
            union(e.src, e.dst)

    chain_of: Dict[str, str] = {}
    root_to_chainid: Dict[str, str] = {}
    next_id = 1
    for s in instances:
        r = find(s.id)
        if r not in root_to_chainid:
            root_to_chainid[r] = f"chain-{next_id}"
            next_id += 1
        chain_of[s.id] = root_to_chainid[r]
    return chain_of


# ---------------------------------------------------------------------------
# SIR scoring (paper Algorithm 3)
# ---------------------------------------------------------------------------

def compute_sir_scores(
    instances: List[SATDInstance], edges: List[DependencyEdge]
) -> None:
    """Fill in sir_* fields on each instance, normalized to [0,1]."""
    # Outgoing edges per node
    out_edges: Dict[str, List[DependencyEdge]] = defaultdict(list)
    for e in edges:
        out_edges[e.src].append(e)

    # Fanout_w: sum of outgoing weights
    fanout: Dict[str, float] = {s.id: 0.0 for s in instances}
    for sid, es in out_edges.items():
        fanout[sid] = sum(e.weight for e in es)

    # ChainLen_w: longest weighted path (DFS with memoization + cycle guard)
    chainlen: Dict[str, float] = {}

    def dfs_chainlen(node: str, visiting: Set[str]) -> float:
        if node in chainlen:
            return chainlen[node]
        if node in visiting:
            return 0.0
        visiting.add(node)
        best = 0.0
        for e in out_edges.get(node, []):
            v = e.weight + dfs_chainlen(e.dst, visiting)
            if v > best:
                best = v
        visiting.remove(node)
        chainlen[node] = best
        return best

    for s in instances:
        dfs_chainlen(s.id, set())

    # Reachability_w: sum over reachable nodes of max single-edge weight on path
    reachability: Dict[str, float] = {}
    for s in instances:
        visited: Dict[str, float] = {}
        stack: List[Tuple[str, float]] = [(s.id, 0.0)]
        while stack:
            node, path_strength = stack.pop()
            for e in out_edges.get(node, []):
                ns = max(path_strength, e.weight)
                if e.dst == s.id:
                    continue
                cur = visited.get(e.dst, -1.0)
                if ns > cur:
                    visited[e.dst] = ns
                    stack.append((e.dst, ns))
        reachability[s.id] = sum(visited.values())

    # Min-max normalize each component
    def normalize(d: Dict[str, float]) -> Dict[str, float]:
        if not d:
            return d
        vs = list(d.values())
        lo, hi = min(vs), max(vs)
        rng = hi - lo or 1.0
        return {k: (v - lo) / rng for k, v in d.items()}

    n_fanout = normalize(fanout)
    n_chainlen = normalize(chainlen)
    n_reach = normalize(reachability)

    a, b, g = SIR_WEIGHTS["alpha"], SIR_WEIGHTS["beta"], SIR_WEIGHTS["gamma"]
    raw_sir: Dict[str, float] = {}
    for s in instances:
        s.sir_fanout = n_fanout.get(s.id, 0.0)
        s.sir_chainlen = n_chainlen.get(s.id, 0.0)
        s.sir_reachability = n_reach.get(s.id, 0.0)
        raw_sir[s.id] = a * s.sir_fanout + b * s.sir_chainlen + g * s.sir_reachability

    sir_norm = normalize(raw_sir)
    for s in instances:
        s.sir_score = sir_norm.get(s.id, 0.0)


# ---------------------------------------------------------------------------
# Effort score S^t
# ---------------------------------------------------------------------------

def compute_effort_scores(
    repo: str, snapshot: str, instances: List[SATDInstance]
) -> None:
    """Approximate S^t = lambda * (RT/max RT) + (1-lambda) * (FM/max FM).

    Paper RT_t and FM_t are computed from "SATD-touching" commits before the
    snapshot. We approximate them with file-level history up to the snapshot.
    """
    by_file: Dict[str, Set[str]] = defaultdict(set)
    for s in instances:
        by_file[s.file].add(s.id)

    rt: Dict[str, float] = {}
    fm: Dict[str, float] = {}
    for f, sids in by_file.items():
        # FM: number of commits touching the file up to the snapshot
        try:
            out = _git(repo, "log", "--pretty=format:%at", snapshot, "--", f)
            timestamps = [int(t) for t in out.splitlines() if t.strip().isdigit()]
        except GitError:
            timestamps = []
        fm_val = float(len(timestamps))
        # RT: average gap between consecutive touches in days
        if len(timestamps) > 1:
            gaps = [
                (timestamps[i] - timestamps[i + 1]) / 86400.0
                for i in range(len(timestamps) - 1)
            ]
            rt_val = sum(g for g in gaps if g > 0) / max(1, sum(1 for g in gaps if g > 0))
        else:
            rt_val = 0.0
        for sid in sids:
            rt[sid] = rt_val
            fm[sid] = fm_val

    max_rt = max(rt.values()) if rt else 1.0
    max_fm = max(fm.values()) if fm else 1.0
    max_rt = max_rt or 1.0
    max_fm = max_fm or 1.0

    for s in instances:
        s.effort_score = (
            EFFORT_LAMBDA * (rt.get(s.id, 0.0) / max_rt)
            + (1 - EFFORT_LAMBDA) * (fm.get(s.id, 0.0) / max_fm)
        )


# ---------------------------------------------------------------------------
# "Addressed by commit" detection
# ---------------------------------------------------------------------------

def commit_addressed_satd(
    repo: str,
    commit: CommitInfo,
    instances: List[SATDInstance],
    line_index_at_snapshot: Dict[str, Tuple[str, int]],
    snapshot: str,
) -> List[AddressedEvent]:
    """
    Determine which SATD instances are addressed by the given commit.

    Rules (paper Section RQ3):
      - comment line is deleted    → "removed"
      - comment text changed >50%  → "modified"
      - (Refactoring detection is out of scope for a self-contained replay
         here; replication package shows how to run RefactoringMiner.)
    """
    addressed: List[AddressedEvent] = []
    files_in_commit = {Path(f).as_posix() for f in commit.files_modified}

    # Index SATD by file
    by_file: Dict[str, List[SATDInstance]] = defaultdict(list)
    for s in instances:
        by_file[Path(s.file).as_posix()].append(s)

    snap_dt = git_commit_datetime(repo, snapshot)

    for f, sids in by_file.items():
        if f not in files_in_commit:
            continue

        # Compare file content before and after the commit
        before = git_file_at_commit(repo, f"{commit.hash}^", f)
        after = git_file_at_commit(repo, commit.hash, f)

        # If no parent, treat as new file (no prior SATD lines)
        if before is None:
            continue
        before_lines = before.splitlines()
        after_lines = after.splitlines() if after is not None else []

        # Build a set of all SATD-looking lines in `after` for fast lookup
        ext = Path(f).suffix.lower()
        after_satd_set = {
            ln.strip()
            for ln in after_lines
            if line_is_satd(ln, ext)
        }

        for s in sids:
            # Find the SATD line content as it was at the snapshot
            snap_content = s.content
            # Look in `before` for the same content (the line may have shifted)
            if snap_content not in [bl.strip() for bl in before_lines]:
                # Line was already changed/removed before this commit; skip
                continue

            if snap_content in after_satd_set:
                # Line still present unchanged → not addressed by this commit
                continue

            # Look for a near-match in after_satd_set
            best_sim = 0.0
            for after_line in after_satd_set:
                sim = levenshtein_similarity(snap_content, after_line)
                if sim > best_sim:
                    best_sim = sim

            if best_sim >= (1.0 - SUBSTANTIAL_MODIFICATION_RATIO):
                # Cosmetic change only; consider it still present
                continue

            reason = "removed" if best_sim < 0.2 else "modified"
            days_since = (commit.timestamp - snap_dt).total_seconds() / 86400.0
            addressed.append(
                AddressedEvent(
                    satd_id=s.id,
                    commit_hash=commit.hash,
                    commit_index=-1,  # filled later
                    reason=reason,
                    days_since_snapshot=days_since,
                )
            )

    return addressed


# ---------------------------------------------------------------------------
# Ranking strategies
# ---------------------------------------------------------------------------

class RankingStrategy:
    name: str = "base"

    def rank(
        self,
        instances: List[SATDInstance],
        recent_window: List[CommitInfo],
        already_addressed: Set[str],
        adj: Dict[str, List[str]],
    ) -> List[str]:
        raise NotImplementedError


class RecencyRanking(RankingStrategy):
    name = "recency"

    def rank(
        self,
        instances: List[SATDInstance],
        recent_window: List[CommitInfo],
        already_addressed: Set[str],
        adj: Dict[str, List[str]],
    ) -> List[str]:
        # Higher rank for SATD in files touched most recently in the window
        recency: Dict[str, float] = defaultdict(float)
        for i, c in enumerate(recent_window):
            weight = (i + 1) / len(recent_window) if recent_window else 0.0
            for f in c.files_modified:
                recency[Path(f).as_posix()] += weight
        scored = [
            (s, recency.get(Path(s.file).as_posix(), 0.0))
            for s in instances
            if s.id not in already_addressed
        ]
        scored.sort(key=lambda x: x[1], reverse=True)
        return [s.id for s, _ in scored]


class EffortOnlyRanking(RankingStrategy):
    name = "effort_only"

    def rank(
        self,
        instances: List[SATDInstance],
        recent_window: List[CommitInfo],
        already_addressed: Set[str],
        adj: Dict[str, List[str]],
    ) -> List[str]:
        # Lower effort first
        cand = [s for s in instances if s.id not in already_addressed]
        cand.sort(key=lambda s: s.effort_score)
        return [s.id for s in cand]


class SIROnlyRanking(RankingStrategy):
    name = "sir_only"

    def rank(
        self,
        instances: List[SATDInstance],
        recent_window: List[CommitInfo],
        already_addressed: Set[str],
        adj: Dict[str, List[str]],
    ) -> List[str]:
        cand = [s for s in instances if s.id not in already_addressed]
        cand.sort(key=lambda s: s.sir_score, reverse=True)
        return [s.id for s in cand]


class CAIGRanking(RankingStrategy):
    """Full CAIG ranking: Rank = eta1 * SIR + eta2 * CommitRel + eta3 * (1 - S^t) + eta4 * f_i.

    f_i (fix potential) is approximated structurally here as 1.0 if the SATD's
    file is modified by the most recent commit in the window, 0.5 if a chain
    neighbor's file is modified, 0.0 otherwise. The paper uses an LLM
    (Prompt 2) for this; for reproducible automated replay we use this
    deterministic proxy, which the paper acknowledges as a fallback when
    LLM access is not available.
    """
    name = "caig_full"

    def __init__(self, chain_of: Dict[str, str]) -> None:
        self.chain_of = chain_of

    def rank(
        self,
        instances: List[SATDInstance],
        recent_window: List[CommitInfo],
        already_addressed: Set[str],
        adj: Dict[str, List[str]],
    ) -> List[str]:
        if not recent_window:
            return SIROnlyRanking().rank(instances, recent_window, already_addressed, adj)

        # Files touched in window with recency weight
        touched_recent: Dict[str, float] = defaultdict(float)
        for i, c in enumerate(recent_window):
            w = (i + 1) / len(recent_window)
            for f in c.files_modified:
                touched_recent[Path(f).as_posix()] += w
        max_touched = max(touched_recent.values()) if touched_recent else 1.0

        # Files in the most recent commit
        latest_files = (
            {Path(f).as_posix() for f in recent_window[-1].files_modified}
            if recent_window
            else set()
        )

        # Pre-index instances by chain
        chain_to_ids: Dict[str, Set[str]] = defaultdict(set)
        for s in instances:
            cid = self.chain_of.get(s.id, s.id)
            chain_to_ids[cid].add(s.id)
        id_to_chain = self.chain_of

        # File set per chain
        chain_files: Dict[str, Set[str]] = defaultdict(set)
        for s in instances:
            chain_files[id_to_chain.get(s.id, s.id)].add(Path(s.file).as_posix())

        cand = [s for s in instances if s.id not in already_addressed]

        scored: List[Tuple[str, float]] = []
        for s in cand:
            f_norm = Path(s.file).as_posix()
            commit_rel = touched_recent.get(f_norm, 0.0) / max_touched
            cid = id_to_chain.get(s.id, s.id)
            # Fix potential proxy
            if f_norm in latest_files:
                f_i = 1.0
            elif chain_files[cid] & latest_files:
                f_i = 0.5
            else:
                f_i = 0.0
            rank_score = (
                CAIG_WEIGHTS["eta1"] * s.sir_score
                + CAIG_WEIGHTS["eta2"] * commit_rel
                + CAIG_WEIGHTS["eta3"] * (1 - s.effort_score)
                + CAIG_WEIGHTS["eta4"] * f_i
            )
            scored.append((s.id, rank_score))
        scored.sort(key=lambda x: x[1], reverse=True)
        return [sid for sid, _ in scored]


# ---------------------------------------------------------------------------
# Replay engine
# ---------------------------------------------------------------------------

@dataclass
class ProjectReplayResult:
    project_id: str
    n_satd: int
    n_chains: int
    n_commits_replayed: int
    n_addressed_events: int
    per_strategy_hits: Dict[str, List[HitResult]]
    co_removal_actual: int          # within-chain pairs co-removed (window 30d)
    co_removal_chain_pairs_total: int
    co_removal_random_actual: int   # random pairs co-removed (control)
    co_removal_random_total: int
    counterfactual_lead_count: int  # SATD ranked top-5 ≥5 commits before addressed
    counterfactual_total_resolved: int


def replay_project(
    project: ProjectConfig,
    quick: bool = False,
) -> ProjectReplayResult:
    log.info("=== Replaying project %s (%s) ===", project.project_id, project.name)

    if not os.path.isdir(project.repo_path):
        raise FileNotFoundError(f"Repository not found: {project.repo_path}")
    if not git_commit_exists(project.repo_path, project.snapshot_commit):
        raise GitError(
            f"Snapshot commit {project.snapshot_commit} not found in {project.repo_path}"
        )

    # 1. Detect SATD at the snapshot
    instances = detect_satd_instances(
        project.repo_path, project.snapshot_commit, project.project_id
    )
    if not instances:
        log.warning("[%s] No SATD instances detected; skipping.", project.project_id)
        return ProjectReplayResult(
            project_id=project.project_id,
            n_satd=0, n_chains=0,
            n_commits_replayed=0, n_addressed_events=0,
            per_strategy_hits={},
            co_removal_actual=0, co_removal_chain_pairs_total=0,
            co_removal_random_actual=0, co_removal_random_total=0,
            counterfactual_lead_count=0, counterfactual_total_resolved=0,
        )

    # Cap for very large projects to keep runtime tractable
    if quick and len(instances) > 1000:
        instances = instances[:1000]
        log.info("[%s] Quick mode: truncated to %d SATD instances.", project.project_id, len(instances))

    # 2. Build dependency graph + chains
    edges, adj = build_dependency_graph(instances, project)
    chain_of = find_chains(instances, edges)
    for s in instances:
        s.chain_id = chain_of[s.id]
    n_chains = len(set(chain_of.values()))
    log.info("[%s] Built %d edges, %d chains.", project.project_id, len(edges), n_chains)

    # 3. Score SIR and effort
    compute_sir_scores(instances, edges)
    compute_effort_scores(project.repo_path, project.snapshot_commit, instances)

    # 4. Pull post-snapshot commits
    commits = git_post_snapshot_commits(
        project.repo_path, project.snapshot_commit, project.horizon_months
    )
    if quick:
        commits = commits[:300]
    log.info("[%s] Replaying %d post-snapshot commits.", project.project_id, len(commits))

    # 5. For each commit, determine which SATD instances it addressed
    #    and run all ranking strategies BEFORE that commit.
    strategies: List[RankingStrategy] = [
        RecencyRanking(),
        EffortOnlyRanking(),
        SIROnlyRanking(),
        CAIGRanking(chain_of=chain_of),
    ]
    per_strategy_hits: Dict[str, List[HitResult]] = {s.name: [] for s in strategies}
    already_addressed: Set[str] = set()
    addressed_events_all: List[AddressedEvent] = []
    addressed_to_commit_idx: Dict[str, int] = {}

    # For counterfactual lead-time on CAIG: track the earliest commit_idx at
    # which each SATD entered the CAIG top-5. We compute this incrementally
    # over the full commit stream.
    caig_first_top5_idx: Dict[str, int] = {}
    caig_strategy = next(s for s in strategies if s.name == "caig_full")

    window: List[CommitInfo] = []

    for cidx, commit in enumerate(commits):
        # First: update CAIG top-5 tracking for the state BEFORE this commit
        # (this lets us detect "would-have-surfaced-earlier" lead time even
        # for commits that don't address SATD themselves).
        caig_pre_ranking = caig_strategy.rank(
            instances, window, already_addressed, adj
        )
        for r, sid in enumerate(caig_pre_ranking[:5], start=1):
            if sid not in caig_first_top5_idx:
                caig_first_top5_idx[sid] = cidx

        # Determine what this commit addresses
        events = commit_addressed_satd(
            project.repo_path, commit, instances,
            line_index_at_snapshot={},
            snapshot=project.snapshot_commit,
        )
        events = [ev for ev in events if ev.satd_id not in already_addressed]
        for ev in events:
            ev.commit_index = cidx

        if events:
            for strat in strategies:
                ranking = strat.rank(instances, window, already_addressed, adj)
                first_rank: Optional[int] = None
                addressed_set = {ev.satd_id for ev in events}
                for r, sid in enumerate(ranking, start=1):
                    if sid in addressed_set:
                        first_rank = r
                        break
                hit_at_k = {
                    k: (first_rank is not None and first_rank <= k)
                    for k in HIT_K_VALUES
                }
                top_ranks: Dict[str, int] = {}
                if strat.name == "caig_full":
                    for r, sid in enumerate(ranking[:20], start=1):
                        top_ranks[sid] = r
                per_strategy_hits[strat.name].append(
                    HitResult(
                        project_id=project.project_id,
                        strategy=strat.name,
                        commit_hash=commit.hash,
                        commit_index=cidx,
                        addressed_ids=sorted(addressed_set),
                        rank_of_first_hit=first_rank,
                        hit_at_k=hit_at_k,
                        top_ranks=top_ranks,
                    )
                )
            for ev in events:
                if ev.satd_id not in addressed_to_commit_idx:
                    addressed_to_commit_idx[ev.satd_id] = cidx

        for ev in events:
            already_addressed.add(ev.satd_id)
            addressed_events_all.append(ev)

        window.append(commit)
        if len(window) > COMMIT_WINDOW_SIZE:
            window = window[-COMMIT_WINDOW_SIZE:]

    # 6. Co-removal analysis (chain neighbors vs random pairs)
    co_actual, co_total = _co_removal_within_chain(
        instances, chain_of, addressed_events_all
    )
    co_rand_actual, co_rand_total = _co_removal_random(
        instances, chain_of, addressed_events_all
    )

    # 7. Counterfactual lead-time analysis (CAIG)
    # For each addressed SATD, check whether it was in CAIG's top-5 at a
    # commit at least 5 commits BEFORE the one that actually addressed it.
    lead_count = 0
    for sid, addr_idx in addressed_to_commit_idx.items():
        first_top5 = caig_first_top5_idx.get(sid)
        if first_top5 is not None and (addr_idx - first_top5) >= 5:
            lead_count += 1

    return ProjectReplayResult(
        project_id=project.project_id,
        n_satd=len(instances),
        n_chains=n_chains,
        n_commits_replayed=len(commits),
        n_addressed_events=len(addressed_events_all),
        per_strategy_hits=per_strategy_hits,
        co_removal_actual=co_actual,
        co_removal_chain_pairs_total=co_total,
        co_removal_random_actual=co_rand_actual,
        co_removal_random_total=co_rand_total,
        counterfactual_lead_count=lead_count,
        counterfactual_total_resolved=len(addressed_to_commit_idx),
    )


# ---------------------------------------------------------------------------
# Co-removal analysis
# ---------------------------------------------------------------------------

def _co_removal_within_chain(
    instances: List[SATDInstance],
    chain_of: Dict[str, str],
    events: List[AddressedEvent],
) -> Tuple[int, int]:
    """Count chain pairs that are co-addressed within CO_REMOVAL_WINDOW_DAYS."""
    by_chain: Dict[str, List[str]] = defaultdict(list)
    for s in instances:
        by_chain[chain_of[s.id]].append(s.id)

    ev_by_id: Dict[str, AddressedEvent] = {ev.satd_id: ev for ev in events}

    pairs_total = 0
    pairs_co_addressed = 0
    for cid, ids in by_chain.items():
        if len(ids) < 2:
            continue
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                pairs_total += 1
                a, b = ids[i], ids[j]
                ea, eb = ev_by_id.get(a), ev_by_id.get(b)
                if ea is None or eb is None:
                    continue
                if abs(ea.days_since_snapshot - eb.days_since_snapshot) <= CO_REMOVAL_WINDOW_DAYS:
                    pairs_co_addressed += 1
    return pairs_co_addressed, pairs_total


def _co_removal_random(
    instances: List[SATDInstance],
    chain_of: Dict[str, str],
    events: List[AddressedEvent],
    max_pairs: int = 5000,
) -> Tuple[int, int]:
    """Control: same metric but on randomly sampled non-chain pairs."""
    import random
    rng = random.Random(42)
    ev_by_id: Dict[str, AddressedEvent] = {ev.satd_id: ev for ev in events}
    ids = [s.id for s in instances]
    if len(ids) < 2:
        return 0, 0
    sampled_pairs = 0
    co_addressed = 0
    attempts = 0
    max_attempts = max_pairs * 3
    while sampled_pairs < max_pairs and attempts < max_attempts:
        attempts += 1
        a, b = rng.sample(ids, 2)
        if chain_of[a] == chain_of[b]:
            continue
        sampled_pairs += 1
        ea, eb = ev_by_id.get(a), ev_by_id.get(b)
        if ea is None or eb is None:
            continue
        if abs(ea.days_since_snapshot - eb.days_since_snapshot) <= CO_REMOVAL_WINDOW_DAYS:
            co_addressed += 1
    return co_addressed, sampled_pairs


# ---------------------------------------------------------------------------
# CSV writers
# ---------------------------------------------------------------------------

def aggregate_hit_mrr(
    results: List[ProjectReplayResult],
) -> List[Dict[str, Any]]:
    """Aggregate Hit@k and MRR per strategy across all projects."""
    rows = []
    # Combine all per-commit HitResults across projects per strategy
    all_strategies = set()
    for r in results:
        all_strategies.update(r.per_strategy_hits.keys())

    for strat in sorted(all_strategies):
        all_hits: List[HitResult] = []
        for r in results:
            all_hits.extend(r.per_strategy_hits.get(strat, []))
        n = len(all_hits)
        if n == 0:
            continue
        row = {"strategy": strat, "n_events": n}
        for k in HIT_K_VALUES:
            row[f"hit_at_{k}"] = round(
                sum(1 for h in all_hits if h.hit_at_k[k]) / n, 4
            )
        # MRR: 1/rank when there is a hit anywhere; else 0
        # (paper convention: MRR over events where there is a hit anywhere)
        mrr_sum = 0.0
        for h in all_hits:
            if h.rank_of_first_hit is not None:
                mrr_sum += 1.0 / h.rank_of_first_hit
        row["mrr"] = round(mrr_sum / n, 4)
        rows.append(row)
    return rows


def per_project_breakdown(
    results: List[ProjectReplayResult],
    target_strategy: str = "caig_full",
) -> List[Dict[str, Any]]:
    rows = []
    for r in results:
        hits = r.per_strategy_hits.get(target_strategy, [])
        n = len(hits)
        if n == 0:
            rows.append({
                "project_id": r.project_id,
                "n_satd": r.n_satd,
                "n_chains": r.n_chains,
                "n_commits_replayed": r.n_commits_replayed,
                "n_addressed_events": r.n_addressed_events,
                "hit_at_5": None,
                "mrr": None,
            })
            continue
        hit5 = sum(1 for h in hits if h.hit_at_k[5]) / n
        mrr = sum((1.0 / h.rank_of_first_hit) for h in hits if h.rank_of_first_hit) / n
        rows.append({
            "project_id": r.project_id,
            "n_satd": r.n_satd,
            "n_chains": r.n_chains,
            "n_commits_replayed": r.n_commits_replayed,
            "n_addressed_events": r.n_addressed_events,
            "hit_at_5": round(hit5, 4),
            "mrr": round(mrr, 4),
        })
    return rows


def co_removal_table(results: List[ProjectReplayResult]) -> List[Dict[str, Any]]:
    rows = []
    total_chain_actual = 0
    total_chain_pairs = 0
    total_rand_actual = 0
    total_rand_pairs = 0
    for r in results:
        chain_rate = (
            r.co_removal_actual / r.co_removal_chain_pairs_total
            if r.co_removal_chain_pairs_total else 0.0
        )
        rand_rate = (
            r.co_removal_random_actual / r.co_removal_random_total
            if r.co_removal_random_total else 0.0
        )
        rows.append({
            "project_id": r.project_id,
            "chain_pairs_total": r.co_removal_chain_pairs_total,
            "chain_pairs_co_addressed": r.co_removal_actual,
            "chain_co_removal_rate": round(chain_rate, 4),
            "random_pairs_total": r.co_removal_random_total,
            "random_pairs_co_addressed": r.co_removal_random_actual,
            "random_co_removal_rate": round(rand_rate, 4),
            "ratio_chain_vs_random": round(
                (chain_rate / rand_rate) if rand_rate > 0 else 0.0, 3
            ),
        })
        total_chain_actual += r.co_removal_actual
        total_chain_pairs += r.co_removal_chain_pairs_total
        total_rand_actual += r.co_removal_random_actual
        total_rand_pairs += r.co_removal_random_total
    chain_rate = total_chain_actual / total_chain_pairs if total_chain_pairs else 0.0
    rand_rate = total_rand_actual / total_rand_pairs if total_rand_pairs else 0.0
    rows.append({
        "project_id": "AGGREGATE",
        "chain_pairs_total": total_chain_pairs,
        "chain_pairs_co_addressed": total_chain_actual,
        "chain_co_removal_rate": round(chain_rate, 4),
        "random_pairs_total": total_rand_pairs,
        "random_pairs_co_addressed": total_rand_actual,
        "random_co_removal_rate": round(rand_rate, 4),
        "ratio_chain_vs_random": round(
            (chain_rate / rand_rate) if rand_rate > 0 else 0.0, 3
        ),
    })
    return rows


def time_to_resolution_table(results: List[ProjectReplayResult]) -> List[Dict[str, Any]]:
    rows = []
    total_lead = 0
    total_resolved = 0
    for r in results:
        rate = (
            r.counterfactual_lead_count / r.counterfactual_total_resolved
            if r.counterfactual_total_resolved else 0.0
        )
        rows.append({
            "project_id": r.project_id,
            "total_resolved_satd": r.counterfactual_total_resolved,
            "ranked_top5_5commits_early": r.counterfactual_lead_count,
            "lead_fraction": round(rate, 4),
        })
        total_lead += r.counterfactual_lead_count
        total_resolved += r.counterfactual_total_resolved
    rows.append({
        "project_id": "AGGREGATE",
        "total_resolved_satd": total_resolved,
        "ranked_top5_5commits_early": total_lead,
        "lead_fraction": round(
            (total_lead / total_resolved) if total_resolved else 0.0, 4
        ),
    })
    return rows


def write_csv(path: Path, rows: List[Dict[str, Any]]) -> None:
    if not rows:
        log.warning("No rows to write for %s", path)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(r)
    log.info("Wrote %s (%d rows)", path, len(rows))


def write_raw_per_project(path: Path, result: ProjectReplayResult) -> None:
    rows: List[Dict[str, Any]] = []
    for strat, hits in result.per_strategy_hits.items():
        for h in hits:
            row = {
                "project_id": h.project_id,
                "strategy": h.strategy,
                "commit_index": h.commit_index,
                "commit_hash": h.commit_hash,
                "addressed_ids": ";".join(h.addressed_ids),
                "rank_of_first_hit": h.rank_of_first_hit if h.rank_of_first_hit else "",
            }
            for k in HIT_K_VALUES:
                row[f"hit_at_{k}"] = int(h.hit_at_k[k])
            rows.append(row)
    write_csv(path, rows)


# ---------------------------------------------------------------------------
# Configuration loading
# ---------------------------------------------------------------------------

def load_config(path: str) -> List[ProjectConfig]:
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Config file not found: {path}")
    with open(path, "r", encoding="utf-8") as f:
        if path.endswith((".yaml", ".yml")):
            if yaml is None:
                raise RuntimeError(
                    "PyYAML not installed. Run `pip install pyyaml` or use a JSON config."
                )
            data = yaml.safe_load(f)
        else:
            data = json.load(f)
    out: List[ProjectConfig] = []
    for entry in data.get("projects", []):
        out.append(ProjectConfig(
            project_id=entry["project_id"],
            name=entry.get("name", entry["project_id"]),
            repo_path=entry["repo_path"],
            snapshot_commit=entry["snapshot_commit"],
            horizon_months=int(entry.get("horizon_months", DEFAULT_HORIZON_MONTHS)),
            full_dependency=bool(entry.get("full_dependency", True)),
        ))
    return out


def write_summary(path: Path, results: List[ProjectReplayResult], elapsed: float) -> None:
    lines: List[str] = []
    lines.append("RapidPay RQ3 Evaluation Summary")
    lines.append("=" * 50)
    lines.append(f"Completed in {elapsed/60:.1f} minutes")
    lines.append(f"Projects evaluated: {len(results)}")
    total_satd = sum(r.n_satd for r in results)
    total_chains = sum(r.n_chains for r in results)
    total_commits = sum(r.n_commits_replayed for r in results)
    total_events = sum(r.n_addressed_events for r in results)
    lines.append(f"Total SATD instances: {total_satd}")
    lines.append(f"Total chains: {total_chains}")
    lines.append(f"Total commits replayed: {total_commits}")
    lines.append(f"Total addressed events: {total_events}")
    lines.append("")
    # Aggregate hit/mrr
    agg_rows = aggregate_hit_mrr(results)
    lines.append("Aggregate Hit@k / MRR:")
    for row in agg_rows:
        lines.append(
            f"  {row['strategy']:<12} "
            f"n={row['n_events']:<5} "
            f"Hit@1={row['hit_at_1']:.3f} "
            f"Hit@3={row['hit_at_3']:.3f} "
            f"Hit@5={row['hit_at_5']:.3f} "
            f"Hit@10={row['hit_at_10']:.3f} "
            f"MRR={row['mrr']:.3f}"
        )
    lines.append("")
    # Co-removal aggregate
    co_rows = co_removal_table(results)
    agg_co = co_rows[-1]
    lines.append(
        f"Co-removal: chain_rate={agg_co['chain_co_removal_rate']:.3f} "
        f"vs random_rate={agg_co['random_co_removal_rate']:.3f} "
        f"(ratio={agg_co['ratio_chain_vs_random']})"
    )
    # Time-to-resolution aggregate
    ttr_rows = time_to_resolution_table(results)
    agg_ttr = ttr_rows[-1]
    lines.append(
        f"Counterfactual lead (top-5, ≥5 commits early): "
        f"{agg_ttr['ranked_top5_5commits_early']}/{agg_ttr['total_resolved_satd']} "
        f"= {agg_ttr['lead_fraction']:.3f}"
    )
    path.write_text("\n".join(lines), encoding="utf-8")
    log.info("Wrote summary to %s", path)
    print("\n" + "\n".join(lines))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="RapidPay RQ3 evaluation")
    parser.add_argument("--config", required=True, help="Path to config (YAML or JSON)")
    parser.add_argument("--output", default="rq3_results", help="Output directory")
    parser.add_argument(
        "--projects",
        default="",
        help="Comma-separated subset of project_ids to evaluate (default: all)",
    )
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Quick mode: cap SATD instances and commits per project",
    )
    args = parser.parse_args()

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    fh = logging.FileHandler(out_dir / "rq3_eval.log", mode="w", encoding="utf-8")
    fh.setFormatter(logging.Formatter(
        "[%(asctime)s] %(levelname)s %(name)s: %(message)s"
    ))
    logging.getLogger().addHandler(fh)

    try:
        projects = load_config(args.config)
    except Exception as e:
        log.error("Failed to load config: %s", e)
        return 2

    if args.projects:
        subset = {p.strip() for p in args.projects.split(",") if p.strip()}
        projects = [p for p in projects if p.project_id in subset]
        if not projects:
            log.error("No projects matched --projects=%s", args.projects)
            return 2

    log.info("Will evaluate %d project(s): %s",
             len(projects), ", ".join(p.project_id for p in projects))

    start = time.time()
    results: List[ProjectReplayResult] = []
    for p in projects:
        try:
            r = replay_project(p, quick=args.quick)
            results.append(r)
            # Write raw per-project replay log
            write_raw_per_project(
                out_dir / f"rq3_raw_replay_{p.project_id}.csv", r
            )
        except Exception as e:
            log.exception("[%s] Failed: %s", p.project_id, e)

    if not results:
        log.error("No project results produced.")
        return 1

    # Aggregate CSVs
    write_csv(out_dir / "rq3_hit_mrr_aggregate.csv", aggregate_hit_mrr(results))
    write_csv(out_dir / "rq3_per_project.csv", per_project_breakdown(results))
    write_csv(out_dir / "rq3_co_removal.csv", co_removal_table(results))
    write_csv(out_dir / "rq3_time_to_resolution.csv", time_to_resolution_table(results))

    elapsed = time.time() - start
    write_summary(out_dir / "rq3_summary.txt", results, elapsed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
