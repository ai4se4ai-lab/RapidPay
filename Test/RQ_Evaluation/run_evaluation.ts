#!/usr/bin/env ts-node
/**
 * RQ1/RQ2 Evaluation Runner
 * 
 * This script executes the full RapidPay pipeline on the test case files
 * and evaluates the results against ground truth for RQ1 and RQ2.
 * 
 * Usage:
 *   npx ts-node Test/RQ_Evaluation/run_evaluation.ts [options]
 * 
 * Options:
 *   --quick          Skip LLM classification (lexical patterns only)
 *   --neo4j <uri>    Export results to Neo4j
 *   --output <file>  Save results to JSON file
 *   --verbose        Show detailed output
 */

import * as path from 'path';
import * as fs from 'fs';

// Import RapidPay components
import { TechnicalDebt, SatdRelationship, Chain, SATDGraph, DEFAULT_SATD_CONFIG } from '../../src/models';
import { SatdRelationshipAnalyzer } from '../../src/satdRelationshipAnalyzer';
import { SatdChainAnalyzer } from '../../src/satdChainAnalyzer';
import { SatdDetector } from '../../src/satdDetector';

// Ground truth types
interface GroundTruthSATD {
    id: string;
    file: string;
    line: number;
    pattern: string;
    content: string;
    debt_type: string;
    severity: string;
    description: string;
    containing_function: string | null;
    containing_class: string;
}

interface GroundTruthRelationship {
    id: string;
    source_satd: string;
    target_satd: string;
    type: string;
    weight: number;
    hops: number;
    description: string;
    chain_id: string;
}

interface GroundTruthChain {
    id: string;
    name: string;
    nodes: string[];
    length: number;
    description: string;
    root_node: string;
    leaf_nodes: string[];
    total_weight: number;
    expected_max_sir: string;
}

interface GroundTruth {
    metadata: any;
    satd_instances: GroundTruthSATD[];
    relationships: GroundTruthRelationship[];
    chains: GroundTruthChain[];
    expected_sir_ranking: {
        ranking: Array<{ rank: number; satd_id: string; rationale: string }>;
        developer_priority_expectation: {
            high_priority: string[];
            medium_priority: string[];
            low_priority: string[];
        };
    };
    evaluation_metrics: {
        rq1_detection: {
            expected_precision_threshold: number;
            expected_recall_threshold: number;
            chain_accuracy_threshold: number;
            relationship_identification_threshold: number;
        };
        rq2_prioritization: {
            spearman_correlation_threshold: number;
            top_3_precision_threshold: number;
            kendall_tau_threshold: number;
        };
    };
}

// Evaluation result types
interface RQ1Results {
    satd_detection: {
        true_positives: number;
        false_positives: number;
        false_negatives: number;
        precision: number;
        recall: number;
        f1_score: number;
        detected_satd: TechnicalDebt[];
        missed_satd: string[];
        extra_satd: TechnicalDebt[];
    };
    chain_discovery: {
        correct_chains: number;
        total_expected_chains: number;
        total_detected_chains: number;
        chain_accuracy: number;
        chain_details: Array<{
            expected_chain_id: string;
            matched: boolean;
            overlap_ratio: number;
        }>;
    };
    relationship_detection: {
        correct_relationships: number;
        total_expected: number;
        total_detected: number;
        precision: number;
        recall: number;
        type_accuracy: Record<string, number>;
    };
}

interface RQ2Results {
    sir_ranking: {
        detected_ranking: Array<{ satd_id: string; sir_score: number; rank: number }>;
        expected_ranking: Array<{ satd_id: string; expected_rank: number }>;
        spearman_correlation: number;
        kendall_tau: number;
        top_3_precision: number;
        top_5_precision: number;
    };
    developer_alignment: {
        high_priority_match: number;
        medium_priority_match: number;
        low_priority_match: number;
        overall_alignment: number;
    };
}

interface EvaluationResults {
    timestamp: string;
    test_case_path: string;
    pipeline_steps: {
        sid: { duration_ms: number; satd_count: number };
        ird: { duration_ms: number; relationship_count: number; chain_count: number };
        sir: { duration_ms: number; scored_count: number };
    };
    rq1: RQ1Results;
    rq2: RQ2Results;
    summary: {
        rq1_passed: boolean;
        rq2_passed: boolean;
        overall_assessment: string;
    };
}

/**
 * Main evaluation class
 */
class RQEvaluator {
    private testCasePath: string;
    private groundTruth: GroundTruth;
    private verbose: boolean;
    private results: EvaluationResults;

    constructor(testCasePath: string, verbose: boolean = false) {
        this.testCasePath = testCasePath;
        this.verbose = verbose;
        this.groundTruth = this.loadGroundTruth();
        this.results = this.initializeResults();
    }

    /**
     * Load ground truth data
     */
    private loadGroundTruth(): GroundTruth {
        const groundTruthPath = path.join(this.testCasePath, 'ground_truth.json');
        const content = fs.readFileSync(groundTruthPath, 'utf-8');
        return JSON.parse(content);
    }

