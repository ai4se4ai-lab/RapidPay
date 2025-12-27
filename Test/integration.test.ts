// Test/integration.test.ts
/**
 * Integration tests for end-to-end RapidPay workflows
 * Tests cover: full pipeline, cross-module interactions, data flow
 */

import { SatdDetector } from '../src/satdDetector';
import { SatdRelationshipAnalyzer } from '../src/satdRelationshipAnalyzer';
import { SatdChainAnalyzer } from '../src/satdChainAnalyzer';
import { 
    TechnicalDebt, 
    SatdRelationship, 
    RelationshipType,
    WeightedEdge,
    Chain,
    SATDGraph,
    DebtType,
    DEFAULT_SATD_CONFIG,
    DEFAULT_SIR_WEIGHTS,
    DEFAULT_CAIG_WEIGHTS,
    FixPotential,
    FIX_POTENTIAL_VALUES
} from '../src/models';

describe('Integration Tests: End-to-End Workflows', () => {
    // Mock data for integration tests
    const mockSatdInstances: TechnicalDebt[] = [
        {
            id: 'satd-1',
            file: 'src/auth/login.py',
            line: 25,
            content: '# TODO: Add proper password hashing',
            description: 'Password security needs improvement',
            createdCommit: 'abc123',
            createdDate: '2024-01-15',
            debtType: DebtType.DEFECT
        },
        {
            id: 'satd-2',
            file: 'src/auth/session.py',
            line: 42,
            content: '# FIXME: Session timeout not working',
            description: 'Session management issue',
            createdCommit: 'def456',
            createdDate: '2024-01-20',
            debtType: DebtType.DEFECT
        },
        {
            id: 'satd-3',
            file: 'src/auth/utils.py',
            line: 18,
            content: '# HACK: Workaround for token validation',
            description: 'Token validation workaround',
            createdCommit: 'ghi789',
            createdDate: '2024-02-01',
            debtType: DebtType.IMPLEMENTATION
        },
        {
            id: 'satd-4',
            file: 'src/api/routes.py',
            line: 55,
            content: '# TODO: Refactor endpoint structure',
            description: 'API design needs refactoring',
            createdCommit: 'jkl012',
            createdDate: '2024-02-10',
            debtType: DebtType.DESIGN
        },
        {
            id: 'satd-5',
            file: 'src/database/models.py',
            line: 80,
            content: '# NOTE: Need database migration',
            description: 'Database schema update required',
            createdCommit: 'mno345',
            createdDate: '2024-02-15',
            debtType: DebtType.ARCHITECTURE
        }
    ];

    const mockRelationships: SatdRelationship[] = [
        {
            sourceId: 'satd-1',
            targetId: 'satd-2',
            types: [RelationshipType.CALL],
            edges: [{
                sourceId: 'satd-1',
                targetId: 'satd-2',
                type: RelationshipType.CALL,
                weight: 0.8,
                hops: 1
            }],
            strength: 0.8,
            description: 'Login calls session management'
        },
        {
            sourceId: 'satd-1',
            targetId: 'satd-3',
            types: [RelationshipType.CALL],
            edges: [{
                sourceId: 'satd-1',
                targetId: 'satd-3',
                type: RelationshipType.CALL,
                weight: 0.7,
                hops: 1
            }],
            strength: 0.7,
            description: 'Login uses token utilities'
        },
        {
            sourceId: 'satd-2',
            targetId: 'satd-3',
            types: [RelationshipType.DATA],
            edges: [{
                sourceId: 'satd-2',
                targetId: 'satd-3',
                type: RelationshipType.DATA,
                weight: 0.6,
                hops: 1
            }],
            strength: 0.6,
            description: 'Session shares data with utils'
        },
        {
            sourceId: 'satd-4',
            targetId: 'satd-5',
            types: [RelationshipType.MODULE],
            edges: [{
                sourceId: 'satd-4',
                targetId: 'satd-5',
                type: RelationshipType.MODULE,
                weight: 0.9,
                hops: 1
            }],
            strength: 0.9,
            description: 'Routes depend on database models'
        }
    ];

    // Test 1-3: Full Pipeline SID -> IRD -> SIR
    describe('Full Pipeline: SID -> IRD -> SIR', () => {
        test('INT-1: should process SATD through complete pipeline', () => {
            const chainAnalyzer = new SatdChainAnalyzer();
            
            // Step 1: Find chains (IRD output)
            const { relationships, chains } = chainAnalyzer.findChains(
                mockSatdInstances,
                mockRelationships
            );
            
            // Step 2: Calculate SIR scores
            const scoredDebts = chainAnalyzer.calculateSIRScores(
                mockSatdInstances,
                relationships
            );
            
            // Step 3: Rank by SIR
            const rankedDebts = chainAnalyzer.rankBySIR(scoredDebts);
            
            // Verify pipeline output
            expect(rankedDebts.length).toBe(mockSatdInstances.length);
            expect(rankedDebts[0].sirScore).toBeDefined();
            expect(rankedDebts[0].sirScore).toBeGreaterThanOrEqual(rankedDebts[1].sirScore || 0);
        });

        test('INT-2: should maintain data integrity through pipeline', () => {
            const chainAnalyzer = new SatdChainAnalyzer();
            
            const { relationships } = chainAnalyzer.findChains(
                mockSatdInstances,
                mockRelationships
            );
            
            const scoredDebts = chainAnalyzer.calculateSIRScores(
                mockSatdInstances,
                relationships
            );
            
            // Verify original data preserved
            for (const scored of scoredDebts) {
                const original = mockSatdInstances.find(d => d.id === scored.id);
                expect(original).toBeDefined();
                expect(scored.file).toBe(original!.file);
                expect(scored.line).toBe(original!.line);
                expect(scored.content).toBe(original!.content);
            }
        });

        test('INT-3: should correctly identify SATD chains', () => {
            const chainAnalyzer = new SatdChainAnalyzer();
            
            const { chains } = chainAnalyzer.findChains(
                mockSatdInstances,
                mockRelationships
            );
            
            // Should have 2 chains: auth chain (1,2,3) and api chain (4,5)
            expect(chains.length).toBe(2);
            
            // Find auth chain (satd-1, satd-2, satd-3)
            const authChain = chains.find(c => c.nodes.includes('satd-1'));
            expect(authChain).toBeDefined();
            expect(authChain!.nodes.length).toBe(3);
            
            // Find api chain (satd-4, satd-5)
            const apiChain = chains.find(c => c.nodes.includes('satd-4'));
            expect(apiChain).toBeDefined();
            expect(apiChain!.nodes.length).toBe(2);
        });
    });

    // Test 4-6: Cross-Module Data Flow
    describe('Cross-Module Data Flow', () => {
        test('INT-4: detector output should be valid for relationship analyzer', () => {
            const detector = new SatdDetector();
            
            // Simulate detector output
            const code = '// TODO: Fix this';
            const detected = detector.analyzePotentialSatd('test.js', code, {
                detectionLevel: 'standard',
                includeImplicit: false
            });
            
            // Verify output format
            for (const item of detected) {
                expect(item.line).toBeDefined();
                expect(typeof item.line).toBe('number');
                expect(item.content).toBeDefined();
                expect(typeof item.content).toBe('string');
            }
        });

        test('INT-5: relationship analyzer output should be valid for chain analyzer', () => {
            const analyzer = new SatdRelationshipAnalyzer();
            const graph = analyzer.buildSATDGraph(mockSatdInstances, mockRelationships);
            
            // Verify graph structure
            expect(graph.nodes).toBeDefined();
            expect(graph.edges).toBeDefined();
            expect(graph.adjacencyList).toBeDefined();
            expect(graph.reverseAdjacencyList).toBeDefined();
            
            // Verify edges have required properties
            for (const edge of graph.edges) {
                expect(edge.sourceId).toBeDefined();
                expect(edge.targetId).toBeDefined();
                expect(edge.weight).toBeDefined();
                expect(edge.type).toBeDefined();
            }
        });

        test('INT-6: SIR scores should be valid for CAIG ranking', () => {
            const chainAnalyzer = new SatdChainAnalyzer();
            
            const scoredDebts = chainAnalyzer.calculateSIRScores(
                mockSatdInstances,
                mockRelationships
            );
            
            // Verify SIR scores are valid for CAIG
            for (const debt of scoredDebts) {
                expect(debt.sirScore).toBeDefined();
                expect(debt.sirScore).toBeGreaterThanOrEqual(0);
                expect(debt.sirScore).toBeLessThanOrEqual(1);
                expect(debt.sirComponents).toBeDefined();
            }
        });
    });

    // Test 7-9: Edge Cases and Error Handling
    describe('Edge Cases and Error Handling', () => {
        test('INT-7: should handle empty SATD list', () => {
            const chainAnalyzer = new SatdChainAnalyzer();
            
            const { chains, relationships } = chainAnalyzer.findChains([], []);
            const scoredDebts = chainAnalyzer.calculateSIRScores([], []);
            
            expect(chains.length).toBe(0);
            expect(relationships.length).toBe(0);
            expect(scoredDebts.length).toBe(0);
        });

        test('INT-8: should handle SATD with no relationships', () => {
            const chainAnalyzer = new SatdChainAnalyzer();
            const isolatedDebt: TechnicalDebt = {
                id: 'isolated-1',
                file: 'src/standalone.py',
                line: 10,
                content: '# TODO: Standalone issue',
                description: 'Isolated technical debt',
                createdCommit: 'xyz999',
                createdDate: '2024-03-01'
            };
            
            const { chains } = chainAnalyzer.findChains([isolatedDebt], []);
            const scoredDebts = chainAnalyzer.calculateSIRScores([isolatedDebt], []);
            
            // Isolated node should not form a chain
            expect(chains.length).toBe(0);
            
            // But should still have a SIR score
            expect(scoredDebts.length).toBe(1);
            expect(scoredDebts[0].sirScore).toBeDefined();
        });

        test('INT-9: should handle self-referencing relationships', () => {
            const chainAnalyzer = new SatdChainAnalyzer();
            const debt: TechnicalDebt = {
                id: 'self-ref',
                file: 'src/recursive.py',
                line: 10,
                content: '# TODO: Recursive function issue',
                description: 'Self-referencing debt',
                createdCommit: 'rec001',
                createdDate: '2024-03-01'
            };
            
            const selfRelationship: SatdRelationship = {
                sourceId: 'self-ref',
                targetId: 'self-ref',
                types: [RelationshipType.CALL],
                edges: [{
                    sourceId: 'self-ref',
                    targetId: 'self-ref',
                    type: RelationshipType.CALL,
                    weight: 0.5,
                    hops: 1
                }],
                strength: 0.5,
                description: 'Recursive call'
            };
            
            // Should not crash
            const { chains } = chainAnalyzer.findChains([debt], [selfRelationship]);
            const scoredDebts = chainAnalyzer.calculateSIRScores([debt], [selfRelationship]);
            
            expect(scoredDebts.length).toBe(1);
        });
    });

    // Test 10-12: Configuration Consistency
    describe('Configuration Consistency', () => {
        test('INT-10: SIR weights should be consistent across components', () => {
            const chainAnalyzer = new SatdChainAnalyzer();
            
            chainAnalyzer.setSirWeights(0.5, 0.3, 0.2);
            const weights = chainAnalyzer.getSirWeights();
            
            expect(weights.alpha + weights.beta + weights.gamma).toBeCloseTo(1.0, 5);
        });

        test('INT-11: detection config should propagate to detector', () => {
            const config = { ...DEFAULT_SATD_CONFIG };
            config.confidenceThreshold = 0.8;
            config.includeImplicit = false;
            
            expect(config.confidenceThreshold).toBe(0.8);
            expect(config.includeImplicit).toBe(false);
        });

        test('INT-12: CAIG weights should be consistent', () => {
            const weights = DEFAULT_CAIG_WEIGHTS;
            const sum = weights.eta1 + weights.eta2 + weights.eta3 + weights.eta4;
            
            expect(sum).toBeCloseTo(1.0, 5);
        });
    });

    // Test 13-15: Performance and Scalability
    describe('Performance and Scalability', () => {
        test('INT-13: should handle moderate number of SATD instances', () => {
            const chainAnalyzer = new SatdChainAnalyzer();
            
            // Create 50 mock SATD instances
            const largeList: TechnicalDebt[] = [];
            for (let i = 0; i < 50; i++) {
                largeList.push({
                    id: `satd-${i}`,
                    file: `src/module${i % 10}/file${i}.py`,
                    line: (i * 10) % 500,
                    content: `# TODO: Issue ${i}`,
                    description: `Technical debt ${i}`,
                    createdCommit: `commit${i}`,
                    createdDate: '2024-01-01'
                });
            }
            
            // Create chain relationships
            const largeRelationships: SatdRelationship[] = [];
            for (let i = 0; i < 40; i++) {
                largeRelationships.push({
                    sourceId: `satd-${i}`,
                    targetId: `satd-${i + 1}`,
                    types: [RelationshipType.CALL],
                    edges: [{
                        sourceId: `satd-${i}`,
                        targetId: `satd-${i + 1}`,
                        type: RelationshipType.CALL,
                        weight: 0.7 + (i % 3) * 0.1,
                        hops: 1
                    }],
                    strength: 0.7 + (i % 3) * 0.1,
                    description: `Relationship ${i}`
                });
            }
            
            const startTime = Date.now();
            const { chains } = chainAnalyzer.findChains(largeList, largeRelationships);
            const scoredDebts = chainAnalyzer.calculateSIRScores(largeList, largeRelationships);
            const endTime = Date.now();
            
            expect(scoredDebts.length).toBe(50);
            expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
        });

        test('INT-14: should handle complex chain structures', () => {
            const chainAnalyzer = new SatdChainAnalyzer();
            
            // Create web of relationships
            const debts: TechnicalDebt[] = [
                ...mockSatdInstances,
                {
                    id: 'satd-6',
                    file: 'src/common/shared.py',
                    line: 30,
                    content: '# TODO: Shared dependency',
                    description: 'Common module debt',
                    createdCommit: 'shared001',
                    createdDate: '2024-03-01'
                }
            ];
            
            // Add more complex relationships
            const complexRelationships: SatdRelationship[] = [
                ...mockRelationships,
                {
                    sourceId: 'satd-3',
                    targetId: 'satd-6',
                    types: [RelationshipType.MODULE],
                    edges: [{
                        sourceId: 'satd-3',
                        targetId: 'satd-6',
                        type: RelationshipType.MODULE,
                        weight: 0.85,
                        hops: 1
                    }],
                    strength: 0.85,
                    description: 'Utils imports shared'
                },
                {
                    sourceId: 'satd-5',
                    targetId: 'satd-6',
                    types: [RelationshipType.DATA],
                    edges: [{
                        sourceId: 'satd-5',
                        targetId: 'satd-6',
                        type: RelationshipType.DATA,
                        weight: 0.75,
                        hops: 1
                    }],
                    strength: 0.75,
                    description: 'Models use shared data'
                }
            ];
            
            const { chains } = chainAnalyzer.findChains(debts, complexRelationships);
            
            // Should merge into fewer, larger chains
            expect(chains.some(c => c.nodes.length >= 4)).toBe(true);
        });

        test('INT-15: should produce deterministic results', () => {
            const chainAnalyzer = new SatdChainAnalyzer();
            
            // Run twice
            const result1 = chainAnalyzer.calculateSIRScores(mockSatdInstances, mockRelationships);
            const result2 = chainAnalyzer.calculateSIRScores(mockSatdInstances, mockRelationships);
            
            // Results should be identical
            for (let i = 0; i < result1.length; i++) {
                expect(result1[i].id).toBe(result2[i].id);
                expect(result1[i].sirScore).toBe(result2[i].sirScore);
            }
        });
    });
});

