# How RapidPay's RQ1, RQ2, and RQ3 Are Evaluated — A Worked Example

This guide walks through the **complete evaluation methodology** for all three research questions using a tiny, hand-traceable example. Every number you'll see is computed step by step so you can reproduce the logic yourself.

---

## The Setup: A Tiny Pretend Project

Imagine a small project called **MiniLib** with three Python files:

```
miniLib/
├── auth.py         (handles user authentication)
├── db.py           (handles database queries)
└── utils.py        (helper functions)
```

We pick a **snapshot commit** (call it commit $C_0$, dated Jan 2024). At this snapshot, the three files contain four code comments:

| ID | File | Line | Comment |
|----|------|------|---------|
| c1 | auth.py | 12 | `# TODO: replace plaintext with bcrypt` |
| c2 | auth.py | 25 | `# FIXME: cookie not invalidated on logout` |
| c3 | db.py | 8 | `# HACK: hardcoded credentials for dev` |
| c4 | utils.py | 3 | `# TODO: add user manual link to readme` |

After the snapshot, we observe **8 commits** over the next 18 months. We will treat these as our "ground truth" for what maintainers actually did.

---

## RQ1 — How Accurately Can SATD Be Detected and Structured into Chains?

RQ1 has **two pieces**: detection accuracy (SID) and chain construction quality (IRD).

### Step 1.1 — Run SID on the Four Comments

SID is a two-stage pipeline.

**Stage 1: Lexical filtering.** A regex matches any comment containing words like `TODO`, `FIXME`, `HACK`, `workaround`, `should be improved`, etc. All four comments match (they all contain TODO, FIXME, or HACK), so all four pass to Stage 2.

**Stage 2: LLM classification.** GPT-4o is given each comment with surrounding code context and asked: *"Is this Self-Admitted Technical Debt? Reply TRUE or FALSE with a confidence 0–100."* We set threshold $\tau = 0.7$.

The LLM returns:

| ID | LLM verdict | Confidence | Passes $\tau=0.7$? |
|----|-------------|------------|--------------------|
| c1 | TRUE | 0.92 | ✅ Yes |
| c2 | TRUE | 0.88 | ✅ Yes |
| c3 | TRUE | 0.81 | ✅ Yes |
| c4 | FALSE | 0.35 | ❌ No (admin task, not debt) |

So SID outputs $\mathcal{C}^* = \{c_1, c_2, c_3\}$.

### Step 1.2 — Evaluate Detection Accuracy

We assume **two human annotators** had previously read all four comments and agreed that the true SATD set is $\mathcal{C}^\dagger = \{c_1, c_2, c_3\}$ (c4 is just a documentation chore).

We compute a **confusion matrix**:

|              | LLM says SATD | LLM says not-SATD |
|--------------|---------------|--------------------|
| Truly SATD   | TP = 3 (c1,c2,c3) | FN = 0 |
| Truly not    | FP = 0        | TN = 1 (c4) |

From which:

$$\text{Precision} = \frac{TP}{TP+FP} = \frac{3}{3+0} = 1.00$$

$$\text{Recall} = \frac{TP}{TP+FN} = \frac{3}{3+0} = 1.00$$

$$\text{F1} = \frac{2 \cdot P \cdot R}{P+R} = 1.00$$

In the real paper we average these across 10 projects and get **F1 ≈ 0.90**. The key idea is identical: compare LLM verdicts against human-labeled ground truth.

### Step 1.3 — Run IRD to Build Chains

For each pair of detected SATD instances, IRD checks four dependency types within $k=5$ hops:

- **Call:** does function containing $c_i$ call function containing $c_j$?
- **Data:** do they share a variable through def-use?
- **Control:** does one's execution guard the other?
- **Module:** are they in files that import each other?

For MiniLib:

| Pair | Call? | Data? | Control? | Module? | Edge weight |
|------|-------|-------|----------|---------|--------------|
| c1 ↔ c2 | yes (login→logout) | no | no | yes (same file) | 0.85 (call) |
| c1 ↔ c3 | yes (login→connect) | yes (shared `user` variable) | no | no | 0.82 (call) + 0.70 (data) |
| c2 ↔ c3 | no | no | no | no | none |

This produces the dependency graph:

```
   c1 ─────call(0.85)──── c2
    │
    ├─call(0.82)─┐
    └─data(0.70)─┘
                 ↓
                 c3
```

