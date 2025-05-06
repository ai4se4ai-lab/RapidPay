// src/extension.ts
import * as vscode from 'vscode';
import { TechnicalDebt } from './models';
import { initializeOpenAI, resetOpenAIClient } from './utils/openaiClient';
import { getRepositoryInfo, wasCommitMadeRecently } from './utils/gitUtils';
import { scanRepositoryForTechnicalDebt, enhanceTechnicalDebtWithAI } from './utils/debtScanner';
import { showTechnicalDebtPanel, withProgressNotification } from './utils/uiUtils';
import { 
  initializeCommitMonitor, 
  checkCommitForTechnicalDebtFixes, 
  setTechnicalDebtItems,
  disposeCommitMonitor,
  getTechnicalDebtItems
} from './utils/commitMonitor';

// Keep track of technical debt items globally
let technicalDebtItems: TechnicalDebt[] = [];

export function activate(context: vscode.ExtensionContext) {
  console.log('SATD Helper Extension is now active');

  // Command: Initialize and scan repository
  const initCommand = vscode.commands.registerCommand('satdHelper.init', async () => {
    if (!initializeOpenAI()) {
      return;
    }
    
    await withProgressNotification('SATD Helper', async (progress) => {
      progress.report({ message: "Getting repository information..." });
      const repoInfo = await getRepositoryInfo();
      
      if (!repoInfo) {
        return;
      }
      
      progress.report({ message: "Scanning repository for technical debt..." });
      const debtItems = await scanRepositoryForTechnicalDebt();
      
      progress.report({ message: "Analyzing technical debt items..." });
      technicalDebtItems = await enhanceTechnicalDebtWithAI(debtItems);
      
      // Initialize the commit monitor with the debt items
      setTechnicalDebtItems(technicalDebtItems);
      await initializeCommitMonitor(context, technicalDebtItems);
      
      vscode.window.showInformationMessage(
        `Found ${technicalDebtItems.length} technical debt items in the repository.`,
        'View Details'
      ).then(selection => {
        if (selection === 'View Details') {
          vscode.commands.executeCommand('satdHelper.viewTechnicalDebt');
        }
      });
    });
  });

  // Command: View technical debt items
  const viewTechnicalDebtCommand = vscode.commands.registerCommand('satdHelper.viewTechnicalDebt', async () => {
    // Get the current technical debt items (they might have been updated)
    const debtItems = getTechnicalDebtItems();
    
    if (debtItems.length === 0) {
      vscode.window.showInformationMessage('No technical debt items found. Run the initialization command first.');
      return;
    }
    
    showTechnicalDebtPanel(debtItems, context);
  });

  // Command: Check the latest commit for technical debt fixes
  const checkLatestCommitCommand = vscode.commands.registerCommand('satdHelper.checkLatestCommit', async () => {
    // Make sure we have an OpenAI instance
    if (!initializeOpenAI()) {
      vscode.window.showErrorMessage('Failed to initialize OpenAI client. Check your API key.');
      return;
    }
    
    // Check if we have technical debt items loaded
    if (getTechnicalDebtItems().length === 0) {
      const shouldScan = await vscode.window.showInformationMessage(
        'No technical debt items found. Would you like to scan the repository first?',
        'Yes', 'No'
      );
      
      if (shouldScan === 'Yes') {
        // Run the init command first
        await vscode.commands.executeCommand('satdHelper.init');
        
        if (getTechnicalDebtItems().length === 0) {
          // If still no items, exit
          vscode.window.showInformationMessage('No technical debt items were found during scanning.');
          return;
        }
      } else {
        return;
      }
    }
    
    // Show progress notification
    await withProgressNotification('SATD Helper', async (progress) => {
      progress.report({ message: "Checking the latest commit for technical debt fixes..." });
      await checkCommitForTechnicalDebtFixes();
      progress.report({ message: "Finished checking the latest commit." });
    });
  });

  // Event: Listen for Git post-commit events through file changes
  const gitEventListener = vscode.workspace.onDidSaveTextDocument(async (document) => {
    // Look for changes to git related files
    const fileName = document.fileName.toLowerCase();
    
    // Check if this might be related to a git commit
    if (fileName.includes('.git')) {
      // Check if a commit just happened
      try {
        if (await wasCommitMadeRecently()) {
          await checkCommitForTechnicalDebtFixes();
        }
      } catch (error) {
        console.error('Error checking for recent commits:', error);
      }
    }
  });

  // Register commands
  context.subscriptions.push(initCommand);
  context.subscriptions.push(viewTechnicalDebtCommand);
  context.subscriptions.push(checkLatestCommitCommand);
  context.subscriptions.push(gitEventListener);
  
  // Check auto-scan setting
  const config = vscode.workspace.getConfiguration('satdHelper');
  const autoScan = config.get<boolean>('autoScanOnStartup');
  
  if (autoScan) {
    vscode.commands.executeCommand('satdHelper.init');
  }
}