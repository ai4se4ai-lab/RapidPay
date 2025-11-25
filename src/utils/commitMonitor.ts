// src/utils/commitMonitor.ts
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { 
    TechnicalDebt, 
    CommitInfo, 
    DeveloperInterest,
    FixPotential,
    CAIGWeights,
    DEFAULT_CAIG_WEIGHTS,
    COMMIT_WINDOW_SIZE,
    FIX_POTENTIAL_VALUES,
    SATDGraph
} from '../models';
import { 
    assessFixPotential, 
    generateRemediationPlan, 
    summarizeChanges,
    analyzeDebtFix 
} from './openaiClient';
import { getLatestCommit, getWorkspaceRoot } from './gitUtils';
import { EffortScorer } from './effortScorer';

const execPromise = promisify(exec);

/**
 * CommitMonitor implements Algorithm 4: Commit-Aware Insight Generation (CAIG)
 * 
 * It monitors commits, detects relevant SATD instances, calculates developer interest,
 * and generates ranked recommendations with remediation plans.
 * 
 * Ranking formula: Rank(t_i) = η1·SIR(t_i) + η2·CommitRel(t_i) + η3·(1-S^t) + η4·f_i
 * Where (η1,η2,η3,η4) = (0.4, 0.3, 0.15, 0.15)
 */
export class CommitMonitor {
    private workspaceRoot: string;
    private lastKnownCommit: string | null = null;
    private isRunning: boolean = false;
    private intervalId: NodeJS.Timeout | null = null;
    private weights: CAIGWeights = DEFAULT_CAIG_WEIGHTS;
    
    // Sliding window of recent commits (W=50)
    private commitWindow: CommitInfo[] = [];
    private windowSize: number = COMMIT_WINDOW_SIZE;
    
    // Developer interest tracking
    private developerInterest: Map<string, DeveloperInterest> = new Map();
    
