/**
 * Test/llm-providers.test.ts
 *
 * Tests for the pluggable LLM provider system (Section 3.1 of the paper).
 *
 * All tests mock the actual SDK clients so no real API calls are made.
 * Test IDs: LP-1 through LP-15
 */

import { createLLMProvider, buildLLMConfigFromVSCode } from '../src/utils/llmFactory';
import {
    LLMProvider,
    LLMClassification,
    LLMFixPotential,
    parseClassificationResponse,
    parseFixPotentialResponse,
    parseRemediationResponse,
    summarizeChangesDiff,
    buildPrompt1,
    buildPrompt2,
    buildPrompt3,
    PROMPT1_SYSTEM,
    PROMPT2_SYSTEM,
    PROMPT3_SYSTEM,
} from '../src/utils/llmProvider';
import { OpenAIProvider } from '../src/utils/openaiClient';
import { AnthropicProvider } from '../src/utils/anthropicClient';
import { GeminiProvider } from '../src/utils/geminiClient';
import { TechnicalDebt } from '../src/models';

// ---------------------------------------------------------------------------
// Mock SDK constructors so tests never call the network
// ---------------------------------------------------------------------------

jest.mock('openai', () => ({
    OpenAI: jest.fn().mockImplementation(() => ({
        chat: {
            completions: {
                create: jest.fn().mockResolvedValue({
                    choices: [{ message: { content: 'CLASSIFICATION: TRUE\nCONFIDENCE: 85' } }],
                }),
            },
        },
    })),
}));

jest.mock('@anthropic-ai/sdk', () => ({
    Anthropic: jest.fn().mockImplementation(() => ({
        messages: {
            create: jest.fn().mockResolvedValue({
                content: [{ text: 'CLASSIFICATION: TRUE\nCONFIDENCE: 80' }],
            }),
        },
    })),
}));

jest.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
        getGenerativeModel: jest.fn().mockReturnValue({
            generateContent: jest.fn().mockResolvedValue({
                response: { text: () => 'CLASSIFICATION: TRUE\nCONFIDENCE: 78' },
            }),
        }),
    })),
}));

// ---------------------------------------------------------------------------
// LP-1 to LP-7  — LLM Factory
// ---------------------------------------------------------------------------

describe('LP-1 to LP-7: LLMFactory — provider creation and API key resolution', () => {

    test('LP-1: createLLMProvider creates OpenAIProvider when provider=openai', () => {
        process.env.OPENAI_API_KEY = 'sk-test-openai';
        const provider = createLLMProvider({ provider: 'openai' });
        expect(provider).toBeInstanceOf(OpenAIProvider);
    });

    test('LP-2: createLLMProvider creates AnthropicProvider when provider=anthropic', () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
        const provider = createLLMProvider({ provider: 'anthropic' });
        expect(provider).toBeInstanceOf(AnthropicProvider);
    });

    test('LP-3: createLLMProvider creates GeminiProvider when provider=gemini', () => {
        process.env.GEMINI_API_KEY = 'gm-test';
        const provider = createLLMProvider({ provider: 'gemini' });
        expect(provider).toBeInstanceOf(GeminiProvider);
    });

    test('LP-4: createLLMProvider throws on unknown provider name', () => {
        process.env.OPENAI_API_KEY = 'sk-test-openai'; // prevent key error
        expect(() => createLLMProvider({ provider: 'unknown-llm' as any, apiKey: 'x' }))
            .toThrow(/unknown llm provider/i);
    });

    test('LP-5: Factory reads OPENAI_API_KEY env var', () => {
        delete process.env.OPENAI_API_KEY;
        process.env.OPENAI_API_KEY = 'sk-env-openai';
        const provider = createLLMProvider({ provider: 'openai' });
        expect(provider).toBeInstanceOf(OpenAIProvider);
        delete process.env.OPENAI_API_KEY;
    });

    test('LP-6: Factory reads ANTHROPIC_API_KEY env var', () => {
        delete process.env.ANTHROPIC_API_KEY;
        process.env.ANTHROPIC_API_KEY = 'sk-ant-env';
        const provider = createLLMProvider({ provider: 'anthropic' });
        expect(provider).toBeInstanceOf(AnthropicProvider);
        delete process.env.ANTHROPIC_API_KEY;
    });

    test('LP-7: Factory reads GEMINI_API_KEY env var', () => {
        delete process.env.GEMINI_API_KEY;
        process.env.GEMINI_API_KEY = 'gm-env';
        const provider = createLLMProvider({ provider: 'gemini' });
        expect(provider).toBeInstanceOf(GeminiProvider);
        delete process.env.GEMINI_API_KEY;
    });
});

// ---------------------------------------------------------------------------
// LP-8 to LP-11  — Provider interface shape
// ---------------------------------------------------------------------------

