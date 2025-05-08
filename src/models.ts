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
    
    /** SATD Impact Ripple Score */
    sirScore?: number;
    
    /** Components of the SIR score */
    sirComponents?: {
        /** Intrinsic severity (1-10) */
        severity: number;
        
        /** Number of other SATD instances dependent on this */
        outDependencies: number;
        
        /** Number of other SATD instances this depends on */
        inDependencies: number;
        
        /** Chain length factor (normalized) */
        chainLengthFactor: number;
    };
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

/**
 * Type of relationship between technical debt items
 */
export enum RelationshipType {
    CALL_GRAPH = 'Call Graph',
    DATA_DEPENDENCY = 'Data Dependency',
    CONTROL_FLOW = 'Control Flow',
    MODULE_DEPENDENCY = 'Module Dependency'
}

/**
 * Relationship between two technical debt items
 */
export interface SatdRelationship {
    /** ID of the source technical debt item */
    sourceId: string;
    
    /** ID of the target technical debt item */
    targetId: string;
    
    /** Types of relationships between the items */
    types: RelationshipType[];
    
    /** Strength of the relationship (0-1) */
    strength: number;
    
    /** Description of the relationship */
    description: string;
    
    /** IDs of chains this relationship belongs to */
    chainIds?: string[];
    
    /** Flag indicating if this relationship is part of any chain */
    inChain?: boolean;
}

/**
 * Represents a chain of technical debt items
 */
export interface Chain {
    /** Unique identifier for the chain */
    id: string;
    
    /** Ordered list of node IDs in the chain */
    nodes: string[];
    
    /** Length of the chain (number of nodes) */
    length: number;
}
