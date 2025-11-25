// src/extension.ts
import * as vscode from 'vscode';
import { 
    TechnicalDebt, 
    SatdRelationship,
    Chain,
    SATDGraph,
    DEFAULT_SATD_CONFIG,
    DEFAULT_SIR_WEIGHTS,
    DEFAULT_CAIG_WEIGHTS
} from './models';
import { initializeOpenAI, resetOpenAIClient } from './utils/openaiClient';
import { getRepositoryInfo, wasCommitMadeRecently, getWorkspaceRoot } from './utils/gitUtils';
import { 
    scanRepositoryForTechnicalDebt, 
    enhanceTechnicalDebtWithAI,
    detectSATDInstances
} from './utils/debtScanner';
import { showTechnicalDebtPanel, withProgressNotification } from './utils/uiUtils';
import { SatdChainAnalyzer } from './satdChainAnalyzer';
import { SatdRelationshipAnalyzer } from './satdRelationshipAnalyzer';
import { CommitMonitor, createCommitMonitor } from './utils/commitMonitor';
import { EffortScorer } from './utils/effortScorer';
import { registerVisualizationCommands } from './visualization/visualizationCommands';

// Global state
let technicalDebtItems: TechnicalDebt[] = [];
let relationships: SatdRelationship[] = [];
let chains: Chain[] = [];
let satdGraph: SATDGraph | null = null;
let commitMonitor: CommitMonitor | null = null;
let relationshipAnalyzer: SatdRelationshipAnalyzer | null = null;
let chainAnalyzer: SatdChainAnalyzer | null = null;

