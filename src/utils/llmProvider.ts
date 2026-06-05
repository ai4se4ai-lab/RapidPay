/**
 * src/utils/llmProvider.ts
 *
 * Pluggable LLM provider abstraction for RapidPay.
 *
 * The paper (Section 3.1) treats F_LLM as a pluggable component:
 * "a systematic multi-model comparison is beyond the scope of this paper and
 * is left for future work — the same pipeline can in principle be instantiated
 * with alternative backends as they become available."
 *
 * This module defines the shared interface that all LLM backends must satisfy,
 * along with the configuration types used by LLMFactory (llmFactory.ts).
 */

import { RemediationPlan, TechnicalDebt } from '../models';

// ---------------------------------------------------------------------------
// Result types (shared across all providers)
// ---------------------------------------------------------------------------

/**
 * Result of Prompt 1 (SID): SATD Instance Detection.
 * Maps to the paper's F_LLM return value in Section 3.1.
 */
export interface LLMClassification {
  /** True when the LLM classifies the comment as SATD. */
  isSATD: boolean;

  /** Self-assessed LLM confidence in [0, 1].
   *  The threshold τ (default 0.7) is applied by the SID caller. */
  confidence: number;

  /** Raw text returned by the model (for debugging / logging). */
  rawResponse?: string;

  /** Error message if the call failed. */
  error?: string;
}

/**
 * Result of Prompt 2 (CAIG): Fix Potential Assessment.
 * Maps to f_i ∈ {1.0, 0.5, 0.0} in the CAIG ranking formula.
 */
export interface LLMFixPotential {
  /** Categorical level: HIGH → 1.0, PARTIAL → 0.5, LOW → 0.0 */
  level: 'HIGH' | 'PARTIAL' | 'LOW';

  /** Numeric score for direct use in the ranking formula. */
  numericScore: number;

  /** One- or two-sentence justification from the model. */
  justification?: string;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

/**
 * LLMProvider — the interface every backend must implement.
 *
 * The three main methods correspond to the three LLM prompts described
 * in the paper (Prompts 1, 2, and 3).  summarizeChanges is a lightweight
 * helper used inside CAIG before calling assessFixPotential.
 */
export interface LLMProvider {
  /**
   * Prompt 1 — SATD Instance Detection (SID, Section 3.1).
   *
   * @param comment     The raw comment text extracted from source code.
   * @param context     Optional surrounding code lines (improves accuracy).
   */
  classifySATD(comment: string, context?: string): Promise<LLMClassification>;

  /**
   * Prompt 2 — Fix Potential Assessment (CAIG, Section 3.4).
   *
   * @param satdComment    The SATD comment text.
   * @param commitSummary  A compressed natural-language description of recent diffs.
   * @param sirScore       The SIR score of the instance (used for context in the prompt).
   * @param effortScore    The historical effort score S^t.
   */
  assessFixPotential(
    satdComment: string,
    commitSummary: string,
    sirScore: number,
    effortScore: number
  ): Promise<LLMFixPotential>;

  /**
   * Prompt 3 — Remediation Plan Generation (CAIG, Section 3.4).
   *
   * @param satd            The primary SATD instance.
   * @param connectedItems  Other SATD nodes in the same chain (for chain-wide context).
   */
  generateRemediationPlan(
    satd: TechnicalDebt,
    connectedItems: Array<{ id: string; content: string; file: string; line: number }>
  ): Promise<RemediationPlan | null>;

  /**
   * Compress a raw git diff into a short natural-language summary.
   * Used by CAIG before invoking assessFixPotential.
   */
  summarizeChanges(diff: string, maxLength?: number): string;
}

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

/** Supported LLM provider backends. */
export type LLMProviderName = 'openai' | 'anthropic' | 'gemini';

/**
 * Configuration passed to LLMFactory.create().
 *
 * API keys can be supplied directly here or via environment variables:
 *   OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY
 *
 * VS Code users can also set them in the extension settings:
 *   RapidPay.openaiApiKey, RapidPay.anthropicApiKey, RapidPay.geminiApiKey
 */
export interface LLMConfig {
  /** Which backend to use (default: 'openai'). */
  provider: LLMProviderName;

  /** API key for the chosen provider.  Leave empty to fall back to env vars. */
  apiKey?: string;