describe('LP-8 to LP-11: Provider interface — return shape and value ranges', () => {

    beforeEach(() => {
        process.env.OPENAI_API_KEY    = 'sk-test-openai';
        process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
        process.env.GEMINI_API_KEY    = 'gm-test';
    });

    test('LP-8: OpenAIProvider.classifySATD returns {isSATD, confidence} shape', async () => {
        const p = createLLMProvider({ provider: 'openai' });
        const r = await p.classifySATD('# TODO: fix this hack');
        expect(r).toHaveProperty('isSATD');
        expect(r).toHaveProperty('confidence');
        expect(typeof r.isSATD).toBe('boolean');
        expect(typeof r.confidence).toBe('number');
    });

    test('LP-9: AnthropicProvider.classifySATD returns same {isSATD, confidence} shape', async () => {
        const p = createLLMProvider({ provider: 'anthropic' });
        const r = await p.classifySATD('# FIXME: this is a workaround');
        expect(r).toHaveProperty('isSATD');
        expect(r).toHaveProperty('confidence');
        expect(typeof r.isSATD).toBe('boolean');
        expect(typeof r.confidence).toBe('number');
    });

    test('LP-10: GeminiProvider.classifySATD returns same {isSATD, confidence} shape', async () => {
        const p = createLLMProvider({ provider: 'gemini' });
        const r = await p.classifySATD('# HACK: temporary solution');
        expect(r).toHaveProperty('isSATD');
        expect(r).toHaveProperty('confidence');
    });

    test('LP-11: All providers produce confidence in [0,1]', async () => {
        for (const providerName of ['openai', 'anthropic', 'gemini'] as const) {
            const p = createLLMProvider({ provider: providerName });
            const r = await p.classifySATD('# TODO: refactor this');
            expect(r.confidence).toBeGreaterThanOrEqual(0);
            expect(r.confidence).toBeLessThanOrEqual(1);
        }
    });
});

// ---------------------------------------------------------------------------
// LP-12 to LP-13  — Prompt 2 and Prompt 3 shapes
// ---------------------------------------------------------------------------

