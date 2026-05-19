/**
 * src/utils/anthropicClient.ts
 *
 * Anthropic Claude backend for RapidPay's pluggable F_LLM component.
 *
 * Implements the LLMProvider interface using @anthropic-ai/sdk.
 * Default model: claude-opus-4-7  (configurable via LLMConfig.model or
 * the VS Code setting RapidPay.anthropicModel).
 *
 * API key sources (checked in order):
 *   1. LLMConfig.apiKey
 *   2. VS Code setting RapidPay.anthropicApiKey
 *   3. Environment variable ANTHROPIC_API_KEY
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

const DEFAULT_MODEL = 'claude-opus-4-7';
const MAX_RETRIES   = 3;
const INITIAL_DELAY = 1000;

/**
 * Retry helper with exponential backoff, shared across all provider calls.
 */
async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = MAX_RETRIES, delay = INITIAL_DELAY): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const isRateLimit =
        err?.status === 429 ||
        err?.message?.includes('rate_limit') ||
        err?.message?.includes('overloaded');
      if (isRateLimit && attempt < maxRetries - 1) {
        const wait = delay * Math.pow(2, attempt);
        console.warn(`[AnthropicProvider] Rate limit — retrying in ${wait}ms (${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export class AnthropicProvider implements LLMProvider {
  private client: any;   // Anthropic SDK instance (dynamically required)
  private model: string;

  constructor(apiKey: string, model = DEFAULT_MODEL) {
    this.model = model;
    try {
      // Dynamic require so the package is optional for users who only use OpenAI
      const { Anthropic } = require('@anthropic-ai/sdk');
      this.client = new Anthropic({ apiKey });
    } catch {
      throw new Error(
        'AnthropicProvider requires @anthropic-ai/sdk. Install it with: npm install @anthropic-ai/sdk'
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Prompt 1 — SATD Instance Detection
  // ---------------------------------------------------------------------------
  async classifySATD(comment: string, context = ''): Promise<LLMClassification> {
    try {
      const response = await retryWithBackoff(() =>
        this.client.messages.create({
          model:      this.model,
          max_tokens: 150,
          system:     PROMPT1_SYSTEM,
          messages:   [{ role: 'user', content: buildPrompt1(comment, context) }],
        })
      );

      const res = response as any;
      const text = (res.content?.[0] as any)?.text?.trim() ?? '';
      return parseClassificationResponse(text);
    } catch (err: any) {
      console.error(`[AnthropicProvider] classifySATD failed: ${err?.message}`);
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
      const response = await this.client.messages.create({
        model:      this.model,
        max_tokens: 250,
        system:     PROMPT2_SYSTEM,
        messages:   [{ role: 'user', content: buildPrompt2(satdComment, commitSummary, sirScore, effortScore) }],
      });

      const text = (response.content[0] as any)?.text?.trim() ?? '';
      return parseFixPotentialResponse(text);
    } catch (err: any) {
      console.error(`[AnthropicProvider] assessFixPotential failed: ${err?.message}`);
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
      const response = await this.client.messages.create({
        model:      this.model,
        max_tokens: 900,
        system:     PROMPT3_SYSTEM,
        messages: [{
          role:    'user',
          content: buildPrompt3(
            satd.content,
            satd.sirScore ?? 0,
            satd.fixPotential ?? 'LOW',
            this.summarizeChanges(satd.extendedContent ?? ''),
            connectedItems
          ),
        }],
      });

      const text = (response.content[0] as any)?.text?.trim() ?? '';
      return parseRemediationResponse(text);
    } catch (err: any) {
      console.error(`[AnthropicProvider] generateRemediationPlan failed: ${err?.message}`);
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
// Factory helper
// ---------------------------------------------------------------------------

/**
 * Resolve the Anthropic API key from config → VS Code settings → env var.
 */
export function resolveAnthropicApiKey(configKey?: string): string {
  if (configKey) return configKey;

  if (vscode) {
    const cfg = vscode.workspace.getConfiguration('RapidPay');
    const key = cfg.get<string>('anthropicApiKey');
    if (key) return key;
  }

  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) return envKey;

  throw new Error(
    'Anthropic API key not found. Set RapidPay.anthropicApiKey in VS Code settings or ' +
    'export ANTHROPIC_API_KEY as an environment variable.'
  );
}

/**
 * Resolve the Anthropic model from config → VS Code settings → default.
 */
export function resolveAnthropicModel(configModel?: string): string {
  if (configModel) return configModel;
  if (vscode) {
    const cfg = vscode.workspace.getConfiguration('RapidPay');
    return cfg.get<string>('anthropicModel') || DEFAULT_MODEL;
  }
  return DEFAULT_MODEL;
}
