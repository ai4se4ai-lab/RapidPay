// src/utils/openaiClient.ts
// Conditional import for vscode (only available in VS Code extension context)
let vscode: typeof import('vscode') | undefined;
try {
  vscode = require('vscode');
} catch {
  // vscode module not available (CLI mode)
  vscode = undefined;
}

import { OpenAI } from 'openai';
import {
  SATDClassificationResult,
  FixPotential,
  FixPotentialResult,
  RemediationPlan,
  FIX_POTENTIAL_VALUES,
  TechnicalDebt
} from '../models';

let openaiClient: OpenAI | null = null;
let modelName: string = 'gpt-4o';

/**
 * Initialize the OpenAI client with API key from VS Code settings or environment
 * @returns boolean indicating success
 */
export function initializeOpenAI(): boolean {
  try {
    let apiKey: string | undefined;
    
    // Get the API key from VS Code settings if available
    if (vscode) {
      const config = vscode.workspace.getConfiguration('RapidPay');
      apiKey = config.get<string>('openaiApiKey');
      modelName = config.get<string>('modelName') || 'gpt-4o';
    }
    
    // If no API key in settings, check for environment variable
    if (!apiKey) {
      // Try to get from environment
      const processEnv = process.env;
      apiKey = processEnv.OPENAI_API_KEY;
    }
    
    if (!apiKey) {
      if (vscode) {
        vscode.window.showErrorMessage(
          'OpenAI API key not found. Please set it in the extension settings or as OPENAI_API_KEY environment variable.',
          'Open Settings'
        ).then(selection => {
          if (selection === 'Open Settings') {
            vscode!.commands.executeCommand('workbench.action.openSettings', 'RapidPay.openaiApiKey');
          }
        });
      } else {
        console.error('OpenAI API key not found. Please set OPENAI_API_KEY environment variable.');
      }
      return false;
    }

    openaiClient = new OpenAI({
      apiKey: apiKey
    });
    return true;
  } catch (error) {
    if (vscode) {
      vscode.window.showErrorMessage(`Failed to initialize OpenAI client: ${error}`);
    } else {
      console.error(`Failed to initialize OpenAI client: ${error}`);
    }
    return false;
  }
}

/**
 * Initialize OpenAI client for CLI usage (without VS Code)
 * @param apiKey OpenAI API key
 * @param model Model name (default: gpt-4o)
 */
