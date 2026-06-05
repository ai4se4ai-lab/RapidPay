# RapidPay – RQ3 Evaluation

This directory contains a fully self-contained Python script that reproduces
the RQ3 results in the paper (Section: *"To what extent does RapidPay's SIR-based prioritization predict real maintenance outcomes (SATD removal, co-removal patterns, and fix effort) in historical project data?"*).

It replays 18–24 months of post-snapshot commit history for each of the 10
subject projects, runs RapidPay's CAIG ranking against three baselines, and
emits the CSV tables referenced in the paper.

## What the script produces

After running, the `--output` directory contains:

| File                                  | Contents (paper reference)                              |
|---------------------------------------|---------------------------------------------------------|
| `rq3_hit_mrr_aggregate.csv`           | Hit@k and MRR table (Table: CAIG vs. baselines)         |
| `rq3_per_project.csv`                 | Per-project Hit@5 and MRR (Table: per-project)          |
| `rq3_co_removal.csv`                  | Chain vs. random co-removal rates (paragraph: Co-Removal Prediction) |
| `rq3_time_to_resolution.csv`          | Counterfactual lead-time analysis (paragraph: Time-to-Resolution) |
| `rq3_raw_replay_<project>.csv`        | Per-commit per-strategy hit log (for audit / replication)|
| `rq3_summary.txt`                     | Human-readable summary                                  |
| `rq3_eval.log`                        | Full log of the run                                     |

## Prerequisites

* Python 3.9+
* `pip install pyyaml` (only if your config is YAML; JSON works without it)
* `git` available on `$PATH`
* Cloned copies of the 10 subject repositories (see *Setup*).

The script has **no other Python dependencies**: Levenshtein, dependency
extraction, SIR scoring, and chain construction are all implemented in
pure stdlib so the replay is fully reproducible.

## Setup

### 1. Clone the 10 subject repositories

```bash
# Full clones (large; ~50GB total). Slower but most reliable.
./setup_repos.sh

# OR: shallow blob-filtered clones (much faster).
./setup_repos.sh --shallow # Windows: wsl bash ./setup_repos.sh --shallow

# OR: only a subset (use project IDs from the paper).
./setup_repos.sh --only react,scipy # Windows: wsl bash ./setup_repos.sh --only react,scipy
```

This script:

1. Clones each repo into `./repos/<name>` (skipped if already present).
2. Auto-picks a snapshot commit ≥ 18 months in the past on each repo's default branch.
3. Fills the `snapshot_commit:` fields in `config.yaml`.

You can also edit `config.yaml` by hand if you want a specific snapshot.

### 2. Run the evaluation

```bash
python rq3_evaluate.py --config config.yaml --output rq3_results/
```

Useful flags:

```bash
# Evaluate a subset of projects:
python rq3_evaluate.py --config config.yaml --output rq3_results/ --projects RE,SC

# "Quick" mode caps SATD count per project and number of replayed commits,
# useful for smoke-testing before a full run:
python rq3_evaluate.py --config config.yaml --output rq3_results/ --quick
```

## How the replay works (matches paper Section RQ3)

For each project:

1. **SATD detection at snapshot.** Scan every source file in the snapshot
   tree, flagging comment lines that contain SATD keywords or phrases (the
   paper's lexical pattern set `P`).

2. **Dependency graph + chains.** Build the SATD dependency graph using the
   four dependency types the paper defines (`call`, `data`, `control`,
   `module`), with edges restricted to `k=5` hops (paper default).
   Chains are weakly-connected subgraphs of this graph (Definition 6 in
   the paper).

3. **SIR scoring.** Compute `Fanout_w`, `ChainLen_w`, `Reachability_w` exactly
   as in Algorithm 3, with `(α, β, γ) = (0.4, 0.3, 0.3)` and min-max
   normalization.

4. **Effort score `S^t`.** Compute as `λ·(RT/maxRT) + (1−λ)·(FM/maxFM)`
   with `λ=0.5`, using git history up to the snapshot.

5. **Replay loop.** Walk forward through every post-snapshot commit in the
   horizon. For each commit:
   - Detect which SATD instances it *addresses* (deleted line, ≥50%
     content change, etc., per Section RQ3).
   - If anything is addressed, ask every ranking strategy
     (`recency`, `effort_only`, `sir_only`, `caig_full`) to rank the
     remaining SATD using only information available **before** that commit.
   - Record `Hit@k` for `k ∈ {1,3,5,10}` and the rank of the first hit.

6. **Co-removal analysis.** Within each chain, count pairs that are
   addressed within 30 days of each other. Compare against a random
   non-chain control sample of the same size (paper paragraph
   *Co-Removal Prediction*).

7. **Counterfactual lead-time.** For each addressed SATD, find the
   earliest replay commit where CAIG already had it in the top-5.
   Report the fraction that would have been surfaced ≥ 5 commits before
   maintainers actually addressed it (paper paragraph *Time-to-Resolution*).

The CAIG ranking formula is

```
Rank(t) = η1·SIR(t) + η2·CommitRel(t) + η3·(1 − S^t) + η4·f_i
```

with `(η1, η2, η3, η4) = (0.4, 0.3, 0.15, 0.15)` (paper Section RQ3).
The sliding window `W = 50` matches the paper default.

## Implementation choices vs. the paper

The script is designed to be **fully automated and dependency-free**, so a
few simplifications are made versus the full RapidPay prototype:

* **Refactoring detection.** The paper mentions RefactoringMiner as a
  "third reason a SATD is considered addressed." We implement the *removed*
  and *modified* signals here and document a hook to plug in RefactoringMiner
  results from a JSON file if you have them. The two automatic signals
  alone are already sufficient to reproduce the headline Hit@k and MRR
  trends, and we report them honestly.
* **Fix-potential `f_i` (CAIG Prompt 2).** The paper uses GPT-4o to assess
  whether recent diffs make a SATD easier to fix. For deterministic,
  no-API replay, we use a structural proxy: `1.0` if the SATD's file is
  in the most recent commit, `0.5` if a chain neighbor's file is, else
  `0.0`. The paper acknowledges such a proxy as a fallback when LLM access
  is unavailable.
* **Static analysis for IRD.** Full call/data/control extraction is
  performed by the prototype's language-specific analyzers. For the
  replay we build a lighter approximation that matches what the paper says
  is used as the fallback for non-fully-supported languages
  (module-level + intra-file proximity). The script's per-project results
  reflect this in `full_dependency: true/false`.

These trade-offs are listed transparently in `rq3_eval.log` so reviewers
can see exactly what the numbers came from.

## Runtime expectations

On a typical workstation (16-core, SSD), expect:

* Small projects (Apache Commons, React, SciPy): 5–20 min each
* Medium (TensorFlow, VS Code, Kubernetes, PostgreSQL): 30–90 min each
* Large (Android, Firefox): 2–6 hours each

Total full run: 8–24 hours depending on hardware and disk. Use
`--quick` for smoke tests (~10 min per project).

## Troubleshooting

* **"Snapshot commit not found":** the auto-picked SHA is on a branch
  that wasn't fetched. Run `git -C <repo> fetch --all --tags`.
* **Out-of-memory on very large repos:** restrict file extensions in
  `SOURCE_EXTENSIONS` near the top of `rq3_evaluate.py`, or run those
  projects individually with `--projects`.
* **`pyyaml` import error:** install with `pip install pyyaml`, or rename
  `config.yaml` to `config.json` and convert.
