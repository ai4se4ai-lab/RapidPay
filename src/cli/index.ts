#!/usr/bin/env node
// src/cli/index.ts
/**
 * RapidPay CLI - Command-line interface for SATD analysis
 * 
 * Usage:
 *   rapidpay sid [--repo <path>] [--threshold <0-1>]    # SATD Instance Detection
 *   rapidpay ird [--repo <path>] [--hops <1-5>]         # Inter-SATD Relationship Discovery
 *   rapidpay sir [--repo <path>]                        # SATD Impact Ripple scoring
 *   rapidpay caig [--repo <path>] [--commit <hash>]     # Commit-Aware Insight Generation
 *   rapidpay analyze [--repo <path>]                    # Full analysis pipeline
 *   rapidpay export [--format json|neo4j]               # Export results
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { 
    TechnicalDebt, 
    SatdRelationship, 
    Chain, 
    SATDGraph,
    DEFAULT_SATD_CONFIG 
} from '../models';
import { scanRepositoryCLI, lexicalFiltering, llmClassification, LEXICAL_PATTERNS } from '../utils/debtScanner';
import { SatdRelationshipAnalyzer } from '../satdRelationshipAnalyzer';
import { SatdChainAnalyzer } from '../satdChainAnalyzer';
import { initializeOpenAICLI } from '../utils/openaiClient';
import { Neo4jClient } from './neo4jClient';
import { EffortScorer } from '../utils/effortScorer';

const program = new Command();

program
    .name('rapidpay')
    .description('RapidPay - SATD Analysis Tool')
    .version('1.0.0');

/**
 * SID Command - SATD Instance Detection
 */
program
    .command('sid')
    .description('Perform SATD Instance Detection')
    .option('-r, --repo <path>', 'Repository path', process.cwd())
    .option('-t, --threshold <number>', 'LLM confidence threshold (0-1)', '0.7')
    .option('--quick', 'Quick scan using lexical patterns only (no LLM)')
    .option('-o, --output <file>', 'Output file (JSON)')
    .action(async (options) => {
        console.log('=== RapidPay SID: SATD Instance Detection ===\n');
        
        const repoPath = path.resolve(options.repo);
        const threshold = parseFloat(options.threshold);
        
        console.log(`Repository: ${repoPath}`);
        console.log(`Threshold: ${threshold}`);
        console.log(`Mode: ${options.quick ? 'Quick (lexical only)' : 'Full (lexical + LLM)'}\n`);
        
        try {
            let satdInstances: TechnicalDebt[];
            
            if (options.quick) {
                // Quick scan - lexical only
                const candidates = await lexicalFilteringCLI(repoPath);
                satdInstances = candidates.map((c, i) => ({
                    id: `satd-${i}`,
                    file: c.file,
                    line: c.line,
                    content: c.content,
                    description: c.content,
                    createdCommit: c.commitHash,
                    createdDate: c.commitDate,
                    confidence: undefined
                }));
            } else {
                // Full scan with LLM
                const apiKey = process.env.OPENAI_API_KEY;
                if (!apiKey) {
                    console.error('Error: OPENAI_API_KEY environment variable not set');
                    process.exit(1);
                }
                initializeOpenAICLI(apiKey);
                
                satdInstances = await scanRepositoryCLI(repoPath, { 
                    ...DEFAULT_SATD_CONFIG,
                    confidenceThreshold: threshold 
                });
            }
            
            console.log(`\nDetected ${satdInstances.length} SATD instances:\n`);
            
            for (const satd of satdInstances.slice(0, 20)) {
                console.log(`  [${satd.debtType || 'Unknown'}] ${satd.file}:${satd.line}`);
                console.log(`    ${satd.content.substring(0, 80)}${satd.content.length > 80 ? '...' : ''}`);
                if (satd.confidence !== undefined) {
                    console.log(`    Confidence: ${(satd.confidence * 100).toFixed(1)}%`);
                }
                console.log();
            }
            
            if (satdInstances.length > 20) {
                console.log(`  ... and ${satdInstances.length - 20} more\n`);
            }
            
            // Save output
            if (options.output) {
                fs.writeFileSync(options.output, JSON.stringify(satdInstances, null, 2));
                console.log(`Results saved to: ${options.output}`);
            }
            
        } catch (error) {
            console.error('SID Error:', error);
            process.exit(1);
        }
    });

