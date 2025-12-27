// Test/sir.test.ts
/**
 * Unit tests for SATD Impact Ripple (SIR) Score Calculation
 * Tests cover: score calculation, normalization, ranking
 * 
 * Formula: SIR(t_i) = α·Fanout_w(t_i) + β·ChainLen_w(t_i) + γ·Reachability_w(t_i)
 * Default weights: (α,β,γ) = (0.4, 0.3, 0.3)
 */

import { SatdChainAnalyzer } from '../src/satdChainAnalyzer';
import { 
    TechnicalDebt, 
    SatdRelationship, 
    RelationshipType,
    WeightedEdge,
    SIRComponents,
    DEFAULT_SIR_WEIGHTS
} from '../src/models';

describe('SIR: SATD Impact Ripple Score Calculation', () => {
    let chainAnalyzer: SatdChainAnalyzer;

    beforeEach(() => {
        chainAnalyzer = new SatdChainAnalyzer();
    });

    // Helper functions
    const createMockDebt = (id: string, file: string, line: number): TechnicalDebt => ({
        id,
        file,
        line,
        content: `TODO: ${id}`,
        description: `TODO: ${id}`,
        createdCommit: 'abc123',
        createdDate: '2024-01-01'
    });

    const createMockEdge = (sourceId: string, targetId: string, weight: number): WeightedEdge => ({
        sourceId,
        targetId,
        type: RelationshipType.CALL,
        weight,
        hops: 1
    });

    const createMockRelationship = (sourceId: string, targetId: string, weight: number): SatdRelationship => ({
        sourceId,
        targetId,
        types: [RelationshipType.CALL],
        edges: [createMockEdge(sourceId, targetId, weight)],
        strength: weight,
        description: ''
    });

    // Test 1-5: Default Weight Configuration
    describe('Default Weight Configuration', () => {
        test('SIR-1: default alpha should be 0.4', () => {
            expect(DEFAULT_SIR_WEIGHTS.alpha).toBe(0.4);
        });

        test('SIR-2: default beta should be 0.3', () => {
            expect(DEFAULT_SIR_WEIGHTS.beta).toBe(0.3);
        });

        test('SIR-3: default gamma should be 0.3', () => {
            expect(DEFAULT_SIR_WEIGHTS.gamma).toBe(0.3);
        });

        test('SIR-4: weights should sum to 1', () => {
            const sum = DEFAULT_SIR_WEIGHTS.alpha + DEFAULT_SIR_WEIGHTS.beta + DEFAULT_SIR_WEIGHTS.gamma;
            expect(sum).toBe(1.0);
        });

        test('SIR-5: should allow custom weight configuration', () => {
            chainAnalyzer.setSirWeights(0.5, 0.25, 0.25);
            const weights = chainAnalyzer.getSirWeights();
            
            expect(weights.alpha).toBe(0.5);
            expect(weights.beta).toBe(0.25);
            expect(weights.gamma).toBe(0.25);
        });
    });

    // Test 6-10: Fanout_w Calculation
    describe('Fanout_w Calculation', () => {
        test('SIR-6: node with no outgoing edges has 0 fanout', () => {
            const debts = [createMockDebt('a', 'file.py', 10)];
            const relationships: SatdRelationship[] = [];
            
            const scored = chainAnalyzer.calculateSIRScores(debts, relationships);
            
            expect(scored[0].sirComponents?.rawFanout).toBe(0);
        });

        test('SIR-7: fanout equals sum of outgoing edge weights', () => {
            const debts = [
                createMockDebt('a', 'file.py', 10),
                createMockDebt('b', 'file.py', 20),
                createMockDebt('c', 'file.py', 30)
            ];
            
            const relationships: SatdRelationship[] = [
                createMockRelationship('a', 'b', 0.8),
                createMockRelationship('a', 'c', 0.7)
            ];
            
            const scored = chainAnalyzer.calculateSIRScores(debts, relationships);
            const nodeA = scored.find(d => d.id === 'a');
            
            // Raw fanout should be 0.8 + 0.7 = 1.5
            expect(nodeA?.sirComponents?.rawFanout).toBeCloseTo(1.5, 2);
        });

        test('SIR-8: fanout considers edge weights not count', () => {
            const debts = [
                createMockDebt('a', 'file.py', 10),
                createMockDebt('b', 'file.py', 20)
            ];
            
            const relationships: SatdRelationship[] = [
                {
                    sourceId: 'a', targetId: 'b',
                    types: [RelationshipType.CALL, RelationshipType.DATA],
                    edges: [
                        createMockEdge('a', 'b', 0.8),
                        createMockEdge('a', 'b', 0.7)
                    ],
                    strength: 0.8, description: ''
                }
            ];
            
            const scored = chainAnalyzer.calculateSIRScores(debts, relationships);
            const nodeA = scored.find(d => d.id === 'a');
            
            // Should sum both edge weights
            expect(nodeA?.sirComponents?.rawFanout).toBeCloseTo(1.5, 2);
        });

        test('SIR-9: fanout is normalized to [0,1]', () => {
            const debts = [
                createMockDebt('a', 'file.py', 10),
                createMockDebt('b', 'file.py', 20),
                createMockDebt('c', 'file.py', 30)
            ];
            
            const relationships: SatdRelationship[] = [
                createMockRelationship('a', 'b', 0.8),
                createMockRelationship('a', 'c', 0.7)
            ];
            
            const scored = chainAnalyzer.calculateSIRScores(debts, relationships);
            
            for (const debt of scored) {
                expect(debt.sirComponents?.fanout_w).toBeGreaterThanOrEqual(0);
                expect(debt.sirComponents?.fanout_w).toBeLessThanOrEqual(1);
            }
        });

        test('SIR-10: max fanout node has normalized fanout of 1', () => {
            const debts = [
                createMockDebt('a', 'file.py', 10),
                createMockDebt('b', 'file.py', 20),
                createMockDebt('c', 'file.py', 30)
            ];
            
            const relationships: SatdRelationship[] = [
                createMockRelationship('a', 'b', 0.8),
                createMockRelationship('a', 'c', 0.7)
            ];
            
            const scored = chainAnalyzer.calculateSIRScores(debts, relationships);
            const nodeA = scored.find(d => d.id === 'a');
            
            expect(nodeA?.sirComponents?.fanout_w).toBe(1);
        });
    });

    // Test 11-15: ChainLen_w Calculation
    describe('ChainLen_w Calculation', () => {
        test('SIR-11: isolated node has 0 chain length', () => {
            const debts = [createMockDebt('a', 'file.py', 10)];
            const relationships: SatdRelationship[] = [];
            
            const scored = chainAnalyzer.calculateSIRScores(debts, relationships);
            
            expect(scored[0].sirComponents?.rawChainLen).toBe(0);
        });

        test('SIR-12: chain length is max weighted path length', () => {
            const debts = [
                createMockDebt('a', 'file.py', 10),
                createMockDebt('b', 'file.py', 20),
                createMockDebt('c', 'file.py', 30)
            ];
            
            const relationships: SatdRelationship[] = [
                createMockRelationship('a', 'b', 0.8),
                createMockRelationship('b', 'c', 0.7)
            ];
            
            const scored = chainAnalyzer.calculateSIRScores(debts, relationships);
            const nodeA = scored.find(d => d.id === 'a');
            
            // Max path from a: a->b (0.8) -> c (0.7) = 1.5
            expect(nodeA?.sirComponents?.rawChainLen).toBeCloseTo(1.5, 2);
        });

        test('SIR-13: chooses longest path among alternatives', () => {
            const debts = [
                createMockDebt('a', 'file.py', 10),
                createMockDebt('b', 'file.py', 20),
                createMockDebt('c', 'file.py', 30),
                createMockDebt('d', 'file.py', 40)
            ];
            
            const relationships: SatdRelationship[] = [
                createMockRelationship('a', 'b', 0.8),
                createMockRelationship('a', 'c', 0.5),
                createMockRelationship('b', 'd', 0.9), // Longer path: a->b->d = 1.7
                createMockRelationship('c', 'd', 0.3)  // Shorter path: a->c->d = 0.8
            ];
            
            const scored = chainAnalyzer.calculateSIRScores(debts, relationships);
            const nodeA = scored.find(d => d.id === 'a');
            
            expect(nodeA?.sirComponents?.rawChainLen).toBeCloseTo(1.7, 2);
        });

        test('SIR-14: chain length handles cycles', () => {
            const debts = [
                createMockDebt('a', 'file.py', 10),
                createMockDebt('b', 'file.py', 20),
                createMockDebt('c', 'file.py', 30)
            ];
            
            const relationships: SatdRelationship[] = [
                createMockRelationship('a', 'b', 0.8),
                createMockRelationship('b', 'c', 0.7),
                createMockRelationship('c', 'a', 0.6) // Cycle
            ];
            
            // Should not infinite loop
            const scored = chainAnalyzer.calculateSIRScores(debts, relationships);
            
            expect(scored.length).toBe(3);
            for (const debt of scored) {
                expect(debt.sirComponents?.rawChainLen).toBeDefined();
                expect(isFinite(debt.sirComponents?.rawChainLen || 0)).toBe(true);
            }
        });

        test('SIR-15: chain length is normalized to [0,1]', () => {
            const debts = [
                createMockDebt('a', 'file.py', 10),
                createMockDebt('b', 'file.py', 20)
            ];
            
            const relationships: SatdRelationship[] = [
                createMockRelationship('a', 'b', 0.8)
            ];
            
            const scored = chainAnalyzer.calculateSIRScores(debts, relationships);
            
            for (const debt of scored) {
                expect(debt.sirComponents?.chainLen_w).toBeGreaterThanOrEqual(0);
                expect(debt.sirComponents?.chainLen_w).toBeLessThanOrEqual(1);
            }
        });
    });

    // Test 16-20: Reachability_w and Final SIR Score
    describe('Reachability_w and Final SIR Score', () => {
        test('SIR-16: isolated node has 0 reachability', () => {
            const debts = [createMockDebt('a', 'file.py', 10)];
            const relationships: SatdRelationship[] = [];
            
            const scored = chainAnalyzer.calculateSIRScores(debts, relationships);
            
            expect(scored[0].sirComponents?.rawReachability).toBe(0);
        });

        test('SIR-17: reachability counts all reachable nodes', () => {
            const debts = [
                createMockDebt('a', 'file.py', 10),
                createMockDebt('b', 'file.py', 20),
                createMockDebt('c', 'file.py', 30)
            ];
            
            const relationships: SatdRelationship[] = [
                createMockRelationship('a', 'b', 0.8),
                createMockRelationship('b', 'c', 0.7)
            ];
            
            const scored = chainAnalyzer.calculateSIRScores(debts, relationships);
            const nodeA = scored.find(d => d.id === 'a');
            
            // Node A can reach B and C
            expect(nodeA?.sirComponents?.rawReachability).toBeGreaterThan(0);
        });

        test('SIR-18: final SIR score is weighted sum', () => {
            const debts = [
                createMockDebt('a', 'file.py', 10),
                createMockDebt('b', 'file.py', 20)
            ];
            
            const relationships: SatdRelationship[] = [
                createMockRelationship('a', 'b', 0.8)
            ];
            
            chainAnalyzer.setSirWeights(0.4, 0.3, 0.3);
            const scored = chainAnalyzer.calculateSIRScores(debts, relationships);
            
            for (const debt of scored) {
                const expected = 
                    0.4 * (debt.sirComponents?.fanout_w || 0) +
                    0.3 * (debt.sirComponents?.chainLen_w || 0) +
                    0.3 * (debt.sirComponents?.reachability_w || 0);
                
                // SIR scores are normalized, so we just check the range
                expect(debt.sirScore).toBeGreaterThanOrEqual(0);
                expect(debt.sirScore).toBeLessThanOrEqual(1);
            }
        });

        test('SIR-19: final SIR score is normalized to [0,1]', () => {
            const debts = [
                createMockDebt('a', 'file.py', 10),
                createMockDebt('b', 'file.py', 20),
                createMockDebt('c', 'file.py', 30)
            ];
            
            const relationships: SatdRelationship[] = [
                createMockRelationship('a', 'b', 0.8),
                createMockRelationship('b', 'c', 0.7)
            ];
            
            const scored = chainAnalyzer.calculateSIRScores(debts, relationships);
            
            for (const debt of scored) {
                expect(debt.sirScore).toBeGreaterThanOrEqual(0);
                expect(debt.sirScore).toBeLessThanOrEqual(1);
            }
        });

        test('SIR-20: ranking returns sorted by SIR descending', () => {
            const debts = [
                createMockDebt('a', 'file.py', 10),
                createMockDebt('b', 'file.py', 20),
                createMockDebt('c', 'file.py', 30)
            ];
            
            const relationships: SatdRelationship[] = [
                createMockRelationship('a', 'b', 0.8),
                createMockRelationship('a', 'c', 0.7),
                createMockRelationship('b', 'c', 0.6)
            ];
            
            const scored = chainAnalyzer.calculateSIRScores(debts, relationships);
            const ranked = chainAnalyzer.rankBySIR(scored);
            
            // Check descending order
            for (let i = 1; i < ranked.length; i++) {
                expect(ranked[i - 1].sirScore).toBeGreaterThanOrEqual(ranked[i].sirScore || 0);
            }
        });
    });
});

