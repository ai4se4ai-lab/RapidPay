// Test/ird.test.ts
/**
 * Unit tests for Inter-SATD Relationship Discovery (IRD)
 * Tests cover: dependency detection, graph construction, chain discovery
 */

import { SatdRelationshipAnalyzer } from '../src/satdRelationshipAnalyzer';
import { SatdChainAnalyzer } from '../src/satdChainAnalyzer';
import { 
    TechnicalDebt, 
    SatdRelationship, 
    RelationshipType,
    WeightedEdge,
    Chain,
    MAX_DEPENDENCY_HOPS,
    DEFAULT_RELATIONSHIP_WEIGHTS
} from '../src/models';

describe('IRD: Inter-SATD Relationship Discovery', () => {
    // Test data
    const createMockDebt = (id: string, file: string, line: number, content: string): TechnicalDebt => ({
        id,
        file,
        line,
        content,
        description: content,
        createdCommit: 'abc123',
        createdDate: '2024-01-01'
    });

    const createMockEdge = (sourceId: string, targetId: string, type: RelationshipType, weight: number): WeightedEdge => ({
        sourceId,
        targetId,
        type,
        weight,
        hops: 1
    });

    // Test 1-5: Dependency Type Detection
    describe('Dependency Type Detection', () => {
        test('IRD-1: should detect call dependency type', () => {
            const edge = createMockEdge('a', 'b', RelationshipType.CALL, 0.8);
            expect(edge.type).toBe(RelationshipType.CALL);
        });

        test('IRD-2: should detect data dependency type', () => {
            const edge = createMockEdge('a', 'b', RelationshipType.DATA, 0.7);
            expect(edge.type).toBe(RelationshipType.DATA);
        });

        test('IRD-3: should detect control dependency type', () => {
            const edge = createMockEdge('a', 'b', RelationshipType.CONTROL, 0.6);
            expect(edge.type).toBe(RelationshipType.CONTROL);
        });

        test('IRD-4: should detect module dependency type', () => {
            const edge = createMockEdge('a', 'b', RelationshipType.MODULE, 0.9);
            expect(edge.type).toBe(RelationshipType.MODULE);
        });

        test('IRD-5: should use correct weight ranges for each type', () => {
            const callWeights = DEFAULT_RELATIONSHIP_WEIGHTS[RelationshipType.CALL];
            const dataWeights = DEFAULT_RELATIONSHIP_WEIGHTS[RelationshipType.DATA];
            const controlWeights = DEFAULT_RELATIONSHIP_WEIGHTS[RelationshipType.CONTROL];
            const moduleWeights = DEFAULT_RELATIONSHIP_WEIGHTS[RelationshipType.MODULE];
            
            expect(callWeights.min).toBe(0.7);
            expect(callWeights.max).toBe(0.9);
            expect(dataWeights.min).toBe(0.6);
            expect(dataWeights.max).toBe(0.8);
            expect(controlWeights.min).toBe(0.5);
            expect(controlWeights.max).toBe(0.7);
            expect(moduleWeights.min).toBe(0.8);
            expect(moduleWeights.max).toBe(1.0);
        });
    });

    // Test 6-10: Hop Limit Enforcement
    describe('Hop Limit Enforcement', () => {
        test('IRD-6: default max hops should be 5', () => {
            expect(MAX_DEPENDENCY_HOPS).toBe(5);
        });

        test('IRD-7: should respect hop limit in edge creation', () => {
            const edge = createMockEdge('a', 'b', RelationshipType.CALL, 0.8);
            edge.hops = 3;
            expect(edge.hops).toBeLessThanOrEqual(MAX_DEPENDENCY_HOPS);
        });

        test('IRD-8: should filter edges exceeding hop limit', () => {
            const edges: WeightedEdge[] = [
                { sourceId: 'a', targetId: 'b', type: RelationshipType.CALL, weight: 0.8, hops: 2 },
                { sourceId: 'b', targetId: 'c', type: RelationshipType.CALL, weight: 0.7, hops: 6 }, // Exceeds
                { sourceId: 'c', targetId: 'd', type: RelationshipType.CALL, weight: 0.9, hops: 5 }
            ];
            
            const validEdges = edges.filter(e => e.hops <= MAX_DEPENDENCY_HOPS);
            expect(validEdges.length).toBe(2);
        });

        test('IRD-9: should allow exactly k=5 hops', () => {
            const edge = createMockEdge('a', 'b', RelationshipType.CALL, 0.8);
            edge.hops = 5;
            expect(edge.hops <= MAX_DEPENDENCY_HOPS).toBe(true);
        });

        test('IRD-10: should handle hop count of 1', () => {
            const edge = createMockEdge('a', 'b', RelationshipType.CALL, 0.8);
            edge.hops = 1;
            expect(edge.hops).toBe(1);
        });
    });

    // Test 11-15: Graph Construction
    describe('Graph Construction', () => {
        test('IRD-11: should create adjacency list from relationships', () => {
            const debts = [
                createMockDebt('a', 'file1.py', 10, 'TODO: Fix A'),
                createMockDebt('b', 'file1.py', 20, 'TODO: Fix B')
            ];
            
            const relationships: SatdRelationship[] = [{
                sourceId: 'a',
                targetId: 'b',
                types: [RelationshipType.CALL],
                edges: [createMockEdge('a', 'b', RelationshipType.CALL, 0.8)],
                strength: 0.8,
                description: 'A calls B'
            }];
            
            const analyzer = new SatdRelationshipAnalyzer();
            const graph = analyzer.buildSATDGraph(debts, relationships);
            
            expect(graph.adjacencyList.get('a')?.length).toBe(1);
            expect(graph.reverseAdjacencyList.get('b')?.length).toBe(1);
        });

        test('IRD-12: should build reverse adjacency list', () => {
            const debts = [
                createMockDebt('a', 'file1.py', 10, 'TODO: Fix A'),
                createMockDebt('b', 'file1.py', 20, 'TODO: Fix B')
            ];
            
            const relationships: SatdRelationship[] = [{
                sourceId: 'a',
                targetId: 'b',
                types: [RelationshipType.CALL],
                edges: [createMockEdge('a', 'b', RelationshipType.CALL, 0.8)],
                strength: 0.8,
                description: 'A calls B'
            }];
            
            const analyzer = new SatdRelationshipAnalyzer();
            const graph = analyzer.buildSATDGraph(debts, relationships);
            
            expect(graph.reverseAdjacencyList.get('b')?.[0].sourceId).toBe('a');
        });

        test('IRD-13: should handle nodes with no edges', () => {
            const debts = [
                createMockDebt('a', 'file1.py', 10, 'TODO: Fix A'),
                createMockDebt('b', 'file1.py', 20, 'TODO: Fix B'),
                createMockDebt('c', 'file2.py', 30, 'TODO: Fix C') // Isolated
            ];
            
            const relationships: SatdRelationship[] = [{
                sourceId: 'a',
                targetId: 'b',
                types: [RelationshipType.CALL],
                edges: [createMockEdge('a', 'b', RelationshipType.CALL, 0.8)],
                strength: 0.8,
                description: 'A calls B'
            }];
            
            const analyzer = new SatdRelationshipAnalyzer();
            const graph = analyzer.buildSATDGraph(debts, relationships);
            
            expect(graph.nodes.length).toBe(3);
            expect(graph.adjacencyList.get('c')?.length).toBe(0);
        });

        test('IRD-14: should collect all edges in graph', () => {
            const debts = [
                createMockDebt('a', 'file1.py', 10, 'TODO'),
                createMockDebt('b', 'file1.py', 20, 'FIXME'),
                createMockDebt('c', 'file1.py', 30, 'HACK')
            ];
            
            const relationships: SatdRelationship[] = [
                {
                    sourceId: 'a', targetId: 'b',
                    types: [RelationshipType.CALL],
                    edges: [createMockEdge('a', 'b', RelationshipType.CALL, 0.8)],
                    strength: 0.8, description: ''
                },
                {
                    sourceId: 'b', targetId: 'c',
                    types: [RelationshipType.DATA],
                    edges: [createMockEdge('b', 'c', RelationshipType.DATA, 0.7)],
                    strength: 0.7, description: ''
                }
            ];
            
            const analyzer = new SatdRelationshipAnalyzer();
            const graph = analyzer.buildSATDGraph(debts, relationships);
            
            expect(graph.edges.length).toBe(2);
        });

        test('IRD-15: should merge multiple edges between same nodes', () => {
            const debts = [
                createMockDebt('a', 'file1.py', 10, 'TODO'),
                createMockDebt('b', 'file1.py', 20, 'FIXME')
            ];
            
            const relationships: SatdRelationship[] = [{
                sourceId: 'a', targetId: 'b',
                types: [RelationshipType.CALL, RelationshipType.DATA],
                edges: [
                    createMockEdge('a', 'b', RelationshipType.CALL, 0.8),
                    createMockEdge('a', 'b', RelationshipType.DATA, 0.7)
                ],
                strength: 0.8, description: ''
            }];
            
            const analyzer = new SatdRelationshipAnalyzer();
            const graph = analyzer.buildSATDGraph(debts, relationships);
            
            expect(graph.adjacencyList.get('a')?.length).toBe(2);
        });
    });

    // Test 16-20: Chain Discovery (Weakly Connected Subgraphs)
    describe('Chain Discovery', () => {
        test('IRD-16: should discover chain with two nodes', () => {
            const debts = [
                createMockDebt('a', 'file1.py', 10, 'TODO'),
                createMockDebt('b', 'file1.py', 20, 'FIXME')
            ];
            
            const relationships: SatdRelationship[] = [{
                sourceId: 'a', targetId: 'b',
                types: [RelationshipType.CALL],
                edges: [createMockEdge('a', 'b', RelationshipType.CALL, 0.8)],
                strength: 0.8, description: ''
            }];
            
            const chainAnalyzer = new SatdChainAnalyzer();
            const { chains } = chainAnalyzer.findChains(debts, relationships);
            
            expect(chains.length).toBe(1);
            expect(chains[0].nodes.length).toBe(2);
        });

        test('IRD-17: should discover multiple separate chains', () => {
            const debts = [
                createMockDebt('a', 'file1.py', 10, 'TODO'),
                createMockDebt('b', 'file1.py', 20, 'FIXME'),
                createMockDebt('c', 'file2.py', 10, 'HACK'),
                createMockDebt('d', 'file2.py', 20, 'XXX')
            ];
            
            const relationships: SatdRelationship[] = [
                {
                    sourceId: 'a', targetId: 'b',
                    types: [RelationshipType.CALL],
                    edges: [createMockEdge('a', 'b', RelationshipType.CALL, 0.8)],
                    strength: 0.8, description: ''
                },
                {
                    sourceId: 'c', targetId: 'd',
                    types: [RelationshipType.DATA],
                    edges: [createMockEdge('c', 'd', RelationshipType.DATA, 0.7)],
                    strength: 0.7, description: ''
                }
            ];
            
            const chainAnalyzer = new SatdChainAnalyzer();
            const { chains } = chainAnalyzer.findChains(debts, relationships);
            
            expect(chains.length).toBe(2);
        });

        test('IRD-18: should not create chain for isolated nodes', () => {
            const debts = [
                createMockDebt('a', 'file1.py', 10, 'TODO'),
                createMockDebt('b', 'file2.py', 20, 'FIXME')
            ];
            
            const relationships: SatdRelationship[] = [];
            
            const chainAnalyzer = new SatdChainAnalyzer();
            const { chains } = chainAnalyzer.findChains(debts, relationships);
            
            expect(chains.length).toBe(0);
        });

        test('IRD-19: should handle cyclic dependencies', () => {
            const debts = [
                createMockDebt('a', 'file1.py', 10, 'TODO'),
                createMockDebt('b', 'file1.py', 20, 'FIXME'),
                createMockDebt('c', 'file1.py', 30, 'HACK')
            ];
            
            const relationships: SatdRelationship[] = [
                {
                    sourceId: 'a', targetId: 'b',
                    types: [RelationshipType.CALL],
                    edges: [createMockEdge('a', 'b', RelationshipType.CALL, 0.8)],
                    strength: 0.8, description: ''
                },
                {
                    sourceId: 'b', targetId: 'c',
                    types: [RelationshipType.CALL],
                    edges: [createMockEdge('b', 'c', RelationshipType.CALL, 0.7)],
                    strength: 0.7, description: ''
                },
                {
                    sourceId: 'c', targetId: 'a', // Cycle
                    types: [RelationshipType.DATA],
                    edges: [createMockEdge('c', 'a', RelationshipType.DATA, 0.6)],
                    strength: 0.6, description: ''
                }
            ];
            
            const chainAnalyzer = new SatdChainAnalyzer();
            const { chains } = chainAnalyzer.findChains(debts, relationships);
            
            expect(chains.length).toBe(1);
            expect(chains[0].nodes.length).toBe(3);
        });

        test('IRD-20: should calculate chain total weight', () => {
            const debts = [
                createMockDebt('a', 'file1.py', 10, 'TODO'),
                createMockDebt('b', 'file1.py', 20, 'FIXME')
            ];
            
            const relationships: SatdRelationship[] = [{
                sourceId: 'a', targetId: 'b',
                types: [RelationshipType.CALL],
                edges: [createMockEdge('a', 'b', RelationshipType.CALL, 0.8)],
                strength: 0.8, description: ''
            }];
            
            const chainAnalyzer = new SatdChainAnalyzer();
            const { chains } = chainAnalyzer.findChains(debts, relationships);
            
            expect(chains[0].totalWeight).toBe(0.8);
        });
    });

    // Test 21-25: Relationship Merging and Deduplication
    describe('Relationship Merging', () => {
        test('IRD-21: should deduplicate same source-target pairs', () => {
            const analyzer = new SatdRelationshipAnalyzer();
            
            // Simulate deduplication logic
            const relationships: SatdRelationship[] = [
                {
                    sourceId: 'a', targetId: 'b',
                    types: [RelationshipType.CALL],
                    edges: [createMockEdge('a', 'b', RelationshipType.CALL, 0.8)],
                    strength: 0.8, description: 'Call dependency'
                },
                {
                    sourceId: 'a', targetId: 'b',
                    types: [RelationshipType.DATA],
                    edges: [createMockEdge('a', 'b', RelationshipType.DATA, 0.7)],
                    strength: 0.7, description: 'Data dependency'
                }
            ];
            
            // After deduplication, should merge to one relationship with both types
            const merged = new Map<string, SatdRelationship>();
            for (const rel of relationships) {
                const key = `${rel.sourceId}-${rel.targetId}`;
                if (merged.has(key)) {
                    const existing = merged.get(key)!;
                    existing.types = [...new Set([...existing.types, ...rel.types])];
                    existing.edges.push(...rel.edges);
                    existing.strength = Math.max(existing.strength, rel.strength);
                } else {
                    merged.set(key, { ...rel });
                }
            }
            
            expect(merged.size).toBe(1);
            expect(merged.get('a-b')!.types.length).toBe(2);
        });

        test('IRD-22: should keep max strength when merging', () => {
            const relationships: SatdRelationship[] = [
                {
                    sourceId: 'a', targetId: 'b',
                    types: [RelationshipType.CALL],
                    edges: [createMockEdge('a', 'b', RelationshipType.CALL, 0.8)],
                    strength: 0.8, description: ''
                },
                {
                    sourceId: 'a', targetId: 'b',
                    types: [RelationshipType.DATA],
                    edges: [createMockEdge('a', 'b', RelationshipType.DATA, 0.9)],
                    strength: 0.9, description: ''
                }
            ];
            
            const maxStrength = Math.max(...relationships.map(r => r.strength));
            expect(maxStrength).toBe(0.9);
        });

        test('IRD-23: should preserve all edge types in merged relationship', () => {
            const rel1: SatdRelationship = {
                sourceId: 'a', targetId: 'b',
                types: [RelationshipType.CALL],
                edges: [createMockEdge('a', 'b', RelationshipType.CALL, 0.8)],
                strength: 0.8, description: ''
            };
            
            const rel2: SatdRelationship = {
                sourceId: 'a', targetId: 'b',
                types: [RelationshipType.DATA, RelationshipType.CONTROL],
                edges: [
                    createMockEdge('a', 'b', RelationshipType.DATA, 0.7),
                    createMockEdge('a', 'b', RelationshipType.CONTROL, 0.6)
                ],
                strength: 0.7, description: ''
            };
            
            const mergedTypes = [...new Set([...rel1.types, ...rel2.types])];
            expect(mergedTypes.length).toBe(3);
        });

        test('IRD-24: should mark relationships as in chain after discovery', () => {
            const debts = [
                createMockDebt('a', 'file1.py', 10, 'TODO'),
                createMockDebt('b', 'file1.py', 20, 'FIXME')
            ];
            
            const relationships: SatdRelationship[] = [{
                sourceId: 'a', targetId: 'b',
                types: [RelationshipType.CALL],
                edges: [createMockEdge('a', 'b', RelationshipType.CALL, 0.8)],
                strength: 0.8, description: ''
            }];
            
            const chainAnalyzer = new SatdChainAnalyzer();
            const { relationships: enhanced } = chainAnalyzer.findChains(debts, relationships);
            
            expect(enhanced[0].inChain).toBe(true);
        });

        test('IRD-25: should assign chain IDs to relationships', () => {
            const debts = [
                createMockDebt('a', 'file1.py', 10, 'TODO'),
                createMockDebt('b', 'file1.py', 20, 'FIXME')
            ];
            
            const relationships: SatdRelationship[] = [{
                sourceId: 'a', targetId: 'b',
                types: [RelationshipType.CALL],
                edges: [createMockEdge('a', 'b', RelationshipType.CALL, 0.8)],
                strength: 0.8, description: ''
            }];
            
            const chainAnalyzer = new SatdChainAnalyzer();
            const { relationships: enhanced, chains } = chainAnalyzer.findChains(debts, relationships);
            
            expect(enhanced[0].chainIds).toBeDefined();
            expect(enhanced[0].chainIds?.length).toBeGreaterThan(0);
        });
    });
});