/**
 * IRD Command - Inter-SATD Relationship Discovery
 */
program
    .command('ird')
    .description('Perform Inter-SATD Relationship Discovery')
    .option('-r, --repo <path>', 'Repository path', process.cwd())
    .option('-i, --input <file>', 'Input file with SATD instances (from SID)')
    .option('-k, --hops <number>', 'Maximum hop count (1-5)', '5')
    .option('-o, --output <file>', 'Output file (JSON)')
    .action(async (options) => {
        console.log('=== RapidPay IRD: Inter-SATD Relationship Discovery ===\n');
        
        const repoPath = path.resolve(options.repo);
        const maxHops = Math.min(5, Math.max(1, parseInt(options.hops, 10)));
        
        console.log(`Repository: ${repoPath}`);
        console.log(`Max hops: ${maxHops}\n`);
        
        try {
            // Load SATD instances
            let satdInstances: TechnicalDebt[];
            
            if (options.input) {
                const inputData = fs.readFileSync(options.input, 'utf-8');
                satdInstances = JSON.parse(inputData);
                console.log(`Loaded ${satdInstances.length} SATD instances from ${options.input}\n`);
            } else {
                // Run quick SID first
                console.log('Running quick SID first...\n');
                const candidates = await lexicalFilteringCLI(repoPath);
                satdInstances = candidates.map((c, i) => ({
                    id: `satd-${i}`,
                    file: c.file,
                    line: c.line,
                    content: c.content,
                    description: c.content,
                    createdCommit: c.commitHash,
                    createdDate: c.commitDate
                }));
                console.log(`Detected ${satdInstances.length} SATD instances\n`);
            }
            
            // Run IRD
            const analyzer = new SatdRelationshipAnalyzer();
            await analyzer.initialize(repoPath);
            analyzer.setMaxHops(maxHops);
            
            console.log('Analyzing relationships...\n');
            const relationships = await analyzer.analyzeRelationships(satdInstances);
            
            // Build graph
            const graph = analyzer.buildSATDGraph(satdInstances, relationships);
            
            console.log(`Found ${relationships.length} relationships`);
            console.log(`Discovered ${graph.chains.length} chains\n`);
            
            // Show sample relationships
            console.log('Sample relationships:');
            for (const rel of relationships.slice(0, 10)) {
                console.log(`  ${rel.sourceId} -> ${rel.targetId}`);
                console.log(`    Types: ${rel.types.join(', ')}`);
                console.log(`    Strength: ${rel.strength.toFixed(2)}`);
                console.log();
            }
            
            // Show chains
            console.log('Chains:');
            for (const chain of graph.chains) {
                console.log(`  ${chain.id}: ${chain.nodes.length} nodes`);
            }
            
            // Save output
            if (options.output) {
                const output = {
                    satdInstances,
                    relationships,
                    chains: graph.chains
                };
                fs.writeFileSync(options.output, JSON.stringify(output, null, 2));
                console.log(`\nResults saved to: ${options.output}`);
            }
            
        } catch (error) {
            console.error('IRD Error:', error);
            process.exit(1);
        }
    });

/**
 * SIR Command - SATD Impact Ripple Scoring
 */
