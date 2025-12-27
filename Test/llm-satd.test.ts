// Test/llm-satd.test.ts
/**
 * Integration tests for LLM-based SATD detection
 * Tests require .env file with OPENAI_API_KEY
 * Tests cover: LLM classification, confidence scores, various SATD patterns
 * 
 * NOTE: These tests include automatic rate limiting (2s delay between tests)
 * to avoid hitting OpenAI API rate limits. If you encounter 429 errors:
 * 1. Check your OpenAI account billing and quota limits
 * 2. Wait a few minutes and try again
 * 3. Consider using a lower-tier model (gpt-3.5-turbo) for testing
 * 4. The tests will automatically retry with exponential backoff
 */

import * as fs from 'fs';
import * as path from 'path';
import { 
  classifySATD, 
  initializeOpenAICLI, 
  getOpenAIClient,
  batchClassifySATD 
} from '../src/utils/openaiClient';
import { 
  SATDClassificationResult,
  DEFAULT_SATD_CONFIG 
} from '../src/models';

// Load .env file manually
function loadEnvFile(): void {
  const envPath = path.join(process.cwd(), '.env');
  
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const lines = envContent.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').trim();
          // Remove quotes if present
          const cleanValue = value.replace(/^["']|["']$/g, '');
          process.env[key.trim()] = cleanValue;
        }
      }
    }
    console.log('Loaded .env file successfully');
  } else {
    console.warn('.env file not found. Using environment variables if set.');
  }
}

// Load .env before tests
loadEnvFile();

// Helper to check if error is rate limit related
function isRateLimitError(error?: string): boolean {
  if (!error) return false;
  return error.includes('429') || 
         error.includes('quota') || 
         error.includes('rate limit') ||
         error.includes('Rate limit');
}