  /**
   * Model name.  Defaults:
   *   openai    → gpt-4o
   *   anthropic → claude-opus-4-7
   *   gemini    → gemini-2.0-flash
   */
  model?: string;
}

// ---------------------------------------------------------------------------
// Shared prompt text (same across all providers — paper Section 3.1, 3.4)
// ---------------------------------------------------------------------------

/** System message used for Prompt 1 (all providers). */
export const PROMPT1_SYSTEM =
  'You are a code analysis assistant specialized in detecting Self-Admitted Technical Debt (SATD) in source code comments. ' +
  'SATD includes TODO comments, FIXME notes, hack acknowledgments, workaround descriptions, and any developer-written text ' +
  'acknowledging suboptimal code quality or implementation shortcuts.';

/** User message template for Prompt 1. */
export function buildPrompt1(comment: string, context: string): string {
  return (
    'Given the following code comment and its surrounding code context, determine whether this comment represents ' +
    "a developer's acknowledgment of suboptimal implementation, technical shortcuts, or known limitations that " +
    'constitute SATD. Consider comments that express concerns about code quality, temporary solutions, known issues, ' +
    'or areas needing improvement. Respond with \'TRUE\' if the comment indicates SATD, or \'FALSE\' otherwise. ' +
    'Also provide a confidence score from 0 to 100.\n\n' +
    `Comment: ${comment}\n\nCode Context:\n${context}\n\n` +
    'Respond in the following format only:\nCLASSIFICATION: TRUE or FALSE\nCONFIDENCE: <number from 0 to 100>'
  );
}

/** System message for Prompt 2 (all providers). */
export const PROMPT2_SYSTEM =
  'You are a code analysis assistant that helps developers identify opportunities to address technical debt ' +
  'during their regular development workflow. Analyze whether recent code changes create an opportunity to ' +
  'fix existing technical debt.';

/** User message template for Prompt 2. */
export function buildPrompt2(
  satdComment: string,
  commitSummary: string,
  sirScore: number,
  effortScore: number
): string {
  return (
    `Technical Debt: "${satdComment}" (SIR score: ${sirScore.toFixed(2)}, ` +
    `Historical effort score S^t: ${effortScore.toFixed(2)}).\n\n` +
    `Recent Commit Summary:\n${commitSummary}\n\n` +
    'Assess whether the recent changes enable debt resolution:\n' +
    '  HIGH    — the changes directly address this debt\n' +
    '  PARTIAL — the changes create a related opportunity\n' +
    '  LOW     — the changes are unrelated\n\n' +
    'Also provide a brief justification (1-2 sentences).\n\n' +
    'Respond in the following format only:\nASSESSMENT: HIGH, PARTIAL, or LOW\nJUSTIFICATION: <brief explanation>'
  );
}

/** System message for Prompt 3 (all providers). */
export const PROMPT3_SYSTEM =
  'You are a senior software architect helping developers create actionable plans to address technical debt. ' +
  'Provide concrete, step-by-step guidance that considers the current development context and related debt items.';

/** User message template for Prompt 3. */
export function buildPrompt3(
  satdComment: string,
  sirScore: number,
  fixPotential: string,
  summarizedChanges: string,
  connectedItems: Array<{ id: string; content: string; file: string; line: number }>
): string {
  const connectedText =
    connectedItems.length > 0
      ? connectedItems.map(i => `- ${i.content} (${i.file}:${i.line})`).join('\n')
      : 'None';

  return (
    `Technical Debt: "${satdComment}" (SIR: ${sirScore.toFixed(2)}, Fix Potential: ${fixPotential}).\n` +
    `Recent Changes: ${summarizedChanges}.\n\n` +
    'Generate an actionable remediation plan (max 500 words) including: why address now, ' +
    'step-by-step approach, expected benefits/risks, and priority. Consider related debt:\n' +
    `${connectedText}\n\n` +
    'Respond in the following structured format:\n' +
    'WHY_NOW: <explanation>\nSTEPS:\n1. <step>\n2. <step>\n...\n' +
    'BENEFITS:\n- <benefit>\n...\nRISKS:\n- <risk>\n...\nPRIORITY: HIGH, MEDIUM, or LOW'
  );
}

// ---------------------------------------------------------------------------
// Shared response parser utilities
// ---------------------------------------------------------------------------

/**
 * Parse the standard Prompt 1 response format into an LLMClassification.
 * Used by all provider implementations.
 */
export function parseClassificationResponse(text: string): LLMClassification {
  const classMatch = text.match(/CLASSIFICATION:\s*(TRUE|FALSE)/i);
  const confMatch  = text.match(/CONFIDENCE:\s*(\d+)/i);

  const isSATD    = classMatch ? classMatch[1].toUpperCase() === 'TRUE' : false;
  const confRaw   = confMatch  ? parseInt(confMatch[1], 10) : 0;
  const confidence = Math.min(100, Math.max(0, confRaw)) / 100;

  return { isSATD, confidence, rawResponse: text };
}

/**
 * Parse the standard Prompt 2 response format into an LLMFixPotential.
 */
export function parseFixPotentialResponse(text: string): LLMFixPotential {
  const assessMatch = text.match(/ASSESSMENT:\s*(HIGH|PARTIAL|LOW)/i);
  const justMatch   = text.match(/JUSTIFICATION:\s*(.+)/is);

  const level: 'HIGH' | 'PARTIAL' | 'LOW' =
    assessMatch
      ? (assessMatch[1].toUpperCase() as 'HIGH' | 'PARTIAL' | 'LOW')
      : 'LOW';

  const numericScore = level === 'HIGH' ? 1.0 : level === 'PARTIAL' ? 0.5 : 0.0;
  const justification = justMatch ? justMatch[1].trim() : undefined;

  return { level, numericScore, justification };
}

/**
 * Parse the standard Prompt 3 response format into a RemediationPlan.
 */
export function parseRemediationResponse(text: string): RemediationPlan {
  const whyNowMatch   = text.match(/WHY_NOW:\s*(.+?)(?=STEPS:|$)/is);
  const stepsMatch    = text.match(/STEPS:\s*([\s\S]+?)(?=BENEFITS:|$)/i);
  const benefitsMatch = text.match(/BENEFITS:\s*([\s\S]+?)(?=RISKS:|$)/i);
  const risksMatch    = text.match(/RISKS:\s*([\s\S]+?)(?=PRIORITY:|$)/i);
  const priorityMatch = text.match(/PRIORITY:\s*(HIGH|MEDIUM|LOW)/i);

  const parseList = (raw: string | undefined): string[] =>
    (raw || '')
      .trim()
      .split(/\n/)
      .map(l => l.replace(/^(\d+\.\s*|-\s*)/, '').trim())
      .filter(l => l.length > 0);

  const priority = priorityMatch
    ? (priorityMatch[1].toUpperCase() as 'HIGH' | 'MEDIUM' | 'LOW')
    : 'MEDIUM';

  return {
    whyNow:   whyNowMatch ? whyNowMatch[1].trim() : 'Recent changes provide an opportunity to address this debt.',
    steps:    parseList(stepsMatch?.[1])   .length > 0 ? parseList(stepsMatch?.[1])    : ['Review context', 'Implement fix', 'Test changes'],
    benefits: parseList(benefitsMatch?.[1]).length > 0 ? parseList(benefitsMatch?.[1]) : ['Improved code quality'],
    risks:    parseList(risksMatch?.[1])   .length > 0 ? parseList(risksMatch?.[1])    : ['Potential regression if not tested'],
    priority,
    fullPlan: text,
  };
}

/**
 * Shared summarizeChanges helper (no LLM required — pure string processing).
 * Extracts added/removed lines from a diff and truncates to maxLength.
 */
export function summarizeChangesDiff(diff: string, maxLength = 500): string {
  if (diff.length <= maxLength) return diff;

  const lines = diff.split('\n');
  const key: string[] = [];
  for (const line of lines) {
    if ((line.startsWith('+') && !line.startsWith('+++')) ||
        (line.startsWith('-') && !line.startsWith('---'))) {
      key.push(line);
    }
    if (key.join('\n').length > maxLength - 50) break;
  }

  const summary = key.join('\n');
  return summary.length > maxLength
    ? summary.substring(0, maxLength - 3) + '...'
    : summary + (key.length < lines.length ? '\n... (truncated)' : '');
}
