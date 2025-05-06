// src/utils/commitMonitor.ts
import * as vscode from 'vscode';
import { getCurrentCommitHash, getLatestCommitInfo } from './gitUtils';
import { analyzeDebtFix } from './openaiClient';
import { showDebtFixSuggestionsPanel } from './uiUtils';
import { TechnicalDebt } from '../models';

let lastKnownCommitHash: string = '';
let commitCheckInterval: NodeJS.Timeout | undefined;
let technicalDebtItems: TechnicalDebt[] = [];

/**
 * Initialize the commit monitor
 * @param context Extension context
 * @param debtItems Technical debt items to monitor
 */
export async function initializeCommitMonitor(
  context: vscode.ExtensionContext,
  debtItems: TechnicalDebt[]
): Promise<void> {
  // Store the debt items for monitoring
  technicalDebtItems = debtItems;
  
  // Get current commit hash
  lastKnownCommitHash = await getCurrentCommitHash();
  
  // Set up interval to check for new commits
  if (commitCheckInterval) {
    clearInterval(commitCheckInterval);
  }
  
  commitCheckInterval = setInterval(async () => {
    await checkForNewCommits();
  }, 10000); // Check every 10 seconds
  
  // Add cleanup to context
  context.subscriptions.push({
    dispose: () => {
      if (commitCheckInterval) {
        clearInterval(commitCheckInterval);
        commitCheckInterval = undefined;
      }
    }
  });
}

/**
 * Check for new commits and analyze if they address technical debt
 */
async function checkForNewCommits(): Promise<void> {
  try {
    const currentHash = await getCurrentCommitHash();
    
    if (lastKnownCommitHash && currentHash !== lastKnownCommitHash) {
      // New commit detected
      console.log(`New commit detected: ${currentHash}`);
      lastKnownCommitHash = currentHash;
      
      // Only check for debt fixes if we have debt items
      if (technicalDebtItems.length > 0) {
        await checkCommitForTechnicalDebtFixes();
      }
    }
    
    // Update the hash even if we didn't check for fixes
    lastKnownCommitHash = currentHash;
  } catch (error) {
    console.error('Error checking for new commits:', error);
  }
}

/**
 * Check if a commit addresses technical debt
 */
export async function checkCommitForTechnicalDebtFixes(): Promise<void> {
  if (technicalDebtItems.length === 0) {
    vscode.window.showInformationMessage('No technical debt items to check against.');
    return;
  }
  
  try {
    const commitInfo = await getLatestCommitInfo();
    
    if (!commitInfo) {
      vscode.window.showWarningMessage('Could not get latest commit information.');
      return;
    }
    
    vscode.window.showInformationMessage('Checking the latest commit for technical debt fixes...');
    
    // For each technical debt item, check if this commit might address it
    for (const debtItem of technicalDebtItems) {
      try {
        const analysis = await analyzeDebtFix(
          debtItem, 
          commitInfo.hash, 
          commitInfo.message, 
          commitInfo.diff
        );
        
        if (!analysis) {
          continue;
        }
        
        vscode.window.showInformationMessage(
          `Analysis for ${debtItem.file}:${debtItem.line}: `,
          analysis || 'No analysis provided'
        );
        
        if (analysis && !analysis.includes("UNRELATED")) {
          vscode.window.showInformationMessage(
            `Potential fix for technical debt in ${debtItem.file}:${debtItem.line}`,
            'View Suggestions'
          ).then(selection => {
            if (selection === 'View Suggestions') {
              showDebtFixSuggestionsPanel(debtItem, analysis);
            }
          });
        }
      } catch (error) {
        console.error(`Failed to analyze commit for technical debt fixes: ${error}`);
      }
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to check commit: ${error}`);
  }
}

/**
 * Set technical debt items to monitor
 * @param debtItems Technical debt items
 */
export function setTechnicalDebtItems(debtItems: TechnicalDebt[]): void {
  technicalDebtItems = debtItems;
}

/**
 * Get technical debt items being monitored
 * @returns Technical debt items
 */
export function getTechnicalDebtItems(): TechnicalDebt[] {
  return technicalDebtItems;
}

/**
 * Dispose of the commit monitor
 */
export function disposeCommitMonitor(): void {
  if (commitCheckInterval) {
    clearInterval(commitCheckInterval);
    commitCheckInterval = undefined;
  }
  
  technicalDebtItems = [];
}