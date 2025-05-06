// src/utils/debtScanner.ts
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TechnicalDebt } from '../models';
import { getWorkspaceRoot } from './gitUtils';
import { analyzeTechnicalDebtComment } from './openaiClient';

const execPromise = promisify(exec);

/**
 * Scan repository for technical debt comments
 * @returns Array of technical debt items
 */
export async function scanRepositoryForTechnicalDebt(): Promise<TechnicalDebt[]> {
  try {
    const workspaceRoot = getWorkspaceRoot();
    
    if (!workspaceRoot) {
      vscode.window.showInformationMessage('No workspace folder open');
      return [];
    }
    
    // Get all files with technical debt comments using git grep
    const { stdout } = await execPromise(
      'git grep -n -E "TODO:|FIXME:|HACK:|XXX:|BUG:|ISSUE:|DEBT:" --', 
      { cwd: workspaceRoot }
    );
    
    const lines = stdout.split('\n').filter(line => line.trim() !== '');
    const debtItems: TechnicalDebt[] = [];
    
    for (const line of lines) {
      const [file, lineNumber, content] = line.split(':', 3);
      const lineNum = parseInt(lineNumber, 10);
      
      if (file && lineNum && content) {
        // Get commit information for this line
        const { stdout: blame } = await execPromise(
          `git blame -L ${lineNum},${lineNum} --porcelain "${file}"`,
          { cwd: workspaceRoot }
        );
        
        const commitHash = blame.split('\n')[0].split(' ')[0];
        const { stdout: commitDate } = await execPromise(
          `git show -s --format=%ci ${commitHash}`,
          { cwd: workspaceRoot }
        );
        
        // Create a unique ID for this debt item
        const id = `${file}-${lineNum}-${commitHash.substring(0, 7)}`;
        
        debtItems.push({
          id,
          file,
          line: lineNum,
          content: content.trim(),
          description: content.trim(),  // Will be enhanced later
          createdCommit: commitHash,
          createdDate: commitDate.trim()
        });
      }
    }
    
    return debtItems;
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to scan repository: ${error}`);
    return [];
  }
}

/**
 * Enhance technical debt items with AI-generated descriptions
 * @param debtItems Array of technical debt items
 * @returns Enhanced technical debt items
 */
export async function enhanceTechnicalDebtWithAI(debtItems: TechnicalDebt[]): Promise<TechnicalDebt[]> {
  const enhancedDebtItems: TechnicalDebt[] = [];
  
  for (const item of debtItems) {
    try {
      const description = await analyzeTechnicalDebtComment(item.content);
      enhancedDebtItems.push({
        ...item,
        description
      });
    } catch (error) {
      console.error(`Failed to enhance technical debt item: ${error}`);
      enhancedDebtItems.push(item);
    }
  }
  
  return enhancedDebtItems;
}

/**
 * Get surrounding context for a technical debt item
 * @param filePath File path
 * @param lineNumber Line number
 * @param contextLines Number of context lines before and after
 * @returns Context as a string
 */
export async function getTechnicalDebtContext(
  filePath: string, 
  lineNumber: number, 
  contextLines: number = 2
): Promise<string> {
  const workspaceRoot = getWorkspaceRoot();
  
  if (!workspaceRoot) {
    return '';
  }
  
  try {
    // Get context lines using git
    const startLine = Math.max(1, lineNumber - contextLines);
    const endLine = lineNumber + contextLines;
    
    const { stdout } = await execPromise(
      `git show HEAD:"${filePath}" | sed -n '${startLine},${endLine}p'`,
      { cwd: workspaceRoot }
    );
    
    return stdout.trim();
  } catch (error) {
    console.error(`Failed to get technical debt context: ${error}`);
    return '';
  }
}