program
    .command('sir')
    .description('Calculate SATD Impact Ripple scores')
    .option('-r, --repo <path>', 'Repository path', process.cwd())
    .option('-i, --input <file>', 'Input file with IRD results')
    .option('-a, --alpha <number>', 'Fanout weight', '0.4')
    .option('-b, --beta <number>', 'ChainLen weight', '0.3')
    .option('-g, --gamma <number>', 'Reachability weight', '0.3')
    .option('-o, --output <file>', 'Output file (JSON)')
    .action(async (options) => {
        console.log('=== RapidPay SIR: SATD Impact Ripple Scoring ===\n');
        
        const repoPath = path.resolve(options.repo);
        const alpha = parseFloat(options.alpha);
        const beta = parseFloat(options.beta);
        const gamma = parseFloat(options.gamma);
        
        console.log(`Repository: ${repoPath}`);
        console.log(`Weights: α=${alpha}, β=${beta}, γ=${gamma}\n`);
        
        try {
            let satdInstances: TechnicalDebt[];
            let relationships: SatdRelationship[];
            
            if (options.input) {
                const inputData = JSON.parse(fs.readFileSync(options.input, 'utf-8'));
                satdInstances = inputData.satdInstances;
                relationships = inputData.relationships;
            } else {
                // Run SID and IRD first
                console.log('Running SID and IRD first...\n');
                
                const candidates = await lexicalFilteringCLI(repoPath);
                satdInstances = candidates.map((c, i) => ({
                    id: `satd-${i}`,
                    file: c.file,
                    line: c.line,
                    content: c.content,
                    description: c.content,
                    createdCommit: c.commitHash,
                    createdDate: c.commitDate
                }));
                
                const analyzer = new SatdRelationshipAnalyzer();
                await analyzer.initialize(repoPath);
                relationships = await analyzer.analyzeRelationships(satdInstances);
            }
            
            // Calculate SIR scores
            const chainAnalyzer = new SatdChainAnalyzer();
            chainAnalyzer.setSirWeights(alpha, beta, gamma);
            
            const scoredDebts = chainAnalyzer.calculateSIRScores(satdInstances, relationships);
            const rankedDebts = chainAnalyzer.rankBySIR(scoredDebts);
            
            console.log('Top 20 SATD instances by SIR score:\n');
            
            for (const debt of rankedDebts.slice(0, 20)) {
                console.log(`  SIR: ${(debt.sirScore || 0).toFixed(3)} | ${debt.file}:${debt.line}`);
                console.log(`    ${debt.content.substring(0, 60)}${debt.content.length > 60 ? '...' : ''}`);
                if (debt.sirComponents) {
                    console.log(`    Components: F=${debt.sirComponents.fanout_w.toFixed(2)}, C=${debt.sirComponents.chainLen_w.toFixed(2)}, R=${debt.sirComponents.reachability_w.toFixed(2)}`);
                }
                console.log();
            }
            
            // Save output
            if (options.output) {
                fs.writeFileSync(options.output, JSON.stringify(rankedDebts, null, 2));
                console.log(`Results saved to: ${options.output}`);
            }
            
        } catch (error) {
            console.error('SIR Error:', error);
            process.exit(1);
        }
    });

/**
 * Full analysis pipeline
 */