describe('LLM SATD Detection Tests', () => {
  const apiKey = process.env.OPENAI_API_KEY;
  const modelName = process.env.OPENAI_MODEL_NAME || 'gpt-4o';
  
  // Add delay between tests to avoid rate limits
  const delayBetweenTests = 2000; // 2 seconds
  
  beforeAll(() => {
    // Skip all tests if API key is not available
    if (!apiKey) {
      console.warn('OPENAI_API_KEY not found. Skipping LLM tests.');
      console.warn('Please create a .env file with OPENAI_API_KEY=your_key');
    } else {
      const initialized = initializeOpenAICLI(apiKey, modelName);
      if (!initialized) {
        throw new Error('Failed to initialize OpenAI client');
      }
      console.log(`Initialized OpenAI client with model: ${modelName}`);
      console.log('Note: Tests include delays to respect rate limits');
    }
  });

  // Add delay after each test
  afterEach(async () => {
    if (apiKey) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenTests));
    }
  });

  // Skip suite if no API key
  const describeIf = apiKey ? describe : describe.skip;

  describeIf('Basic SATD Classification', () => {
    test('LLM-1: should classify explicit TODO as SATD', async () => {
      const comment = '// TODO: Fix this bug later';
      const context = `
function processData() {
  // TODO: Fix this bug later
  return data;
}
`;
      const result = await classifySATD(comment, context);
      
      expect(result).toBeDefined();
      if (result.error && isRateLimitError(result.error)) {
        console.warn(`Test LLM-1: Rate limit/quota error - ${result.error}`);
        console.warn('This may indicate you need to wait or check your OpenAI account limits');
        return; // Skip test gracefully
      }
      expect(result.isSATD).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    }, 60000);

    test('LLM-2: should classify FIXME as SATD', async () => {
      const comment = '// FIXME: This is broken and needs fixing';
      const context = `
function authenticate() {
  // FIXME: This is broken and needs fixing
  return false;
}
`;
      const result = await classifySATD(comment, context);
      
      expect(result.isSATD).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.6);
    }, 30000);

    test('LLM-3: should classify HACK as SATD', async () => {
      const comment = '// HACK: Temporary workaround for API issue';
      const context = `
function fetchData() {
  // HACK: Temporary workaround for API issue
  return mockData;
}
`;
      const result = await classifySATD(comment, context);
      
      expect(result.isSATD).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.7);
    }, 30000);

    test('LLM-4: should classify XXX as SATD', async () => {
      const comment = '# XXX: This needs attention';
      const context = `
def calculate():
    # XXX: This needs attention
    return result
`;
      const result = await classifySATD(comment, context);
      
      expect(result.isSATD).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    }, 30000);

    test('LLM-5: should classify BUG comment as SATD', async () => {
      const comment = '// BUG: Known issue with null pointer';
      const context = `
function processUser(user) {
  // BUG: Known issue with null pointer
  return user.name;
}
`;
      const result = await classifySATD(comment, context);
      
      expect(result.isSATD).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.6);
    }, 30000);
  });

  describeIf('Implicit SATD Patterns', () => {
    test('LLM-6: should detect workaround as SATD', async () => {
      const comment = '// Workaround for the API limitation';
      const context = `
function getData() {
  // Workaround for the API limitation
  return cachedData;
}
`;
      const result = await classifySATD(comment, context);
      
      expect(result.isSATD).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    }, 30000);

    test('LLM-7: should detect temporary solution as SATD', async () => {
      const comment = '// Temporary fix until proper solution is implemented';
      const context = `
function validate() {
  // Temporary fix until proper solution is implemented
  return true;
}
`;
      const result = await classifySATD(comment, context);
      
      expect(result.isSATD).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    }, 30000);

    test('LLM-8: should detect code quality issues as SATD', async () => {
      const comment = '// This is ugly but it works';
      const context = `
function complexCalculation() {
  // This is ugly but it works
  return result;
}
`;
      const result = await classifySATD(comment, context);
      
      expect(result.isSATD).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.4);
    }, 30000);

    test('LLM-9: should detect refactoring needs as SATD', async () => {
      const comment = '// Needs refactoring - too complex';
      const context = `
function process() {
  // Needs refactoring - too complex
  // ... 200 lines of code ...
}
`;
      const result = await classifySATD(comment, context);
      
      expect(result.isSATD).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    }, 30000);

    test('LLM-10: should detect hardcoded values as SATD', async () => {
      const comment = '// Hardcoded value - should be configurable';
      const context = `
function getTimeout() {
  // Hardcoded value - should be configurable
  return 5000;
}
`;
      const result = await classifySATD(comment, context);
      
      expect(result.isSATD).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    }, 30000);
  });

  describeIf('Non-SATD Comments', () => {
    test('LLM-11: should not classify regular comments as SATD', async () => {
      const comment = '// This function processes user data';
      const context = `
function processUser(user) {
  // This function processes user data
  return user.name;
}
`;
      const result = await classifySATD(comment, context);
      
      expect(result.isSATD).toBe(false);
    }, 30000);

    test('LLM-12: should not classify documentation as SATD', async () => {
      const comment = '/** * This is a JSDoc comment */';
      const context = `
/**
 * This is a JSDoc comment
 * @param {string} name - The user name
 */
function greet(name) {
  return \`Hello, \${name}\`;
}
`;
      const result = await classifySATD(comment, context);
      
      expect(result.isSATD).toBe(false);
    }, 30000);

    test('LLM-13: should not classify explanatory comments as SATD', async () => {
      const comment = '// Calculate the sum of all values';
      const context = `
function sum(values) {
  // Calculate the sum of all values
  return values.reduce((a, b) => a + b, 0);
}
`;
      const result = await classifySATD(comment, context);
      
      expect(result.isSATD).toBe(false);
    }, 30000);
  });

  describeIf('Confidence Threshold Testing', () => {
    test('LLM-14: should return confidence score between 0 and 1', async () => {
      const comment = '// TODO: Fix this';
      const context = 'function test() { // TODO: Fix this }';
      
      const result = await classifySATD(comment, context);
      
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }, 30000);

    test('LLM-15: should meet default confidence threshold for clear SATD', async () => {
      const comment = '// FIXME: Critical bug - fix immediately';
      const context = `
function criticalFunction() {
  // FIXME: Critical bug - fix immediately
  return null;
}
`;
      const result = await classifySATD(comment, context);
      const threshold = DEFAULT_SATD_CONFIG.confidenceThreshold;
      
      if (result.isSATD) {
        expect(result.confidence).toBeGreaterThanOrEqual(threshold);
      }
    }, 30000);

    test('LLM-16: should handle edge cases with low confidence', async () => {
      const comment = '// Maybe this needs work?';
      const context = `
function uncertain() {
  // Maybe this needs work?
  return value;
}
`;
      const result = await classifySATD(comment, context);
      
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }, 30000);
  });

  describeIf('Batch Classification', () => {
    test('LLM-17: should classify multiple comments in batch', async () => {
      const comments = [
        {
          id: '1',
          comment: '// TODO: Fix bug',
          context: 'function test() { // TODO: Fix bug }'
        },
        {
          id: '2',
          comment: '// FIXME: Broken code',
          context: 'function broken() { // FIXME: Broken code }'
        },
        {
          id: '3',
          comment: '// Regular comment',
          context: 'function normal() { // Regular comment }'
        }
      ];
      
      const results = await batchClassifySATD(comments, 0.7);
      
      expect(results.size).toBe(3);
      
      // Check for errors
      const result1 = results.get('1');
      const result2 = results.get('2');
      const result3 = results.get('3');
      
      if (result1?.error && isRateLimitError(result1.error)) {
        console.warn(`Batch test: Rate limit/quota error - ${result1.error}`);
        console.warn('This may indicate you need to wait or check your OpenAI account limits');
        return; // Skip test gracefully
      }
      
      expect(result1?.isSATD).toBe(true);
      expect(result2?.isSATD).toBe(true);
      expect(result3?.isSATD).toBe(false);
    }, 120000); // Increased timeout for batch processing

    test('LLM-18: should apply threshold in batch classification', async () => {
      const comments = [
        {
          id: '1',
          comment: '// TODO: Clear technical debt',
          context: 'function test() { // TODO: Clear technical debt }'
        },
        {
          id: '2',
          comment: '// Maybe fix this?',
          context: 'function uncertain() { // Maybe fix this? }'
        }
      ];
      
      const threshold = 0.7;
      const results = await batchClassifySATD(comments, threshold);
      
      expect(results.size).toBe(2);
      
      // First should be above threshold if classified as SATD
      const result1 = results.get('1');
      if (result1?.isSATD) {
        expect(result1.confidence).toBeGreaterThanOrEqual(threshold);
      }
    }, 60000);
  });

  describeIf('Language-Specific SATD Patterns', () => {
    test('LLM-19: should detect Python SATD patterns', async () => {
      const comment = '# TODO: Refactor this function';
      const context = `
def process_data():
    # TODO: Refactor this function
    return result
`;
      const result = await classifySATD(comment, context);
      
      expect(result.isSATD).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    }, 30000);

    test('LLM-20: should detect Java SATD patterns', async () => {
      const comment = '// FIXME: This needs proper error handling';
      const context = `
public void process() {
    // FIXME: This needs proper error handling
    return;
}
`;
      const result = await classifySATD(comment, context);
      
      expect(result.isSATD).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    }, 30000);

    test('LLM-21: should detect TypeScript SATD patterns', async () => {
      const comment = '// HACK: Type assertion workaround';
      const context = `
function getValue(): string {
  // HACK: Type assertion workaround
  return value as string;
}
`;
      const result = await classifySATD(comment, context);
      
      expect(result.isSATD).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    }, 30000);
  });

  describeIf('Complex SATD Scenarios', () => {
    test('LLM-22: should detect SATD in multi-line comments', async () => {
      const comment = `/*
 * TODO: This entire section needs refactoring
 * The current implementation is inefficient
 */`;
      const context = `
/*
 * TODO: This entire section needs refactoring
 * The current implementation is inefficient
 */
function complexFunction() {
  // ... complex code ...
}
`;
      const result = await classifySATD(comment, context);
      
      expect(result.isSATD).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    }, 30000);

    test('LLM-23: should detect SATD with context clues', async () => {
      const comment = '// Quick fix';
      const context = `
function brokenFunction() {
  // Quick fix
  if (true) {  // This is clearly a hack
    return value;
  }
}
`;
      const result = await classifySATD(comment, context);
      
      // Should detect based on context
      expect(result.isSATD).toBe(true);
    }, 30000);

    test('LLM-24: should handle ambiguous comments with context', async () => {
      const comment = '// This could be better';
      const context = `
function inefficient() {
  // This could be better
  for (let i = 0; i < 1000000; i++) {
    // O(n^2) complexity - needs optimization
  }
}
`;
      const result = await classifySATD(comment, context);
      
      // Should detect as SATD given the context
      expect(result.isSATD).toBe(true);
    }, 30000);
  });

  describeIf('Error Handling', () => {
    test('LLM-25: should handle empty comments gracefully', async () => {
      const comment = '';
      const context = 'function test() {}';
      
      const result = await classifySATD(comment, context);
      
      expect(result).toBeDefined();
      expect(result.isSATD).toBe(false);
    }, 30000);

    test('LLM-26: should handle very long comments', async () => {
      const longComment = '// TODO: ' + 'This is a very long comment. '.repeat(100);
      const context = `function test() { ${longComment} }`;
      
      const result = await classifySATD(longComment, context);
      
      expect(result).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }, 30000);
  });
});

