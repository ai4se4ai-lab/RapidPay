/**
 * run_example.ts — End-to-end MiniLib pipeline demonstration
 *
 * This script replicates the hand-traceable running example from
 * Section 3.5 of the RapidPay paper. It walks through all four stages:
 *
 *   Stage 1 (SID)  → detects SATD; c4 filtered by LLM at τ = 0.70
 *   Stage 2 (IRD)  → builds dependency graph; edges c1→c2, c1→c3
 *   Stage 3 (SIR)  → computes impact scores; SIR(c1) = 1.0
 *   Stage 4 (CAIG) → commit-aware ranking; Rank(c2) ≈ 0.555 when auth.py touched
 *
 * Run (requires ts-node or compiled JS):
 *   npx ts-node examples/running_example/run_example.ts
 *
 * No real LLM call is made — the example uses the built-in mock LLM
 * that replays the paper's confidence values (0.92, 0.88, 0.81, 0.35).
 */

import * as path from 'path';
import { TechnicalDebt, WeightedEdge, RelationshipType } from '../../src/models';
import { SatdChainAnalyzer } from '../../src/satdChainAnalyzer';

// ---------------------------------------------------------------------------
// PAPER CONSTANTS
// ---------------------------------------------------------------------------
const TAU = 0.70;          // confidence threshold (Section 3.1)
const ALPHA = 0.40;        // SIR weight for Fanout_w
const BETA  = 0.30;        // SIR weight for ChainLen_w
const GAMMA = 0.30;        // SIR weight for Reachability_w
const ETA1  = 0.40;        // CAIG weight for SIR
const ETA2  = 0.30;        // CAIG weight for CommitRel
const ETA3  = 0.15;        // CAIG weight for (1 - S^t)
const ETA4  = 0.15;        // CAIG weight for fix potential f_i

const MINILIB_DIR = path.join(__dirname, 'miniLib');

// ---------------------------------------------------------------------------
// STAGE 1 — SID: SATD Instance Detection
// ---------------------------------------------------------------------------

/**
 * Mock LLM responses that replicate the paper's Table 1 values.
 * In the real pipeline, classifySATD() calls the chosen LLM provider.
 */
const MOCK_LLM_RESPONSES: Record<string, { isSATD: boolean; confidence: number }> = {
  'c1': { isSATD: true,  confidence: 0.92 },   // TODO: replace plaintext check with bcrypt
  'c2': { isSATD: true,  confidence: 0.88 },   // FIXME: cookie not invalidated on logout
  'c3': { isSATD: true,  confidence: 0.81 },   // HACK: hardcoded credentials for dev
  'c4': { isSATD: false, confidence: 0.35 },   // TODO: add user manual link to README
};

interface CandidateComment {
  id: string;
  file: string;
  line: number;
  comment: string;
}

const CANDIDATE_COMMENTS: CandidateComment[] = [
  { id: 'c1', file: 'miniLib/auth.py',  line: 12, comment: '# TODO: replace plaintext check with bcrypt' },
  { id: 'c2', file: 'miniLib/auth.py',  line: 25, comment: '# FIXME: cookie not invalidated on logout' },
  { id: 'c3', file: 'miniLib/db.py',    line: 8,  comment: '# HACK: hardcoded credentials for dev' },
  { id: 'c4', file: 'miniLib/utils.py', line: 3,  comment: '# TODO: add user manual link to README' },
];

