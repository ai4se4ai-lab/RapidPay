#!/usr/bin/env ts-node
/**
 * Commit Scenario Simulation Runner
 * 
 * This script simulates developer commits and demonstrates SATD chain detection.
 * It runs the RapidPay pipeline on before/after states and compares results.
 * 
 * Usage:
 *   npx ts-node Test/CommitScenarios/run_commit_scenario.ts --scenario 1
 *   npx ts-node Test/CommitScenarios/run_commit_scenario.ts --all
 *   npx ts-node Test/CommitScenarios/run_commit_scenario.ts --scenario 2 --verbose
 */

import * as path from 'path';
import * as fs from 'fs';

// Import RapidPay components
import { TechnicalDebt, SatdRelationship, Chain, SATDGraph } from '../../src/models';
import { SatdRelationshipAnalyzer } from '../../src/satdRelationshipAnalyzer';
import { SatdChainAnalyzer } from '../../src/satdChainAnalyzer';
import { SatdDetector } from '../../src/satdDetector';

// Types
interface GroundTruth {
    metadata: {
        scenario_id: string;
        scenario_name: string;
        description: string;
        commit_message: string;
        before_satd_count: number;
        after_satd_count: number;
        before_chain_count: number;
        after_chain_count: number;
    };
    before_state: {
        files: string[];
        satd_instances: any[];
        chains: any[];
    };
    after_state: {
        files: string[];
        satd_instances: any[];
        relationships: any[];
        chains: any[];
    };
    commit_analysis: any;
}

interface ScenarioResult {
    scenario_id: string;
    scenario_name: string;
    timestamp: string;
    before_analysis: {
        satd_count: number;
        chain_count: number;
        satd_items: TechnicalDebt[];
        chains: Chain[];
        duration_ms: number;
    };
    after_analysis: {
        satd_count: number;
        chain_count: number;
        relationship_count: number;
        satd_items: TechnicalDebt[];
        relationships: SatdRelationship[];
        chains: Chain[];
        duration_ms: number;
    };
    delta: {
        new_satd_count: number;
        chain_growth: number;
        new_relationships: number;
        sir_score_changes: Array<{
            satd_id: string;
            before_sir: number;
            after_sir: number;
            change: number;
        }>;
    };
    ground_truth_comparison: {
        expected_satd: number;
        detected_satd: number;
        accuracy: number;
        expected_chains: number;
        detected_chains: number;
    };
}

interface AllScenariosResult {
    timestamp: string;
    scenarios: ScenarioResult[];
    summary: {
        total_scenarios: number;
        avg_detection_accuracy: number;
        total_satd_detected: number;
        total_chains_detected: number;
    };
}

/**
 * Scenario Runner Class
 */
class CommitScenarioRunner {
    private scenariosPath: string;
    private verbose: boolean;
    private detector: SatdDetector;
    private relationshipAnalyzer: SatdRelationshipAnalyzer;
    private chainAnalyzer: SatdChainAnalyzer;