/**
 * Activate the RapidPay extension
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('RapidPay Extension is now active');
    console.log('Implementing: SID, IRD, SIR, and CAIG from the research paper');

    // Register visualization commands
    registerVisualizationCommands(context);

    // Initialize analyzers
    chainAnalyzer = new SatdChainAnalyzer();
    
    // Command: Initialize and scan repository (Full Pipeline)
    const initCommand = vscode.commands.registerCommand('RapidPay.init', async () => {
        if (!initializeOpenAI()) {
            return;
        }
        
        await withProgressNotification('RapidPay', async (progress) => {
            const config = vscode.workspace.getConfiguration('RapidPay');
            
            progress.report({ message: "Getting repository information..." });
            const repoInfo = await getRepositoryInfo();
            
            if (!repoInfo) {
                return;
            }
            
            const workspaceRoot = repoInfo.workspaceRoot || '';
            
            // Step 1: SID - SATD Instance Detection
            progress.report({ message: "Stage 1: SATD Instance Detection (SID)..." });
            const confidenceThreshold = config.get<number>('confidenceThreshold') || 0.7;
            
            // Use quick scan for initial detection
            const debtItems = await scanRepositoryForTechnicalDebt();
            
            progress.report({ message: `Found ${debtItems.length} potential SATD instances. Enhancing with LLM...` });
            technicalDebtItems = await enhanceTechnicalDebtWithAI(debtItems, confidenceThreshold);
            
            console.log(`SID: Detected ${technicalDebtItems.length} SATD instances`);
            
            // Step 2: IRD - Inter-SATD Relationship Discovery
            const relationshipAnalysisEnabled = config.get<boolean>('relationshipAnalysisEnabled', true);
            
            if (relationshipAnalysisEnabled && technicalDebtItems.length > 0) {
                progress.report({ message: "Stage 2: Inter-SATD Relationship Discovery (IRD)..." });
                
                relationshipAnalyzer = new SatdRelationshipAnalyzer();
                await relationshipAnalyzer.initialize(workspaceRoot);
                
                const maxHops = config.get<number>('maxDependencyHops') || 5;
                relationshipAnalyzer.setMaxHops(maxHops);
                
                relationships = await relationshipAnalyzer.analyzeRelationships(technicalDebtItems);
                
                // Build SATD graph
                satdGraph = relationshipAnalyzer.buildSATDGraph(technicalDebtItems, relationships);
                chains = satdGraph.chains;
                
                console.log(`IRD: Found ${relationships.length} relationships, ${chains.length} chains`);
                
                // Step 3: SIR - SATD Impact Ripple Scoring
                progress.report({ message: "Stage 3: SATD Impact Ripple (SIR) Scoring..." });
                
                const sirWeights = config.get<{ alpha: number; beta: number; gamma: number }>('sirWeights') 
                    || DEFAULT_SIR_WEIGHTS;
                
                chainAnalyzer!.setSirWeights(sirWeights.alpha, sirWeights.beta, sirWeights.gamma);
                
                // Find chains and calculate SIR
                const chainResult = chainAnalyzer!.findChains(technicalDebtItems, relationships);
                relationships = chainResult.relationships;
                chains = chainResult.chains;
                
                // Calculate SIR scores
                technicalDebtItems = chainAnalyzer!.calculateSIRScores(technicalDebtItems, relationships);
                
                // Rank by SIR
                technicalDebtItems = chainAnalyzer!.rankBySIR(technicalDebtItems);
                
                console.log(`SIR: Scored and ranked ${technicalDebtItems.length} instances`);
                
                // Step 4: Calculate Effort Scores
                progress.report({ message: "Calculating historical effort scores..." });
                
                const effortScorer = new EffortScorer(workspaceRoot);
                technicalDebtItems = await effortScorer.calculateEffortScores(technicalDebtItems);
                
                // Step 5: Initialize CAIG Commit Monitor
                progress.report({ message: "Stage 4: Initializing Commit-Aware Insight Generation (CAIG)..." });
                
                commitMonitor = new CommitMonitor(workspaceRoot);
                
                const caigWeights = config.get<{ eta1: number; eta2: number; eta3: number; eta4: number }>('caigWeights')
                    || DEFAULT_CAIG_WEIGHTS;
                
                commitMonitor.setWeights(caigWeights);
                
                const windowSize = config.get<number>('commitWindowSize') || 50;
                commitMonitor.setWindowSize(windowSize);
                
                // Start monitoring commits
                await commitMonitor.startMonitoring(
                    technicalDebtItems,
                    (rankedDebts) => {
                        // Handle new commit - show notification
                        if (rankedDebts.length > 0) {
                            const topDebt = rankedDebts[0];
                            vscode.window.showInformationMessage(
                                `CAIG: Found ${rankedDebts.length} relevant SATD opportunities. Top: ${topDebt.file}:${topDebt.line}`,
                                'View Details'
                            ).then(selection => {
                                if (selection === 'View Details') {
                                    showTechnicalDebtPanel(rankedDebts, context);
                                }
                            });
                        }
                    }
                );
                
                console.log('CAIG: Commit monitoring started');
            }
            
            // Show results
            vscode.window.showInformationMessage(
                `RapidPay Analysis Complete:\n` +
                `• ${technicalDebtItems.length} SATD instances detected\n` +
                `• ${relationships.length} relationships discovered\n` +
                `• ${chains.length} chains identified`,
                'View Details',
                'Visualize Relationships'
            ).then(selection => {
                if (selection === 'View Details') {
                    vscode.commands.executeCommand('RapidPay.viewTechnicalDebt');
                } else if (selection === 'Visualize Relationships') {
                    vscode.commands.executeCommand('RapidPay.visualizeRelationships');
                }
            });
        });
    });

    // Command: View technical debt items
    const viewTechnicalDebtCommand = vscode.commands.registerCommand('RapidPay.viewTechnicalDebt', async () => {
        if (technicalDebtItems.length === 0) {
            vscode.window.showInformationMessage('No technical debt items found. Run the initialization command first.');
            return;
        }
        
        showTechnicalDebtPanel(technicalDebtItems, context);
    });

    // Command: Check the latest commit for technical debt fixes
    const checkLatestCommitCommand = vscode.commands.registerCommand('RapidPay.checkLatestCommit', async () => {
        if (!initializeOpenAI()) {
            vscode.window.showErrorMessage('Failed to initialize OpenAI client. Check your API key.');
            return;
        }
        
        if (technicalDebtItems.length === 0) {
            const shouldScan = await vscode.window.showInformationMessage(
                'No technical debt items found. Would you like to scan the repository first?',
                'Yes', 'No'
            );
            
            if (shouldScan === 'Yes') {
                await vscode.commands.executeCommand('RapidPay.init');
            }
            return;
        }
        
        await withProgressNotification('RapidPay', async (progress) => {
            progress.report({ message: "Checking the latest commit for SATD opportunities..." });
            
            if (commitMonitor) {
                const workspaceRoot = getWorkspaceRoot();
                if (workspaceRoot) {
                    const { exec } = require('child_process');
                    const { promisify } = require('util');
                    const execPromise = promisify(exec);
                    
                    const { stdout } = await execPromise('git rev-parse HEAD', { cwd: workspaceRoot });
                    const commitHash = stdout.trim();
                    
                    await commitMonitor.checkCommitForTechnicalDebtFixes(technicalDebtItems, commitHash);
                }
            }
            
            progress.report({ message: "Finished checking the latest commit." });
        });
    });

    // Command: Calculate SIR Scores
    const calculateSIRCommand = vscode.commands.registerCommand('RapidPay.calculateSIR', async () => {
        if (technicalDebtItems.length === 0) {
            vscode.window.showInformationMessage('No technical debt items found. Run the initialization command first.');
            return;
        }
        
        await withProgressNotification('RapidPay', async (progress) => {
            progress.report({ message: "Calculating SATD Impact Ripple scores..." });
            
            const config = vscode.workspace.getConfiguration('RapidPay');
            const sirWeights = config.get<{ alpha: number; beta: number; gamma: number }>('sirWeights') 
                || DEFAULT_SIR_WEIGHTS;
            
            chainAnalyzer!.setSirWeights(sirWeights.alpha, sirWeights.beta, sirWeights.gamma);
            
            technicalDebtItems = chainAnalyzer!.calculateSIRScores(technicalDebtItems, relationships);
            technicalDebtItems = chainAnalyzer!.rankBySIR(technicalDebtItems);
            
            // Show top 5 by SIR
            const top5 = technicalDebtItems.slice(0, 5);
            let message = 'Top 5 SATD by Impact (SIR):\n';
            for (const debt of top5) {
                message += `• [${(debt.sirScore || 0).toFixed(2)}] ${debt.file}:${debt.line}\n`;
            }
            
            vscode.window.showInformationMessage(message, 'View All').then(selection => {
                if (selection === 'View All') {
                    showTechnicalDebtPanel(technicalDebtItems, context);
                }
            });
        });
    });

    // Command: Analyze current commit for SATD opportunities (CAIG)
    const analyzeCommitCommand = vscode.commands.registerCommand('RapidPay.analyzeCommit', async () => {
        if (!initializeOpenAI()) {
            vscode.window.showErrorMessage('Failed to initialize OpenAI client. Check your API key.');
            return;
        }
        
        if (technicalDebtItems.length === 0) {
            await vscode.commands.executeCommand('RapidPay.init');
            return;
        }
        
        await withProgressNotification('RapidPay', async (progress) => {
            progress.report({ message: "Running CAIG analysis on recent commit..." });
            
            const workspaceRoot = getWorkspaceRoot();
            if (!workspaceRoot || !commitMonitor) {
                vscode.window.showErrorMessage('Could not access repository');
                return;
            }
            
            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execPromise = promisify(exec);
            
            try {
                const { stdout: hashOutput } = await execPromise('git rev-parse HEAD', { cwd: workspaceRoot });
                const commitHash = hashOutput.trim();
                
                const { stdout: metaOutput } = await execPromise(
                    `git show -s --format="%H|%an|%ae|%at|%s" ${commitHash}`,
                    { cwd: workspaceRoot }
                );
                
                const [hash, author, authorEmail, timestamp, message] = metaOutput.trim().split('|');
                
                const { stdout: filesOutput } = await execPromise(
                    `git diff-tree --no-commit-id --name-only -r ${commitHash}`,
                    { cwd: workspaceRoot }
                );
                
                const modifiedFiles = filesOutput.trim().split('\n').filter((f: string) => f);
                
                const { stdout: diff } = await execPromise(
                    `git show ${commitHash} --format=""`,
                    { cwd: workspaceRoot, maxBuffer: 5 * 1024 * 1024 }
                ).catch(() => ({ stdout: '' }));
                
                const commitInfo = {
                    hash,
                    message,
                    author,
                    authorEmail,
                    timestamp: new Date(parseInt(timestamp, 10) * 1000),
                    modifiedFiles,
                    diff
                };
                
                progress.report({ message: "Analyzing commit relevance and fix potential..." });
                
                const rankedDebts = await commitMonitor.analyzeCommitRelevance(technicalDebtItems, commitInfo);
                
                if (rankedDebts.length > 0) {
                    vscode.window.showInformationMessage(
                        `CAIG found ${rankedDebts.length} SATD opportunities related to this commit.`,
                        'View Recommendations'
                    ).then(selection => {
                        if (selection === 'View Recommendations') {
                            showTechnicalDebtPanel(rankedDebts, context);
                        }
                    });
                } else {
                    vscode.window.showInformationMessage('No SATD opportunities found for this commit.');
                }
                
            } catch (error) {
                console.error('CAIG analysis error:', error);
                vscode.window.showErrorMessage('Failed to analyze commit');
            }
        });
    });

    // Event: Listen for Git post-commit events through file changes
    const gitEventListener = vscode.workspace.onDidSaveTextDocument(async (document) => {
        const fileName = document.fileName.toLowerCase();
        
        if (fileName.includes('.git')) {
            try {
                if (await wasCommitMadeRecently()) {
                    if (commitMonitor && technicalDebtItems.length > 0) {
                        vscode.commands.executeCommand('RapidPay.analyzeCommit');
                    }
                }
            } catch (error) {
                console.error('Error checking for recent commits:', error);
            }
        }
    });

    // Register all commands
    context.subscriptions.push(initCommand);
    context.subscriptions.push(viewTechnicalDebtCommand);
    context.subscriptions.push(checkLatestCommitCommand);
    context.subscriptions.push(calculateSIRCommand);
    context.subscriptions.push(analyzeCommitCommand);
    context.subscriptions.push(gitEventListener);
    
    // Check auto-scan setting
    const config = vscode.workspace.getConfiguration('RapidPay');
    const autoScan = config.get<boolean>('autoScanOnStartup');
    
    if (autoScan) {
        vscode.commands.executeCommand('RapidPay.init');
    }
}

/**
 * Deactivate the extension
 */
export function deactivate() {
    console.log('RapidPay Extension is deactivating');
    
    // Stop commit monitoring
    if (commitMonitor) {
        commitMonitor.stopMonitoring();
        commitMonitor = null;
    }
    
    // Reset OpenAI client
    resetOpenAIClient();
    
    // Clear global state
    technicalDebtItems = [];
    relationships = [];
    chains = [];
    satdGraph = null;
    relationshipAnalyzer = null;
    chainAnalyzer = null;
}

/**
 * Get current technical debt items (for other modules)
 */
export function getTechnicalDebtItems(): TechnicalDebt[] {
    return technicalDebtItems;
}

/**
 * Get current relationships (for visualization)
 */
export function getRelationships(): SatdRelationship[] {
    return relationships;
}

/**
 * Get current chains (for visualization)
 */
export function getChains(): Chain[] {
    return chains;
}

/**
 * Get the SATD graph (for advanced queries)
 */
export function getSATDGraph(): SATDGraph | null {
    return satdGraph;
}
