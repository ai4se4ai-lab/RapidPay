// src/visualization/satdGraphVisualizer.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { TechnicalDebt, SatdRelationship, RelationshipType, DebtType } from '../models';

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
     */
    public displaySatdGraph(debtItems: TechnicalDebt[], relationships: SatdRelationship[]): void {
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
        
        // Set webview content
        this.panel.webview.html = this.getWebviewContent(debtItems, relationships);
        
        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'openFile':
                        this.openFileAtPosition(message.file, message.line);
                        return;
                }
            },
            undefined,
            this.context.subscriptions
        );
    }
    
    /**
     * Generate HTML content for the webview
     * @param debtItems Technical debt items
     * @param relationships Relationships between debt items
     * @returns HTML string
     */
    private getWebviewContent(debtItems: TechnicalDebt[], relationships: SatdRelationship[]): string {
        // Prepare data for visualization
        const nodes = debtItems.map(debt => ({
            id: debt.id,
            label: `${path.basename(debt.file)}:${debt.line}`,
            file: debt.file,
            line: debt.line,
            content: debt.content,
            debtType: debt.debtType || 'Other',
            createdDate: debt.createdDate
        }));
        
        const edges = relationships.map(rel => ({
            id: `${rel.sourceId}-${rel.targetId}`,
            source: rel.sourceId,
            target: rel.targetId,
            label: rel.types.join(', '),
            types: rel.types,
            strength: rel.strength,
            description: rel.description
        }));
        
        // Return HTML with embedded visualization
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Technical Debt Relationships</title>
            <style>
                body, html {
                    height: 100%;
                    margin: 0;
                    padding: 0;
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                }
                #cy {
                    width: 100%;
                    height: 85vh;
                    display: block;
                }
                .controls {
                    padding: 10px;
                    display: flex;
                    flex-wrap: wrap;
                    gap: 10px;
                }
                .filter-section {
                    margin-right: 20px;
                }
                .legend {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 15px;
                    padding: 10px;
                    border-top: 1px solid var(--vscode-panel-border);
                }
                .legend-item {
                    display: flex;
                    align-items: center;
                    margin-right: 15px;
                }
                .legend-color {
                    width: 15px;
                    height: 15px;
                    margin-right: 5px;
                    border-radius: 3px;
                }
                .debt-details {
                    padding: 10px;
                    border-top: 1px solid var(--vscode-panel-border);
                    display: none;
                    max-height: 200px;
                    overflow-y: auto;
                }
                button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 4px 8px;
                    cursor: pointer;
                    border-radius: 2px;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                select {
                    background-color: var(--vscode-dropdown-background);
                    color: var(--vscode-dropdown-foreground);
                    border: 1px solid var(--vscode-dropdown-border);
                    padding: 3px 6px;
                }
                .file-link {
                    color: var(--vscode-textLink-foreground);
                    text-decoration: underline;
                    cursor: pointer;
                }
                #loading {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    font-size: 16px;
                    padding: 20px;
                    background-color: var(--vscode-editorWidget-background);
                    border: 1px solid var(--vscode-editorWidget-border);
                    border-radius: 5px;
                }
                #error {
                    color: var(--vscode-errorForeground);
                    padding: 10px;
                    margin: 10px 0;
                    display: none;
                }
                #stats {
                    font-size: 12px;
                    padding: 5px 10px;
                    color: var(--vscode-descriptionForeground);
                }
            </style>
        </head>
        <body>
            <div id="loading">Loading visualization...</div>
            <div id="error"></div>
            <div id="stats">
                ${debtItems.length} technical debt items, ${relationships.length} relationships
            </div>
            
            <div class="controls">
                <div class="filter-section">
                    <label for="relationshipType">Relationship Type:</label>
                    <select id="relationshipType">
                        <option value="all">All Types</option>
                        <option value="${RelationshipType.CALL_GRAPH}">${RelationshipType.CALL_GRAPH}</option>
                        <option value="${RelationshipType.DATA_DEPENDENCY}">${RelationshipType.DATA_DEPENDENCY}</option>
                        <option value="${RelationshipType.CONTROL_FLOW}">${RelationshipType.CONTROL_FLOW}</option>
                        <option value="${RelationshipType.MODULE_DEPENDENCY}">${RelationshipType.MODULE_DEPENDENCY}</option>
                    </select>
                </div>
                <div class="filter-section">
                    <label for="debtType">Debt Type:</label>
                    <select id="debtType">
                        <option value="all">All Types</option>
                        <option value="Design">Design</option>
                        <option value="Implementation">Implementation</option>
                        <option value="Documentation">Documentation</option>
                        <option value="Defect">Defect</option>
                        <option value="Test">Test</option>
                        <option value="Requirement">Requirement</option>
                        <option value="Architecture">Architecture</option>
                        <option value="Other">Other</option>
                    </select>
                </div>
                <div class="filter-section">
                    <button id="resetLayout">Reset Layout</button>
                    <button id="exportPng">Export PNG</button>
                    <button id="exportJson">Export JSON</button>
                </div>
            </div>
            
            <div id="cy"></div>
            
            <div class="legend">
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #e41a1c;"></div>
                    <span>Design</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #377eb8;"></div>
                    <span>Implementation</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #4daf4a;"></div>
                    <span>Documentation</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #984ea3;"></div>
                    <span>Defect</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #ff7f00;"></div>
                    <span>Test</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #ffff33;"></div>
                    <span>Requirement</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #a65628;"></div>
                    <span>Architecture</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #999999;"></div>
                    <span>Other</span>
                </div>
            </div>
            
            <div id="debtDetails" class="debt-details"></div>

            <script src="https://unpkg.com/cytoscape/dist/cytoscape.min.js"></script>
            <script src="https://unpkg.com/dagre@0.8.5/dist/dagre.min.js"></script>
            <script src="https://unpkg.com/cytoscape-dagre@2.5.0/cytoscape-dagre.js"></script>

            <script>
                // Get DOM elements
                const loadingEl = document.getElementById('loading');
                const errorEl = document.getElementById('error');
                const cyEl = document.getElementById('cy');
                const debtDetailsEl = document.getElementById('debtDetails');
                
                // Initialize VS Code API
                const vscode = acquireVsCodeApi();
                
                // Data for visualization
                const nodes = ${JSON.stringify(nodes)};
                const edges = ${JSON.stringify(edges)};
                
                // Node color mapping based on debt type
                const typeColors = {
                    'Design': '#e41a1c',
                    'Implementation': '#377eb8',
                    'Documentation': '#4daf4a',
                    'Defect': '#984ea3',
                    'Test': '#ff7f00',
                    'Requirement': '#ffff33',
                    'Architecture': '#a65628',
                    'Other': '#999999'
                };
                
                // Show error function
                function showError(message) {
                    errorEl.style.display = 'block';
                    errorEl.textContent = message;
                    if (loadingEl) loadingEl.style.display = 'none';
                }
                
                // Check if libraries are loaded
                if (typeof cytoscape === 'undefined') {
                    showError('Cytoscape library failed to load');
                } else {
                    // Initialize graph when page is loaded
                    window.addEventListener('DOMContentLoaded', initGraph);
                }
                
                function initGraph() {
                    try {
                        // Register the layout extension
                        cytoscape.use(cytoscapeDagre);
                        
                        // Initialize Cytoscape
                        const cy = cytoscape({
                            container: cyEl,
                            elements: {
                                nodes: nodes.map(node => ({ data: node })),
                                edges: edges.map(edge => ({ data: edge }))
                            },
                            style: [
                                {
                                    selector: 'node',
                                    style: {
                                        'label': 'data(label)',
                                        'background-color': function(ele) {
                                            return typeColors[ele.data('debtType')] || typeColors['Other'];
                                        },
                                        'width': 25,
                                        'height': 25,
                                        'font-size': 10,
                                        'text-valign': 'center',
                                        'text-halign': 'right',
                                        'text-margin-x': 5,
                                        'color': '#fff'
                                    }
                                },
                                {
                                    selector: 'edge',
                                    style: {
                                        'curve-style': 'bezier',
                                        'target-arrow-shape': 'triangle',
                                        'arrow-scale': 0.8,
                                        'width': function(ele) {
                                            return ele.data('strength') * 5 || 1;
                                        },
                                        'line-color': '#fff'
                                    }
                                },
                                {
                                    selector: ':selected',
                                    style: {
                                        'border-width': 2,
                                        'border-color': '#fff'
                                    }
                                }
                            ],
                            layout: {
                                name: 'grid' // Start with a simple layout
                            }
                        });
                        
                        // Hide loading indicator
                        if (loadingEl) loadingEl.style.display = 'none';
                        
                        // Run layout after initialization
                        runDagreLayout();
                        
                        // Handle node click
                        cy.on('tap', 'node', function(evt) {
                            const node = evt.target;
                            const data = node.data();
                            
                            // Show debt details
                            if (debtDetailsEl) {
                                debtDetailsEl.style.display = 'block';
                                
                                const fileLink = \`<span class="file-link" data-file="\${data.file}" data-line="\${data.line}">\${data.file}:\${data.line}</span>\`;
                                
                                debtDetailsEl.innerHTML = \`
                                    <h4>Technical Debt Details</h4>
                                    <p><strong>File:</strong> \${fileLink}</p>
                                    <p><strong>Type:</strong> \${data.debtType}</p>
                                    <p><strong>Content:</strong> \${data.content}</p>
                                    <p><strong>Created:</strong> \${data.createdDate}</p>
                                \`;
                                
                                // Add event listener for file link
                                const fileLinkElement = debtDetailsEl.querySelector('.file-link');
                                if (fileLinkElement) {
                                    fileLinkElement.addEventListener('click', function() {
                                        vscode.postMessage({
                                            command: 'openFile',
                                            file: this.getAttribute('data-file'),
                                            line: parseInt(this.getAttribute('data-line'))
                                        });
                                    });
                                }
                            }
                        });
                        
                        // Handle edge click
                        cy.on('tap', 'edge', function(evt) {
                            const edge = evt.target;
                            const data = edge.data();
                            
                            // Show relationship details
                            if (debtDetailsEl) {
                                debtDetailsEl.style.display = 'block';
                                
                                debtDetailsEl.innerHTML = \`
                                    <h4>Relationship Details</h4>
                                    <p><strong>Type:</strong> \${data.label}</p>
                                    <p><strong>Strength:</strong> \${Math.round(data.strength * 100)}%</p>
                                    <p><strong>Description:</strong> \${data.description}</p>
                                \`;
                            }
                        });
                        
                        // Click on background to clear selection
                        cy.on('tap', function(evt) {
                            if (evt.target === cy && debtDetailsEl) {
                                debtDetailsEl.style.display = 'none';
                            }
                        });
                        
                        // Filter by relationship type
                        const relTypeSelect = document.getElementById('relationshipType');
                        if (relTypeSelect) {
                            relTypeSelect.addEventListener('change', function() {
                                const type = this.value;
                                
                                if (type === 'all') {
                                    cy.edges().show();
                                } else {
                                    cy.edges().hide();
                                    cy.edges().filter(edge => {
                                        const types = edge.data('types');
                                        return types && types.includes(type);
                                    }).show();
                                }
                                
                                runDagreLayout();
                            });
                        }
                        
                        // Filter by debt type
                        const debtTypeSelect = document.getElementById('debtType');
                        if (debtTypeSelect) {
                            debtTypeSelect.addEventListener('change', function() {
                                const type = this.value;
                                
                                if (type === 'all') {
                                    cy.nodes().show();
                                    cy.edges().show();
                                } else {
                                    cy.nodes().hide();
                                    cy.nodes().filter(node => node.data('debtType') === type).show();
                                    
                                    // Hide edges not connected to visible nodes
                                    cy.edges().hide();
                                    cy.edges().filter(edge => {
                                        const source = cy.getElementById(edge.data('source'));
                                        const target = cy.getElementById(edge.data('target'));
                                        return source.visible() && target.visible();
                                    }).show();
                                }
                                
                                runDagreLayout();
                            });
                        }
                        
                        // Reset layout button
                        const resetBtn = document.getElementById('resetLayout');
                        if (resetBtn) {
                            resetBtn.addEventListener('click', function() {
                                runDagreLayout();
                            });
                        }
                        
                        // Export PNG button
                        const pngBtn = document.getElementById('exportPng');
                        if (pngBtn) {
                            pngBtn.addEventListener('click', function() {
                                try {
                                    // Create a PNG representation of the graph
                                    const png = cy.png({
                                        full: true,
                                        scale: 2,
                                        bg: '#fff',
                                        output: 'blob'
                                    });
                                    
                                    // Convert to downloadable URL
                                    const url = URL.createObjectURL(png);
                                    
                                    // Create download link
                                    const link = document.createElement('a');
                                    link.href = url;
                                    link.download = 'satd-graph.png';
                                    document.body.appendChild(link);
                                    link.click();
                                    document.body.removeChild(link);
                                    
                                    // Clean up
                                    setTimeout(() => URL.revokeObjectURL(url), 100);
                                } catch (e) {
                                    showError('Failed to export PNG: ' + e.message);
                                    console.error(e);
                                }
                            });
                        }
                        
                        // Export JSON button
                        const jsonBtn = document.getElementById('exportJson');
                        if (jsonBtn) {
                            jsonBtn.addEventListener('click', function() {
                                try {
                                    // Prepare the data
                                    const data = JSON.stringify({
                                        nodes: cy.nodes().map(n => n.data()),
                                        edges: cy.edges().map(e => e.data())
                                    }, null, 2);
                                    
                                    // Create a blob with the data
                                    const blob = new Blob([data], {type: 'application/json'});
                                    
                                    // Convert to downloadable URL
                                    const url = URL.createObjectURL(blob);
                                    
                                    // Create download link
                                    const link = document.createElement('a');
                                    link.href = url;
                                    link.download = 'satd-graph.json';
                                    document.body.appendChild(link);
                                    link.click();
                                    document.body.removeChild(link);
                                    
                                    // Clean up
                                    setTimeout(() => URL.revokeObjectURL(url), 100);
                                } catch (e) {
                                    showError('Failed to export JSON: ' + e.message);
                                    console.error(e);
                                }
                            });
                        }
                        
                        // Helper function to run the Dagre layout
                        function runDagreLayout() {
                            try {
                                const layout = cy.layout({
                                    name: 'dagre',
                                    rankDir: 'TB',
                                    padding: 50,
                                    fit: true
                                });
                                layout.run();
                            } catch (e) {
                                showError('Layout error: ' + e.message);
                                
                                // Fallback to grid layout
                                cy.layout({
                                    name: 'grid'
                                }).run();
                            }
                        }
                    } catch (e) {
                        showError('Initialization error: ' + e.message);
                    }
                }
            </script>
        </body>
        </html>
        `;
    }
    
    /**
     * Open a file at a specific position in VS Code
     * @param filePath Path to the file
     * @param line Line number
     */
    private async openFileAtPosition(filePath: string, line: number): Promise<void> {
        try {
            if (!vscode.workspace.workspaceFolders) {
                return;
            }
            
            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const fullPath = vscode.Uri.file(`${workspaceRoot}/${filePath}`);
            
            const doc = await vscode.workspace.openTextDocument(fullPath);
            const editor = await vscode.window.showTextDocument(doc);
            
            const position = new vscode.Position(line - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
            );
        } catch (error) {
            console.error(`Failed to open file ${filePath}:`, error);
            vscode.window.showErrorMessage(`Failed to open file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}