program
    .command('analyze')
    .description('Run full RapidPay analysis pipeline')
    .option('-r, --repo <path>', 'Repository path', process.cwd())
    .option('-t, --threshold <number>', 'LLM confidence threshold', '0.7')
    .option('--quick', 'Quick mode (no LLM)')
    .option('-o, --output <file>', 'Output file (JSON)')
    .option('--neo4j <uri>', 'Export to Neo4j database')
    .action(async (options) => {
        console.log('=== RapidPay Full Analysis ===\n');
        
        const repoPath = path.resolve(options.repo);
        
        try {
            // Step 1: SID
            console.log('Step 1: SATD Instance Detection...');
            let satdInstances: TechnicalDebt[];
            
            if (options.quick) {
                const candidates = await lexicalFilteringCLI(repoPath);
                satdInstances = candidates.map((c, i) => ({
                    id: `satd-${i}`,
                    file: c.file,
                    line: c.line,
                    content: c.content,
                    description: c.content,
                    createdCommit: c.commitHash,
                    createdDate: c.commitDate
                }));
            } else {
                const apiKey = process.env.OPENAI_API_KEY;
                if (apiKey) {
                    initializeOpenAICLI(apiKey);
                }
                satdInstances = await scanRepositoryCLI(repoPath, {
                    ...DEFAULT_SATD_CONFIG,
                    confidenceThreshold: parseFloat(options.threshold)
                });
            }
            console.log(`  Found ${satdInstances.length} SATD instances\n`);
            
            // Step 2: IRD
            console.log('Step 2: Inter-SATD Relationship Discovery...');
            const analyzer = new SatdRelationshipAnalyzer();
            await analyzer.initialize(repoPath);
            const relationships = await analyzer.analyzeRelationships(satdInstances);
            const graph = analyzer.buildSATDGraph(satdInstances, relationships);
            console.log(`  Found ${relationships.length} relationships`);
            console.log(`  Discovered ${graph.chains.length} chains\n`);
            
            // Step 3: SIR
            console.log('Step 3: SATD Impact Ripple Scoring...');
            const chainAnalyzer = new SatdChainAnalyzer();
            const scoredDebts = chainAnalyzer.calculateSIRScores(satdInstances, relationships);
            const rankedDebts = chainAnalyzer.rankBySIR(scoredDebts);
            console.log(`  Scored and ranked ${rankedDebts.length} instances\n`);
            
            // Step 4: Effort Scoring
            console.log('Step 4: Historical Effort Scoring...');
            const effortScorer = new EffortScorer(repoPath);
            const debtsWithEffort = await effortScorer.calculateEffortScores(rankedDebts);
            console.log(`  Calculated effort scores\n`);
            
            // Summary
            console.log('=== Analysis Summary ===\n');
            console.log(`Total SATD instances: ${satdInstances.length}`);
            console.log(`Total relationships: ${relationships.length}`);
            console.log(`Total chains: ${graph.chains.length}`);
            console.log();
            
            // Top items
            console.log('Top 10 SATD instances by SIR score:');
            for (const debt of debtsWithEffort.slice(0, 10)) {
                console.log(`  [${(debt.sirScore || 0).toFixed(3)}] ${debt.file}:${debt.line} - ${debt.content.substring(0, 50)}...`);
            }
            
            // Save output
            const result = {
                timestamp: new Date().toISOString(),
                repository: repoPath,
                satdInstances: debtsWithEffort,
                relationships,
                chains: graph.chains,
                summary: {
                    totalInstances: satdInstances.length,
                    totalRelationships: relationships.length,
                    totalChains: graph.chains.length
                }
            };
            
            if (options.output) {
                fs.writeFileSync(options.output, JSON.stringify(result, null, 2));
                console.log(`\nResults saved to: ${options.output}`);
            }
            
            // Export to Neo4j if requested
            if (options.neo4j) {
                console.log('\nExporting to Neo4j...');
                const neo4jClient = new Neo4jClient(
                    options.neo4j,
                    process.env.NEO4J_USER || 'neo4j',
                    process.env.NEO4J_PASSWORD || 'rapidpay'
                );
                await neo4jClient.connect();
                await neo4jClient.storeSATDGraph(debtsWithEffort, relationships);
                await neo4jClient.close();
                console.log('Exported to Neo4j');
            }
            
        } catch (error) {
            console.error('Analysis Error:', error);
            process.exit(1);
        }
    });

/**
 * Export command
 */