export function initializeOpenAICLI(apiKey: string, model: string = 'gpt-4o'): boolean {
  try {
    openaiClient = new OpenAI({ apiKey });
    modelName = model;
    return true;
  } catch (error) {
    console.error(`Failed to initialize OpenAI client: ${error}`);
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
 * Retry helper with exponential backoff for rate limit errors
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Check if it's a rate limit error (429) or quota error
      const isRateLimit = error?.status === 429 || 
                          error?.message?.includes('429') ||
                          error?.message?.includes('quota') ||
                          error?.message?.includes('rate limit');
      
      if (isRateLimit && attempt < maxRetries - 1) {
        // Exponential backoff: 1s, 2s, 4s, etc.
        const delay = initialDelay * Math.pow(2, attempt);
        console.warn(`Rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // If not a rate limit error or max retries reached, throw
      throw error;
    }
  }
  
  throw lastError;
}

/**
 * PROMPT 1: SATD Instance Detection (SID)
 * Classifies a code comment as SATD or non-SATD with confidence score
 * 
 * @param commentText The code comment to classify
 * @param surroundingCode The surrounding code context
 * @returns Classification result with TRUE/FALSE and confidence score
 */
export async function classifySATD(
  commentText: string,
  surroundingCode: string
): Promise<SATDClassificationResult> {
  if (!openaiClient) {
    return { isSATD: false, confidence: 0 };
  }

  const prompt = `Given the following code comment and its surrounding code context, determine whether this comment represents a developer's acknowledgment of suboptimal implementation, technical shortcuts, or known limitations that constitute SATD. Consider comments that express concerns about code quality, temporary solutions, known issues, or areas needing improvement. Respond with 'TRUE' if the comment indicates SATD, or 'FALSE' otherwise. Also provide a confidence score from 0 to 100.

Comment: ${commentText}

Code Context:
${surroundingCode}

Respond in the following format only:
CLASSIFICATION: TRUE or FALSE
CONFIDENCE: <number from 0 to 100>`;

  try {
    const response = await retryWithBackoff(async () => {
      return await openaiClient!.chat.completions.create({
        model: modelName,
        messages: [
          {
            role: "system",
            content: "You are a code analysis assistant specialized in detecting Self-Admitted Technical Debt (SATD) in source code comments. SATD includes TODO comments, FIXME notes, hack acknowledgments, workaround descriptions, and any developer-written text acknowledging suboptimal code quality or implementation shortcuts."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 100,
        temperature: 0.1
      });
    });

    const responseText = response.choices[0]?.message.content?.trim() || '';
    
    // Parse response
    const classificationMatch = responseText.match(/CLASSIFICATION:\s*(TRUE|FALSE)/i);
    const confidenceMatch = responseText.match(/CONFIDENCE:\s*(\d+)/i);
    
    const isSATD = classificationMatch ? classificationMatch[1].toUpperCase() === 'TRUE' : false;
    const confidenceRaw = confidenceMatch ? parseInt(confidenceMatch[1], 10) : 0;
    const confidence = Math.min(100, Math.max(0, confidenceRaw)) / 100; // Normalize to 0-1
    
    return {
      isSATD,
      confidence,
      rawResponse: responseText
    };
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    console.error(`Failed to classify SATD: ${errorMessage}`);
    
    // Return a more informative error result
    return { 
      isSATD: false, 
      confidence: 0,
      error: errorMessage
    };
  }
}

/**
 * PROMPT 2: Fix Potential Assessment (CAIG)
 * Assesses whether recent changes enable debt resolution
 * 
 * @param satdComment The SATD comment
 * @param filePath File path containing the SATD
 * @param lineNumber Line number of the SATD
 * @param diffContent Recent changes diff
 * @param changedFiles List of changed files
 * @returns Fix potential assessment (HIGH/PARTIAL/LOW)
 */
export async function assessFixPotential(
  satdComment: string,
  filePath: string,
  lineNumber: number,
  diffContent: string,
  changedFiles: string[]
): Promise<FixPotentialResult> {
  if (!openaiClient) {
    return { potential: FixPotential.LOW, value: 0 };
  }

  const prompt = `Technical Debt: "${satdComment}" at ${filePath}:${lineNumber}. Recent Changes: ${diffContent} in [${changedFiles.join(', ')}]. Assess if changes enable debt resolution: HIGH (directly addresses), PARTIAL (related opportunity), LOW (unrelated). Respond: HIGH, PARTIAL, or LOW.

Also provide a brief justification (1-2 sentences).

Respond in the following format only:
ASSESSMENT: HIGH, PARTIAL, or LOW
JUSTIFICATION: <brief explanation>`;

  try {
    const response = await openaiClient.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: "system",
          content: "You are a code analysis assistant that helps developers identify opportunities to address technical debt during their regular development workflow. Analyze whether recent code changes create an opportunity to fix existing technical debt."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 200,
      temperature: 0.1
    });

    const responseText = response.choices[0]?.message.content?.trim() || '';
    
    // Parse response
    const assessmentMatch = responseText.match(/ASSESSMENT:\s*(HIGH|PARTIAL|LOW)/i);
    const justificationMatch = responseText.match(/JUSTIFICATION:\s*(.+)/is);
    
    let potential: FixPotential;
    if (assessmentMatch) {
      const assessment = assessmentMatch[1].toUpperCase();
      if (assessment === 'HIGH') {
        potential = FixPotential.HIGH;
      } else if (assessment === 'PARTIAL') {
        potential = FixPotential.PARTIAL;
      } else {
        potential = FixPotential.LOW;
      }
    } else {
      potential = FixPotential.LOW;
    }

    return {
      potential,
      value: FIX_POTENTIAL_VALUES[potential],
      justification: justificationMatch ? justificationMatch[1].trim() : undefined
    };
  } catch (error) {
    console.error(`Failed to assess fix potential: ${error}`);
    return { potential: FixPotential.LOW, value: 0 };
  }
}

/**
 * PROMPT 3: Remediation Plan Generation (CAIG)
 * Generates actionable remediation plan for high-priority SATD
 * 
 * @param satdComment The SATD comment
 * @param sirScore The SIR score of the SATD instance
 * @param fixPotential The assessed fix potential
 * @param summarizedChanges Summary of recent relevant changes
 * @param connectedSatdItems Related SATD items in the same chain
 * @returns Detailed remediation plan
 */
export async function generateRemediationPlan(
  satdComment: string,
  sirScore: number,
  fixPotential: FixPotential,
  summarizedChanges: string,
  connectedSatdItems: Array<{ id: string; content: string; file: string; line: number }>
): Promise<RemediationPlan | null> {
  if (!openaiClient) {
    return null;
  }

  const connectedItemsText = connectedSatdItems.length > 0
    ? connectedSatdItems.map(item => `- ${item.content} (${item.file}:${item.line})`).join('\n')
    : 'None';

  const prompt = `Technical Debt: "${satdComment}" (SIR: ${sirScore.toFixed(2)}, Fix Potential: ${fixPotential}). Recent Changes: ${summarizedChanges}. Generate actionable remediation plan (max 500 words) including: why address now, step-by-step approach, expected benefits/risks, and priority. Consider related debt: 
${connectedItemsText}

Respond in the following structured format:
WHY_NOW: <explanation of why this should be addressed now>
STEPS:
1. <first step>
2. <second step>
...
BENEFITS:
- <benefit 1>
- <benefit 2>
...
RISKS:
- <risk 1>
- <risk 2>
...
PRIORITY: HIGH, MEDIUM, or LOW`;

  try {
    const response = await openaiClient.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: "system",
          content: "You are a senior software architect helping developers create actionable plans to address technical debt. Provide concrete, step-by-step guidance that considers the current development context and related debt items."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 800,
      temperature: 0.3
    });

    const responseText = response.choices[0]?.message.content?.trim() || '';
    
    // Parse structured response
    const whyNowMatch = responseText.match(/WHY_NOW:\s*(.+?)(?=STEPS:|$)/is);
    const stepsMatch = responseText.match(/STEPS:\s*([\s\S]+?)(?=BENEFITS:|$)/i);
    const benefitsMatch = responseText.match(/BENEFITS:\s*([\s\S]+?)(?=RISKS:|$)/i);
    const risksMatch = responseText.match(/RISKS:\s*([\s\S]+?)(?=PRIORITY:|$)/i);
    const priorityMatch = responseText.match(/PRIORITY:\s*(HIGH|MEDIUM|LOW)/i);

    // Parse steps
    const stepsText = stepsMatch ? stepsMatch[1].trim() : '';
    const steps = stepsText
      .split(/\n/)
      .map(line => line.replace(/^\d+\.\s*/, '').trim())
      .filter(step => step.length > 0);

    // Parse benefits
    const benefitsText = benefitsMatch ? benefitsMatch[1].trim() : '';
    const benefits = benefitsText
      .split(/\n/)
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(benefit => benefit.length > 0);

    // Parse risks
    const risksText = risksMatch ? risksMatch[1].trim() : '';
    const risks = risksText
      .split(/\n/)
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(risk => risk.length > 0);

    // Parse priority
    let priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
    if (priorityMatch) {
      priority = priorityMatch[1].toUpperCase() as 'HIGH' | 'MEDIUM' | 'LOW';
    }

    return {
      whyNow: whyNowMatch ? whyNowMatch[1].trim() : 'Recent changes provide an opportunity to address this debt.',
      steps: steps.length > 0 ? steps : ['Review the technical debt context', 'Implement fix', 'Test changes'],
      benefits: benefits.length > 0 ? benefits : ['Improved code quality'],
      risks: risks.length > 0 ? risks : ['Potential regression if not tested properly'],
      priority,
      fullPlan: responseText
    };
  } catch (error) {
    console.error(`Failed to generate remediation plan: ${error}`);
    return null;
  }
}

/**
 * Analyze technical debt comment with OpenAI (legacy function kept for compatibility)
 * @param content The technical debt comment content
 * @returns AI-enhanced description or the original content if analysis fails
 */
export async function analyzeTechnicalDebtComment(content: string): Promise<string> {
  if (!openaiClient) {
    return content;
  }
  
  try {
    const response = await openaiClient.chat.completions.create({
      model: modelName,
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
 * Analyze if a commit addresses a technical debt item (legacy function kept for compatibility)
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
      model: modelName,
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
          If no, explain the exact input you got and what is missing in the input data that you need to get a better understanding of the changes made in the code.
          `
        }
      ],
      max_tokens: 1000
    });
    
    return response.choices[0]?.message.content?.trim() || null;
  } catch (error) {
    console.error(`Failed to analyze commit for technical debt fixes: ${error}`);
    return null;
  }
}

