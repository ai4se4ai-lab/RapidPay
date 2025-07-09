// src/utils/commitMonitor.ts
import * as vscode from 'vscode';
import { getCurrentCommitHash, getLatestCommitInfo } from './gitUtils';
import { analyzeDebtFix } from './openaiClient';
import { showDebtFixSuggestionsPanel } from './uiUtils';
import { TechnicalDebt } from '../models';
import * as childProcess from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

// Type-safe version of exec
const execPromise = promisify(childProcess.exec);

let lastKnownCommitHash: string = '';
let commitCheckInterval: NodeJS.Timeout | undefined;
let technicalDebtItems: TechnicalDebt[] = [];

// Files to ignore when checking for technical debt fixes
const IGNORED_FILES: string[] = [
  'README.md',
  'readme.md',
  'LICENSE',
  'license',
  '.gitignore',
  'CHANGELOG.md',
  'changelog.md',
  'CONTRIBUTING.md',
  'contributing.md',
  'AUTHORS',
  'authors',
  'CODEOWNERS',
  'codeowners',
  'CODE_OF_CONDUCT.md',
  'code_of_conduct.md'
];

/**
 * Check if a file should be ignored in the technical debt analysis
 * @param filePath Path to the file
 * @returns True if the file should be ignored
 */
function shouldIgnoreFile(filePath: string): boolean {
  const fileName = path.basename(filePath).toLowerCase();
  return IGNORED_FILES.some(ignored => ignored.toLowerCase() === fileName);
}

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
 * Get file changes from the most recent commit
 * @returns Map of file paths to their changes
 */
