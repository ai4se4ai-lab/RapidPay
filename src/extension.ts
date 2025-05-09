// src/extension.ts
import * as vscode from 'vscode';
import { TechnicalDebt } from './models';
import { initializeOpenAI, resetOpenAIClient } from './utils/openaiClient';
import { getRepositoryInfo, wasCommitMadeRecently } from './utils/gitUtils';
import { scanRepositoryForTechnicalDebt, enhanceTechnicalDebtWithAI } from './utils/debtScanner';
import { showTechnicalDebtPanel, withProgressNotification } from './utils/uiUtils';
import { SatdChainAnalyzer } from './satdChainAnalyzer';

import { 
  initializeCommitMonitor, 
  checkCommitForTechnicalDebtFixes, 
  setTechnicalDebtItems,
  disposeCommitMonitor,
  getTechnicalDebtItems
} from './utils/commitMonitor';
import { registerVisualizationCommands } from './visualization/visualizationCommands';
import { SatdRelationshipAnalyzer } from './satdRelationshipAnalyzer';

// Keep track of technical debt items globally
let technicalDebtItems: TechnicalDebt[] = [];

export function activate(context: vscode.ExtensionContext) {
  console.log('SATD Helper Extension is now active');

  // Register visualization commands
  registerVisualizationCommands(context);

  // Command: Initialize and scan repository
  const initCommand = vscode.commands.registerCommand('RapidPay.init', async () => {
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
      
      // Check if relationship analysis is enabled
      const config = vscode.workspace.getConfiguration('RapidPay');
      const relationshipAnalysisEnabled = config.get<boolean>('relationshipAnalysisEnabled');
      const chainAnalysisEnabled = config.get<boolean>('chainAnalysisEnabled');
      const sirScoreEnabled = config.get<boolean>('sirScoreEnabled');

      if (relationshipAnalysisEnabled) {
        progress.report({ message: "Analyzing relationships between technical debt items..." });
        
        // Create and initialize relationship analyzer
        const analyzer = new SatdRelationshipAnalyzer();
        await analyzer.initialize(repoInfo.workspaceRoot || '');
        
        // This doesn't need to block the initialization, but we'll
        // pre-compute relationships in the background
        analyzer.analyzeRelationships(technicalDebtItems).then(relationships => {
          if (chainAnalysisEnabled) {
            progress.report({ message: "Discovering technical debt chains..." });
            
            // Create the chain analyzer
            const chainAnalyzer = new SatdChainAnalyzer();
            
            // Find chains in the relationships
            const { relationships: enhancedRelationships, chains } = 
              chainAnalyzer.findChains(technicalDebtItems, relationships);
            
            if (sirScoreEnabled) {
              // Get SIR score weights from config
              const sirWeights = config.get<{
                severity: number;
                outgoingInfluence: number;
                incomingDependency: number;
                chainLength: number;
              }>('sirScoreWeights');
              
              // Apply the weights if configured
              if (sirWeights) {
                chainAnalyzer.setSirWeights(
                  sirWeights.severity,
                  sirWeights.outgoingInfluence,
                  sirWeights.incomingDependency,
                  sirWeights.chainLength
                );
              }
              
              // Calculate SIR scores
              const debtItemsWithScores = chainAnalyzer.calculateSIRScores(
                technicalDebtItems,
                enhancedRelationships
              );
              
              // Update the technical debt items with scores
              technicalDebtItems = debtItemsWithScores;
            }
            
            // Update the commit monitor with the updated debt items
            setTechnicalDebtItems(technicalDebtItems);
            
            console.log(`Found ${chains.length} chains among ${relationships.length} relationships.`);
            
            // If chains were found, notify the user
            if (chains.length > 0) {
              vscode.window.showInformationMessage(
                `Found ${chains.length} technical debt chains. Use "Visualize Relationships" to explore them.`
              );
            }
          }
        }).catch(error => {
          console.error('Error analyzing relationships and chains:', error);
        });
      }
      
      vscode.window.showInformationMessage(
        `Found ${technicalDebtItems.length} technical debt items in the repository.`,
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
    // Get the current technical debt items (they might have been updated)
    const debtItems = getTechnicalDebtItems();
    
    if (debtItems.length === 0) {
      vscode.window.showInformationMessage('No technical debt items found. Run the initialization command first.');
      return;
    }
    
    showTechnicalDebtPanel(debtItems, context);
  });

  // Command: Check the latest commit for technical debt fixes
  const checkLatestCommitCommand = vscode.commands.registerCommand('RapidPay.checkLatestCommit', async () => {
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
        await vscode.commands.executeCommand('RapidPay.init');
        
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
  const config = vscode.workspace.getConfiguration('RapidPay');
  const autoScan = config.get<boolean>('autoScanOnStartup');
  
  if (autoScan) {
    vscode.commands.executeCommand('RapidPay.init');
  }
}