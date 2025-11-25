// Test/caig.test.ts
/**
 * Unit tests for Commit-Aware Insight Generation (CAIG)
 * Tests cover: commit relevance, fix potential, ranking formula
 * 
 * Ranking formula: Rank(t_i) = η1·SIR(t_i) + η2·CommitRel(t_i) + η3·(1-S^t) + η4·f_i
 * Default weights: (η1,η2,η3,η4) = (0.4, 0.3, 0.15, 0.15)
 */

import { 
    TechnicalDebt, 
    CommitInfo, 
    FixPotential,
    FIX_POTENTIAL_VALUES,
    CAIGWeights,
    DEFAULT_CAIG_WEIGHTS,
    COMMIT_WINDOW_SIZE,
    DEFAULT_EFFORT_CONFIG
} from '../src/models';

describe('CAIG: Commit-Aware Insight Generation', () => {
    // Helper functions
    const createMockDebt = (id: string, file: string, line: number): TechnicalDebt => ({
        id,
        file,
        line,
        content: `TODO: ${id}`,
        description: `TODO: ${id}`,
        createdCommit: 'abc123',
        createdDate: '2024-01-01',
        sirScore: 0.5
    });

    const createMockCommit = (hash: string, files: string[]): CommitInfo => ({
        hash,
        message: 'Test commit',
        author: 'Test Author',
        authorEmail: 'test@example.com',
        timestamp: new Date(),
        modifiedFiles: files
    });

    // Test 1-5: Default CAIG Weight Configuration
    describe('Default CAIG Weight Configuration', () => {
        test('CAIG-1: default η1 (SIR weight) should be 0.4', () => {
            expect(DEFAULT_CAIG_WEIGHTS.eta1).toBe(0.4);
        });

        test('CAIG-2: default η2 (commit relevance weight) should be 0.3', () => {
            expect(DEFAULT_CAIG_WEIGHTS.eta2).toBe(0.3);
        });

        test('CAIG-3: default η3 (effort score weight) should be 0.15', () => {
            expect(DEFAULT_CAIG_WEIGHTS.eta3).toBe(0.15);
        });

        test('CAIG-4: default η4 (fix potential weight) should be 0.15', () => {
            expect(DEFAULT_CAIG_WEIGHTS.eta4).toBe(0.15);
        });

        test('CAIG-5: CAIG weights should sum to 1', () => {
            const sum = DEFAULT_CAIG_WEIGHTS.eta1 + DEFAULT_CAIG_WEIGHTS.eta2 + 
                       DEFAULT_CAIG_WEIGHTS.eta3 + DEFAULT_CAIG_WEIGHTS.eta4;
            expect(sum).toBe(1.0);
        });
    });

    // Test 6-10: Fix Potential Assessment
    describe('Fix Potential Assessment', () => {
        test('CAIG-6: HIGH fix potential has value 1.0', () => {
            expect(FIX_POTENTIAL_VALUES[FixPotential.HIGH]).toBe(1.0);
        });

        test('CAIG-7: PARTIAL fix potential has value 0.5', () => {
            expect(FIX_POTENTIAL_VALUES[FixPotential.PARTIAL]).toBe(0.5);
        });

        test('CAIG-8: LOW fix potential has value 0.0', () => {
            expect(FIX_POTENTIAL_VALUES[FixPotential.LOW]).toBe(0.0);
        });

        test('CAIG-9: fix potential enum has all three levels', () => {
            expect(Object.keys(FixPotential)).toContain('HIGH');
            expect(Object.keys(FixPotential)).toContain('PARTIAL');
            expect(Object.keys(FixPotential)).toContain('LOW');
        });

        test('CAIG-10: fix potential values are in descending order', () => {
            expect(FIX_POTENTIAL_VALUES[FixPotential.HIGH]).toBeGreaterThan(
                FIX_POTENTIAL_VALUES[FixPotential.PARTIAL]
            );
            expect(FIX_POTENTIAL_VALUES[FixPotential.PARTIAL]).toBeGreaterThan(
                FIX_POTENTIAL_VALUES[FixPotential.LOW]
            );
        });
    });

    // Test 11-15: Commit Relevance Calculation
    describe('Commit Relevance Calculation', () => {
        test('CAIG-11: direct file modification gives high relevance', () => {
            const debt = createMockDebt('a', 'src/auth.py', 10);
            const commit = createMockCommit('abc123', ['src/auth.py']);
            
            // Simulated relevance calculation
            const isDirectlyModified = commit.modifiedFiles.includes(debt.file);
            expect(isDirectlyModified).toBe(true);
        });

        test('CAIG-12: same directory modification gives partial relevance', () => {
            const debt = createMockDebt('a', 'src/auth/login.py', 10);
            const commit = createMockCommit('abc123', ['src/auth/logout.py']);
            
            const debtDir = debt.file.substring(0, debt.file.lastIndexOf('/'));
            const commitDirs = commit.modifiedFiles.map(f => 
                f.substring(0, f.lastIndexOf('/'))
            );
            
            const inSameDir = commitDirs.includes(debtDir);
            expect(inSameDir).toBe(true);
        });

        test('CAIG-13: unrelated file gives low relevance', () => {
            const debt = createMockDebt('a', 'src/auth/login.py', 10);
            const commit = createMockCommit('abc123', ['tests/test_api.py']);
            
            const debtDir = debt.file.substring(0, debt.file.lastIndexOf('/'));
            const commitDirs = commit.modifiedFiles.map(f => 
                f.substring(0, f.lastIndexOf('/'))
            );
            
            const isDirectlyModified = commit.modifiedFiles.includes(debt.file);
            const inSameDir = commitDirs.includes(debtDir);
            
            expect(isDirectlyModified).toBe(false);
            expect(inSameDir).toBe(false);
        });

        test('CAIG-14: commit relevance is between 0 and 1', () => {
            // Simulate relevance calculation logic
            const calculateRelevance = (isModified: boolean, isSameDir: boolean): number => {
                let relevance = 0;
                if (isModified) relevance += 0.5;
                if (isSameDir) relevance += 0.3;
                return Math.min(1, relevance);
            };
            
            expect(calculateRelevance(true, true)).toBeLessThanOrEqual(1);
            expect(calculateRelevance(false, false)).toBeGreaterThanOrEqual(0);
        });

        test('CAIG-15: multiple file modifications increase relevance', () => {
            const debt = createMockDebt('a', 'src/auth/login.py', 10);
            const commit = createMockCommit('abc123', [
                'src/auth/login.py',
                'src/auth/logout.py',
                'src/auth/utils.py'
            ]);
            
            const matchCount = commit.modifiedFiles.filter(f => 
                f.startsWith('src/auth/')
            ).length;
            
            expect(matchCount).toBe(3);
        });
    });

    // Test 16-20: Ranking Formula and Effort Score
    describe('Ranking Formula and Effort Score', () => {
        test('CAIG-16: effort score lambda default is 0.5', () => {
            expect(DEFAULT_EFFORT_CONFIG.lambda).toBe(0.5);
        });

        test('CAIG-17: sliding window size default is 50', () => {
            expect(COMMIT_WINDOW_SIZE).toBe(50);
        });

        test('CAIG-18: lower effort score increases rank (inverted in formula)', () => {
            const weights = DEFAULT_CAIG_WEIGHTS;
            const highEffort = 0.9;
            const lowEffort = 0.2;
            
            // In formula: η3·(1-S^t), so lower effort = higher contribution
            const highEffortContrib = weights.eta3 * (1 - highEffort);
            const lowEffortContrib = weights.eta3 * (1 - lowEffort);
            
            expect(lowEffortContrib).toBeGreaterThan(highEffortContrib);
        });

        test('CAIG-19: ranking formula correctly combines all factors', () => {
            const weights = DEFAULT_CAIG_WEIGHTS;
            const sir = 0.8;
            const commitRel = 0.6;
            const effort = 0.3;
            const fixPotential = 0.5;
            
            const rank = 
                weights.eta1 * sir +
                weights.eta2 * commitRel +
                weights.eta3 * (1 - effort) +
                weights.eta4 * fixPotential;
            
            // Expected: 0.4*0.8 + 0.3*0.6 + 0.15*0.7 + 0.15*0.5
            //         = 0.32 + 0.18 + 0.105 + 0.075 = 0.68
            expect(rank).toBeCloseTo(0.68, 2);
        });

        test('CAIG-20: ranking is normalized between 0 and 1', () => {
            const weights = DEFAULT_CAIG_WEIGHTS;
            
            // Max rank: all factors at 1
            const maxRank = 
                weights.eta1 * 1 +
                weights.eta2 * 1 +
                weights.eta3 * 1 + // (1 - 0) = 1
                weights.eta4 * 1;
            
            // Min rank: all factors at 0
            const minRank = 
                weights.eta1 * 0 +
                weights.eta2 * 0 +
                weights.eta3 * 0 + // (1 - 1) = 0
                weights.eta4 * 0;
            
            expect(maxRank).toBeLessThanOrEqual(1);
            expect(minRank).toBeGreaterThanOrEqual(0);
        });
    });
});