program
    .command('export')
    .description('Export SATD analysis results')
    .option('-i, --input <file>', 'Input file with analysis results', 'rapidpay-results.json')
    .option('-f, --format <format>', 'Output format (json, csv, neo4j)', 'json')
    .option('--neo4j <uri>', 'Neo4j connection URI')
    .action(async (options) => {
        console.log('=== RapidPay Export ===\n');
        
        try {
            const inputData = JSON.parse(fs.readFileSync(options.input, 'utf-8'));
            
            if (options.format === 'neo4j' || options.neo4j) {
                const uri = options.neo4j || 'bolt://localhost:7687';
                const neo4jClient = new Neo4jClient(
                    uri,
                    process.env.NEO4J_USER || 'neo4j',
                    process.env.NEO4J_PASSWORD || 'rapidpay'
                );
                
                await neo4jClient.connect();
                await neo4jClient.storeSATDGraph(
                    inputData.satdInstances,
                    inputData.relationships
                );
                await neo4jClient.close();
                
                console.log(`Exported to Neo4j at ${uri}`);
            } else if (options.format === 'csv') {
                // Export as CSV
                const csv = convertToCSV(inputData.satdInstances);
                const outputFile = options.input.replace('.json', '.csv');
                fs.writeFileSync(outputFile, csv);
                console.log(`Exported to ${outputFile}`);
            } else {
                console.log('Data already in JSON format');
            }
            
        } catch (error) {
            console.error('Export Error:', error);
            process.exit(1);
        }
    });

// Helper: Convert to CSV
function convertToCSV(debts: TechnicalDebt[]): string {
    const headers = ['id', 'file', 'line', 'content', 'debtType', 'sirScore', 'confidence', 'createdDate'];
    const rows = debts.map(d => [
        d.id,
        d.file,
        d.line.toString(),
        `"${d.content.replace(/"/g, '""')}"`,
        d.debtType || '',
        (d.sirScore || 0).toFixed(3),
        d.confidence !== undefined ? (d.confidence * 100).toFixed(1) : '',
        d.createdDate
    ]);
    
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

// Helper: CLI lexical filtering
async function lexicalFilteringCLI(repoPath: string): Promise<Array<{
    file: string;
    line: number;
    content: string;
    context: string;
    commitHash: string;
    commitDate: string;
    matchedPattern: string;
}>> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execPromise = promisify(exec);
    
    const candidates: Array<{
        file: string;
        line: number;
        content: string;
        context: string;
        commitHash: string;
        commitDate: string;
        matchedPattern: string;
    }> = [];
    
    try {
        const grepPattern = LEXICAL_PATTERNS.slice(0, 20).join('|');
        
        const { stdout } = await execPromise(
            `git grep -n -E "\\b(${grepPattern})\\b" -- "*.py" "*.js" "*.ts" "*.tsx" "*.jsx" "*.java"`,
            { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }
        ).catch(() => ({ stdout: '' }));
        
        const lines = stdout.split('\n').filter((line: string) => line.trim() !== '');
        
        for (const line of lines) {
            const match = line.match(/^([^:]+):(\d+):(.*)$/);
            if (!match) continue;
            
            const [, file, lineNumber, content] = match;
            const lineNum = parseInt(lineNumber, 10);
            
            if (!file || !lineNum || !content) continue;
            
            try {
                const { stdout: blame } = await execPromise(
                    `git blame -L ${lineNum},${lineNum} --porcelain "${file}"`,
                    { cwd: repoPath }
                );
                
                const commitHash = blame.split('\n')[0].split(' ')[0];
                const { stdout: commitDate } = await execPromise(
                    `git show -s --format=%ci ${commitHash}`,
                    { cwd: repoPath }
                );
                
                candidates.push({
                    file,
                    line: lineNum,
                    content: content.trim(),
                    context: '',
                    commitHash,
                    commitDate: commitDate.trim(),
                    matchedPattern: 'TODO'
                });
            } catch {
                // Skip files that can't be blamed
            }
        }
    } catch (error) {
        console.error(`Lexical filtering error: ${error}`);
    }
    
    return candidates;
}

// Parse and run
program.parse();