describe('LP-12 to LP-13: Prompt 2/3 return shapes', () => {

    beforeEach(() => {
        // Override mocks for these tests
        const { OpenAI } = require('openai');
        (OpenAI as jest.Mock).mockImplementation(() => ({
            chat: { completions: { create: jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'ASSESSMENT: HIGH\nJUSTIFICATION: Changes directly fix the debt.' } }],
            })}},
        }));
        process.env.OPENAI_API_KEY = 'sk-test-openai';
    });

    test('LP-12: assessFixPotential returns level (HIGH|PARTIAL|LOW) and numericScore', async () => {
        const p = createLLMProvider({ provider: 'openai' });
        const r = await p.assessFixPotential('# TODO: replace with bcrypt', 'refactored auth', 0.9, 0.3);
        expect(['HIGH', 'PARTIAL', 'LOW']).toContain(r.level);
        expect([1.0, 0.5, 0.0]).toContain(r.numericScore);
    });

    test('LP-12: Fix potential numeric mapping: HIGH=1.0, PARTIAL=0.5, LOW=0.0', () => {
        // Test via response parser
        expect(parseFixPotentialResponse('ASSESSMENT: HIGH\nJUSTIFICATION: x').numericScore).toBe(1.0);
        expect(parseFixPotentialResponse('ASSESSMENT: PARTIAL\nJUSTIFICATION: x').numericScore).toBe(0.5);
        expect(parseFixPotentialResponse('ASSESSMENT: LOW\nJUSTIFICATION: x').numericScore).toBe(0.0);
    });

    test('LP-13: generateRemediationPlan returns object with steps array', async () => {
        // Override mock to return remediation format
        const { OpenAI } = require('openai');
        (OpenAI as jest.Mock).mockImplementation(() => ({
            chat: { completions: { create: jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'WHY_NOW: The auth refactor is underway.\nSTEPS:\n1. Replace MD5 with bcrypt\n2. Update tests\nBENEFITS:\n- Improved security\nRISKS:\n- Requires migration\nPRIORITY: HIGH' } }],
            })}},
        }));

        const satd: TechnicalDebt = {
            id: 'c1', file: 'auth.py', line: 12,
            content: '# TODO: replace plaintext check with bcrypt',
            description: 'Replace plaintext with bcrypt',
            createdCommit: 'C0', createdDate: '2024-01-01',
            sirScore: 1.0, fixPotential: 'HIGH' as any,
        };
        const p = createLLMProvider({ provider: 'openai' });
        const plan = await p.generateRemediationPlan(satd, []);
        expect(plan).not.toBeNull();
        expect(Array.isArray(plan!.steps)).toBe(true);
        expect(plan!.steps.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// LP-14  — Retry on rate-limit (OpenAI)
// ---------------------------------------------------------------------------

describe('LP-14: Retry behaviour on API errors', () => {

    test('LP-14: OpenAI rate-limit error triggers retry and eventually succeeds', async () => {
        let callCount = 0;
        const { OpenAI } = require('openai');
        (OpenAI as jest.Mock).mockImplementation(() => ({
            chat: { completions: {
                create: jest.fn().mockImplementation(() => {
                    callCount++;
                    if (callCount < 3) {
                        const err: any = new Error('rate limit exceeded');
                        err.status = 429;
                        return Promise.reject(err);
                    }
                    return Promise.resolve({
                        choices: [{ message: { content: 'CLASSIFICATION: TRUE\nCONFIDENCE: 90' } }],
                    });
                }),
            }},
        }));

        process.env.OPENAI_API_KEY = 'sk-retry-test';
        const p = createLLMProvider({ provider: 'openai' });
        const r = await p.classifySATD('# TODO: fix retry');
        expect(callCount).toBe(3);
        expect(r.isSATD).toBe(true);
    }, 15000); // allow time for retry delays in tests
});

// ---------------------------------------------------------------------------
// LP-15  — Provider swap does not change pipeline output shape
// ---------------------------------------------------------------------------

describe('LP-15: Provider swap — output shape is provider-independent', () => {

    beforeEach(() => {
        process.env.OPENAI_API_KEY    = 'sk-shape-openai';
        process.env.ANTHROPIC_API_KEY = 'sk-shape-ant';
        process.env.GEMINI_API_KEY    = 'gm-shape';
    });

    test('LP-15: All providers return the same LLMClassification shape', async () => {
        for (const name of ['openai', 'anthropic', 'gemini'] as const) {
            const p = createLLMProvider({ provider: name });
            const r: LLMClassification = await p.classifySATD('# TODO: swap test');
            expect(Object.keys(r)).toEqual(expect.arrayContaining(['isSATD', 'confidence']));
        }
    });
});

// ---------------------------------------------------------------------------
// Response parser unit tests (shared across all providers)
// ---------------------------------------------------------------------------

describe('Response parsers (shared by all providers)', () => {

    test('parseClassificationResponse: parses TRUE/90 correctly', () => {
        const r = parseClassificationResponse('CLASSIFICATION: TRUE\nCONFIDENCE: 90');
        expect(r.isSATD).toBe(true);
        expect(r.confidence).toBeCloseTo(0.9, 2);
    });

    test('parseClassificationResponse: parses FALSE/35 correctly', () => {
        const r = parseClassificationResponse('CLASSIFICATION: FALSE\nCONFIDENCE: 35');
        expect(r.isSATD).toBe(false);
        expect(r.confidence).toBeCloseTo(0.35, 2);
    });

    test('parseClassificationResponse: clamps confidence to [0,1]', () => {
        const r = parseClassificationResponse('CLASSIFICATION: TRUE\nCONFIDENCE: 150');
        expect(r.confidence).toBeLessThanOrEqual(1.0);
    });

    test('parseFixPotentialResponse: returns LOW for unknown assessment', () => {
        const r = parseFixPotentialResponse('ASSESSMENT: MAYBE\nJUSTIFICATION: unclear');
        expect(r.level).toBe('LOW');
    });

    test('parseRemediationResponse: parses steps list', () => {
        const text = 'WHY_NOW: now\nSTEPS:\n1. Do this\n2. Do that\nBENEFITS:\n- Better\nRISKS:\n- None\nPRIORITY: HIGH';
        const plan = parseRemediationResponse(text);
        expect(plan.steps).toHaveLength(2);
        expect(plan.priority).toBe('HIGH');
    });

    test('summarizeChangesDiff: truncates long diffs', () => {
        const longDiff = '+line\n'.repeat(200);
        const result = summarizeChangesDiff(longDiff, 100);
        expect(result.length).toBeLessThanOrEqual(120); // allow slight overshoot for ellipsis
    });

    test('buildPrompt1: contains comment and code context', () => {
        const p = buildPrompt1('# TODO: fix', 'def foo(): pass');
        expect(p).toContain('# TODO: fix');
        expect(p).toContain('def foo(): pass');
    });

    test('buildPrompt2: contains SIR score and effort score', () => {
        const p = buildPrompt2('# TODO', 'summary', 0.75, 0.30);
        expect(p).toContain('0.75');
        expect(p).toContain('0.30');
    });

    test('buildPrompt3: contains connected items', () => {
        const items = [{ id: 'c2', content: '# FIXME', file: 'auth.py', line: 25 }];
        const p = buildPrompt3('# TODO', 1.0, 'HIGH', 'diff summary', items);
        expect(p).toContain('# FIXME');
        expect(p).toContain('auth.py:25');
    });

    test('PROMPT1_SYSTEM contains SATD description', () => {
        expect(PROMPT1_SYSTEM).toContain('Self-Admitted Technical Debt');
    });

    test('PROMPT2_SYSTEM is defined', () => {
        expect(typeof PROMPT2_SYSTEM).toBe('string');
        expect(PROMPT2_SYSTEM.length).toBeGreaterThan(0);
    });

    test('PROMPT3_SYSTEM is defined', () => {
        expect(typeof PROMPT3_SYSTEM).toBe('string');
        expect(PROMPT3_SYSTEM.length).toBeGreaterThan(0);
    });
});