    constructor(verbose: boolean = false) {
        this.scenariosPath = path.resolve(__dirname);
        this.verbose = verbose;
        this.detector = new SatdDetector();
        this.relationshipAnalyzer = new SatdRelationshipAnalyzer();
        this.chainAnalyzer = new SatdChainAnalyzer();
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
     * Get list of available scenarios
     */
    public getAvailableScenarios(): string[] {
        const entries = fs.readdirSync(this.scenariosPath, { withFileTypes: true });
        return entries
            .filter(e => e.isDirectory() && e.name.startsWith('scenario'))
            .map(e => e.name)
            .sort();
    }

    /**
     * Load ground truth for a scenario
     */
    private loadGroundTruth(scenarioId: string): GroundTruth {
        const groundTruthPath = path.join(this.scenariosPath, scenarioId, 'ground_truth.json');
        const content = fs.readFileSync(groundTruthPath, 'utf-8');
        return JSON.parse(content);
    }

    /**
     * Run SATD detection on a directory
     */
    private async runDetection(dirPath: string): Promise<{
        satd: TechnicalDebt[];
        relationships: SatdRelationship[];
        chains: Chain[];
        duration_ms: number;
    }> {
        const startTime = Date.now();
        
        // Check if directory exists
        if (!fs.existsSync(dirPath)) {
            return {
                satd: [],
                relationships: [],
                chains: [],
                duration_ms: 0
            };
        }

        // Initialize detector
        await this.detector.initialize(dirPath);
        
        // Detect SATD instances
        const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.py'));
        const satdItems: TechnicalDebt[] = [];
        
        this.log(`  Scanning ${files.length} Python files...`);
        
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            
            const results = this.detector.analyzePotentialSatd(file, content, {
                detectionLevel: 'comprehensive',
                includeImplicit: true
            });
            
            for (const result of results) {
                if (result.isSatd) {
                    satdItems.push({
                        id: `satd-${file}-${result.line}`,
                        file: file,
                        line: result.line,
                        content: result.content,
                        description: result.content,
                        createdCommit: 'simulated-commit',
                        createdDate: new Date().toISOString(),
                        debtType: result.debtType,
                        confidence: result.confidence,
                        isActualDebt: true
                    });
                }
            }
        }
        
        this.log(`  Detected ${satdItems.length} SATD instances`);
        
        // Analyze relationships if we have SATD items
        let relationships: SatdRelationship[] = [];
        let chains: Chain[] = [];
        
        if (satdItems.length > 1) {
            await this.relationshipAnalyzer.initialize(dirPath);
            this.relationshipAnalyzer.setMaxHops(5);
            
            relationships = await this.relationshipAnalyzer.analyzeRelationships(satdItems);
            this.log(`  Found ${relationships.length} relationships`);
            
            // Find chains
            const chainResult = this.chainAnalyzer.findChains(satdItems, relationships);
            chains = chainResult.chains;
            this.log(`  Discovered ${chains.length} chains`);
            
            // Calculate SIR scores
            const scoredSatd = this.chainAnalyzer.calculateSIRScores(satdItems, relationships);
            
            // Update satdItems with scores
            for (const scored of scoredSatd) {
                const item = satdItems.find(s => s.id === scored.id);
                if (item) {
                    item.sirScore = scored.sirScore;
                    item.sirComponents = scored.sirComponents;
                }
            }
        }
        
        const duration = Date.now() - startTime;
        
        return {
            satd: satdItems,
            relationships,
            chains,
            duration_ms: duration
        };
    }

