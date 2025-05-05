import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { OpenAI } from 'openai';

const execPromise = promisify(exec);

interface TechnicalDebt {
  id: string;
  file: string;
  line: number;
  content: string;
  description: string;
  createdCommit: string;
  createdDate: string;
}

let openai: OpenAI | null = null;
let technicalDebtItems: TechnicalDebt[] = [];

export function activate(context: vscode.ExtensionContext) {
  console.log('SATD Helper Extension is now active');

  // Initialize OpenAI client with API key from VS Code settings
  const initializeOpenAI = () => {
    // Get the API key from VS Code settings
    const config = vscode.workspace.getConfiguration('satdHelper');
    let apiKey = config.get<string>('openaiApiKey');
    
    // If no API key in settings, check for environment variable through VS Code
    if (!apiKey) {
      // Try to get from VS Code's environment
      const processEnv = process.env;
      apiKey = processEnv.OPENAI_API_KEY;
    }
    
    if (!apiKey) {
      vscode.window.showErrorMessage(
        'OpenAI API key not found. Please set it in the extension settings or as OPENAI_API_KEY environment variable.',
        'Open Settings'
      ).then(selection => {
        if (selection === 'Open Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'satdHelper.openaiApiKey');
        }
      });
      return false;
    }

    try {
      openai = new OpenAI({
        apiKey: apiKey
      });
      return true;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to initialize OpenAI client: ${error}`);
      return false;
    }
  };

  // Get Git repository information
  const getRepositoryInfo = async () => {
    try {
      if (!vscode.workspace.workspaceFolders) {
        vscode.window.showInformationMessage('No workspace folder open');
        return null;
      }
      
      const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
      
      const { stdout: remoteUrl } = await execPromise('git config --get remote.origin.url', { cwd: workspaceRoot });
      const { stdout: branch } = await execPromise('git branch --show-current', { cwd: workspaceRoot });
      const { stdout: commits } = await execPromise('git rev-list --count HEAD', { cwd: workspaceRoot });
      
      return {
        remoteUrl: remoteUrl.trim(),
        branch: branch.trim(),
        commitCount: parseInt(commits.trim(), 10)
      };
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to get repository info: ${error}`);
      return null;
    }
  };

  // Scan repository for technical debt comments
  const scanRepositoryForTechnicalDebt = async () => {
    try {
      if (!vscode.workspace.workspaceFolders) {
        return [];
      }
      
      const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
      
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
            description: content.trim(),
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
  };

  // Analyze technical debt with OpenAI
  const analyzeTechnicalDebt = async (debtItems: TechnicalDebt[]) => {
    if (!openai) {
      return debtItems;
    }
    
    const enhancedDebtItems: TechnicalDebt[] = [];
    
    for (const item of debtItems) {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4",
          messages: [
            {
              role: "system",
              content: "You are a code analysis assistant that helps understand technical debt."
            },
            {
              role: "user",
              content: `Analyze this technical debt comment and provide a clear description of the issue: "${item.content}"`
            }
          ],
          max_tokens: 150
        });
        
        const description = response.choices[0]?.message.content?.trim() || item.description;
        enhancedDebtItems.push({
          ...item,
          description
        });
      } catch (error) {
        console.error(`Failed to analyze technical debt: ${error}`);
        enhancedDebtItems.push(item);
      }
    }
    
    return enhancedDebtItems;
  };

  // Check if commit addresses technical debt
  const checkCommitForTechnicalDebtFixes = async () => {
    if (!openai || technicalDebtItems.length === 0) {
      return;
    }
    
    try {
      if (!vscode.workspace.workspaceFolders) {
        return;
      }
      
      const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
      
      // Get the latest commit information
      const { stdout: commitHash } = await execPromise('git rev-parse HEAD', { cwd: workspaceRoot });
      const { stdout: commitMessage } = await execPromise('git log -1 --pretty=%B', { cwd: workspaceRoot });
      const { stdout: diff } = await execPromise('git show --name-status', { cwd: workspaceRoot });
      
      // For each technical debt item, check if this commit might address it
      for (const debtItem of technicalDebtItems) {
        try {
          const response = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
              {
                role: "system",
                content: "You are a code analysis assistant that helps developers address technical debt."
              },
              {
                role: "user",
                content: `
                Technical Debt Item:
                File: ${debtItem.file}
                Line: ${debtItem.line}
                Content: ${debtItem.content}
                Description: ${debtItem.description}
                
                Recent Commit:
                Hash: ${commitHash.trim()}
                Message: ${commitMessage.trim()}
                Changes:
                ${diff.trim()}
                
                Question: Does this commit address or partially address the technical debt item? 
                If yes, provide specific suggestions on how to completely resolve the technical debt based on the recent changes.
                If no, simply respond with "UNRELATED".
                `
              }
            ],
            max_tokens: 500
          });
          
          const analysis = response.choices[0]?.message.content?.trim();
          
          if (analysis && !analysis.includes("UNRELATED")) {
            vscode.window.showInformationMessage(
              `Potential fix for technical debt in ${debtItem.file}:${debtItem.line}`,
              'View Suggestions'
            ).then(selection => {
              if (selection === 'View Suggestions') {
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
                        .debt-item { background-color:rgb(6, 6, 6); padding: 15px; border-radius: 5px; margin-bottom: 20px; }
                        .suggestions { background-color: #e6f7ff; padding: 15px; border-radius: 5px; }
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
            });
          }
        } catch (error) {
          console.error(`Failed to analyze commit for technical debt fixes: ${error}`);
        }
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to check commit: ${error}`);
    }
  };

  // Command: Initialize and scan repository
  const initCommand = vscode.commands.registerCommand('satdHelper.init', async () => {
    if (!initializeOpenAI()) {
      return;
    }
    
    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "SATD Helper",
      cancellable: false
    }, async (progress) => {
      progress.report({ message: "Getting repository information..." });
      const repoInfo = await getRepositoryInfo();
      
      if (!repoInfo) {
        return;
      }
      
      progress.report({ message: "Scanning repository for technical debt..." });
      const debtItems = await scanRepositoryForTechnicalDebt();
      
      progress.report({ message: "Analyzing technical debt items..." });
      technicalDebtItems = await analyzeTechnicalDebt(debtItems);
      
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
    if (technicalDebtItems.length === 0) {
      vscode.window.showInformationMessage('No technical debt items found. Run the initialization command first.');
      return;
    }
    
    const panel = vscode.window.createWebviewPanel(
      'satdList',
      'Technical Debt Items',
      vscode.ViewColumn.One,
      {}
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
            .debt-item { background-color:rgb(9, 9, 9); padding: 15px; border-radius: 5px; margin-bottom: 20px; }
            .file-link { color: #0078d7; cursor: pointer; }
            pre { background-color:rgb(40, 78, 39); padding: 10px; border-radius: 3px; overflow: auto; }
        </style>
    </head>
    <body>
        <h1>Technical Debt Items</h1>
    `;
    
    for (const item of technicalDebtItems) {
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
          const filePath = vscode.Uri.file(
            `${vscode.workspace.workspaceFolders?.[0].uri.fsPath}/${message.file}`
          );
          
          vscode.workspace.openTextDocument(filePath).then(doc => {
            vscode.window.showTextDocument(doc).then(editor => {
              const position = new vscode.Position(message.line - 1, 0);
              editor.selection = new vscode.Selection(position, position);
              editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
              );
            });
          });
        }
      },
      undefined,
      context.subscriptions
    );
  });

  // Event: Listen for Git post-commit hook
  const gitEventListener = vscode.workspace.onDidSaveTextDocument(async (document) => {
    // This is a simplified approach; in a real extension we would use Git extension API
    // or custom hooks to detect actual commits
    const fileName = document.fileName.toLowerCase();
    
    // Check if this is a git commit file
    if (fileName.includes('.git') && fileName.includes('commit')) {
      // Wait a bit for the commit to be completed
      setTimeout(async () => {
        await checkCommitForTechnicalDebtFixes();
      }, 2000);
    }
  });

  context.subscriptions.push(initCommand);
  context.subscriptions.push(viewTechnicalDebtCommand);
  context.subscriptions.push(gitEventListener);
}

export function deactivate() {
  // Clean up resources
  technicalDebtItems = [];
  openai = null;
}