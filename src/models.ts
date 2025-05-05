/**
 * Represents a technical debt item identified in the codebase
 */
export interface TechnicalDebt {
    /** Unique identifier for the debt item */
    id: string;
    
    /** Path to the file containing the debt */
    file: string;
    
    /** Line number in the file */
    line: number;
    
    /** The original debt comment content */
    content: string;
    
    /** Extended context around the debt comment (surrounding lines) */
    extendedContent?: string;
    
    /** Description of the technical debt (AI-enhanced) */
    description: string;
    
    /** Git commit hash when the debt was introduced */
    createdCommit: string;
    
    /** Date when the debt was introduced */
    createdDate: string;
    
    /** Type of technical debt (e.g., Design, Implementation, Documentation) */
    debtType?: string;
    
    /** Flag indicating if this is confirmed to be technical debt (vs false positive) */
    isActualDebt?: boolean;
}

/**
 * Type of technical debt
 */
export enum DebtType {
    DESIGN = 'Design',
    IMPLEMENTATION = 'Implementation',
    DOCUMENTATION = 'Documentation',
    DEFECT = 'Defect',
    TEST = 'Test',
    REQUIREMENT = 'Requirement',
    ARCHITECTURE = 'Architecture',
    OTHER = 'Other'
}

/**
 * Configuration for SATD detection
 */
export interface SatdConfig {
    /** Detection level (basic, standard, comprehensive) */
    detectionLevel: string;
    
    /** Whether to include implicit debt patterns */
    includeImplicit: boolean;
    
    /** Custom patterns to detect */
    customPatterns: string[];
    
    /** Patterns to exclude from scanning */
    excludePatterns: string[];
    
    /** Keep all potential debt (even if AI doesn't confirm it) */
    includeAllPotentialDebt: boolean;
}