    // Effort scorer
    private effortScorer: EffortScorer;
    
    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.effortScorer = new EffortScorer(workspaceRoot);
    }
    
    /**
     * Set CAIG ranking weights
     */
    public setWeights(weights: Partial<CAIGWeights>): void {
        this.weights = { ...this.weights, ...weights };
    }
    
    /**
     * Set sliding window size
     */
    public setWindowSize(size: number): void {
        this.windowSize = size;
    }
    
    /**
     * Start monitoring for new commits
     * @param debtItems Technical debt items to monitor
     * @param onCommit Callback when a new commit is detected
     * @param checkInterval Interval in milliseconds to check for new commits (default: 30s)
     */
    public async startMonitoring(
        debtItems: TechnicalDebt[],
        onCommit?: (results: TechnicalDebt[]) => void,
        checkInterval: number = 30000
    ): Promise<void> {
        if (this.isRunning) {
            console.log('Commit monitor is already running');
            return;
        }
        
        this.isRunning = true;
        
        // Get initial commit
        const latestCommit = await getLatestCommit(this.workspaceRoot);
        this.lastKnownCommit = latestCommit;
        
        // Load commit window history
        await this.loadCommitWindow();
        
        // Build initial developer interest from commit history
        await this.buildDeveloperInterest();
        
        console.log(`CAIG: Started monitoring with window of ${this.commitWindow.length} commits`);
        
        // Start periodic checking
        this.intervalId = setInterval(async () => {
            await this.checkForNewCommits(debtItems, onCommit);
        }, checkInterval);
    }
    
    /**
     * Stop monitoring for commits
     */
    public stopMonitoring(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        console.log('CAIG: Stopped commit monitoring');
    }
    
    /**
     * Load sliding window of recent commits
     */
    private async loadCommitWindow(): Promise<void> {
        try {
            const { stdout } = await execPromise(
                `git log -${this.windowSize} --format="%H|%an|%ae|%at|%s" --name-only`,
                { cwd: this.workspaceRoot }
            );
            
            const commits: CommitInfo[] = [];
            const lines = stdout.split('\n');
            let currentCommit: CommitInfo | null = null;
            
            for (const line of lines) {
                if (line.includes('|')) {
                    // Commit header line
                    if (currentCommit) {
                        commits.push(currentCommit);
                    }
                    
                    const [hash, author, authorEmail, timestamp, message] = line.split('|');
                    currentCommit = {
                        hash,
                        author,
                        authorEmail,
                        timestamp: new Date(parseInt(timestamp, 10) * 1000),
                        message,
                        modifiedFiles: []
                    };
                } else if (line.trim() && currentCommit) {
                    // File path line
                    currentCommit.modifiedFiles.push(line.trim());
                }
            }
            
            if (currentCommit) {
                commits.push(currentCommit);
            }
            
            this.commitWindow = commits;
        } catch (error) {
            console.error('Failed to load commit window:', error);
        }
    }
    
    /**
     * Build developer interest from commit history
     */
    private async buildDeveloperInterest(): Promise<void> {
        for (const commit of this.commitWindow) {
            const devId = commit.authorEmail;
            
            if (!this.developerInterest.has(devId)) {
                this.developerInterest.set(devId, {
                    developerId: devId,
                    fileModifications: new Map(),
                    totalScore: 0
                });
            }
            
            const interest = this.developerInterest.get(devId)!;
            
            for (const file of commit.modifiedFiles) {
                const count = interest.fileModifications.get(file) || 0;
                interest.fileModifications.set(file, count + 1);
                interest.totalScore++;
            }
        }
    }
    
    /**
     * Check for new commits and analyze relevant SATD
     */
    private async checkForNewCommits(
        debtItems: TechnicalDebt[],
        onCommit?: (results: TechnicalDebt[]) => void
    ): Promise<void> {
        try {
            const latestCommit = await getLatestCommit(this.workspaceRoot);
            
            if (latestCommit && latestCommit !== this.lastKnownCommit) {
                console.log(`CAIG: New commit detected: ${latestCommit}`);
                
                // Get commit info
                const commitInfo = await this.getCommitInfo(latestCommit);
                
                if (commitInfo) {
                    // Update sliding window
                    this.commitWindow.unshift(commitInfo);
                    if (this.commitWindow.length > this.windowSize) {
                        this.commitWindow.pop();
                    }
                    
                    // Update developer interest
                    this.updateDeveloperInterest(commitInfo);
                    
                    // Analyze and rank SATD
                    const rankedDebts = await this.analyzeCommitRelevance(debtItems, commitInfo);
                    
                    if (onCommit && rankedDebts.length > 0) {
                        onCommit(rankedDebts);
                    }
                }
                
                this.lastKnownCommit = latestCommit;
            }
        } catch (error) {
            console.error('Error checking for new commits:', error);
        }
    }
    
    /**
     * Get detailed commit information
     */
    private async getCommitInfo(commitHash: string): Promise<CommitInfo | null> {
        try {
            // Get commit metadata
            const { stdout: metaOutput } = await execPromise(
                `git show -s --format="%H|%an|%ae|%at|%s" ${commitHash}`,
                { cwd: this.workspaceRoot }
            );
            
            const [hash, author, authorEmail, timestamp, message] = metaOutput.trim().split('|');
            
            // Get modified files
            const { stdout: filesOutput } = await execPromise(
                `git diff-tree --no-commit-id --name-only -r ${commitHash}`,
                { cwd: this.workspaceRoot }
            );
            
            const modifiedFiles = filesOutput.trim().split('\n').filter(f => f);
            
            // Get diff
            const { stdout: diff } = await execPromise(
                `git show ${commitHash} --format=""`,
                { cwd: this.workspaceRoot, maxBuffer: 5 * 1024 * 1024 }
            ).catch(() => ({ stdout: '' }));
            
            return {
                hash,
                author,
                authorEmail,
                timestamp: new Date(parseInt(timestamp, 10) * 1000),
                message,
                modifiedFiles,
                diff
            };
        } catch (error) {
            console.error(`Failed to get commit info for ${commitHash}:`, error);
            return null;
        }
    }
    
    /**
     * Update developer interest with new commit
     */
    private updateDeveloperInterest(commit: CommitInfo): void {
        const devId = commit.authorEmail;
        
        if (!this.developerInterest.has(devId)) {
            this.developerInterest.set(devId, {
                developerId: devId,
                fileModifications: new Map(),
                totalScore: 0
            });
        }
        
        const interest = this.developerInterest.get(devId)!;
        
        for (const file of commit.modifiedFiles) {
            const count = interest.fileModifications.get(file) || 0;
            interest.fileModifications.set(file, count + 1);
            interest.totalScore++;
        }
    }
    
    /**
     * Calculate developer interest score for a SATD instance
     * DEV_id(t_i) = familiarity with file/region
     */
    private calculateDeveloperInterestScore(debt: TechnicalDebt, commit: CommitInfo): number {
        const devId = commit.authorEmail;
        const interest = this.developerInterest.get(devId);
        
        if (!interest) return 0;
        
        // Direct file familiarity
        const fileModCount = interest.fileModifications.get(debt.file) || 0;
        const totalMods = interest.totalScore || 1;
        
        // Normalize to [0, 1]
        return Math.min(1, fileModCount / Math.max(10, totalMods * 0.1));
    }
    
    /**
     * Algorithm 4: Commit-Aware Insight Generation (CAIG)
     * 
     * Analyze commit relevance and rank SATD instances
     * Rank(t_i) = η1·SIR(t_i) + η2·CommitRel(t_i) + η3·(1-S^t) + η4·f_i
     */
    public async analyzeCommitRelevance(
        debtItems: TechnicalDebt[],
        commit: CommitInfo
    ): Promise<TechnicalDebt[]> {
        console.log(`CAIG: Analyzing ${debtItems.length} SATD instances against commit ${commit.hash.substring(0, 7)}`);
        
        // Step 1: Calculate commit relevance for each debt item
        const relevantDebts: TechnicalDebt[] = [];
        
        for (const debt of debtItems) {
            const commitRel = this.calculateCommitRelevance(debt, commit);
            
            // Only consider if there's some relevance
            if (commitRel > 0) {
                relevantDebts.push({
                    ...debt,
                    commitRelevance: commitRel,
                    developerInterestScore: this.calculateDeveloperInterestScore(debt, commit)
                });
            }
        }
        
        if (relevantDebts.length === 0) {
            console.log('CAIG: No relevant SATD instances found for this commit');
            return [];
        }
        
        console.log(`CAIG: Found ${relevantDebts.length} potentially relevant SATD instances`);
        
        // Step 2: Calculate effort scores
        const debtsWithEffort = await this.effortScorer.calculateEffortScores(relevantDebts);
        
        // Step 3: Assess fix potential using LLM (Prompt 2)
        const debtsWithFixPotential = await this.assessFixPotentials(debtsWithEffort, commit);
        
        // Step 4: Calculate final ranking score
        const rankedDebts = this.calculateRankingScores(debtsWithFixPotential);
        
        // Step 5: Generate remediation plans for top items (Prompt 3)
        const topDebts = rankedDebts.slice(0, 5);
        const debtsWithPlans = await this.generateRemediationPlans(topDebts, commit);
        
        // Combine with remaining debts
        const finalDebts = [...debtsWithPlans, ...rankedDebts.slice(5)];
        
        console.log(`CAIG: Ranked ${finalDebts.length} SATD instances, top item: ${finalDebts[0]?.id}`);
        
        return finalDebts;
    }
    
    /**
     * Calculate commit relevance score
     * Based on: file modified, neighbor modified, author familiarity
     */
    private calculateCommitRelevance(debt: TechnicalDebt, commit: CommitInfo): number {
        let relevance = 0;
        
        // Direct file modification (highest relevance)
        if (commit.modifiedFiles.includes(debt.file)) {
            relevance += 0.5;
        }
        
        // Same directory modified (neighbor)
        const debtDir = debt.file.substring(0, debt.file.lastIndexOf('/'));
        const neighborModified = commit.modifiedFiles.some(f => {
            const dir = f.substring(0, f.lastIndexOf('/'));
            return dir === debtDir;
        });
        if (neighborModified) {
            relevance += 0.3;
        }
        
        // Author familiarity
        const devInterest = this.calculateDeveloperInterestScore(debt, commit);
        relevance += 0.2 * devInterest;
        
        return Math.min(1, relevance);
    }
    
    /**
     * Assess fix potential for relevant debt items using Prompt 2
     */
    private async assessFixPotentials(
        debtItems: TechnicalDebt[],
        commit: CommitInfo
    ): Promise<TechnicalDebt[]> {
        const results: TechnicalDebt[] = [];
        
        // Process in parallel with rate limiting
        const batchSize = 3;
        
        for (let i = 0; i < debtItems.length; i += batchSize) {
            const batch = debtItems.slice(i, i + batchSize);
            
            const promises = batch.map(async (debt) => {
                try {
                    const summarizedDiff = summarizeChanges(commit.diff || '', 500);
                    
                    const result = await assessFixPotential(
                        debt.content,
                        debt.file,
                        debt.line,
                        summarizedDiff,
                        commit.modifiedFiles
                    );
                    
                    return {
                        ...debt,
                        fixPotential: result.potential,
                        fixPotentialValue: result.value
                    };
                } catch (error) {
                    console.error(`Failed to assess fix potential for ${debt.id}:`, error);
                    return {
                        ...debt,
                        fixPotential: FixPotential.LOW,
                        fixPotentialValue: 0
                    };
                }
            });
            
            const batchResults = await Promise.all(promises);
            results.push(...batchResults);
            
            // Small delay between batches
            if (i + batchSize < debtItems.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        return results;
    }
    
    /**
     * Calculate final ranking score using CAIG formula
     * Rank(t_i) = η1·SIR(t_i) + η2·CommitRel(t_i) + η3·(1-S^t) + η4·f_i
     */
    private calculateRankingScores(debtItems: TechnicalDebt[]): TechnicalDebt[] {
        const rankedDebts = debtItems.map(debt => {
            const sir = debt.sirScore || 0;
            const commitRel = debt.commitRelevance || 0;
            const effort = debt.effortScore || 0;
            const fixPotential = debt.fixPotentialValue || 0;
            
            // CAIG ranking formula
            const rankScore = 
                this.weights.eta1 * sir +
                this.weights.eta2 * commitRel +
                this.weights.eta3 * (1 - effort) + // Lower effort = higher priority
                this.weights.eta4 * fixPotential;
            
            return {
                ...debt,
                rankScore
            };
        });
        
        // Sort by rank score (descending)
        return rankedDebts.sort((a, b) => (b.rankScore || 0) - (a.rankScore || 0));
    }
    
    /**
     * Generate remediation plans for top-ranked items using Prompt 3
     */
    private async generateRemediationPlans(
        debtItems: TechnicalDebt[],
        commit: CommitInfo
    ): Promise<TechnicalDebt[]> {
        const results: TechnicalDebt[] = [];
        
        for (const debt of debtItems) {
            try {
                // Get connected SATD items (simplified - in full impl, use the graph)
                const connectedItems: Array<{ id: string; content: string; file: string; line: number }> = 
                    (debt.connectedSatdIds || []).map(id => ({
                        id,
                        content: 'Connected SATD',
                        file: debt.file,
                        line: debt.line
                    }));
                
                const summarizedChanges = summarizeChanges(commit.diff || '', 300);
                
                const plan = await generateRemediationPlan(
                    debt.content,
                    debt.sirScore || 0,
                    debt.fixPotential || FixPotential.LOW,
                    summarizedChanges,
                    connectedItems
                );
                
                results.push({
                    ...debt,
                    remediationPlan: plan?.fullPlan
                });
            } catch (error) {
                console.error(`Failed to generate remediation plan for ${debt.id}:`, error);
                results.push(debt);
            }
        }
        
        return results;
    }
    
    /**
     * Check if a commit addresses technical debt (legacy function for compatibility)
     */
    public async checkCommitForTechnicalDebtFixes(
        debtItems: TechnicalDebt[],
        commitHash: string
    ): Promise<void> {
        const commitInfo = await this.getCommitInfo(commitHash);
        
        if (!commitInfo) {
            console.error('Could not get commit info');
            return;
        }
        
        // Find relevant debt items
        const relevantDebts = debtItems.filter(debt => 
            commitInfo.modifiedFiles.includes(debt.file)
        );
        
        if (relevantDebts.length === 0) {
            console.log('No relevant technical debt for this commit');
            return;
        }
        
        // Analyze each relevant debt item
        for (const debt of relevantDebts) {
            const analysis = await analyzeDebtFix(
                debt,
                commitInfo.hash,
                commitInfo.message,
                commitInfo.diff || ''
            );
            
            if (analysis) {
                vscode.window.showInformationMessage(
                    `Technical Debt Analysis for ${debt.file}:${debt.line}`,
                    { modal: false }
                );
                
                // Show in output channel
                const outputChannel = vscode.window.createOutputChannel('RapidPay CAIG');
                outputChannel.appendLine(`\n=== Technical Debt Analysis ===`);
                outputChannel.appendLine(`File: ${debt.file}`);
                outputChannel.appendLine(`Line: ${debt.line}`);
                outputChannel.appendLine(`Debt: ${debt.content}`);
                outputChannel.appendLine(`\nCommit: ${commitInfo.hash.substring(0, 7)} - ${commitInfo.message}`);
                outputChannel.appendLine(`\nAnalysis:\n${analysis}`);
                outputChannel.show();
            }
        }
    }
    
    /**
     * Get the current developer interest map
     */
    public getDeveloperInterest(): Map<string, DeveloperInterest> {
        return new Map(this.developerInterest);
    }
    
    /**
     * Get the current commit window
     */
    public getCommitWindow(): CommitInfo[] {
        return [...this.commitWindow];
    }
}

/**
 * Factory function to create a commit monitor
 */
export function createCommitMonitor(): CommitMonitor | null {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return null;
    }
    return new CommitMonitor(workspaceRoot);
}