/**
 * Batch classify multiple comments for SATD (more efficient for large codebases)
 * @param comments Array of comments with their context
 * @param threshold Confidence threshold (default 0.7)
 * @returns Array of classification results
 */
export async function batchClassifySATD(
  comments: Array<{ comment: string; context: string; id: string }>,
  threshold: number = 0.7
): Promise<Map<string, SATDClassificationResult>> {
  const results = new Map<string, SATDClassificationResult>();
  
  // Process sequentially with delays to avoid rate limits
  // Reduced batch size and increased delays for better rate limit handling
  const delayBetweenRequests = 2000; // 2 seconds between requests
  const delayBetweenBatches = 5000; // 5 seconds between batches
  
  for (let i = 0; i < comments.length; i++) {
    const { comment, context, id } = comments[i];
    
    try {
      const result = await classifySATD(comment, context);
      results.set(id, result);
      
      // Add delay between requests (except for the last one)
      if (i < comments.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
      }
    } catch (error) {
      console.error(`Failed to classify comment ${id}: ${error}`);
      results.set(id, { isSATD: false, confidence: 0 });
    }
    
    // Extra delay every 5 items to respect rate limits
    if ((i + 1) % 5 === 0 && i < comments.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }
  
  return results;
}

/**
 * Summarize code changes for CAIG prompts
 * @param diff Full diff content
 * @param maxLength Maximum length of summary
 * @returns Summarized changes
 */
export function summarizeChanges(diff: string, maxLength: number = 500): string {
  if (diff.length <= maxLength) {
    return diff;
  }
  
  // Extract key changes (additions and deletions)
  const lines = diff.split('\n');
  const keyChanges: string[] = [];
  
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      keyChanges.push(line);
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      keyChanges.push(line);
    }
    
    if (keyChanges.join('\n').length > maxLength - 50) {
      break;
    }
  }
  
  const summary = keyChanges.join('\n');
  if (summary.length > maxLength) {
    return summary.substring(0, maxLength - 3) + '...';
  }
  return summary + (keyChanges.length < lines.length ? '\n... (truncated)' : '');
}

/**
 * Reset the OpenAI client (for deactivation)
 */
export function resetOpenAIClient(): void {
  openaiClient = null;
}
