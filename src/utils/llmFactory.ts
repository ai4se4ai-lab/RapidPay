/**
 * src/utils/llmFactory.ts
 *
 * Factory that creates the correct LLMProvider implementation based on
 * a LLMConfig object.
 *
 * Usage:
 *   import { createLLMProvider } from './utils/llmFactory';
 *
 *   // From VS Code extension
 *   const provider = createLLMProvider({ provider: 'openai' });
 *
 *   // From CLI (explicit key)
 *   const provider = createLLMProvider({ provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY });
 *
 *   // Classification (Prompt 1)
 *   const result = await provider.classifySATD('# TODO: replace with bcrypt', '');
 *
 * Provider resolution order for API keys:
 *   1. LLMConfig.apiKey (explicit)
 *   2. VS Code settings   (RapidPay.openaiApiKey / anthropicApiKey / geminiApiKey)
 *   3. Environment vars   (OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY)
 */

import { LLMProvider, LLMConfig, LLMProviderName } from './llmProvider';
import { OpenAIProvider, resolveOpenAIApiKey, resolveOpenAIModel } from './openaiClient';
import { AnthropicProvider, resolveAnthropicApiKey, resolveAnthropicModel } from './anthropicClient';
import { GeminiProvider, resolveGeminiApiKey, resolveGeminiModel } from './geminiClient';

// Conditional vscode import (not available in CLI mode)
let vscode: typeof import('vscode') | undefined;
try {
  vscode = require('vscode');
} catch {
  vscode = undefined;
}

/**
 * Create an LLMProvider instance based on the supplied config.
 *
 * When provider is omitted or undefined, the factory reads
 * `RapidPay.llmProvider` from VS Code settings (default: 'openai').
 *
 * @throws Error if the API key cannot be resolved or the provider name is unknown.
 */
export function createLLMProvider(config: Partial<LLMConfig> = {}): LLMProvider {
  const providerName = resolveProviderName(config.provider);

  switch (providerName) {
    case 'openai': {
      const apiKey = resolveOpenAIApiKey(config.apiKey);
      const model  = resolveOpenAIModel(config.model);
      return new OpenAIProvider(apiKey, model);
    }

    case 'anthropic': {
      const apiKey = resolveAnthropicApiKey(config.apiKey);
      const model  = resolveAnthropicModel(config.model);
      return new AnthropicProvider(apiKey, model);
    }

    case 'gemini': {
      const apiKey = resolveGeminiApiKey(config.apiKey);
      const model  = resolveGeminiModel(config.model);
      return new GeminiProvider(apiKey, model);
    }

    default:
      throw new Error(
        `Unknown LLM provider: "${providerName}". Valid options are: openai, anthropic, gemini.`
      );
  }
}

/**
 * Resolve the provider name from config → VS Code settings → default ('openai').
 */
function resolveProviderName(configProvider?: string): LLMProviderName {
  if (configProvider) {
    return configProvider as LLMProviderName;
  }

  if (vscode) {
    const cfg = vscode.workspace.getConfiguration('RapidPay');
    const setting = cfg.get<string>('llmProvider');
    if (setting) return setting as LLMProviderName;
  }

  // Check env var for CLI convenience
  const envProvider = process.env.RAPIDPAY_LLM_PROVIDER;
  if (envProvider) return envProvider as LLMProviderName;

  return 'openai';
}

/**
 * Build a LLMConfig from VS Code settings (for use in the extension).
 * The CLI overrides these with command-line flags.
 */
export function buildLLMConfigFromVSCode(): LLMConfig {
  const provider = resolveProviderName(undefined);

  if (vscode) {
    const cfg = vscode.workspace.getConfiguration('RapidPay');
    const apiKeyMap: Record<LLMProviderName, string> = {
      openai:    cfg.get<string>('openaiApiKey')    ?? '',
      anthropic: cfg.get<string>('anthropicApiKey') ?? '',
      gemini:    cfg.get<string>('geminiApiKey')    ?? '',
    };
    const modelMap: Record<LLMProviderName, string> = {
      openai:    cfg.get<string>('modelName')       ?? 'gpt-4o',
      anthropic: cfg.get<string>('anthropicModel')  ?? 'claude-opus-4-7',
      gemini:    cfg.get<string>('geminiModel')     ?? 'gemini-2.0-flash',
    };
    return {
      provider,
      apiKey: apiKeyMap[provider] || undefined,
      model:  modelMap[provider]  || undefined,
    };
  }

  return { provider };
}

export { LLMProvider, LLMConfig, LLMProviderName };
