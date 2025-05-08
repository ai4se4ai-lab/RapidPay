// src/commands/visualizationCommands.ts
import * as vscode from 'vscode';
import { SatdRelationshipAnalyzer } from '../satdRelationshipAnalyzer';
import { SatdChainAnalyzer } from '../satdChainAnalyzer';
import { SatdGraphVisualizer } from '../visualization/satdGraphVisualizer';
import { getTechnicalDebtItems } from '../utils/commitMonitor';
import { getWorkspaceRoot } from '../utils/gitUtils';
import { withProgressNotification } from '../utils/uiUtils';

/**
 * Register visualization commands for SATD relationships
 * @param context Extension context
 */
export function registerVisualizationCommands(context: vscode.ExtensionContext): void {
    // Command to analyze and visualize SATD relationships
    const visualizeCommand = vscode.commands.registerCommand(
        'satdHelper.visualizeRelationships',
        async () => {
            // Get technical debt items
            const debtItems = getTechnicalDebtItems();
            
            if (debtItems.length === 0) {
                vscode.window.showInformationMessage(
                    'No technical debt items found. Run the initialization command first.'
                );
                return;
            }
            
            await withProgressNotification(
                'Analyzing Technical Debt Relationships',
                async (progress) => {
                    progress.report({ message: "Initializing relationship analyzer..." });
                    
                    // Create and initialize the relationship analyzer
                    const analyzer = new SatdRelationshipAnalyzer();
                    const workspaceRoot = getWorkspaceRoot();
                    
                    if (!workspaceRoot) {
                        vscode.window.showErrorMessage('No workspace folder open');
                        return;
                    }
                    
                    await analyzer.initialize(workspaceRoot);
                    
                    progress.report({ message: "Analyzing relationships between technical debt items..." });
                    
                    // Find relationships between technical debt items
                    const relationships = await analyzer.analyzeRelationships(debtItems);
                    
                    progress.report({ message: "Discovering technical debt chains..." });
                    
                    // Create the chain analyzer
                    const chainAnalyzer = new SatdChainAnalyzer();
                    
                    // Find chains in the relationships
                    const { relationships: enhancedRelationships, chains } = 
                        chainAnalyzer.findChains(debtItems, relationships);
                    
                    progress.report({ message: "Calculating SIR scores..." });
                    
                    // Calculate SIR scores for debt items
                    const debtItemsWithScores = chainAnalyzer.calculateSIRScores(
                        debtItems, 
                        enhancedRelationships
                    );
                    
                    progress.report({ message: "Generating visualization..." });
                    
                    // Create and display visualization
                    const visualizer = new SatdGraphVisualizer(context);
                    visualizer.displaySatdGraph(debtItemsWithScores, enhancedRelationships, chains);
                    
                    // Show summary
                    vscode.window.showInformationMessage(
                        `Found ${enhancedRelationships.length} relationships and ${chains.length} chains ` +
                        `between ${debtItems.length} technical debt items.`
                    );
                }
            );
        }
    );
    
    // Register commands
    context.subscriptions.push(visualizeCommand);
}