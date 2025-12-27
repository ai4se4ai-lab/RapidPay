// src/utils/effortScorer.ts
import { exec } from 'child_process';
import { promisify } from 'util';
import { TechnicalDebt, DEFAULT_EFFORT_CONFIG, EffortScoreConfig } from '../models';

const execPromise = promisify(exec);

/**
 * EffortScorer calculates historical effort scores for SATD instances
 * S^t = λ·(RT_t/max(RT)) + (1-λ)·(FM_t/max(FM))
 * 
 * Where:
 * - RT_t: Resolution time for similar debt in the region
 * - FM_t: File modifications count (churn)
 * - λ: Weight balancing factor (default: 0.5)
 */
export class EffortScorer {
    private config: EffortScoreConfig = DEFAULT_EFFORT_CONFIG;
    private workspaceRoot: string;
    
    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }
    
    /**
     * Set configuration for effort scoring
     */
    public setConfig(config: Partial<EffortScoreConfig>): void {
        this.config = { ...this.config, ...config };
    }
    
    /**
     * Calculate effort scores for all debt items
     * @param debtItems Technical debt items
     * @returns Debt items with effort scores
     */
    public async calculateEffortScores(debtItems: TechnicalDebt[]): Promise<TechnicalDebt[]> {
        // Gather file-level metrics
        const fileMetrics = await this.gatherFileMetrics(debtItems);
        
        // Calculate raw RT and FM values
        const rawScores: Map<string, { rt: number; fm: number }> = new Map();
        
        for (const debt of debtItems) {
            const rt = await this.estimateResolutionTime(debt, fileMetrics);
            const fm = fileMetrics.get(debt.file)?.modifications || 0;
            rawScores.set(debt.id, { rt, fm });
        }
        
        // Get max values for normalization
        let maxRT = 0;
        let maxFM = 0;
        
        for (const { rt, fm } of rawScores.values()) {
            maxRT = Math.max(maxRT, rt);
            maxFM = Math.max(maxFM, fm);
        }
        
        // Avoid division by zero
        maxRT = maxRT || 1;
        maxFM = maxFM || 1;
        
        // Calculate normalized effort scores
        const lambda = this.config.lambda;
        
        return debtItems.map(debt => {
            const { rt, fm } = rawScores.get(debt.id)!;
            
            // S^t = λ·(RT_t/max(RT)) + (1-λ)·(FM_t/max(FM))
            const effortScore = lambda * (rt / maxRT) + (1 - lambda) * (fm / maxFM);
            
            return {
                ...debt,
                effortScore
            };
        });
    }
    
    /**
     * Gather file-level metrics (modification count, age, etc.)
     */
    private async gatherFileMetrics(
        debtItems: TechnicalDebt[]
    ): Promise<Map<string, { modifications: number; age: number; contributors: number }>> {
        const metrics = new Map<string, { modifications: number; age: number; contributors: number }>();
        const uniqueFiles = [...new Set(debtItems.map(item => item.file))];
        
        for (const filePath of uniqueFiles) {
            try {
                // Get modification count (file churn)
                const { stdout: logOutput } = await execPromise(
                    `git log --oneline "${filePath}" | wc -l`,
                    { cwd: this.workspaceRoot }
                ).catch(() => ({ stdout: '0' }));
                
                const modifications = parseInt(logOutput.trim(), 10) || 0;
                
                // Get file age in days
                const { stdout: ageOutput } = await execPromise(
                    `git log --follow --format=%at --diff-filter=A -- "${filePath}" | tail -1`,
                    { cwd: this.workspaceRoot }
                ).catch(() => ({ stdout: '' }));
                
                let age = 0;
                if (ageOutput.trim()) {
                    const createdTimestamp = parseInt(ageOutput.trim(), 10);
                    age = Math.floor((Date.now() / 1000 - createdTimestamp) / 86400);
                }
                
                // Get unique contributor count
                const { stdout: contributorOutput } = await execPromise(
                    `git log --format="%ae" "${filePath}" | sort -u | wc -l`,
                    { cwd: this.workspaceRoot }
                ).catch(() => ({ stdout: '1' }));
                
                const contributors = parseInt(contributorOutput.trim(), 10) || 1;
                
                metrics.set(filePath, { modifications, age, contributors });
            } catch (error) {
                console.error(`Failed to gather metrics for ${filePath}:`, error);
                metrics.set(filePath, { modifications: 0, age: 0, contributors: 1 });
            }
        }
        
        return metrics;
    }
    
    /**
     * Estimate resolution time based on:
     * - Debt type (some types historically take longer)
     * - Code complexity (lines of context)
     * - File churn (frequently modified files may be easier)
     * - Historical resolution patterns
     */
    private async estimateResolutionTime(
        debt: TechnicalDebt,
        fileMetrics: Map<string, { modifications: number; age: number; contributors: number }>
    ): Promise<number> {
        let baseTime = 1.0;
        
        // Adjust based on debt type
        switch (debt.debtType) {
            case 'Architecture':
                baseTime = 4.0;
                break;
            case 'Design':
                baseTime = 3.0;
                break;
            case 'Implementation':
                baseTime = 2.0;
                break;
            case 'Documentation':
                baseTime = 1.0;
                break;
            case 'Test':
                baseTime = 2.0;
                break;
            case 'Defect':
                baseTime = 2.5;
                break;
            default:
                baseTime = 1.5;
        }
        
        // Adjust based on context complexity (content length as proxy)
        const contentLength = debt.content.length + (debt.extendedContent?.length || 0);
        const complexityFactor = 1 + Math.log10(contentLength + 1) / 3;
        
        // Adjust based on file metrics
        const metrics = fileMetrics.get(debt.file);
        let fileFactor = 1.0;
        
        if (metrics) {
            // High churn files may be easier (developers are familiar)
            const churnFactor = metrics.modifications > 50 ? 0.8 : 1.0;
            
            // Old files may have more legacy issues
            const ageFactor = metrics.age > 365 ? 1.2 : 1.0;
            
            // Many contributors may mean more complexity
            const contributorFactor = metrics.contributors > 5 ? 1.1 : 1.0;
            
            fileFactor = churnFactor * ageFactor * contributorFactor;
        }
        
        return baseTime * complexityFactor * fileFactor;
    }
    
    /**
     * Calculate effort percentile for a debt item
     * Lower percentile = lower effort = prioritize
     */
    public getEffortPercentile(debt: TechnicalDebt, allDebts: TechnicalDebt[]): number {
        const sortedByEffort = [...allDebts].sort((a, b) => 
            (a.effortScore || 0) - (b.effortScore || 0)
        );
        
        const index = sortedByEffort.findIndex(d => d.id === debt.id);
        return index / (sortedByEffort.length - 1 || 1);
    }
}

