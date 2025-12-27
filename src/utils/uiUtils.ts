// src/utils/uiUtils.ts
import * as vscode from 'vscode';
import { TechnicalDebt, FixPotential } from '../models';

/**
 * Create a webview panel for displaying technical debt items
 * Enhanced to show SIR scores, fix potential, and remediation plans
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
      <title>RapidPay - Technical Debt Analysis</title>
      <style>
          :root {
            --bg-primary: #1e1e1e;
            --bg-secondary: #252526;
            --bg-tertiary: #2d2d30;
            --text-primary: #cccccc;
            --text-secondary: #858585;
            --accent-blue: #007acc;
            --accent-green: #4ec9b0;
            --accent-yellow: #dcdcaa;
            --accent-red: #f14c4c;
            --accent-orange: #ce9178;
          }
          
          body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            padding: 20px;
            background-color: var(--bg-primary);
            color: var(--text-primary);
            margin: 0;
          }
          
          h1 { 
            color: var(--accent-blue);
            border-bottom: 2px solid var(--accent-blue);
            padding-bottom: 10px;
          }
          
          .summary {
            background-color: var(--bg-secondary);
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: flex;
            gap: 30px;
          }
          
          .summary-item {
            text-align: center;
          }
          
          .summary-value {
            font-size: 2em;
            font-weight: bold;
            color: var(--accent-green);
          }
          
          .summary-label {
            color: var(--text-secondary);
            font-size: 0.9em;
          }
          
          .filters {
            background-color: var(--bg-secondary);
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
          }
          
          .filters select, .filters input {
            background-color: var(--bg-tertiary);
            color: var(--text-primary);
            border: 1px solid var(--text-secondary);
            padding: 8px;
            border-radius: 4px;
            margin-right: 10px;
          }
          
          .debt-item { 
            background-color: var(--bg-secondary); 
            padding: 20px; 
            border-radius: 8px; 
            margin-bottom: 15px;
            border-left: 4px solid var(--accent-blue);
            transition: all 0.2s ease;
          }
          
          .debt-item:hover {
            border-left-color: var(--accent-green);
            transform: translateX(5px);
          }
          
          .debt-item.high-impact {
            border-left-color: var(--accent-red);
          }
          
          .debt-item.medium-impact {
            border-left-color: var(--accent-orange);
          }
          
          .debt-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
          }
          
          .file-link { 
            color: var(--accent-blue); 
            cursor: pointer;
            text-decoration: none;
          }
          
          .file-link:hover {
            text-decoration: underline;
          }
          
          .scores {
            display: flex;
            gap: 15px;
          }
          
          .score-badge {
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 0.85em;
            font-weight: bold;
          }
          
          .sir-score {
            background-color: var(--accent-blue);
            color: white;
          }
          
          .sir-high { background-color: var(--accent-red); }
          .sir-medium { background-color: var(--accent-orange); }
          .sir-low { background-color: var(--accent-green); }
          
          .confidence-badge {
            background-color: var(--bg-tertiary);
            color: var(--text-primary);
          }
          
          .fix-potential {
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 0.85em;
          }
          
          .fix-high { background-color: #28a745; color: white; }
          .fix-partial { background-color: #ffc107; color: black; }
          .fix-low { background-color: #6c757d; color: white; }
          
          .debt-type {
            display: inline-block;
            padding: 2px 8px;
            background-color: var(--bg-tertiary);
            border-radius: 4px;
            font-size: 0.8em;
            color: var(--accent-yellow);
          }
          
          pre { 
            background-color: var(--bg-tertiary); 
            padding: 12px; 
            border-radius: 6px; 
            overflow: auto;
            font-size: 0.9em;
            border: 1px solid #404040;
          }
          
          .description {
            color: var(--text-primary);
            margin: 10px 0;
            line-height: 1.5;
          }
          
          .metadata {
            display: flex;
            gap: 20px;
            color: var(--text-secondary);
            font-size: 0.85em;
            margin-top: 10px;
          }
          
          .sir-components {
            background-color: var(--bg-tertiary);
            padding: 10px;
            border-radius: 6px;
            margin-top: 10px;
            font-size: 0.85em;
          }
          
          .sir-components-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin-top: 5px;
          }
          
          .sir-component {
            text-align: center;
          }
          
          .sir-component-value {
            font-size: 1.2em;
            font-weight: bold;
            color: var(--accent-green);
          }
          
          .sir-component-label {
            font-size: 0.8em;
            color: var(--text-secondary);
          }
          
          .remediation-plan {
            background-color: var(--bg-tertiary);
            padding: 15px;
            border-radius: 6px;
            margin-top: 15px;
            border: 1px solid var(--accent-green);
          }
          
          .remediation-plan h4 {
            color: var(--accent-green);
            margin: 0 0 10px 0;
          }
          
          .remediation-content {
            white-space: pre-wrap;
            line-height: 1.6;
          }
          
          .expand-btn {
            background-color: var(--bg-tertiary);
            color: var(--text-primary);
            border: 1px solid var(--text-secondary);
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
          }
          
          .expand-btn:hover {
            background-color: var(--accent-blue);
          }
          
          .hidden {
            display: none;
          }
      </style>
  </head>
  <body>
      <h1>🔍 RapidPay - Technical Debt Analysis</h1>
      
      <div class="summary">
        <div class="summary-item">
          <div class="summary-value">${debtItems.length}</div>
          <div class="summary-label">Total SATD</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${debtItems.filter(d => (d.sirScore || 0) > 0.7).length}</div>
          <div class="summary-label">High Impact</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${debtItems.filter(d => d.fixPotential === 'HIGH').length}</div>
          <div class="summary-label">High Fix Potential</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${new Set(debtItems.map(d => d.file)).size}</div>
          <div class="summary-label">Files Affected</div>
        </div>
      </div>
      
      <div class="filters">
        <label>Sort by: </label>
        <select id="sortBy" onchange="sortItems()">
          <option value="sir">SIR Score (High to Low)</option>
          <option value="rank">CAIG Rank</option>
          <option value="file">File Name</option>
          <option value="date">Date (Newest First)</option>
        </select>
        
        <label>Filter Type: </label>
        <select id="filterType" onchange="filterItems()">
          <option value="all">All Types</option>
          <option value="Design">Design</option>
          <option value="Implementation">Implementation</option>
          <option value="Defect">Defect</option>
          <option value="Test">Test</option>
          <option value="Documentation">Documentation</option>
          <option value="Architecture">Architecture</option>
        </select>
      </div>
      
      <div id="debt-list">
  `;
  
  // Sort by SIR score by default
  const sortedItems = [...debtItems].sort((a, b) => (b.sirScore || 0) - (a.sirScore || 0));
  
  for (const item of sortedItems) {
    const sirScore = item.sirScore || 0;
    const sirClass = sirScore > 0.7 ? 'sir-high' : sirScore > 0.4 ? 'sir-medium' : 'sir-low';
    const impactClass = sirScore > 0.7 ? 'high-impact' : sirScore > 0.4 ? 'medium-impact' : '';
    const fixPotentialClass = item.fixPotential === FixPotential.HIGH ? 'fix-high' : 
                              item.fixPotential === FixPotential.PARTIAL ? 'fix-partial' : 'fix-low';
    
    html += `
    <div class="debt-item ${impactClass}" data-type="${item.debtType || 'Other'}" data-sir="${sirScore}" data-rank="${item.rankScore || 0}" data-file="${item.file}" data-date="${item.createdDate}">
        <div class="debt-header">
          <div>
            <span class="file-link" data-file="${item.file}" data-line="${item.line}">${item.file}:${item.line}</span>
            <span class="debt-type">${item.debtType || 'Unknown'}</span>
          </div>
          <div class="scores">
            <span class="score-badge sir-score ${sirClass}">SIR: ${(sirScore * 100).toFixed(0)}%</span>
            ${item.confidence !== undefined ? `<span class="score-badge confidence-badge">Conf: ${(item.confidence * 100).toFixed(0)}%</span>` : ''}
            ${item.fixPotential ? `<span class="score-badge fix-potential ${fixPotentialClass}">${item.fixPotential}</span>` : ''}
            ${item.rankScore !== undefined ? `<span class="score-badge" style="background-color:#6f42c1;color:white">Rank: ${(item.rankScore * 100).toFixed(0)}</span>` : ''}
          </div>
        </div>
        
        <pre>${escapeHtml(item.content)}</pre>
        
        <p class="description">${escapeHtml(item.description)}</p>
        
        <div class="metadata">
          <span>📅 ${item.createdDate}</span>
          <span>🔗 ${item.createdCommit.substring(0, 7)}</span>
          ${item.effortScore !== undefined ? `<span>⏱️ Effort: ${(item.effortScore * 100).toFixed(0)}%</span>` : ''}
          ${item.commitRelevance !== undefined ? `<span>📊 Commit Rel: ${(item.commitRelevance * 100).toFixed(0)}%</span>` : ''}
        </div>
        
        ${item.sirComponents ? `
        <div class="sir-components">
          <strong>SIR Components:</strong>
          <div class="sir-components-grid">
            <div class="sir-component">
              <div class="sir-component-value">${(item.sirComponents.fanout_w * 100).toFixed(0)}%</div>
              <div class="sir-component-label">Fanout</div>
            </div>
            <div class="sir-component">
              <div class="sir-component-value">${(item.sirComponents.chainLen_w * 100).toFixed(0)}%</div>
              <div class="sir-component-label">Chain Length</div>
            </div>
            <div class="sir-component">
              <div class="sir-component-value">${(item.sirComponents.reachability_w * 100).toFixed(0)}%</div>
              <div class="sir-component-label">Reachability</div>
            </div>
          </div>
        </div>
        ` : ''}
        
        ${item.remediationPlan ? `
        <div class="remediation-plan">
          <h4>📋 Remediation Plan</h4>
          <button class="expand-btn" onclick="togglePlan(this)">Show Plan</button>
          <div class="remediation-content hidden">${escapeHtml(item.remediationPlan)}</div>
        </div>
        ` : ''}
    </div>
    `;
  }
  
  html += `
      </div>
      
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
          
          function togglePlan(btn) {
            const content = btn.nextElementSibling;
            if (content.classList.contains('hidden')) {
              content.classList.remove('hidden');
              btn.textContent = 'Hide Plan';
            } else {
              content.classList.add('hidden');
              btn.textContent = 'Show Plan';
            }
          }
          
          function sortItems() {
            const sortBy = document.getElementById('sortBy').value;
            const container = document.getElementById('debt-list');
            const items = Array.from(container.querySelectorAll('.debt-item'));
            
            items.sort((a, b) => {
              if (sortBy === 'sir') {
                return parseFloat(b.dataset.sir) - parseFloat(a.dataset.sir);
              } else if (sortBy === 'rank') {
                return parseFloat(b.dataset.rank) - parseFloat(a.dataset.rank);
              } else if (sortBy === 'file') {
                return a.dataset.file.localeCompare(b.dataset.file);
              } else if (sortBy === 'date') {
                return new Date(b.dataset.date) - new Date(a.dataset.date);
              }
              return 0;
            });
            
            items.forEach(item => container.appendChild(item));
          }
          
          function filterItems() {
            const filterType = document.getElementById('filterType').value;
            const items = document.querySelectorAll('.debt-item');
            
            items.forEach(item => {
              if (filterType === 'all' || item.dataset.type === filterType) {
                item.style.display = 'block';
              } else {
                item.style.display = 'none';
              }
            });
          }
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
 * Escape HTML characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
  
  const sirScore = debtItem.sirScore || 0;
  
  panel.webview.html = `
  <!DOCTYPE html>
  <html>
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Technical Debt Fix Suggestions</title>
      <style>
          :root {
            --bg-primary: #1e1e1e;
            --bg-secondary: #252526;
            --text-primary: #cccccc;
            --accent-blue: #007acc;
            --accent-green: #4ec9b0;
          }
          body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            padding: 20px;
            background-color: var(--bg-primary);
            color: var(--text-primary);
          }
          h1, h2 { color: var(--accent-blue); }
          .debt-item { 
            background-color: var(--bg-secondary); 
            padding: 15px; 
            border-radius: 8px; 
            margin-bottom: 20px;
          }
          .suggestions { 
            background-color: var(--bg-secondary); 
            padding: 15px; 
            border-radius: 8px;
            border-left: 4px solid var(--accent-green);
          }
          pre { 
            background-color: #2d2d30; 
            padding: 10px; 
            border-radius: 6px; 
            overflow: auto;
          }
          .score-badge {
            display: inline-block;
            padding: 4px 12px;
            background-color: var(--accent-blue);
            color: white;
            border-radius: 12px;
            font-weight: bold;
          }
      </style>
  </head>
  <body>
      <h1>🔧 Technical Debt Fix Suggestions</h1>
      <div class="debt-item">
          <h2>Technical Debt</h2>
          <p><strong>File:</strong> ${debtItem.file}:${debtItem.line}</p>
          <p><span class="score-badge">SIR: ${(sirScore * 100).toFixed(0)}%</span></p>
          <pre>${escapeHtml(debtItem.content)}</pre>
          <p><strong>Description:</strong> ${escapeHtml(debtItem.description)}</p>
      </div>
      <div class="suggestions">
          <h2>AI-Generated Suggestions</h2>
          <div style="white-space: pre-wrap; line-height: 1.6;">${escapeHtml(analysis)}</div>
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
