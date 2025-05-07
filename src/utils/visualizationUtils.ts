// src/utils/visualizationUtils.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { TechnicalDebt, SatdRelationship, RelationshipType, DebtType } from '../models';
import * as fs from 'fs';

/**
 * Open a file at a specific position in VS Code
 * @param filePath Path to the file
 * @param line Line number
 */
export async function openFileAtPosition(filePath: string, line: number): Promise<void> {
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

/**
 * Load an HTML template from a file
 * @param context Extension context
 * @param templatePath Path to the HTML template file relative to extension root
 * @returns Content of the HTML file
 */
export function loadHtmlTemplate(context: vscode.ExtensionContext, templatePath: string): string {
    const fullPath = context.asAbsolutePath(templatePath);
    
    try {
        return fs.readFileSync(fullPath, 'utf8');
    } catch (error) {
        console.error(`Failed to load HTML template: ${error}`);
        return `<html><body><h1>Error: Failed to load template ${templatePath}</h1><p>${error}</p></body></html>`;
    }
}

/**
 * Generate HTML content for the webview visualization
 * @param context Extension context
 * @param debtItems Technical debt items
 * @param relationships Relationships between debt items
 * @returns HTML string
 */
export function generateGraphVisualizationHTML(
    context: vscode.ExtensionContext,
    debtItems: TechnicalDebt[], 
    relationships: SatdRelationship[]
): string {
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
    
    // Load the HTML template
    let template = loadHtmlTemplate(context, 'resources/templates/graphVisualization.html');
    
    // Replace placeholders with actual data
    template = template
        .replace(/RELATIONSHIP_TYPE_CALL_GRAPH/g, RelationshipType.CALL_GRAPH)
        .replace(/RELATIONSHIP_TYPE_DATA_DEPENDENCY/g, RelationshipType.DATA_DEPENDENCY)
        .replace(/RELATIONSHIP_TYPE_CONTROL_FLOW/g, RelationshipType.CONTROL_FLOW)
        .replace(/RELATIONSHIP_TYPE_MODULE_DEPENDENCY/g, RelationshipType.MODULE_DEPENDENCY)
        .replace(/DEBT_ITEMS_COUNT/g, debtItems.length.toString())
        .replace(/RELATIONSHIPS_COUNT/g, relationships.length.toString())
        .replace('NODES_DATA_PLACEHOLDER', JSON.stringify(nodes))
        .replace('EDGES_DATA_PLACEHOLDER', JSON.stringify(edges));
    
    return template;
}