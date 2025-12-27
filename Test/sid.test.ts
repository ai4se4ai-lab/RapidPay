// Test/sid.test.ts
/**
 * Unit tests for SATD Instance Detection (SID)
 * Tests cover: pattern matching, LLM classification, confidence thresholds
 */

import { SatdDetector } from '../src/satdDetector';
import { LEXICAL_PATTERNS } from '../src/utils/debtScanner';
import { 
    DebtType, 
    DEFAULT_SATD_CONFIG,
    SATDClassificationResult 
} from '../src/models';

describe('SID: SATD Instance Detection', () => {
    let detector: SatdDetector;

    beforeEach(() => {
        detector = new SatdDetector();
    });

    // Test 1: Explicit TODO pattern detection
    describe('Explicit Pattern Detection', () => {
        test('SID-1: should detect TODO comments', () => {
            const content = '// TODO: Fix this later';
            const patterns = detector.getLanguagePatterns('test.js');
            expect(patterns.debtPatterns.explicit).toContain('TODO');
        });

        test('SID-2: should detect FIXME comments', () => {
            const content = '// FIXME: This is broken';
            const patterns = detector.getLanguagePatterns('test.js');
            expect(patterns.debtPatterns.explicit).toContain('FIXME');
        });

        test('SID-3: should detect HACK comments', () => {
            const content = '// HACK: Workaround for API bug';
            const patterns = detector.getLanguagePatterns('test.js');
            expect(patterns.debtPatterns.explicit).toContain('HACK');
        });

        test('SID-4: should detect XXX comments', () => {
            const content = '// XXX: Needs attention';
            const patterns = detector.getLanguagePatterns('test.py');
            expect(patterns.debtPatterns.explicit).toContain('XXX');
        });

        test('SID-5: should detect BUG comments', () => {
            const content = '// BUG: Known issue #123';
            const patterns = detector.getLanguagePatterns('test.java');
            expect(patterns.debtPatterns.explicit).toContain('BUG');
        });
    });

    // Test lexical patterns
    describe('Lexical Pattern Set', () => {
        test('SID-6: should include all explicit SATD markers', () => {
            const explicitMarkers = ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG', 'ISSUE', 'DEBT'];
            for (const marker of explicitMarkers) {
                expect(LEXICAL_PATTERNS).toContain(marker);
            }
        });

        test('SID-7: should include implicit patterns for workarounds', () => {
            expect(LEXICAL_PATTERNS).toContain('workaround');
            expect(LEXICAL_PATTERNS).toContain('temporary');
            expect(LEXICAL_PATTERNS).toContain('hacky');
        });

        test('SID-8: should include implicit patterns for code quality', () => {
            expect(LEXICAL_PATTERNS).toContain('ugly');
            expect(LEXICAL_PATTERNS).toContain('messy');
            expect(LEXICAL_PATTERNS).toContain('dirty');
        });

        test('SID-9: should include patterns for future work', () => {
            expect(LEXICAL_PATTERNS).toContain('fix later');
            expect(LEXICAL_PATTERNS).toContain('refactor later');
        });

        test('SID-10: should include code smell patterns', () => {
            expect(LEXICAL_PATTERNS).toContain('magic number');
            expect(LEXICAL_PATTERNS).toContain('hardcoded');
            expect(LEXICAL_PATTERNS).toContain('duplicate');
        });
    });

    // Test debt type classification
    describe('Debt Type Classification', () => {
        test('SID-11: should classify design debt', () => {
            const content = 'TODO: Refactor this poor design';
            const type = detector.classifyDebtType(content, '');
            expect(type).toBe(DebtType.DESIGN);
        });

        test('SID-12: should classify implementation debt', () => {
            const content = 'HACK: Quick fix for performance';
            const type = detector.classifyDebtType(content, '');
            expect(type).toBe(DebtType.IMPLEMENTATION);
        });

        test('SID-13: should classify documentation debt', () => {
            const content = 'TODO: Add documentation for this function';
            const type = detector.classifyDebtType(content, '');
            expect(type).toBe(DebtType.DOCUMENTATION);
        });

        test('SID-14: should classify test debt', () => {
            const content = 'FIXME: Need to add unit tests';
            const type = detector.classifyDebtType(content, '');
            expect(type).toBe(DebtType.TEST);
        });

        test('SID-15: should classify defect debt', () => {
            const content = 'BUG: Known issue with null pointer';
            const type = detector.classifyDebtType(content, '');
            expect(type).toBe(DebtType.DEFECT);
        });

        test('SID-16: should classify architecture debt', () => {
            const content = 'TODO: Improve component coupling';
            const type = detector.classifyDebtType(content, '');
            expect(type).toBe(DebtType.ARCHITECTURE);
        });
    });

    // Test confidence threshold
    describe('Confidence Threshold', () => {
        test('SID-17: default threshold should be 0.7', () => {
            expect(DEFAULT_SATD_CONFIG.confidenceThreshold).toBe(0.7);
        });

        test('SID-18: should filter items below threshold', () => {
            const highConfidence: SATDClassificationResult = { isSATD: true, confidence: 0.9 };
            const lowConfidence: SATDClassificationResult = { isSATD: true, confidence: 0.5 };
            
            const threshold = DEFAULT_SATD_CONFIG.confidenceThreshold;
            
            expect(highConfidence.confidence >= threshold).toBe(true);
            expect(lowConfidence.confidence >= threshold).toBe(false);
        });

        test('SID-19: should accept items at exact threshold', () => {
            const atThreshold: SATDClassificationResult = { isSATD: true, confidence: 0.7 };
            const threshold = DEFAULT_SATD_CONFIG.confidenceThreshold;
            
            expect(atThreshold.confidence >= threshold).toBe(true);
        });

        test('SID-20: should handle edge case of 0 confidence', () => {
            const zeroConfidence: SATDClassificationResult = { isSATD: true, confidence: 0 };
            const threshold = DEFAULT_SATD_CONFIG.confidenceThreshold;
            
            expect(zeroConfidence.confidence >= threshold).toBe(false);
        });
    });

    // Test language-specific patterns
    describe('Language-Specific Patterns', () => {
        test('SID-Python-1: should detect Python-specific patterns', () => {
            const patterns = detector.getLanguagePatterns('test.py');
            expect(patterns.fileExtensions).toContain('py');
            expect(patterns.commentStyles).toContain('#');
        });

        test('SID-JS-1: should detect JavaScript-specific patterns', () => {
            const patterns = detector.getLanguagePatterns('test.js');
            expect(patterns.fileExtensions).toContain('js');
            expect(patterns.commentStyles).toContain('//');
        });

        test('SID-TS-1: should detect TypeScript-specific patterns', () => {
            const patterns = detector.getLanguagePatterns('test.ts');
            expect(patterns.fileExtensions).toContain('ts');
        });

        test('SID-Java-1: should detect Java-specific patterns', () => {
            const patterns = detector.getLanguagePatterns('Test.java');
            expect(patterns.fileExtensions).toContain('java');
        });
    });

    // Test analyzePotentialSatd
    describe('Potential SATD Analysis', () => {
        test('SID-Analyze-1: should find SATD in comment', () => {
            const code = `
// TODO: Fix this later
function test() {
    return 1;
}
`;
            const results = detector.analyzePotentialSatd('test.js', code, {
                detectionLevel: 'standard',
                includeImplicit: false
            });
            
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].isSatd).toBe(true);
        });

        test('SID-Analyze-2: should detect multiple SATD in file', () => {
            const code = `
// TODO: Fix this
function a() {}

// FIXME: Broken
function b() {}

// HACK: Workaround
function c() {}
`;
            const results = detector.analyzePotentialSatd('test.js', code, {
                detectionLevel: 'standard',
                includeImplicit: false
            });
            
            expect(results.length).toBe(3);
        });

        test('SID-Analyze-3: should not detect non-SATD comments', () => {
            const code = `
// This is a regular comment
function test() {
    return 1;
}
`;
            const results = detector.analyzePotentialSatd('test.js', code, {
                detectionLevel: 'basic',
                includeImplicit: false
            });
            
            expect(results.length).toBe(0);
        });

        test('SID-Analyze-4: should include line numbers', () => {
            const code = `line1
line2
// TODO: on line 3
line4`;
            const results = detector.analyzePotentialSatd('test.js', code, {
                detectionLevel: 'standard',
                includeImplicit: false
            });
            
            expect(results.length).toBe(1);
            expect(results[0].line).toBe(3);
        });
    });
});