### Step 1.4 — Evaluate Chain Construction

A chain is a weakly connected subgraph. All three SATDs (c1, c2, c3) are connected through c1, so they form **one chain of length 3**.

To validate chain quality, the real paper would have annotators rate whether grouping c1, c2, c3 together "makes sense for joint maintenance." However, since our paper now avoids human studies, we instead validate chains in **RQ2** by checking whether chain members are actually co-addressed.

**RQ1 summary** in MiniLib: F1 = 1.00, 1 chain found containing 3 SATD instances.

---

## RQ2 — Do SIR Scores and Chains Predict Maintenance Outcomes?

RQ2 asks two questions: (a) does **SIR ranking** predict which SATD gets addressed next? (b) does **chain membership** predict which SATD get addressed together?

### Step 2.1 — Compute SIR Scores

SIR has three components, each computed on the dependency graph.

**Fanout_w**: sum of outgoing edge weights.

- $c_1$: edges out to c2 (0.85), c3 (0.82+0.70 averaged ≈ 0.76) → Fanout = $0.85 + 0.76 = 1.61$
- $c_2$: no outgoing edges → Fanout = 0
- $c_3$: no outgoing edges → Fanout = 0

**ChainLen_w**: longest weighted downstream path.

- $c_1$: longest path is c1 → c2 or c1 → c3, both weight ≈ 0.85 → ChainLen = 0.85
- $c_2$: 0 (no outgoing)
- $c_3$: 0

**Reachability_w**: sum of max path strengths to all reachable nodes.

- $c_1$: reaches c2 (0.85) and c3 (0.76) → Reachability = 1.61
- $c_2$: 0
- $c_3$: 0

**Normalize each to [0,1] using min-max:**

| ID | Fanout (norm) | ChainLen (norm) | Reachability (norm) |
|----|---------------|------------------|----------------------|
| c1 | 1.00 | 1.00 | 1.00 |
| c2 | 0.00 | 0.00 | 0.00 |
| c3 | 0.00 | 0.00 | 0.00 |

**Combine with weights $(\alpha,\beta,\gamma) = (0.4, 0.3, 0.3)$:**

$$\text{SIR}(c_1) = 0.4(1.00) + 0.3(1.00) + 0.3(1.00) = 1.00$$
$$\text{SIR}(c_2) = 0$$
$$\text{SIR}(c_3) = 0$$

So the **SIR ranking** is: c1 (top), then c2, c3 tied.

### Step 2.2 — Replay the Post-Snapshot History

We now play the 8 commits forward one by one. At each commit, we check whether it **addresses any SATD** (deletes the comment line, or modifies it by more than 50%).

| Commit | Files touched | SATD addressed? |
|--------|---------------|-----------------|
| t+1 | auth.py | c1 (replaced TODO with bcrypt code) ✅ |
| t+2 | auth.py | c2 (added invalidate_cookie call) ✅ |
| t+3 | utils.py | none |
| t+4 | db.py | none |
| t+5 | db.py | c3 (replaced HACK with env-var read) ✅ |
| t+6 | utils.py | none |
| t+7 | auth.py | none |
| t+8 | utils.py | none |

So **3 of 3 SATD were addressed** during the replay horizon, at commits t+1, t+2, and t+5.

### Step 2.3 — Evaluate RQ2a: Ranking Quality (Hit@k and MRR)

For each commit that addresses a SATD, we ask: where was the addressed item in the pre-commit ranking?

**Setup:** Before commit t+1, no SATD has been addressed yet, so all three (c1, c2, c3) are candidates.

| Strategy | Ranking at t+1 | Rank of c1 (addressed) | Hit@1? | Hit@5? | Reciprocal rank |
|----------|----------------|------------------------|--------|--------|------------------|
| **Recency** (most-recent file) | c2, c1, c3 (auth.py touched, then db.py) | 2 | ❌ | ✅ | 1/2 = 0.50 |
| **SIROnly** | c1, c2, c3 | **1** | ✅ | ✅ | 1/1 = 1.00 |
| **CAIG (full)** | c1, c2, c3 | **1** | ✅ | ✅ | 1/1 = 1.00 |

Before commit t+2, c1 has been removed from candidates, so we rank only c2 and c3:

| Strategy | Ranking at t+2 | Rank of c2 (addressed) | Hit@1? | RR |
|----------|----------------|------------------------|--------|-----|
| Recency | c2, c3 (auth.py just touched) | 1 | ✅ | 1.00 |
| SIROnly | c2, c3 (tied, broken arbitrarily) | 1 | ✅ | 1.00 |
| CAIG | c2 (auth.py modified recently), c3 | 1 | ✅ | 1.00 |

Before commit t+5, only c3 remains:

| Strategy | Ranking at t+5 | Rank of c3 | RR |
|----------|----------------|------------|-----|
| All | c3 (trivially) | 1 | 1.00 |

**Aggregate over the 3 addressed events:**

$$\text{Hit@1}_{\text{SIROnly}} = \frac{\#\text{hits in top 1}}{\#\text{events}} = \frac{3}{3} = 1.00$$

$$\text{Hit@1}_{\text{Recency}} = \frac{2}{3} = 0.67$$

$$\text{MRR}_{\text{SIROnly}} = \frac{1.00 + 1.00 + 1.00}{3} = 1.00$$

$$\text{MRR}_{\text{Recency}} = \frac{0.50 + 1.00 + 1.00}{3} = 0.83$$

In a tiny project, the rankers are very close. The real paper averages these over **6,411 events across 10 projects**, where SIROnly achieves MRR = 0.33 vs. Recency's 0.18 — a much clearer separation.

### Step 2.4 — Evaluate RQ2b: Chain Co-Removal

The chain contains $\{c_1, c_2, c_3\}$. There are $\binom{3}{2} = 3$ intra-chain pairs:

| Pair | Both addressed within 30 days? |
|------|-------------------------------|
| (c1, c2) | t+1 and t+2 are ~3 days apart → ✅ yes |
| (c1, c3) | t+1 and t+5 are ~40 days apart → ❌ no |
| (c2, c3) | t+2 and t+5 are ~37 days apart → ❌ no |

**Chain co-removal rate** = 1/3 = **33.3%**

**Random control:** Suppose MiniLib has 10 unrelated SATD instances in other chains. We sample 3 random pairs from *different* chains. Suppose 0 of these 3 pairs happen to be co-addressed within 30 days.

**Random co-removal rate** = 0/3 = **0%**

**Fisher's exact test** on the 2×2 table:

|         | Co-addressed | Not |
|---------|--------------|-----|
| Chain   | 1            | 2   |
| Random  | 0            | 3   |

With these tiny numbers $p \approx 1.0$ (no significance), but in the real paper with 18,104 chain pairs vs. 17,692 random pairs, the rates are 14.7% vs. 4.6% and $p < 10^{-9}$.

**RQ2 summary** in MiniLib:
- SIROnly MRR = 1.00 vs. Recency MRR = 0.83 (SIR helps)
- Chain co-removal rate = 33.3% vs. random 0% (chains predict co-removal)

---

## RQ3 — Does CAIG Prioritize and Surface SATD Earlier Than Maintainers?

RQ3 also has two parts: (a) does **CAIG** beat SIR-only? (b) does CAIG surface SATD **early enough** to be useful?

### Step 3.1 — Compute CAIG Scores

The CAIG formula combines four signals:

$$\text{Rank}(t_i) = \eta_1 \cdot \text{SIR}(t_i) + \eta_2 \cdot \text{CommitRel}(t_i) + \eta_3 \cdot (1 - S^t) + \eta_4 \cdot f_i$$

with weights $(\eta_1,\eta_2,\eta_3,\eta_4) = (0.4, 0.3, 0.15, 0.15)$.

Let's compute the score for $c_2$ just before commit t+2, when auth.py was recently modified by commit t+1.

- **SIR**($c_2$) = 0.00 (we computed this earlier)
- **CommitRel**($c_2$) = 1.00 (c2 is in auth.py, which was just modified)
- **Effort score** $S^t(c_2)$ = 0.3 (auth.py modified often, low estimated effort)
- **Fix potential** $f_i$ = 1.0 (auth.py is in the latest commit)

$$\text{Rank}(c_2) = 0.4(0.00) + 0.3(1.00) + 0.15(1 - 0.3) + 0.15(1.0)$$
$$= 0 + 0.30 + 0.105 + 0.15 = 0.555$$

For $c_3$ (in db.py, not in recent commits):

- SIR = 0.00, CommitRel = 0.00, $S^t$ = 0.4, $f_i$ = 0.0

$$\text{Rank}(c_3) = 0 + 0 + 0.15(0.6) + 0 = 0.09$$

So CAIG ranks **c2 > c3** at this moment, which matches what actually happened next (c2 was addressed at t+2).

### Step 3.2 — Evaluate RQ3a: CAIG vs. SIROnly

Compare the two rankings across all 3 addressed events:

| Event | SIROnly rank | CAIG rank |
|-------|--------------|-----------|
| c1 at t+1 | 1 (tied with c2,c3 broken arbitrarily) | 1 (CAIG breaks tie using commit context) |
| c2 at t+2 | 2 (tied with c3) | 1 (auth.py was just touched) |
| c3 at t+5 | 1 (only candidate) | 1 |

$$\text{Hit@1}_{\text{SIROnly}} = \frac{2}{3} = 0.67, \quad \text{Hit@1}_{\text{CAIG}} = \frac{3}{3} = 1.00$$

CAIG beats SIROnly by 0.33 Hit@1 points in this tiny example. In the real paper, the lift is $+0.09$ Hit@1 and $+0.13$ Hit@5 across 6,411 events.

### Step 3.3 — Evaluate RQ3b: Lead Time

For each addressed SATD, we ask: **how many commits before the actual fix was this item already in CAIG's top-5?**

- **c1** was addressed at commit t+1. CAIG ranked c1 in top-5 at commit t+0 (the snapshot itself). Lead time = **1 commit** (the snapshot counts as commit index 0). ❌ Below the 5-commit threshold.
- **c2** was addressed at commit t+2. CAIG had c2 in its top-5 at commits t+0, t+1, and t+2. Earliest top-5 appearance: t+0. Lead time = t+2 − t+0 = **2 commits**. ❌ Below threshold.
- **c3** was addressed at commit t+5. CAIG had c3 in top-5 at every commit from t+0 onward. Earliest top-5 appearance: t+0. Lead time = t+5 − t+0 = **5 commits**. ✅ Meets the threshold.

**Lead fraction** = 1 / 3 = **33%** of addressed SATD were surfaced ≥5 commits in advance.

In the real paper, this is **63% across 10 projects with a median lead time of 14 commits**, and the comparison curve against Recency clearly separates (Figure of CDFs).

---

## Putting It All Together: A One-Page Summary

| Stage | Input | Process | Output | Real-Paper Metric |
|-------|-------|---------|--------|--------------------|
| **RQ1: SID** | Code comments | Lexical filter → LLM classification (τ=0.7) | SATD instances $\mathcal{C}^*$ | Precision, Recall, F1 vs. annotated truth |
| **RQ1: IRD** | $\mathcal{C}^*$ + code | Detect call/data/control/module edges within 5 hops | Dependency graph + chains | Chain count, edge correctness |
| **RQ2a** | Snapshot graph + 18mo history | Replay every commit; record rank of first addressed SATD | Hit@k, MRR per strategy | SIROnly vs. Recency comparison |
| **RQ2b** | Chains + 18mo history | Enumerate chain pairs and random pairs; check 30-day co-removal | Chain rate vs. random rate, Fisher's exact $p$ | Ratio of chain to random co-removal |
| **RQ3a** | Same replay | Compare CAIG-ranked top-k to SIROnly-ranked top-k | Hit@k and MRR for CAIG | CAIG vs. SIROnly per project |
| **RQ3b** | CAIG rankings over time | For each addressed SATD, find earliest commit where it was already in top-5 | Lead-time CDF, fraction with lead ≥5 | 63% at ≥5 commits, median 14 |

### The Big Picture

The evaluation has **three layers of evidence**, each addressing a different concern:

1. **RQ1 (detection)** asks: *Can the tool find SATD at all?* This is the foundation. Without accurate detection, nothing downstream matters. Measured against human-annotated ground truth.

2. **RQ2 (predictive validity)** asks: *Are the structural abstractions — SIR and chains — meaningful?* This is the conceptual claim of the paper. Measured against directly observed maintenance behavior, without asking anyone to opine.

3. **RQ3 (practical utility)** asks: *Does adding commit context actually help, and does it help in time to matter?* This is the deployment-readiness claim. Measured against the same maintenance behavior, plus a timeliness analysis that distinguishes "accurate in hindsight" from "actionable in advance."

Each question builds on the previous one and uses a different kind of evidence: human annotation for RQ1, observational outcomes for RQ2, observational outcomes plus a counterfactual lead-time analysis for RQ3. The progression turns a tool description into an empirical contribution.