    /**
     * Run a single scenario
     */
    public async runScenario(scenarioId: string): Promise<ScenarioResult> {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Running Scenario: ${scenarioId}`);
        console.log('='.repeat(60));
        
        const groundTruth = this.loadGroundTruth(scenarioId);
        console.log(`\n${groundTruth.metadata.scenario_name}`);
        console.log(`Description: ${groundTruth.metadata.description}`);
        console.log(`Simulated Commit: "${groundTruth.metadata.commit_message}"\n`);
        
        // Analyze BEFORE state
        console.log('--- Analyzing BEFORE state ---');
        const beforePath = path.join(this.scenariosPath, scenarioId, 'before');
        const beforeResult = await this.runDetection(beforePath);
        console.log(`  SATD instances: ${beforeResult.satd.length}`);
        console.log(`  Chains: ${beforeResult.chains.length}`);
        console.log(`  Duration: ${beforeResult.duration_ms}ms`);
        
        // Analyze AFTER state (simulating the commit)
        console.log('\n--- Simulating COMMIT ---');
        console.log(`  Added files: ${groundTruth.commit_analysis?.files_added?.join(', ') || 'N/A'}`);
        console.log(`  Modified files: ${groundTruth.commit_analysis?.files_modified?.join(', ') || 'N/A'}`);
        
        console.log('\n--- Analyzing AFTER state ---');
        const afterPath = path.join(this.scenariosPath, scenarioId, 'after');
        const afterResult = await this.runDetection(afterPath);
        console.log(`  SATD instances: ${afterResult.satd.length}`);
        console.log(`  Relationships: ${afterResult.relationships.length}`);
        console.log(`  Chains: ${afterResult.chains.length}`);
        console.log(`  Duration: ${afterResult.duration_ms}ms`);
        
        // Calculate delta
        const newSatdCount = afterResult.satd.length - beforeResult.satd.length;
        const chainGrowth = afterResult.chains.length - beforeResult.chains.length;
        
        // Calculate SIR score changes
        const sirChanges: Array<{
            satd_id: string;
            before_sir: number;
            after_sir: number;
            change: number;
        }> = [];
        
        for (const afterSatd of afterResult.satd) {
            const beforeSatd = beforeResult.satd.find(b => 
                b.file === afterSatd.file && Math.abs(b.line - afterSatd.line) < 5
            );
            
            sirChanges.push({
                satd_id: afterSatd.id,
                before_sir: beforeSatd?.sirScore || 0,
                after_sir: afterSatd.sirScore || 0,
                change: (afterSatd.sirScore || 0) - (beforeSatd?.sirScore || 0)
            });
        }
        
        // Sort by SIR score
        sirChanges.sort((a, b) => b.after_sir - a.after_sir);
        
        // Compare with ground truth
        const expectedSatd = groundTruth.after_state.satd_instances.length;
        const detectedSatd = afterResult.satd.length;
        const accuracy = Math.min(detectedSatd, expectedSatd) / Math.max(detectedSatd, expectedSatd);
        
        // Print summary
        console.log('\n--- COMMIT IMPACT SUMMARY ---');
        console.log(`  New SATD introduced: ${newSatdCount > 0 ? '+' + newSatdCount : newSatdCount}`);
        console.log(`  Chain count change: ${chainGrowth > 0 ? '+' + chainGrowth : chainGrowth}`);
        console.log(`  New relationships: ${afterResult.relationships.length}`);
        
        if (afterResult.chains.length > 0) {
            console.log('\n  Detected Chains:');
            for (const chain of afterResult.chains) {
                console.log(`    - ${chain.id}: ${chain.nodes.length} nodes, weight=${chain.totalWeight?.toFixed(2) || 'N/A'}`);
            }
        }
        
        console.log('\n  Top 5 SATD by SIR Score:');
        for (const item of sirChanges.slice(0, 5)) {
            const satd = afterResult.satd.find(s => s.id === item.satd_id);
            console.log(`    ${item.after_sir.toFixed(3)} | ${satd?.file}:${satd?.line}`);
        }
        
        console.log('\n--- GROUND TRUTH COMPARISON ---');
        console.log(`  Expected SATD: ${expectedSatd}, Detected: ${detectedSatd}`);
        console.log(`  Detection accuracy: ${(accuracy * 100).toFixed(1)}%`);
        console.log(`  Expected chains: ${groundTruth.after_state.chains.length}, Detected: ${afterResult.chains.length}`);
        
        const result: ScenarioResult = {
            scenario_id: scenarioId,
            scenario_name: groundTruth.metadata.scenario_name,
            timestamp: new Date().toISOString(),
            before_analysis: {
                satd_count: beforeResult.satd.length,
                chain_count: beforeResult.chains.length,
                satd_items: beforeResult.satd,
                chains: beforeResult.chains,
                duration_ms: beforeResult.duration_ms
            },
            after_analysis: {
                satd_count: afterResult.satd.length,
                chain_count: afterResult.chains.length,
                relationship_count: afterResult.relationships.length,
                satd_items: afterResult.satd,
                relationships: afterResult.relationships,
                chains: afterResult.chains,
                duration_ms: afterResult.duration_ms
            },
            delta: {
                new_satd_count: newSatdCount,
                chain_growth: chainGrowth,
                new_relationships: afterResult.relationships.length,
                sir_score_changes: sirChanges
            },
            ground_truth_comparison: {
                expected_satd: expectedSatd,
                detected_satd: detectedSatd,
                accuracy,
                expected_chains: groundTruth.after_state.chains.length,
                detected_chains: afterResult.chains.length
            }
        };
        
        return result;
    }

    /**
     * Run all scenarios
     */
    public async runAllScenarios(): Promise<AllScenariosResult> {
        const scenarios = this.getAvailableScenarios();
        console.log(`\nFound ${scenarios.length} scenarios to run\n`);
        
        const results: ScenarioResult[] = [];
        
        for (const scenarioId of scenarios) {
            try {
                const result = await this.runScenario(scenarioId);
                results.push(result);
            } catch (error) {
                console.error(`Error running ${scenarioId}:`, error);
            }
        }
        
        // Calculate summary
        const totalSatd = results.reduce((sum, r) => sum + r.after_analysis.satd_count, 0);
        const totalChains = results.reduce((sum, r) => sum + r.after_analysis.chain_count, 0);
        const avgAccuracy = results.reduce((sum, r) => sum + r.ground_truth_comparison.accuracy, 0) / results.length;
        
        console.log('\n' + '='.repeat(60));
        console.log('ALL SCENARIOS SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total scenarios: ${results.length}`);
        console.log(`Total SATD detected: ${totalSatd}`);
        console.log(`Total chains detected: ${totalChains}`);
        console.log(`Average detection accuracy: ${(avgAccuracy * 100).toFixed(1)}%`);
        