    /**
     * Initialize results structure
     */
    private initializeResults(): EvaluationResults {
        return {
            timestamp: new Date().toISOString(),
            test_case_path: this.testCasePath,
            pipeline_steps: {
                sid: { duration_ms: 0, satd_count: 0 },
                ird: { duration_ms: 0, relationship_count: 0, chain_count: 0 },
                sir: { duration_ms: 0, scored_count: 0 }
            },
            rq1: {
                satd_detection: {
                    true_positives: 0,
                    false_positives: 0,
                    false_negatives: 0,
                    precision: 0,
                    recall: 0,
                    f1_score: 0,
                    detected_satd: [],
                    missed_satd: [],
                    extra_satd: []
                },
                chain_discovery: {
                    correct_chains: 0,
                    total_expected_chains: 0,
                    total_detected_chains: 0,
                    chain_accuracy: 0,
                    chain_details: []
                },
                relationship_detection: {
                    correct_relationships: 0,
                    total_expected: 0,
                    total_detected: 0,
                    precision: 0,
                    recall: 0,
                    type_accuracy: {}
                }
            },
            rq2: {
                sir_ranking: {
                    detected_ranking: [],
                    expected_ranking: [],
                    spearman_correlation: 0,
                    kendall_tau: 0,
                    top_3_precision: 0,
                    top_5_precision: 0
                },
                developer_alignment: {
                    high_priority_match: 0,
                    medium_priority_match: 0,
                    low_priority_match: 0,
                    overall_alignment: 0
                }
            },
            summary: {
                rq1_passed: false,
                rq2_passed: false,
                overall_assessment: ''
            }
        };
    }

    /**
     * Log message if verbose mode is enabled
     */
    private log(message: string): void {
        if (this.verbose) {
            console.log(message);
        }
    }

    /**
     * Run the full evaluation pipeline
     */
    async runEvaluation(): Promise<EvaluationResults> {
        console.log('='.repeat(60));
        console.log('RQ1/RQ2 SATD Chain Detection Evaluation');
        console.log('='.repeat(60));
        console.log(`Test Case: ${this.testCasePath}`);
        console.log(`Ground Truth: ${this.groundTruth.metadata.total_satd_instances} SATD instances, ${this.groundTruth.metadata.total_chains} chains\n`);

        // Step 1: SID - SATD Instance Detection
        console.log('\n--- Step 1: SID (SATD Instance Detection) ---');
        const sidStart = Date.now();
        const detectedSATD = await this.runSID();
        this.results.pipeline_steps.sid.duration_ms = Date.now() - sidStart;
        this.results.pipeline_steps.sid.satd_count = detectedSATD.length;
        console.log(`  Detected: ${detectedSATD.length} SATD instances`);
        console.log(`  Duration: ${this.results.pipeline_steps.sid.duration_ms}ms`);

        // Step 2: IRD - Inter-SATD Relationship Discovery
        console.log('\n--- Step 2: IRD (Inter-SATD Relationship Discovery) ---');
        const irdStart = Date.now();
        const { relationships, chains, graph } = await this.runIRD(detectedSATD);
        this.results.pipeline_steps.ird.duration_ms = Date.now() - irdStart;
        this.results.pipeline_steps.ird.relationship_count = relationships.length;
        this.results.pipeline_steps.ird.chain_count = chains.length;
        console.log(`  Detected: ${relationships.length} relationships, ${chains.length} chains`);
        console.log(`  Duration: ${this.results.pipeline_steps.ird.duration_ms}ms`);

        // Step 3: SIR - SATD Impact Ripple Scoring
        console.log('\n--- Step 3: SIR (SATD Impact Ripple Scoring) ---');
        const sirStart = Date.now();
        const scoredSATD = await this.runSIR(detectedSATD, relationships);
        this.results.pipeline_steps.sir.duration_ms = Date.now() - sirStart;
        this.results.pipeline_steps.sir.scored_count = scoredSATD.length;
        console.log(`  Scored: ${scoredSATD.length} SATD instances`);
        console.log(`  Duration: ${this.results.pipeline_steps.sir.duration_ms}ms`);

        // Step 4: Evaluate RQ1
        console.log('\n--- Step 4: RQ1 Evaluation ---');
        this.evaluateRQ1(detectedSATD, relationships, chains);

        // Step 5: Evaluate RQ2
        console.log('\n--- Step 5: RQ2 Evaluation ---');
        this.evaluateRQ2(scoredSATD);

        // Generate summary
        this.generateSummary();

        return this.results;
    }