function runSID(candidates: CandidateComment[], tau: number): TechnicalDebt[] {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('STAGE 1 — SID (SATD Instance Detection)');
  console.log('══════════════════════════════════════════════════════');

  const detected: TechnicalDebt[] = [];

  for (const c of candidates) {
    const llm = MOCK_LLM_RESPONSES[c.id];
    const passes = llm.isSATD && llm.confidence >= tau;
    const status = passes ? '✓ SATD' : '✗ filtered';
    console.log(`  ${c.id}  ${status.padEnd(10)} conf=${llm.confidence.toFixed(2)}  "${c.comment}"`);

    if (passes) {
      detected.push({
        id: c.id,
        file: path.join(MINILIB_DIR, c.file.replace('miniLib/', '')),
        line: c.line,
        content: c.comment,
        description: c.comment,
        createdCommit: 'C0',
        createdDate: '2024-01-01',
        confidence: llm.confidence,
        isActualDebt: true,
      });
    }
  }

  console.log(`\n  → C* = { ${detected.map(d => d.id).join(', ')} }   (τ = ${tau})`);
  return detected;
}

// ---------------------------------------------------------------------------
// STAGE 2 — IRD: Inter-SATD Relationship Discovery
// ---------------------------------------------------------------------------

/**
 * Hand-coded graph edges matching the paper's Stage 2 analysis.
 *
 * IRD discovers:
 *   c1 → c2  call   (login calls logout)      weight ≈ 0.85
 *   c1 → c2  module (both in auth.py)          weight ≈ 0.76
 *   c1 → c3  call   (login calls connect)      weight ≈ 0.85
 *   c1 → c3  data   (shared variable `user`)   weight ≈ 0.76
 *   c2 ↔ c3  (none)
 */
function runIRD(satdSet: TechnicalDebt[]): WeightedEdge[] {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('STAGE 2 — IRD (Inter-SATD Relationship Discovery)');
  console.log('══════════════════════════════════════════════════════');

  if (satdSet.length < 2) {
    console.log('  Not enough SATD instances to form edges.');
    return [];
  }

  const edges: WeightedEdge[] = [
    { sourceId: 'c1', targetId: 'c2', type: RelationshipType.CALL,    weight: 0.85, hops: 1 },
    { sourceId: 'c1', targetId: 'c2', type: RelationshipType.MODULE,  weight: 0.76, hops: 1 },
    { sourceId: 'c1', targetId: 'c3', type: RelationshipType.CALL,    weight: 0.85, hops: 1 },
    { sourceId: 'c1', targetId: 'c3', type: RelationshipType.DATA,    weight: 0.76, hops: 1 },
  ];

  for (const e of edges) {
    console.log(`  ${e.sourceId} → ${e.targetId}  [${e.type.padEnd(7)}]  w=${e.weight.toFixed(2)}`);
  }
  console.log('  c2 ↔ c3  (none)');
  console.log('\n  → All three nodes are weakly connected → single chain of length 3');

  return edges;
}

// ---------------------------------------------------------------------------
// STAGE 3 — SIR: SATD Impact Ripple Score
// ---------------------------------------------------------------------------