async function getChangedFilesFromGit(): Promise<Map<string, { added: string, context: string }>> {
  const changedFiles = new Map<string, { added: string, context: string }>();
  
  try {
    const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspacePath) {
      console.error('No workspace folder found');
      return changedFiles;
    }
    
    // Get list of files changed in the last commit
    const { stdout: changedFilesList } = await execPromise(
      'git show --name-only --pretty=format: HEAD',
      { cwd: workspacePath }
    );
    
    // Filter out ignored files
    const fileNames = changedFilesList
      .trim()
      .split('\n')
      .filter((name: string) => name.trim())
      .filter((name: string) => !shouldIgnoreFile(name));
    
    console.log(`Found ${fileNames.length} relevant changed files in last commit (after filtering)`, fileNames);
    
    // For each file, get the diff and current content
    for (const fileName of fileNames) {
      try {
        // Get the diff for this specific file
        const { stdout: fileDiff } = await execPromise(
          `git show HEAD -- "${fileName}"`,
          { cwd: workspacePath }
        );
        
        // Try to read the current file content
        let fileContent = "";
        try {
          const uri = vscode.Uri.file(`${workspacePath}/${fileName}`);
          const document = await vscode.workspace.openTextDocument(uri);
          fileContent = document.getText();
        } catch (err) {
          console.warn(`Could not read current content of ${fileName}: ${err}`);
        }
        
        changedFiles.set(fileName, {
          added: fileContent.substring(0, 1000), // First 1000 chars of current content
          context: fileDiff // The full diff for this file
        });
      } catch (err) {
        console.error(`Error getting diff for ${fileName}: ${err}`);
      }
    }
    
  } catch (error) {
    console.error('Failed to get changed files:', error);
  }
  
  console.log(`Successfully processed ${changedFiles.size} changed files`);
  return changedFiles;
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
    
    // Get changed files directly from git commands instead of parsing diff
    const changedFiles = await getChangedFilesFromGit();
    
    if (changedFiles.size === 0) {
      console.warn('No relevant changed files detected after filtering.');
      vscode.window.showWarningMessage('No relevant code changes detected in the latest commit (documentation files are ignored).');
      return;
    }
    
    console.log(`Analyzing ${changedFiles.size} changed files for technical debt fixes...`);
    
    // For each technical debt item, check if any changes in this commit might address it
    // First filter out technical debt items in ignored files
    const relevantDebtItems = technicalDebtItems.filter(item => !shouldIgnoreFile(item.file));
    
    console.log(`Found ${relevantDebtItems.length} relevant technical debt items (ignored ${technicalDebtItems.length - relevantDebtItems.length} in documentation files)`);
    
    if (relevantDebtItems.length === 0) {
      console.log('No technical debt items in code files to analyze');
      vscode.window.showInformationMessage('All technical debt items are in documentation files, which are ignored.');
      return;
    }
    
    // Analyze each relevant technical debt item
    for (const debtItem of relevantDebtItems) {
      try {
        // Get surrounding code context for the technical debt
        let surroundingCode = "";
        try {
          // Use VS Code API to get file content
          const uri = vscode.Uri.file(`${vscode.workspace.workspaceFolders?.[0].uri.fsPath}/${debtItem.file}`);
          const document = await vscode.workspace.openTextDocument(uri);
          
          // Get 5 lines before and 5 lines after the technical debt comment
          const startLine = Math.max(0, debtItem.line - 6);
          const endLine = Math.min(document.lineCount - 1, debtItem.line + 4);
          
          // Extract the code
          for (let i = startLine; i <= endLine; i++) {
            const lineText = document.lineAt(i).text;
            // Mark the actual debt line
            surroundingCode += (i === debtItem.line - 1) ? 
              `→ ${lineText}\n` : 
              `  ${lineText}\n`;
          }
        } catch (error) {
          console.error(`Failed to get surrounding code for ${debtItem.file}: ${error}`);
          surroundingCode = "Could not retrieve surrounding code.";
        }
        
        // Create a detailed analysis context with both the debt and the changes
        let analysisContext = `Technical Debt Details:\n`;
        analysisContext += `File: ${debtItem.file}, Line: ${debtItem.line}\n`;
        analysisContext += `Debt Comment: ${debtItem.content}\n`;
        
        // Ensure we have a rich description for the technical debt
        let enhancedDescription = debtItem.description || debtItem.content;
        if (enhancedDescription === debtItem.content) {
          // If description is same as content, enrich it with code context
          enhancedDescription += `\n\nContext Analysis: The technical debt appears in the following code context:\n${surroundingCode}\n`;
          enhancedDescription += `Based on the surrounding code, this technical debt likely involves issues that should be fixed.`;
        }
        
        analysisContext += `Description: ${enhancedDescription}\n\n`;
        analysisContext += `Surrounding Code Context:\n${surroundingCode}\n\n`;
        
        // Add changed files information
        analysisContext += `Recent Code Changes:\n`;
        
        // Track if we have meaningful content
        let hasMeaningfulChanges = false;
        
        for (const [filePath, fileInfo] of changedFiles.entries()) {
          analysisContext += `\n\nFile: ${filePath}\n`;
          
          // If this is the file with the technical debt, highlight it
          if (filePath === debtItem.file) {
            analysisContext += `NOTE: This file contains the technical debt comment at line ${debtItem.line}.\n\n`;
          }
          
          // Add the diff content (which includes both the changes and context)
          if (fileInfo.context && fileInfo.context.trim()) {
            analysisContext += `Diff:\n${fileInfo.context}\n`;
            hasMeaningfulChanges = true;
          }
          
          // Try to get the actual file content
          try {
            const uri = vscode.Uri.file(`${vscode.workspace.workspaceFolders?.[0].uri.fsPath}/${filePath}`);
            const document = await vscode.workspace.openTextDocument(uri);
            const fileContent = document.getText();
            
            // Add first 1000 chars of content
            analysisContext += `\nCurrent file content (truncated):\n${fileContent.substring(0, 1000)}`;
            if (fileContent.length > 1000) {
              analysisContext += `\n... (truncated, total size: ${fileContent.length} bytes)`;
            }
            hasMeaningfulChanges = true;
          } catch (error) {
            console.error(`Failed to get content for ${filePath}: ${error}`);
            analysisContext += `\nCould not retrieve current file content.\n`;
          }
        }
        
        // Add commit information
        analysisContext += `\n\nCommit Information:\n`;
        analysisContext += `Hash: ${commitInfo.hash}\n`;
        analysisContext += `Message: ${commitInfo.message}\n`;
        analysisContext += `Note: Changes to documentation files (README.md, etc.) are ignored in this analysis.\n`;
        
        if (!hasMeaningfulChanges) {
          console.warn(`No meaningful changes detected for analysis of ${debtItem.file}:${debtItem.line}`);
          analysisContext += `\nWARNING: Limited change information available for analysis.\n`;
        }
        
        console.log(`Analyzing debt item ${debtItem.id} against changes...`);
        
        // Analyze if the debt has been addressed by any of the changes
        const analysis = await analyzeDebtFix(
          {
            ...debtItem,
            // Include detailed context in the description
            description: analysisContext
          },
          commitInfo.hash,
          commitInfo.message,
          `Please analyze if the recent code changes in this commit address or partially address the technical debt. 
          Focus on understanding the semantic relationship between the changes and the technical debt comment.
          
          1. First, understand what the technical debt is about by examining the comment and surrounding code.
          2. Then, analyze the changes in all files to see if they resolve the underlying issue.
          3. Explain WHY the changes may or may not fix the technical debt issue.
          4. Be specific about which code changes (if any) relate to the technical debt and how they address it.
          
          If the changes completely fix the issue, explain how.
          If they partially fix it, explain what's still missing.
          If they don't fix it at all, explain why not.`
        );
        
        if (!analysis) {
          console.log(`No analysis result for debt item ${debtItem.id}`);
          continue;
        }
        
        console.log(`Analysis for ${debtItem.file}:${debtItem.line} - ` + 
          (analysis.includes("UNRELATED") ? "UNRELATED" : "POTENTIAL FIX"));
        
        if (!analysis.includes("UNRELATED")) {
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