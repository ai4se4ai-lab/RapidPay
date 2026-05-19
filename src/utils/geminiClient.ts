/**
 * src/utils/geminiClient.ts
 *
 * Google Gemini backend for RapidPay's pluggable F_LLM component.
 *
 * Implements the LLMProvider interface using @google/generative-ai.
 * Default model: gemini-2.0-flash  (configurable via LLMConfig.model or
 * the VS Code setting RapidPay.geminiModel).
 *
 * API key sources (checked in order):
 *   1. LLMConfig.apiKey
 *   2. VS Code setting RapidPay.geminiApiKey
 *   3. Environment variable GEMINI_API_KEY
 */

import {
  LLMProvider,
  LLMClassification,
  LLMFixPotential,
  PROMPT1_SYSTEM,
  PROMPT2_SYSTEM,
  PROMPT3_SYSTEM,
  buildPrompt1,
  buildPrompt2,
  buildPrompt3,
  parseClassificationResponse,
  parseFixPotentialResponse,
  parseRemediationResponse,
  summarizeChangesDiff,
} from './llmProvider';
import { RemediationPlan, TechnicalDebt } from '../models';

// Conditional vscode import (not available in CLI mode)
let vscode: typeof import('vscode') | undefined;
try {
  vscode = require('vscode');
} catch {
  vscode = undefined;
}

const DEFAULT_MODEL = 'gemini-2.0-flash';
const MAX_RETRIES   = 3;
const INITIAL_DELAY = 1000;

async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = MAX_RETRIES, delay = INITIAL_DELAY): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const isRateLimit =
        err?.status === 429 ||
        err?.message?.includes('RESOURCE_EXHAUSTED') ||
        err?.message?.includes('quota');
      if (isRateLimit && attempt < maxRetries - 1) {
        const wait = delay * Math.pow(2, attempt);
        console.warn(`[GeminiProvider] Rate limit — retrying in ${wait}ms (${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export class GeminiProvider implements LLMProvider {
  private genAI: any;    // GoogleGenerativeAI instance
  private model: string;

  constructor(apiKey: string, model = DEFAULT_MODEL) {
    this.model = model;
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      this.genAI = new GoogleGenerativeAI(apiKey);
    } catch {
      throw new Error(
        'GeminiProvider requires @google/generative-ai. Install it with: npm install @google/generative-ai'
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Prompt 1 — SATD Instance Detection
  // ---------------------------------------------------------------------------
  async classifySATD(comment: string, context = ''): Promise<LLMClassification> {
    try {
      const genModel = this.genAI.getGenerativeModel({ model: this.model });
      const fullPrompt = `${PROMPT1_SYSTEM}\n\n${buildPrompt1(comment, context)}`;

      const result = await retryWithBackoff(() => genModel.generateContent(fullPrompt)) as any;
      const text = result.response.text().trim();
      return parseClassificationResponse(text);
    } catch (err: any) {
      console.error(`[GeminiProvider] classifySATD failed: ${err?.message}`);
      return { isSATD: false, confidence: 0, error: String(err?.message) };
    }
  }

  // ---------------------------------------------------------------------------
  // Prompt 2 — Fix Potential Assessment
  // ---------------------------------------------------------------------------
  async assessFixPotential(
    satdComment: string,
    commitSummary: string,
    sirScore: number,
    effortScore: number
  ): Promise<LLMFixPotential> {
    try {
      const genModel = this.genAI.getGenerativeModel({ model: this.model });
      const fullPrompt = `${PROMPT2_SYSTEM}\n\n${buildPrompt2(satdComment, commitSummary, sirScore, effortScore)}`;

      const result = await genModel.generateContent(fullPrompt);
      const text = result.response.text().trim();
      return parseFixPotentialResponse(text);
    } catch (err: any) {
      console.error(`[GeminiProvider] assessFixPotential failed: ${err?.message}`);
      return { level: 'LOW', numericScore: 0.0 };
    }
  }

  // ---------------------------------------------------------------------------
  // Prompt 3 — Remediation Plan Generation
  // ---------------------------------------------------------------------------
  async generateRemediationPlan(
    satd: TechnicalDebt,
    connectedItems: Array<{ id: string; content: string; file: string; line: number }>
  ): Promise<RemediationPlan | null> {
    try {
      const genModel = this.genAI.getGenerativeModel({ model: this.model });
      const fullPrompt =
        `${PROMPT3_SYSTEM}\n\n` +
        buildPrompt3(
          satd.content,
          satd.sirScore ?? 0,
          satd.fixPotential ?? 'LOW',
          this.summarizeChanges(satd.extendedContent ?? ''),
          connectedItems
        );

      const result = await genModel.generateContent(fullPrompt);
      const text = result.response.text().trim();
      return parseRemediationResponse(text);
    } catch (err: any) {
      console.error(`[GeminiProvider] generateRemediationPlan failed: ${err?.message}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Summarize Changes (pure string — no LLM call)
  // ---------------------------------------------------------------------------
  summarizeChanges(diff: string, maxLength = 500): string {
    return summarizeChangesDiff(diff, maxLength);
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function resolveGeminiApiKey(configKey?: string): string {
  if (configKey) return configKey;

  if (vscode) {
    const cfg = vscode.workspace.getConfiguration('RapidPay');
    const key = cfg.get<string>('geminiApiKey');
    if (key) return key;
  }

  const envKey = process.env.GEMINI_API_KEY;
  if (envKey) return envKey;

  throw new Error(
    'Gemini API key not found. Set RapidPay.geminiApiKey in VS Code settings or ' +
    'export GEMINI_API_KEY as an environment variable.'
  );
}

export function resolveGeminiModel(configModel?: string): string {
  if (configModel) return configModel;
  if (vscode) {
    const cfg = vscode.workspace.getConfiguration('RapidPay');
    return cfg.get<string>('geminiModel') || DEFAULT_MODEL;
  }
  return DEFAULT_MODEL;
}