function runSIR(satdSet: TechnicalDebt[], edges: WeightedEdge[]): Map<string, number> {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('STAGE 3 — SIR (SATD Impact Ripple Score)');
  console.log(`  (α=${ALPHA}, β=${BETA}, γ=${GAMMA})`);
  console.log('══════════════════════════════════════════════════════');

  // Build adjacency list
  const outEdges = new Map<string, WeightedEdge[]>();
  for (const td of satdSet) {
    outEdges.set(td.id, []);
  }
  for (const e of edges) {
    if (outEdges.has(e.sourceId)) {
      outEdges.get(e.sourceId)!.push(e);
    }
  }

  // Fanout_w: sum of outgoing edge weights
  const rawFanout = new Map<string, number>();
  for (const td of satdSet) {
    const w = (outEdges.get(td.id) || []).reduce((s, e) => s + e.weight, 0);
    rawFanout.set(td.id, w);
  }

  // ChainLen_w: max weighted path length (DFS with memoization)
  const chainLenMemo = new Map<string, number>();
  function chainLen(nodeId: string, visited: Set<string>): number {
    if (chainLenMemo.has(nodeId)) return chainLenMemo.get(nodeId)!;
    if (visited.has(nodeId)) return 0;
    visited.add(nodeId);
    let maxLen = 0;
    for (const e of (outEdges.get(nodeId) || [])) {
      const len = e.weight + chainLen(e.targetId, new Set(visited));
      if (len > maxLen) maxLen = len;
    }
    chainLenMemo.set(nodeId, maxLen);
    return maxLen;
  }

  const rawChainLen = new Map<string, number>();
  for (const td of satdSet) {
    rawChainLen.set(td.id, chainLen(td.id, new Set()));
  }

  // Reachability_w: sum of max path strengths to all reachable nodes
  function maxPathStrength(src: string, dst: string, visited: Set<string>): number {
    if (src === dst) return 0;
    if (visited.has(src)) return 0;
    visited.add(src);
    let best = 0;
    for (const e of (outEdges.get(src) || [])) {
      const s = e.weight + maxPathStrength(e.targetId, dst, new Set(visited));
      if (s > best) best = s;
    }
    return best;
  }

  const rawReach = new Map<string, number>();
  for (const td of satdSet) {
    let total = 0;
    for (const other of satdSet) {
      if (other.id !== td.id) {
        total += maxPathStrength(td.id, other.id, new Set());
      }
    }
    rawReach.set(td.id, total);
  }

  // Min-max normalization
  function normalize(values: Map<string, number>): Map<string, number> {
    const nums = Array.from(values.values());
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const norm = new Map<string, number>();
    for (const [k, v] of values) {
      norm.set(k, max === min ? 0 : (v - min) / (max - min));
    }
    return norm;
  }

  const normFanout  = normalize(rawFanout);
  const normChain   = normalize(rawChainLen);
  const normReach   = normalize(rawReach);

  const rawSIR = new Map<string, number>();
  for (const td of satdSet) {
    const id = td.id;
    rawSIR.set(id, ALPHA * normFanout.get(id)! + BETA * normChain.get(id)! + GAMMA * normReach.get(id)!);
  }
  const normSIR = normalize(rawSIR);

  console.log('\n  Node   Fanout_w  ChainLen_w  Reach_w   SIR(norm)');
  console.log('  ────   ────────  ──────────  ───────   ─────────');
  for (const td of satdSet) {
    const id = td.id;
    console.log(
      `  ${id}     ${normFanout.get(id)!.toFixed(2)}      ${normChain.get(id)!.toFixed(2)}        ${normReach.get(id)!.toFixed(2)}       ${normSIR.get(id)!.toFixed(2)}`
    );
    td.sirScore = normSIR.get(id)!;
  }

  const top = Array.from(normSIR.entries()).sort((a, b) => b[1] - a[1]);
  console.log(`\n  → Top-ranked by SIR: ${top.map(([id, s]) => `${id}(${s.toFixed(2)})`).join(' > ')}`);

  return normSIR;
}

// ---------------------------------------------------------------------------
// STAGE 4 — CAIG: Commit-Aware Insight Generation
// ---------------------------------------------------------------------------

interface CommitScenario {
  description: string;
  modifiedFile: string;  // file touched by the incoming commit
}

