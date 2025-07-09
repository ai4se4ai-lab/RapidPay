// src/visualization/satdGraphVisualizer.ts (updated)
import * as vscode from 'vscode';
import { TechnicalDebt, SatdRelationship, Chain } from '../models';
import { openFileAtPosition, generateGraphVisualizationHTML } from '../utils/visualizationUtils';

/**
 * SatdGraphVisualizer creates and manages visualizations of technical debt
 * relationships using Cytoscape.js in a webview
 */
export class SatdGraphVisualizer {
    private panel: vscode.WebviewPanel | undefined;
    private context: vscode.ExtensionContext;
    
    /**
     * Constructor initializes the visualizer with the extension context
     * @param context Extension context
     */
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }
    
    /**
     * Display a visualization of technical debt relationships
     * @param debtItems Technical debt items
     * @param relationships Relationships between debt items
     * @param chains Detected chains between debt items
     */
    public displaySatdGraph(
        debtItems: TechnicalDebt[], 
        relationships: SatdRelationship[],
        chains: Chain[] = []
    ): void {
        // Create or reveal panel
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'satdGraph',
                'Technical Debt Relationships',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );
            
            // Clean up when the panel is closed
            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });
        }
        
        // Set webview content using the utility function
        this.panel.webview.html = generateGraphVisualizationHTML(
            this.context, 
            debtItems, 
            relationships,
            chains
        );
        
        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'openFile':
                        openFileAtPosition(message.file, message.line);
                        return;
                }
            },
            undefined,
            this.context.subscriptions
        );
    }
}