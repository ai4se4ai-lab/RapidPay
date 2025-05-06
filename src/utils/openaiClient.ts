// src/utils/openaiClient.ts
import * as vscode from 'vscode';
import { OpenAI } from 'openai';

let openaiClient: OpenAI | null = null;

/**
 * Initialize the OpenAI client with API key from VS Code settings or environment
 * @returns boolean indicating success
 */
export function initializeOpenAI(): boolean {
  try {
    // Get the API key from VS Code settings
    const config = vscode.workspace.getConfiguration('satdHelper');
    let apiKey = config.get<string>('openaiApiKey');
    
    // If no API key in settings, check for environment variable
    if (!apiKey) {
      // Try to get from environment
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

    openaiClient = new OpenAI({
      apiKey: apiKey
    });
    return true;
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to initialize OpenAI client: ${error}`);
    return false;
  }
}

/**
 * Get the OpenAI client instance
 * @returns OpenAI client instance or null
 */
export function getOpenAIClient(): OpenAI | null {
  return openaiClient;
}

/**
 * Analyze technical debt comment with OpenAI
 * @param content The technical debt comment content
 * @returns AI-enhanced description or the original content if analysis fails
 */
export async function analyzeTechnicalDebtComment(content: string): Promise<string> {
  if (!openaiClient) {
    return content;
  }
  
  try {
    const response = await openaiClient.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a code analysis assistant that helps understand technical debt."
        },
        {
          role: "user",
          content: `Analyze this technical debt comment and provide a clear description of the issue: "${content}"`
        }
      ],
      max_tokens: 150
    });
    
    return response.choices[0]?.message.content?.trim() || content;
  } catch (error) {
    console.error(`Failed to analyze technical debt comment: ${error}`);
    return content;
  }
}

/**
 * Analyze if a commit addresses a technical debt item
 * @param debtItem The technical debt item
 * @param commitHash The commit hash
 * @param commitMessage The commit message
 * @param diff The commit diff
 * @returns Analysis result or null if analysis fails
 */
export async function analyzeDebtFix(
  debtItem: {
    file: string;
    line: number;
    content: string;
    description: string;
  }, 
  commitHash: string, 
  commitMessage: string, 
  diff: string
): Promise<string | null> {
  if (!openaiClient) {
    return null;
  }
  
  try {
    const response = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
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
    
    return response.choices[0]?.message.content?.trim() || null;
  } catch (error) {
    console.error(`Failed to analyze commit for technical debt fixes: ${error}`);
    return null;
  }
}

/**
 * Reset the OpenAI client (for deactivation)
 */
export function resetOpenAIClient(): void {
  openaiClient = null;
}