function runCAIG(satdSet: TechnicalDebt[], sirScores: Map<string, number>, scenario: CommitScenario): void {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('STAGE 4 — CAIG (Commit-Aware Insight Generation)');
  console.log(`  Scenario: ${scenario.description}`);
  console.log(`  (η1=${ETA1}, η2=${ETA2}, η3=${ETA3}, η4=${ETA4})`);
  console.log('══════════════════════════════════════════════════════');

  // Paper values for the scenario where auth.py is modified:
  //   CommitRel(c2) = 1.0  (auth.py directly touched)
  //   CommitRel(c3) = 0.0  (db.py untouched)
  //   S^t(c2) = 0.30  → (1-S^t) = 0.70
  //   f_i(c2) = 1.0   (HIGH fix potential)
  //   S^t(c3) = 0.60  → (1-S^t) = 0.40
  //   f_i(c3) = 0.0   (LOW fix potential)

  const caigParams: Record<string, { commitRel: number; effortScore: number; fixPotential: number }> = {
    c1: { commitRel: 1.0, effortScore: 0.20, fixPotential: 1.0 },
    c2: { commitRel: scenario.modifiedFile.includes('auth') ? 1.0 : 0.0, effortScore: 0.30, fixPotential: 1.0 },
    c3: { commitRel: scenario.modifiedFile.includes('db')   ? 1.0 : 0.0, effortScore: 0.60, fixPotential: 0.0 },
  };

  console.log('\n  Node   SIR    CommitRel  (1-S^t)   f_i    Rank');
  console.log('  ────   ───    ─────────  ───────   ───    ────');

  const ranks: Array<{ id: string; rank: number }> = [];
  for (const td of satdSet) {
    const id = td.id;
    const p  = caigParams[id];
    const sir = sirScores.get(id) ?? 0;
    const rank = ETA1 * sir + ETA2 * p.commitRel + ETA3 * (1 - p.effortScore) + ETA4 * p.fixPotential;
    console.log(
      `  ${id}     ${sir.toFixed(2)}   ${p.commitRel.toFixed(2)}       ${(1-p.effortScore).toFixed(2)}      ${p.fixPotential.toFixed(2)}   ${rank.toFixed(3)}`
    );
    ranks.push({ id, rank });
    td.rankScore = rank;
    td.commitRelevance = p.commitRel;
    td.effortScore = p.effortScore;
    td.fixPotentialValue = p.fixPotential;
  }

  ranks.sort((a, b) => b.rank - a.rank);
  console.log(`\n  → Recommendation order: ${ranks.map(r => `${r.id}(${r.rank.toFixed(3)})`).join(' > ')}`);

  // Verify the paper's expected values for the auth.py scenario
  const c2Rank = ranks.find(r => r.id === 'c2')?.rank ?? 0;
  const c3Rank = ranks.find(r => r.id === 'c3')?.rank ?? 0;
  if (scenario.modifiedFile.includes('auth')) {
    const expected_c2 = 0.555;
    const expected_c3 = 0.09;
    const okC2 = Math.abs(c2Rank - expected_c2) < 0.01;
    const okC3 = Math.abs(c3Rank - expected_c3) < 0.01;
    console.log(`\n  Paper check — Rank(c2) expected ≈ ${expected_c2}: ${okC2 ? '✓' : `✗  got ${c2Rank.toFixed(3)}`}`);
    console.log(`  Paper check — Rank(c3) expected ≈ ${expected_c3}: ${okC3 ? '✓' : `✗  got ${c3Rank.toFixed(3)}`}`);
    console.log(`  Paper check — c2 ranked above c3: ${c2Rank > c3Rank ? '✓' : '✗'}`);
  }
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  RapidPay — MiniLib Running Example (Section 3.5)   ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Repository: ${MINILIB_DIR}`);

  // Stage 1 — SID
  const satdSet = runSID(CANDIDATE_COMMENTS, TAU);

  // Stage 2 — IRD
  const edges = runIRD(satdSet);

  // Stage 3 — SIR
  const sirScores = runSIR(satdSet, edges);

  // Stage 4 — CAIG  (scenario: commit on auth.py)
  runCAIG(satdSet, sirScores, {
    description: 'auth.py was just modified (commit t+1)',
    modifiedFile: 'auth.py',
  });

  console.log('\n══════════════════════════════════════════════════════');
  console.log('Final prioritized SATD list');
  console.log('══════════════════════════════════════════════════════');
  const sorted = [...satdSet].sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0));
  for (const td of sorted) {
    console.log(`  ${td.id}  SIR=${td.sirScore?.toFixed(2)}  Rank=${td.rankScore?.toFixed(3)}  "${td.content}"`);
  }
  console.log('\nDone.\n');
}

main().catch(err => {
  console.error('Error running example:', err);
  process.exit(1);
});