        return {
            timestamp: new Date().toISOString(),
            scenarios: results,
            summary: {
                total_scenarios: results.length,
                avg_detection_accuracy: avgAccuracy,
                total_satd_detected: totalSatd,
                total_chains_detected: totalChains
            }
        };
    }

    /**
     * Generate visualization data for web interface
     */
    public generateVisualizationData(results: AllScenariosResult): object {
        return {
            scenarios: results.scenarios.map(scenario => ({
                id: scenario.scenario_id,
                name: scenario.scenario_name,
                before: {
                    nodes: scenario.before_analysis.satd_items.map(satd => ({
                        id: satd.id,
                        label: `${satd.file}:${satd.line}`,
                        file: satd.file,
                        line: satd.line,
                        debtType: satd.debtType,
                        sirScore: satd.sirScore || 0,
                        content: satd.content?.substring(0, 100)
                    })),
                    edges: [],
                    chains: scenario.before_analysis.chains
                },
                after: {
                    nodes: scenario.after_analysis.satd_items.map(satd => ({
                        id: satd.id,
                        label: `${satd.file}:${satd.line}`,
                        file: satd.file,
                        line: satd.line,
                        debtType: satd.debtType,
                        sirScore: satd.sirScore || 0,
                        content: satd.content?.substring(0, 100)
                    })),
                    edges: scenario.after_analysis.relationships.map((rel, idx) => ({
                        id: `edge-${idx}`,
                        source: rel.sourceId,
                        target: rel.targetId,
                        types: rel.types,
                        strength: rel.strength,
                        inChain: rel.inChain
                    })),
                    chains: scenario.after_analysis.chains
                },
                delta: scenario.delta,
                metrics: {
                    accuracy: scenario.ground_truth_comparison.accuracy,
                    newSatd: scenario.delta.new_satd_count,
                    chainGrowth: scenario.delta.chain_growth
                }
            })),
            summary: results.summary,
            timestamp: results.timestamp
        };
    }
}

/**
 * Main execution
 */
async function main() {
    const args = process.argv.slice(2);
    const verbose = args.includes('--verbose');
    const runAll = args.includes('--all');
    
    let scenarioId: string | undefined;
    const scenarioIdx = args.indexOf('--scenario');
    if (scenarioIdx !== -1 && args[scenarioIdx + 1]) {
        scenarioId = `scenario${args[scenarioIdx + 1]}`;
    }
    
    const outputIdx = args.indexOf('--output');
    const outputFile = outputIdx !== -1 ? args[outputIdx + 1] : undefined;
    
    const runner = new CommitScenarioRunner(verbose);
    
    try {
        let results: AllScenariosResult;
        
        if (runAll) {
            results = await runner.runAllScenarios();
        } else if (scenarioId) {
            const scenarioResult = await runner.runScenario(scenarioId);
            results = {
                timestamp: new Date().toISOString(),
                scenarios: [scenarioResult],
                summary: {
                    total_scenarios: 1,
                    avg_detection_accuracy: scenarioResult.ground_truth_comparison.accuracy,
                    total_satd_detected: scenarioResult.after_analysis.satd_count,
                    total_chains_detected: scenarioResult.after_analysis.chain_count
                }
            };
        } else {
            console.log('Usage:');
            console.log('  npx ts-node run_commit_scenario.ts --scenario <number>');
            console.log('  npx ts-node run_commit_scenario.ts --all');
            console.log('');
            console.log('Available scenarios:');
            for (const s of runner.getAvailableScenarios()) {
                console.log(`  - ${s}`);
            }
            process.exit(0);
        }
        
        // Save results
        const resultsPath = outputFile || path.join(__dirname, 'scenario_results.json');
        fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
        console.log(`\nResults saved to: ${resultsPath}`);
        
        // Generate visualization data
        const vizData = runner.generateVisualizationData(results);
        const vizDataPath = path.join(__dirname, 'visualization_data.json');
        fs.writeFileSync(vizDataPath, JSON.stringify(vizData, null, 2));
        console.log(`Visualization data saved to: ${vizDataPath}`);
        
        console.log(`\nOpen commit_visualization.html in a browser to view results.`);
        
    } catch (error) {
        console.error('Error running scenarios:', error);
        process.exit(1);
    }
}

// Export for testing
export { CommitScenarioRunner };

// Run if executed directly
if (require.main === module) {
    main();
}

