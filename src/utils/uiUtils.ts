// src/utils/uiUtils.ts
import * as vscode from 'vscode';
import { TechnicalDebt } from '../models';

/**
 * Create a webview panel for displaying technical debt items
 * @param debtItems Array of technical debt items
 * @param context Extension context
 */
export function showTechnicalDebtPanel(
  debtItems: TechnicalDebt[], 
  context: vscode.ExtensionContext
): void {
  if (debtItems.length === 0) {
    vscode.window.showInformationMessage('No technical debt items found. Run the initialization command first.');
    return;
  }
  
  const panel = vscode.window.createWebviewPanel(
    'satdList',
    'Technical Debt Items',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  
  let html = `
  <!DOCTYPE html>
  <html>
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Technical Debt Items</title>
      <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; }
          h1 { color: #333; }
          .debt-item { background-color: rgb(9, 9, 9); padding: 15px; border-radius: 5px; margin-bottom: 20px; }
          .file-link { color: #0078d7; cursor: pointer; }
          pre { background-color: rgb(40, 78, 39); padding: 10px; border-radius: 3px; overflow: auto; }
      </style>
  </head>
  <body>
      <h1>Technical Debt Items</h1>
  `;
  
  for (const item of debtItems) {
    html += `
    <div class="debt-item">
        <p><strong>File:</strong> <span class="file-link" data-file="${item.file}" data-line="${item.line}">${item.file}:${item.line}</span></p>
        <pre>${item.content}</pre>
        <p><strong>Description:</strong> ${item.description}</p>
        <p><strong>Created:</strong> ${item.createdDate} (${item.createdCommit.substring(0, 7)})</p>
    </div>
    `;
  }
  
  html += `
      <script>
          const vscode = acquireVsCodeApi();
          document.querySelectorAll('.file-link').forEach(link => {
              link.addEventListener('click', () => {
                  vscode.postMessage({
                      command: 'openFile',
                      file: link.getAttribute('data-file'),
                      line: parseInt(link.getAttribute('data-line'), 10)
                  });
              });
          });
      </script>
  </body>
  </html>
  `;
  
  panel.webview.html = html;
  
  panel.webview.onDidReceiveMessage(
    message => {
      if (message.command === 'openFile') {
        openFileAtPosition(message.file, message.line);
      }
    },
    undefined,
    context.subscriptions
  );
}

/**
 * Open a file at a specific position
 * @param filePath Path to the file
 * @param line Line number
 */
export function openFileAtPosition(filePath: string, line: number): void {
  if (!vscode.workspace.workspaceFolders) {
    return;
  }
  
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const fullPath = vscode.Uri.file(`${workspaceRoot}/${filePath}`);
  
  vscode.workspace.openTextDocument(fullPath).then(doc => {
    vscode.window.showTextDocument(doc).then(editor => {
      const position = new vscode.Position(line - 1, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter
      );
    });
  });
}

/**
 * Show a panel with technical debt fix suggestions
 * @param debtItem Technical debt item
 * @param analysis Analysis of the fix
 */
export function showDebtFixSuggestionsPanel(
  debtItem: TechnicalDebt, 
  analysis: string
): void {
  const panel = vscode.window.createWebviewPanel(
    'satdSuggestions',
    'Technical Debt Fix Suggestions',
    vscode.ViewColumn.Beside,
    {}
  );
  
  panel.webview.html = `
  <!DOCTYPE html>
  <html>
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Technical Debt Fix Suggestions</title>
      <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; }
          h1 { color: #333; }
          .debt-item { background-color: rgb(6, 6, 6); padding: 15px; border-radius: 5px; margin-bottom: 20px; }
          .suggestions { background-color:rgb(15, 11, 231); padding: 15px; border-radius: 5px; }
          pre { background-color: rgb(40, 78, 39); padding: 10px; border-radius: 3px; overflow: auto; }
      </style>
  </head>
  <body>
      <h1>Technical Debt Fix Suggestions</h1>
      <div class="debt-item">
          <h2>Technical Debt</h2>
          <p><strong>File:</strong> ${debtItem.file}</p>
          <p><strong>Line:</strong> ${debtItem.line}</p>
          <pre>${debtItem.content}</pre>
          <p><strong>Description:</strong> ${debtItem.description}</p>
      </div>
      <div class="suggestions">
          <h2>AI Suggestions</h2>
          <div>${analysis.replace(/\n/g, '<br>')}</div>
      </div>
  </body>
  </html>
  `;
}

/**
 * Show a progress notification for a task
 * @param title Title of the notification
 * @param task Task to execute
 * @returns Promise with the result of the task
 */
export async function withProgressNotification<T>(
  title: string, 
  task: (
    progress: vscode.Progress<{ message?: string; increment?: number }>
  ) => Promise<T>
): Promise<T> {
  return vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title,
    cancellable: false
  }, task);
}