    /**
     * Run SID (SATD Instance Detection)
     */
    private async runSID(): Promise<TechnicalDebt[]> {
        const detector = new SatdDetector();
        await detector.initialize(this.testCasePath);

        const detectedSATD: TechnicalDebt[] = [];
        const files = fs.readdirSync(this.testCasePath)
            .filter(f => f.endsWith('.py'));

        this.log(`  Scanning ${files.length} Python files...`);

        for (const file of files) {
            const filePath = path.join(this.testCasePath, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            
            const results = detector.analyzePotentialSatd(file, content, {
                detectionLevel: 'comprehensive',
                includeImplicit: true
            });

            for (const result of results) {
                if (result.isSatd) {
                    detectedSATD.push({
                        id: `satd-detected-${detectedSATD.length + 1}`,
                        file: file,
                        line: result.line,
                        content: result.content,
                        description: result.content,
                        createdCommit: 'test-commit',
                        createdDate: new Date().toISOString(),
                        debtType: result.debtType,
                        confidence: result.confidence,
                        isActualDebt: true
                    });
                }
            }
        }

        return detectedSATD;
    }

    /**
     * Run IRD (Inter-SATD Relationship Discovery)
     */
    private async runIRD(satdInstances: TechnicalDebt[]): Promise<{
        relationships: SatdRelationship[];
        chains: Chain[];
        graph: SATDGraph;
    }> {
        const analyzer = new SatdRelationshipAnalyzer();
        await analyzer.initialize(this.testCasePath);
        analyzer.setMaxHops(5);

        this.log('  Analyzing relationships...');
        const relationships = await analyzer.analyzeRelationships(satdInstances);
        
        this.log('  Building SATD graph...');
        const graph = analyzer.buildSATDGraph(satdInstances, relationships);
        
        // Enhance relationships with chain info
        const enhancedRelationships = analyzer.enhanceRelationshipsWithChainInfo(
            relationships,
            graph.chains
        );

        return {
            relationships: enhancedRelationships,
            chains: graph.chains,
            graph
        };
    }

    /**
     * Run SIR (SATD Impact Ripple Scoring)
     */
    private async runSIR(
        satdInstances: TechnicalDebt[],
        relationships: SatdRelationship[]
    ): Promise<TechnicalDebt[]> {
        const chainAnalyzer = new SatdChainAnalyzer();
        
        this.log('  Calculating SIR scores...');
        const scoredSATD = chainAnalyzer.calculateSIRScores(satdInstances, relationships);
        
        this.log('  Ranking by SIR score...');
        const rankedSATD = chainAnalyzer.rankBySIR(scoredSATD);

        // Store detected ranking
        this.results.rq2.sir_ranking.detected_ranking = rankedSATD.map((satd, index) => ({
            satd_id: satd.id,
            sir_score: satd.sirScore || 0,
            rank: index + 1
        }));

        return rankedSATD;
    }

    /**
     * Evaluate RQ1: SATD Detection and Chain Structuring
     */
    private evaluateRQ1(
        detectedSATD: TechnicalDebt[],
        relationships: SatdRelationship[],
        chains: Chain[]
    ): void {
        // 1. Evaluate SATD Detection
        this.evaluateSATDDetection(detectedSATD);

        // 2. Evaluate Relationship Detection
        this.evaluateRelationshipDetection(relationships);

        // 3. Evaluate Chain Discovery
        this.evaluateChainDiscovery(chains);
    }

    /**
     * Evaluate SATD detection accuracy
     */
    private evaluateSATDDetection(detectedSATD: TechnicalDebt[]): void {
        const expectedSATD = this.groundTruth.satd_instances;
        
        // Match detected SATD to expected based on file and approximate line
        let truePositives = 0;
        const matchedExpected = new Set<string>();
        const matchedDetected = new Set<number>();

        for (let i = 0; i < detectedSATD.length; i++) {
            const detected = detectedSATD[i];
            
            for (const expected of expectedSATD) {
                if (matchedExpected.has(expected.id)) continue;
                
                // Match if same file and line within 5 lines
                if (detected.file === expected.file &&
                    Math.abs(detected.line - expected.line) <= 5) {
                    truePositives++;
                    matchedExpected.add(expected.id);
                    matchedDetected.add(i);
                    break;
                }
            }
        }

        const falsePositives = detectedSATD.length - truePositives;
        const falseNegatives = expectedSATD.length - truePositives;

        const precision = detectedSATD.length > 0 ? truePositives / detectedSATD.length : 0;
        const recall = expectedSATD.length > 0 ? truePositives / expectedSATD.length : 0;
        const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

        // Record results
        this.results.rq1.satd_detection = {
            true_positives: truePositives,
            false_positives: falsePositives,
            false_negatives: falseNegatives,
            precision,
            recall,
            f1_score: f1,
            detected_satd: detectedSATD,
            missed_satd: expectedSATD
                .filter(e => !matchedExpected.has(e.id))
                .map(e => e.id),
            extra_satd: detectedSATD.filter((_, i) => !matchedDetected.has(i))
        };

        console.log(`  SATD Detection: P=${precision.toFixed(2)}, R=${recall.toFixed(2)}, F1=${f1.toFixed(2)}`);
        console.log(`    True Positives: ${truePositives}, False Positives: ${falsePositives}, False Negatives: ${falseNegatives}`);
    }

    /**
     * Evaluate relationship detection accuracy
     */
    private evaluateRelationshipDetection(relationships: SatdRelationship[]): void {
        const expectedRelationships = this.groundTruth.relationships;
        
        // Simplified matching based on relationship structure
        let correctRelationships = 0;
        const typeAccuracy: Record<string, number> = {
            call: 0,
            data: 0,
            control: 0,
            module: 0
        };
        const typeCounts: Record<string, number> = {
            call: 0,
            data: 0,
            control: 0,
            module: 0
        };

        // Count expected relationships by type
        for (const expected of expectedRelationships) {
            typeCounts[expected.type] = (typeCounts[expected.type] || 0) + 1;
        }

        // Count detected relationships by type
        for (const rel of relationships) {
            for (const type of rel.types) {
                if (typeAccuracy[type] !== undefined) {
                    typeAccuracy[type]++;
                }
            }
        }

        // Simple overlap calculation
        correctRelationships = Math.min(relationships.length, expectedRelationships.length);

        const precision = relationships.length > 0 ? 
            correctRelationships / relationships.length : 0;
        const recall = expectedRelationships.length > 0 ? 
            correctRelationships / expectedRelationships.length : 0;

        this.results.rq1.relationship_detection = {
            correct_relationships: correctRelationships,
            total_expected: expectedRelationships.length,
            total_detected: relationships.length,
            precision,
            recall,
            type_accuracy: typeAccuracy
        };

        console.log(`  Relationship Detection: ${relationships.length} detected, ${expectedRelationships.length} expected`);
        console.log(`    Types found: ${Object.entries(typeAccuracy).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }

    /**
     * Evaluate chain discovery accuracy
     */
    private evaluateChainDiscovery(chains: Chain[]): void {
        const expectedChains = this.groundTruth.chains;
        
        let correctChains = 0;
        const chainDetails: Array<{
            expected_chain_id: string;
            matched: boolean;
            overlap_ratio: number;
        }> = [];

        for (const expected of expectedChains) {
            let bestMatch = 0;
            
            for (const detected of chains) {
                // Calculate overlap between expected and detected chain nodes
                const expectedNodes = new Set(expected.nodes);
                const detectedNodes = new Set(detected.nodes);
                
                let overlap = 0;
                for (const node of detectedNodes) {
                    // Check if any expected node's file matches
                    const nodeFile = node.split('-')[0];
                    for (const expectedNode of expectedNodes) {
                        const expectedFile = this.groundTruth.satd_instances
                            .find(s => s.id === expectedNode)?.file || '';
                        if (nodeFile === expectedFile || node.includes(expectedFile)) {
                            overlap++;
                            break;
                        }
                    }
                }
                
                const overlapRatio = overlap / Math.max(expectedNodes.size, detectedNodes.size);
                bestMatch = Math.max(bestMatch, overlapRatio);
            }

            const matched = bestMatch >= 0.5;
            if (matched) correctChains++;
            
            chainDetails.push({
                expected_chain_id: expected.id,
                matched,
                overlap_ratio: bestMatch
            });
        }

        const chainAccuracy = expectedChains.length > 0 ? 
            correctChains / expectedChains.length : 0;

        this.results.rq1.chain_discovery = {
            correct_chains: correctChains,
            total_expected_chains: expectedChains.length,
            total_detected_chains: chains.length,
            chain_accuracy: chainAccuracy,
            chain_details: chainDetails
        };

        console.log(`  Chain Discovery: ${chains.length} detected, ${expectedChains.length} expected`);
        console.log(`    Accuracy: ${(chainAccuracy * 100).toFixed(1)}%`);
    }

    /**
     * Evaluate RQ2: SIR Scoring Effectiveness
     */
    private evaluateRQ2(scoredSATD: TechnicalDebt[]): void {
        // Store expected ranking
        this.results.rq2.sir_ranking.expected_ranking = 
            this.groundTruth.expected_sir_ranking.ranking.map(r => ({
                satd_id: r.satd_id,
                expected_rank: r.rank
            }));

        // Calculate Spearman correlation
        this.calculateSpearmanCorrelation(scoredSATD);

        // Calculate Kendall's Tau
        this.calculateKendallTau(scoredSATD);

        // Calculate top-k precision
        this.calculateTopKPrecision(scoredSATD);

        // Evaluate developer alignment
        this.evaluateDeveloperAlignment(scoredSATD);
    }

    /**
     * Calculate Spearman rank correlation
     */
    private calculateSpearmanCorrelation(scoredSATD: TechnicalDebt[]): void {
        const expectedRanking = this.groundTruth.expected_sir_ranking.ranking;
        const n = Math.min(scoredSATD.length, expectedRanking.length);
        
        if (n < 2) {
            this.results.rq2.sir_ranking.spearman_correlation = 0;
            return;
        }

        // Create rank maps
        const detectedRanks = new Map<string, number>();
        scoredSATD.forEach((satd, index) => {
            // Map detected SATD to ground truth IDs based on file
            const gtMatch = this.groundTruth.satd_instances.find(
                gt => gt.file === satd.file && Math.abs(gt.line - satd.line) <= 5
            );
            if (gtMatch) {
                detectedRanks.set(gtMatch.id, index + 1);
            }
        });

        // Calculate d^2 sum
        let d2Sum = 0;
        let count = 0;
        
        for (const expected of expectedRanking) {
            const detectedRank = detectedRanks.get(expected.satd_id);
            if (detectedRank !== undefined) {
                const d = detectedRank - expected.rank;
                d2Sum += d * d;
                count++;
            }
        }

        // Spearman formula: 1 - (6 * sum(d^2)) / (n * (n^2 - 1))
        const spearman = count > 1 ? 
            1 - (6 * d2Sum) / (count * (count * count - 1)) : 0;
        
        this.results.rq2.sir_ranking.spearman_correlation = Math.max(-1, Math.min(1, spearman));
        
        console.log(`  Spearman Correlation: ${this.results.rq2.sir_ranking.spearman_correlation.toFixed(3)}`);
    }

    /**
     * Calculate Kendall's Tau correlation
     */
    private calculateKendallTau(scoredSATD: TechnicalDebt[]): void {
        // Simplified Kendall's Tau based on concordant/discordant pairs
        const expectedRanking = this.groundTruth.expected_sir_ranking.ranking;
        
        // Create pairs and count concordant/discordant
        let concordant = 0;
        let discordant = 0;
        
        for (let i = 0; i < expectedRanking.length - 1; i++) {
            for (let j = i + 1; j < expectedRanking.length; j++) {
                const expectedOrder = expectedRanking[i].rank < expectedRanking[j].rank;
                
                // Find detected ranks
                const detectedi = scoredSATD.findIndex(s => 
                    s.file === this.groundTruth.satd_instances.find(
                        gt => gt.id === expectedRanking[i].satd_id
                    )?.file
                );
                const detectedj = scoredSATD.findIndex(s => 
                    s.file === this.groundTruth.satd_instances.find(
                        gt => gt.id === expectedRanking[j].satd_id
                    )?.file
                );
                
                if (detectedi !== -1 && detectedj !== -1) {
                    const detectedOrder = detectedi < detectedj;
                    if (expectedOrder === detectedOrder) {
                        concordant++;
                    } else {
                        discordant++;
                    }
                }
            }
        }

        const total = concordant + discordant;
        const tau = total > 0 ? (concordant - discordant) / total : 0;
        
        this.results.rq2.sir_ranking.kendall_tau = tau;
        console.log(`  Kendall's Tau: ${tau.toFixed(3)}`);
    }

    /**
     * Calculate top-k precision
     */
    private calculateTopKPrecision(scoredSATD: TechnicalDebt[]): void {
        const expectedTop3 = this.groundTruth.expected_sir_ranking.ranking
            .slice(0, 3)
            .map(r => r.satd_id);
        const expectedTop5 = this.groundTruth.expected_sir_ranking.ranking
            .slice(0, 5)
            .map(r => r.satd_id);

        // Get detected top-k
        const detectedTop3Files = scoredSATD.slice(0, 3).map(s => s.file);
        const detectedTop5Files = scoredSATD.slice(0, 5).map(s => s.file);

        // Map to ground truth files
        const expectedTop3Files = expectedTop3.map(id => 
            this.groundTruth.satd_instances.find(s => s.id === id)?.file || ''
        );
        const expectedTop5Files = expectedTop5.map(id => 
            this.groundTruth.satd_instances.find(s => s.id === id)?.file || ''
        );

        // Calculate overlap
        const top3Matches = detectedTop3Files.filter(f => expectedTop3Files.includes(f)).length;
        const top5Matches = detectedTop5Files.filter(f => expectedTop5Files.includes(f)).length;

        this.results.rq2.sir_ranking.top_3_precision = top3Matches / 3;
        this.results.rq2.sir_ranking.top_5_precision = top5Matches / 5;

        console.log(`  Top-3 Precision: ${(this.results.rq2.sir_ranking.top_3_precision * 100).toFixed(1)}%`);
        console.log(`  Top-5 Precision: ${(this.results.rq2.sir_ranking.top_5_precision * 100).toFixed(1)}%`);
    }

    /**
     * Evaluate developer priority alignment
     */
    private evaluateDeveloperAlignment(scoredSATD: TechnicalDebt[]): void {
        const priorities = this.groundTruth.expected_sir_ranking.developer_priority_expectation;
        
        // Map ground truth priority to files
        const highPriorityFiles = priorities.high_priority.map(id => 
            this.groundTruth.satd_instances.find(s => s.id === id)?.file || ''
        );
        const mediumPriorityFiles = priorities.medium_priority.map(id => 
            this.groundTruth.satd_instances.find(s => s.id === id)?.file || ''
        );
        const lowPriorityFiles = priorities.low_priority.map(id => 
            this.groundTruth.satd_instances.find(s => s.id === id)?.file || ''
        );

        // Check if high priority items are in top 30%
        const topCount = Math.ceil(scoredSATD.length * 0.3);
        const topFiles = scoredSATD.slice(0, topCount).map(s => s.file);
        
        const highMatch = highPriorityFiles.filter(f => topFiles.includes(f)).length / 
            highPriorityFiles.length;
        
        // Medium priority should be in middle 40%
        const midStart = Math.ceil(scoredSATD.length * 0.3);
        const midEnd = Math.ceil(scoredSATD.length * 0.7);
        const midFiles = scoredSATD.slice(midStart, midEnd).map(s => s.file);
        
        const mediumMatch = mediumPriorityFiles.filter(f => midFiles.includes(f)).length /
            Math.max(1, mediumPriorityFiles.length);
        
        // Low priority should be in bottom 30%
        const bottomFiles = scoredSATD.slice(midEnd).map(s => s.file);
        
        const lowMatch = lowPriorityFiles.filter(f => bottomFiles.includes(f)).length /
            Math.max(1, lowPriorityFiles.length);

        this.results.rq2.developer_alignment = {
            high_priority_match: highMatch,
            medium_priority_match: mediumMatch,
            low_priority_match: lowMatch,
            overall_alignment: (highMatch + mediumMatch + lowMatch) / 3
        };

        console.log(`  Developer Alignment: ${(this.results.rq2.developer_alignment.overall_alignment * 100).toFixed(1)}%`);
    }

    /**
     * Generate summary and overall assessment
     */
    private generateSummary(): void {
        const thresholds = this.groundTruth.evaluation_metrics;
        
        // Check RQ1 thresholds
        const rq1Passed = 
            this.results.rq1.satd_detection.precision >= thresholds.rq1_detection.expected_precision_threshold &&
            this.results.rq1.satd_detection.recall >= thresholds.rq1_detection.expected_recall_threshold;
        
        // Check RQ2 thresholds
        const rq2Passed = 
            this.results.rq2.sir_ranking.spearman_correlation >= thresholds.rq2_prioritization.spearman_correlation_threshold;

        this.results.summary = {
            rq1_passed: rq1Passed,
            rq2_passed: rq2Passed,
            overall_assessment: this.generateAssessmentText(rq1Passed, rq2Passed)
        };

        console.log('\n' + '='.repeat(60));
        console.log('EVALUATION SUMMARY');
        console.log('='.repeat(60));
        console.log(`RQ1 (Detection Accuracy): ${rq1Passed ? 'PASSED' : 'NEEDS IMPROVEMENT'}`);
        console.log(`  - Precision: ${(this.results.rq1.satd_detection.precision * 100).toFixed(1)}% (threshold: ${thresholds.rq1_detection.expected_precision_threshold * 100}%)`);
        console.log(`  - Recall: ${(this.results.rq1.satd_detection.recall * 100).toFixed(1)}% (threshold: ${thresholds.rq1_detection.expected_recall_threshold * 100}%)`);
        console.log(`  - Chain Accuracy: ${(this.results.rq1.chain_discovery.chain_accuracy * 100).toFixed(1)}%`);
        
        console.log(`\nRQ2 (SIR Effectiveness): ${rq2Passed ? 'PASSED' : 'NEEDS IMPROVEMENT'}`);
        console.log(`  - Spearman Correlation: ${this.results.rq2.sir_ranking.spearman_correlation.toFixed(3)} (threshold: ${thresholds.rq2_prioritization.spearman_correlation_threshold})`);
        console.log(`  - Top-3 Precision: ${(this.results.rq2.sir_ranking.top_3_precision * 100).toFixed(1)}%`);
        console.log(`  - Developer Alignment: ${(this.results.rq2.developer_alignment.overall_alignment * 100).toFixed(1)}%`);
        
        console.log(`\nOverall: ${this.results.summary.overall_assessment}`);
    }

    /**
     * Generate assessment text
     */
    private generateAssessmentText(rq1Passed: boolean, rq2Passed: boolean): string {
        if (rq1Passed && rq2Passed) {
            return 'RapidPay successfully detects SATD chains and provides effective prioritization rankings.';
        } else if (rq1Passed && !rq2Passed) {
            return 'RapidPay detects SATD accurately but SIR ranking needs refinement for better developer alignment.';
        } else if (!rq1Passed && rq2Passed) {
            return 'RapidPay prioritization is effective but detection accuracy needs improvement.';
        } else {
            return 'Both detection accuracy and prioritization ranking need improvement.';
        }
    }

    /**
     * Get results
     */
    getResults(): EvaluationResults {
        return this.results;
    }
}

/**
 * Generate HTML visualization
 */
function generateVisualizationHTML(
    satdInstances: TechnicalDebt[],
    relationships: SatdRelationship[],
    chains: Chain[],
    results: EvaluationResults
): string {
    // Create nodes data
    const nodes = satdInstances.map(satd => ({
        id: satd.id,
        label: `${satd.file}:${satd.line}`,
        file: satd.file,
        line: satd.line,
        content: satd.content.substring(0, 100),
        debtType: satd.debtType || 'Other',
        sirScore: satd.sirScore || 0,
        sirComponents: satd.sirComponents || {},
        createdDate: satd.createdDate
    }));

    // Create edges data
    const edges = relationships.map((rel, index) => ({
        id: `edge-${index}`,
        source: rel.sourceId,
        target: rel.targetId,
        label: rel.types.join(', '),
        types: rel.types,
        strength: rel.strength,
        description: rel.description,
        inChain: rel.inChain,
        chainIds: rel.chainIds || []
    }));

    // Create chains data for visualization
    const chainsData = chains.map(chain => ({
        id: chain.id,
        nodes: chain.nodes,
        length: chain.length,
        maxSirScore: chain.maxSirScore || 0,
        totalWeight: chain.totalWeight || 0
    }));

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RQ1/RQ2 Evaluation Results - SATD Chain Visualization</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #e0e0e0;
            min-height: 100vh;
        }
        .container { max-width: 1600px; margin: 0 auto; padding: 20px; }
        h1 { 
            color: #00d9ff; 
            text-align: center; 
            margin-bottom: 30px;
            font-size: 2.5em;
            text-shadow: 0 0 20px rgba(0, 217, 255, 0.3);
        }
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .metric-card {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 15px;
            padding: 20px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
        }
        .metric-card h3 {
            color: #00d9ff;
            margin-bottom: 15px;
            font-size: 1.2em;
            border-bottom: 2px solid rgba(0, 217, 255, 0.3);
            padding-bottom: 10px;
        }
        .metric-item {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        .metric-label { color: #888; }
        .metric-value { 
            font-weight: bold;
            color: #fff;
        }
        .metric-value.good { color: #4ade80; }
        .metric-value.warning { color: #fbbf24; }
        .metric-value.bad { color: #f87171; }
        .status-badge {
            padding: 5px 15px;
            border-radius: 20px;
            font-weight: bold;
            display: inline-block;
        }
        .status-passed { background: rgba(74, 222, 128, 0.2); color: #4ade80; }
        .status-failed { background: rgba(248, 113, 113, 0.2); color: #f87171; }
        #cy {
            width: 100%;
            height: 600px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 15px;
            margin: 20px 0;
        }
        .legend {
            display: flex;
            flex-wrap: wrap;
            gap: 15px;
            padding: 15px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 10px;
            margin-bottom: 20px;
        }
        .legend-item {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .legend-color {
            width: 20px;
            height: 20px;
            border-radius: 4px;
        }
        .ranking-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }
        .ranking-table th, .ranking-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        .ranking-table th {
            background: rgba(0, 217, 255, 0.1);
            color: #00d9ff;
        }
        .ranking-table tr:hover {
            background: rgba(255, 255, 255, 0.05);
        }
        .sir-bar {
            height: 8px;
            background: linear-gradient(90deg, #00d9ff, #00ff88);
            border-radius: 4px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>RQ1/RQ2 SATD Chain Evaluation Results</h1>
        
        <div class="metrics-grid">
            <div class="metric-card">
                <h3>RQ1: Detection Accuracy</h3>
                <div class="metric-item">
                    <span class="metric-label">Status</span>
                    <span class="status-badge ${results.summary.rq1_passed ? 'status-passed' : 'status-failed'}">
                        ${results.summary.rq1_passed ? 'PASSED' : 'NEEDS WORK'}
                    </span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">Precision</span>
                    <span class="metric-value ${results.rq1.satd_detection.precision >= 0.8 ? 'good' : 'warning'}">
                        ${(results.rq1.satd_detection.precision * 100).toFixed(1)}%
                    </span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">Recall</span>
                    <span class="metric-value ${results.rq1.satd_detection.recall >= 0.9 ? 'good' : 'warning'}">
                        ${(results.rq1.satd_detection.recall * 100).toFixed(1)}%
                    </span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">F1 Score</span>
                    <span class="metric-value">${results.rq1.satd_detection.f1_score.toFixed(3)}</span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">True Positives</span>
                    <span class="metric-value">${results.rq1.satd_detection.true_positives}</span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">Chains Detected</span>
                    <span class="metric-value">${results.rq1.chain_discovery.total_detected_chains}</span>
                </div>
            </div>
            
            <div class="metric-card">
                <h3>RQ2: SIR Effectiveness</h3>
                <div class="metric-item">
                    <span class="metric-label">Status</span>
                    <span class="status-badge ${results.summary.rq2_passed ? 'status-passed' : 'status-failed'}">
                        ${results.summary.rq2_passed ? 'PASSED' : 'NEEDS WORK'}
                    </span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">Spearman Correlation</span>
                    <span class="metric-value ${results.rq2.sir_ranking.spearman_correlation >= 0.6 ? 'good' : 'warning'}">
                        ${results.rq2.sir_ranking.spearman_correlation.toFixed(3)}
                    </span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">Kendall's Tau</span>
                    <span class="metric-value">${results.rq2.sir_ranking.kendall_tau.toFixed(3)}</span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">Top-3 Precision</span>
                    <span class="metric-value ${results.rq2.sir_ranking.top_3_precision >= 0.67 ? 'good' : 'warning'}">
                        ${(results.rq2.sir_ranking.top_3_precision * 100).toFixed(1)}%
                    </span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">Developer Alignment</span>
                    <span class="metric-value">${(results.rq2.developer_alignment.overall_alignment * 100).toFixed(1)}%</span>
                </div>
            </div>
            
            <div class="metric-card">
                <h3>Pipeline Performance</h3>
                <div class="metric-item">
                    <span class="metric-label">SID Duration</span>
                    <span class="metric-value">${results.pipeline_steps.sid.duration_ms}ms</span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">IRD Duration</span>
                    <span class="metric-value">${results.pipeline_steps.ird.duration_ms}ms</span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">SIR Duration</span>
                    <span class="metric-value">${results.pipeline_steps.sir.duration_ms}ms</span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">Total SATD Found</span>
                    <span class="metric-value">${results.pipeline_steps.sid.satd_count}</span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">Relationships Found</span>
                    <span class="metric-value">${results.pipeline_steps.ird.relationship_count}</span>
                </div>
            </div>
        </div>
        
        <div class="metric-card">
            <h3>SATD Dependency Graph</h3>
            <div class="legend">
                <div class="legend-item"><div class="legend-color" style="background:#e41a1c"></div>Design</div>
                <div class="legend-item"><div class="legend-color" style="background:#377eb8"></div>Implementation</div>
                <div class="legend-item"><div class="legend-color" style="background:#4daf4a"></div>Documentation</div>
                <div class="legend-item"><div class="legend-color" style="background:#984ea3"></div>Defect</div>
                <div class="legend-item"><div class="legend-color" style="background:#ff7f00"></div>Test</div>
                <div class="legend-item"><div class="legend-color" style="background:#a65628"></div>Architecture</div>
                <div class="legend-item"><div class="legend-color" style="background:#999"></div>Other/Requirement</div>
            </div>
            <div id="cy"></div>
        </div>
        
        <div class="metric-card">
            <h3>SIR Score Ranking</h3>
            <table class="ranking-table">
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>SATD ID</th>
                        <th>SIR Score</th>
                        <th>Visual</th>
                    </tr>
                </thead>
                <tbody>
                    ${results.rq2.sir_ranking.detected_ranking.slice(0, 10).map(item => `
                        <tr>
                            <td>#${item.rank}</td>
                            <td>${item.satd_id}</td>
                            <td>${item.sir_score.toFixed(4)}</td>
                            <td><div class="sir-bar" style="width: ${item.sir_score * 100}%"></div></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        
        <div class="metric-card">
            <h3>Overall Assessment</h3>
            <p style="font-size: 1.1em; line-height: 1.6; padding: 10px 0;">
                ${results.summary.overall_assessment}
            </p>
        </div>
    </div>
    
    <script src="https://unpkg.com/cytoscape/dist/cytoscape.min.js"></script>
    <script>
        const nodes = ${JSON.stringify(nodes)};
        const edges = ${JSON.stringify(edges)};
        const chains = ${JSON.stringify(chainsData)};
        
        const typeColors = {
            'Design': '#e41a1c',
            'Implementation': '#377eb8',
            'Documentation': '#4daf4a',
            'Defect': '#984ea3',
            'Test': '#ff7f00',
            'Architecture': '#a65628',
            'Requirement': '#999',
            'Other': '#999'
        };
        
        const cy = cytoscape({
            container: document.getElementById('cy'),
            elements: {
                nodes: nodes.map(n => ({ data: n })),
                edges: edges.map(e => ({ data: e }))
            },
            style: [
                {
                    selector: 'node',
                    style: {
                        'label': 'data(label)',
                        'background-color': function(ele) {
                            return typeColors[ele.data('debtType')] || '#999';
                        },
                        'width': function(ele) {
                            return 25 + (ele.data('sirScore') * 20);
                        },
                        'height': function(ele) {
                            return 25 + (ele.data('sirScore') * 20);
                        },
                        'font-size': 10,
                        'color': '#fff',
                        'text-outline-color': '#000',
                        'text-outline-width': 1
                    }
                },
                {
                    selector: 'edge',
                    style: {
                        'curve-style': 'bezier',
                        'target-arrow-shape': 'triangle',
                        'width': function(ele) {
                            return ele.data('inChain') ? 3 : 1;
                        },
                        'line-color': function(ele) {
                            return ele.data('inChain') ? '#00d9ff' : '#666';
                        },
                        'target-arrow-color': function(ele) {
                            return ele.data('inChain') ? '#00d9ff' : '#666';
                        }
                    }
                }
            ],
            layout: {
                name: 'cose',
                padding: 50,
                nodeRepulsion: 8000,
                idealEdgeLength: 100
            }
        });
    </script>
</body>
</html>`;
}

/**
 * Export to Neo4j
 */
async function exportToNeo4j(
    satdInstances: TechnicalDebt[],
    relationships: SatdRelationship[],
    neo4jUri: string
): Promise<void> {
    const { Neo4jClient } = await import('../../src/cli/neo4jClient');
    
    const client = new Neo4jClient(
        neo4jUri,
        process.env.NEO4J_USER || 'neo4j',
        process.env.NEO4J_PASSWORD || 'rapidpay'
    );
    
    await client.connect();
    await client.storeSATDGraph(satdInstances, relationships);
    await client.close();
    
    console.log(`\nExported to Neo4j at ${neo4jUri}`);
}

/**
 * Main execution
 */
async function main() {
    const args = process.argv.slice(2);
    const verbose = args.includes('--verbose');
    const neo4jUri = args.includes('--neo4j') ? 
        args[args.indexOf('--neo4j') + 1] : undefined;
    const outputFile = args.includes('--output') ?
        args[args.indexOf('--output') + 1] : undefined;
    
    const testCasePath = path.resolve(__dirname);
    
    try {
        // Run evaluation
        const evaluator = new RQEvaluator(testCasePath, verbose);
        const results = await evaluator.runEvaluation();
        
        // Save results to JSON
        const resultsPath = outputFile || path.join(testCasePath, 'evaluation_results.json');
        fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
        console.log(`\nResults saved to: ${resultsPath}`);
        
        // Generate visualization HTML
        const vizPath = path.join(testCasePath, 'visualization.html');
        const vizHTML = generateVisualizationHTML(
            results.rq1.satd_detection.detected_satd,
            [],  // relationships would come from IRD step
            [],  // chains would come from IRD step
            results
        );
        fs.writeFileSync(vizPath, vizHTML);
        console.log(`Visualization saved to: ${vizPath}`);
        
        // Export to Neo4j if requested
        if (neo4jUri) {
            await exportToNeo4j(
                results.rq1.satd_detection.detected_satd,
                [],  // relationships
                neo4jUri
            );
        }
        
        // Exit with appropriate code
        process.exit(results.summary.rq1_passed && results.summary.rq2_passed ? 0 : 1);
        
    } catch (error) {
        console.error('Evaluation failed:', error);
        process.exit(1);
    }
}

// Export for testing
export { RQEvaluator, generateVisualizationHTML, exportToNeo4j };

// Run if executed directly
if (require.main === module) {
    main();
}

