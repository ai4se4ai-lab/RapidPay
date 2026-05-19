# RapidPay — MiniLib Running Example

This directory implements the end-to-end running example from **Section 3.5** of the RapidPay paper, walking through all four pipeline stages on a small, hand-traceable project called **MiniLib**.

## Structure

```
examples/running_example/
├── miniLib/
│   ├── auth.py     — authentication module (c1, c2)
│   ├── db.py       — database access module (c3)
│   └── utils.py    — helper utilities (c4 — filtered out)
├── run_example.ts  — end-to-end pipeline demonstration
└── README.md       — this file
```

## The Four Comments (Table 1 of the paper)

| ID | File         | Line | Comment                                          |
|----|--------------|------|--------------------------------------------------|
| c1 | `auth.py`    | 12   | `# TODO: replace plaintext check with bcrypt`    |
| c2 | `auth.py`    | 25   | `# FIXME: cookie not invalidated on logout`      |
| c3 | `db.py`      | 8    | `# HACK: hardcoded credentials for dev`          |
| c4 | `utils.py`   | 3    | `# TODO: add user manual link to README`          |

## Stage-by-Stage Walkthrough

### Stage 1 — SID (SATD Instance Detection)

The lexical filter `𝒫` matches **all four** comments (TODO, FIXME, HACK keywords).  
The LLM (`gpt-4o` / Claude / Gemini) then classifies each with a confidence score:

| ID | LLM verdict | Confidence | τ = 0.70 | Result |
|----|-------------|------------|----------|--------|
| c1 | TRUE        | 0.92       | ✓        | SATD   |
| c2 | TRUE        | 0.88       | ✓        | SATD   |
| c3 | TRUE        | 0.81       | ✓        | SATD   |
| c4 | FALSE       | 0.35       | ✗        | filtered |

**C\* = { c1, c2, c3 }**

c4 is a documentation chore, not a structural SATD instance — illustrating why the hybrid pipeline reduces false positives that a purely lexical detector would accept.

### Stage 2 — IRD (Inter-SATD Relationship Discovery)

IRD examines every pair in C\* for the four dependency types within k = 5 hops:

| Edge       | Type   | Weight | Reason |
|------------|--------|--------|--------|
| c1 → c2   | call   | 0.85   | `login()` calls `logout()` |
| c1 → c2   | module | 0.76   | both reside in `auth.py` |
| c1 → c3   | call   | 0.85   | `login()` calls `db.connect()` |
| c1 → c3   | data   | 0.76   | shared variable `user` |

No edge exists between c2 and c3 (different files, no shared calls or data flow).

All three nodes are reachable from one another in the undirected sense →  
**single propagation chain** of length 3.

### Stage 3 — SIR (SATD Impact Ripple Score)

Formula: **SIR(tᵢ) = α·Fanout_w(tᵢ) + β·ChainLen_w(tᵢ) + γ·Reachability_w(tᵢ)**  
Weights: (α, β, γ) = (0.4, 0.3, 0.3)

| Node | Fanout_w | ChainLen_w | Reach_w | SIR (norm) |
|------|----------|------------|---------|------------|
| c1   | 1.0      | 1.0        | 1.0     | **1.00**   |
| c2   | 0.0      | 0.0        | 0.0     | 0.00       |
| c3   | 0.0      | 0.0        | 0.0     | 0.00       |

c1 is the **structural anchor** of the chain — fixing it likely forces touches in c2 and c3.

### Stage 4 — CAIG (Commit-Aware Insight Generation)

Formula: **Rank(tᵢ) = η₁·SIR(tᵢ) + η₂·CommitRel(tᵢ) + η₃·(1−Sᵗ) + η₄·fᵢ**  
Weights: (η₁, η₂, η₃, η₄) = (0.4, 0.3, 0.15, 0.15)

Scenario: `auth.py` was just modified (commit t+1).

| Node | SIR  | CommitRel | 1−Sᵗ  | fᵢ   | **Rank** |
|------|------|-----------|-------|------|----------|
| c2   | 0.00 | 1.00      | 0.70  | 1.00 | **0.555** |
| c3   | 0.00 | 0.00      | 0.40  | 0.00 | 0.090    |

Even though SIR tied c2 and c3 at 0, **CAIG correctly surfaces c2** at the moment a developer is editing `auth.py`.

## Running the Example

```bash
# From the repository root
npx ts-node examples/running_example/run_example.ts
```

No LLM API key is required — the example uses a built-in mock that replays the paper's confidence values.

## Mapping to Research Questions

| RQ | Paper section | What the example demonstrates |
|----|--------------|-------------------------------|
| RQ1 | Sec. 4.1 | SID accepts c1/c2/c3, rejects c4 (F1 = 1.0 on this micro-corpus) |
| RQ2a | Sec. 4.2 | SIR alone ranks c1 first; c1 is addressed first in the post-snapshot history |
| RQ2b | Sec. 4.2 | c1 and c2 (same chain) co-addressed within 3 days |
| RQ3a | Sec. 4.3 | CAIG raises c2 above c3 when auth.py is touched |
| RQ3b | Sec. 4.3 | c3 appears in CAIG top-5 from snapshot onward, 5 commits before its actual fix |
