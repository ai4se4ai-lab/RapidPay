// Test/models.test.ts
/**
 * Unit tests for the models and type definitions
 * Tests cover: interfaces, enums, default configurations
 */

import {
    TechnicalDebt,
    SatdRelationship,
    RelationshipType,
    DebtType,
    WeightedEdge,
    Chain,
    SIRComponents,
    SIRWeights,
    CAIGWeights,
    FixPotential,
    FIX_POTENTIAL_VALUES,
    DEFAULT_SIR_WEIGHTS,
    DEFAULT_CAIG_WEIGHTS,
    DEFAULT_SATD_CONFIG,
    DEFAULT_EFFORT_CONFIG,
    DEFAULT_RELATIONSHIP_WEIGHTS,
    MAX_DEPENDENCY_HOPS,
    COMMIT_WINDOW_SIZE
} from '../src/models';

describe('Models: Type Definitions and Defaults', () => {
    // Test RelationshipType enum
    describe('RelationshipType Enum', () => {
        test('MODEL-1: should have CALL type', () => {
            expect(RelationshipType.CALL).toBeDefined();
            expect(typeof RelationshipType.CALL).toBe('string');
        });

        test('MODEL-2: should have DATA type', () => {
            expect(RelationshipType.DATA).toBeDefined();
        });

        test('MODEL-3: should have CONTROL type', () => {
            expect(RelationshipType.CONTROL).toBeDefined();
        });

        test('MODEL-4: should have MODULE type', () => {
            expect(RelationshipType.MODULE).toBeDefined();
        });

        test('MODEL-5: should have exactly 4 relationship types', () => {
            const types = Object.values(RelationshipType);
            expect(types.length).toBe(4);
        });
    });

    // Test DebtType enum
    describe('DebtType Enum', () => {
        test('MODEL-6: should have Design debt type', () => {
            expect(DebtType.DESIGN).toBeDefined();
        });

        test('MODEL-7: should have Implementation debt type', () => {
            expect(DebtType.IMPLEMENTATION).toBeDefined();
        });

        test('MODEL-8: should have Documentation debt type', () => {
            expect(DebtType.DOCUMENTATION).toBeDefined();
        });

        test('MODEL-9: should have Test debt type', () => {
            expect(DebtType.TEST).toBeDefined();
        });

        test('MODEL-10: should have Defect debt type', () => {
            expect(DebtType.DEFECT).toBeDefined();
        });
    });

    // Test FixPotential enum and values
    describe('FixPotential Enum', () => {
        test('MODEL-11: HIGH fix potential should map to 1.0', () => {
            expect(FIX_POTENTIAL_VALUES[FixPotential.HIGH]).toBe(1.0);
        });

        test('MODEL-12: PARTIAL fix potential should map to 0.5', () => {
            expect(FIX_POTENTIAL_VALUES[FixPotential.PARTIAL]).toBe(0.5);
        });

        test('MODEL-13: LOW fix potential should map to 0.0', () => {
            expect(FIX_POTENTIAL_VALUES[FixPotential.LOW]).toBe(0.0);
        });
    });

    // Test default configurations
    describe('Default Configurations', () => {
        test('MODEL-14: MAX_DEPENDENCY_HOPS should be 5', () => {
            expect(MAX_DEPENDENCY_HOPS).toBe(5);
        });

        test('MODEL-15: COMMIT_WINDOW_SIZE should be 50', () => {
            expect(COMMIT_WINDOW_SIZE).toBe(50);
        });

        test('MODEL-16: SIR weights should sum to 1', () => {
            const sum = DEFAULT_SIR_WEIGHTS.alpha + DEFAULT_SIR_WEIGHTS.beta + DEFAULT_SIR_WEIGHTS.gamma;
            expect(sum).toBeCloseTo(1.0, 5);
        });

        test('MODEL-17: CAIG weights should sum to 1', () => {
            const sum = DEFAULT_CAIG_WEIGHTS.eta1 + DEFAULT_CAIG_WEIGHTS.eta2 + 
                       DEFAULT_CAIG_WEIGHTS.eta3 + DEFAULT_CAIG_WEIGHTS.eta4;
            expect(sum).toBeCloseTo(1.0, 5);
        });

        test('MODEL-18: SATD config should have default threshold of 0.7', () => {
            expect(DEFAULT_SATD_CONFIG.confidenceThreshold).toBe(0.7);
        });

        test('MODEL-19: Effort config lambda should be 0.5', () => {
            expect(DEFAULT_EFFORT_CONFIG.lambda).toBe(0.5);
        });

        test('MODEL-20: All relationship types should have weight ranges', () => {
            expect(DEFAULT_RELATIONSHIP_WEIGHTS[RelationshipType.CALL]).toBeDefined();
            expect(DEFAULT_RELATIONSHIP_WEIGHTS[RelationshipType.DATA]).toBeDefined();
            expect(DEFAULT_RELATIONSHIP_WEIGHTS[RelationshipType.CONTROL]).toBeDefined();
            expect(DEFAULT_RELATIONSHIP_WEIGHTS[RelationshipType.MODULE]).toBeDefined();
        });
    });
});

