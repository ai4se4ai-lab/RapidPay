// Test/setup.ts
/**
 * Jest setup file - runs before all tests
 */

// Increase timeout for integration tests
jest.setTimeout(30000);

// Mock console methods to reduce noise during tests
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

beforeAll(() => {
  // Suppress console output during tests unless DEBUG is set
  if (!process.env.DEBUG) {
    console.log = jest.fn();
    console.warn = jest.fn();
    // Keep error for debugging failed tests
    // console.error = jest.fn();
  }
});

afterAll(() => {
  // Restore console methods
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});

// Global test utilities
global.testUtils = {
  /**
   * Create a mock technical debt item
   */
  createMockDebt: (id: string, file: string, line: number, content: string = 'TODO: Fix') => ({
    id,
    file,
    line,
    content,
    description: content,
    createdCommit: 'test-commit',
    createdDate: new Date().toISOString()
  }),

  /**
   * Create a mock relationship
   */
  createMockRelationship: (sourceId: string, targetId: string, weight: number = 0.8) => ({
    sourceId,
    targetId,
    types: ['call'],
    edges: [{
      sourceId,
      targetId,
      type: 'call',
      weight,
      hops: 1
    }],
    strength: weight,
    description: `${sourceId} -> ${targetId}`
  }),

  /**
   * Wait for async operations
   */
  wait: (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
};

// Extend Jest matchers
expect.extend({
  /**
   * Check if value is between min and max (inclusive)
   */
  toBeBetween(received: number, min: number, max: number) {
    const pass = received >= min && received <= max;
    return {
      pass,
      message: () =>
        `expected ${received} to be between ${min} and ${max}`
    };
  }
});

// TypeScript declarations for custom matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeBetween(min: number, max: number): R;
    }
  }
  
  var testUtils: {
    createMockDebt: (id: string, file: string, line: number, content?: string) => any;
    createMockRelationship: (sourceId: string, targetId: string, weight?: number) => any;
    wait: (ms: number) => Promise<void>;
  };
}

export {};

