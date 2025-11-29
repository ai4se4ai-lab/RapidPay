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
    
    /** LLM confidence score for SATD classification (0-1) */
    confidence?: number;
    
    /** SATD Impact Ripple Score (normalized 0-1) */
    sirScore?: number;
    
    /** Components of the SIR score (paper formula) */
    sirComponents?: SIRComponents;
    
    /** Fix potential assessment from CAIG (HIGH, PARTIAL, LOW) */
    fixPotential?: FixPotential;
    
    /** Numeric fix potential value (1.0, 0.5, 0.0) */
    fixPotentialValue?: number;
    
    /** Developer interest score - familiarity with code region */
    developerInterestScore?: number;
    
    /** Historical effort score S^t based on resolution time and file modifications */
    effortScore?: number;
    
    /** Commit relevance score for CAIG ranking */
    commitRelevance?: number;
    
    /** Final CAIG ranking score */
    rankScore?: number;
    
    /** Connected SATD items in the same chain */
    connectedSatdIds?: string[];
    
    /** LLM-generated remediation plan */
    remediationPlan?: string;
    
    /** Function/method name containing this SATD */
    containingFunction?: string;
    
    /** Class name containing this SATD (if applicable) */
    containingClass?: string;
    
    /** Error message if LLM classification failed */
    llmError?: string;
}

/**
 * SIR Score Components according to paper formula:
 * SIR(t_i) = α·Fanout_w(t_i) + β·ChainLen_w(t_i) + γ·Reachability_w(t_i)
 * Where (α,β,γ) = (0.4, 0.3, 0.3)
 */
export interface SIRComponents {
    /** Weighted out-degree: sum of edge weights for outgoing edges */
    fanout_w: number;
    
    /** Maximum weighted path length via DFS with memoization */
    chainLen_w: number;
    
    /** Sum of max path strengths to all reachable SATD nodes */
    reachability_w: number;
    
    /** Raw fanout before normalization */
    rawFanout?: number;
    
    /** Raw chain length before normalization */
    rawChainLen?: number;
    
    /** Raw reachability before normalization */
    rawReachability?: number;
}

/**
 * SIR weight configuration
 * Default: (α,β,γ) = (0.4, 0.3, 0.3)
 */
export interface SIRWeights {
    /** Weight for Fanout_w component */
    alpha: number;
    
    /** Weight for ChainLen_w component */
    beta: number;
    
    /** Weight for Reachability_w component */
    gamma: number;
}

/**
 * Default SIR weights from paper
 */
export const DEFAULT_SIR_WEIGHTS: SIRWeights = {
    alpha: 0.4,
    beta: 0.3,
    gamma: 0.3
};

/**
 * Fix potential assessment levels from CAIG Prompt 2
 */
export enum FixPotential {
    HIGH = 'HIGH',      // Directly addresses the debt
    PARTIAL = 'PARTIAL', // Related opportunity
    LOW = 'LOW'         // Unrelated
}

/**
 * Fix potential numeric mappings
 */
export const FIX_POTENTIAL_VALUES: Record<FixPotential, number> = {
    [FixPotential.HIGH]: 1.0,
    [FixPotential.PARTIAL]: 0.5,
    [FixPotential.LOW]: 0.0
};

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
 * Configuration for SATD detection (SID)
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
    
    /** LLM confidence threshold τ for SATD classification (default: 0.7) */
    confidenceThreshold: number;
}

/**
 * Default SATD detection configuration
 */
export const DEFAULT_SATD_CONFIG: SatdConfig = {
    detectionLevel: 'standard',
    includeImplicit: true,
    customPatterns: [],
    excludePatterns: [],
    includeAllPotentialDebt: false,
    confidenceThreshold: 0.7
};

/**
 * Type of relationship between technical debt items
 */
export enum RelationshipType {
    CALL = 'call',
    DATA = 'data',
    CONTROL = 'control',
    MODULE = 'module'
}

/**
 * Relationship type weights from paper
 * Call: 0.7-0.9, Data: 0.6-0.8, Control: 0.5-0.7, Module: 0.8-1.0
 */
export interface RelationshipTypeWeights {
    [RelationshipType.CALL]: { min: number; max: number; default: number };
    [RelationshipType.DATA]: { min: number; max: number; default: number };
    [RelationshipType.CONTROL]: { min: number; max: number; default: number };
    [RelationshipType.MODULE]: { min: number; max: number; default: number };
}

/**
 * Default relationship type weights from paper
 */
export const DEFAULT_RELATIONSHIP_WEIGHTS: RelationshipTypeWeights = {
    [RelationshipType.CALL]: { min: 0.7, max: 0.9, default: 0.8 },
    [RelationshipType.DATA]: { min: 0.6, max: 0.8, default: 0.7 },
    [RelationshipType.CONTROL]: { min: 0.5, max: 0.7, default: 0.6 },
    [RelationshipType.MODULE]: { min: 0.8, max: 1.0, default: 0.9 }
};

/**
 * Weighted edge in the SATD dependency graph
 */
export interface WeightedEdge {
    /** Source SATD node ID */
    sourceId: string;
    
    /** Target SATD node ID */
    targetId: string;
    
    /** Dependency type */
    type: RelationshipType;
    
    /** Edge weight w_r based on dependency type */
    weight: number;
    
    /** Number of hops in the dependency path */
    hops: number;
}

/**
 * Relationship between two technical debt items (IRD output)
 */
export interface SatdRelationship {
    /** ID of the source technical debt item */
    sourceId: string;
    
    /** ID of the target technical debt item */
    targetId: string;
    
    /** Types of relationships between the items */
    types: RelationshipType[];
    
    /** Weighted edges for each relationship type */
    edges: WeightedEdge[];
    
    /** Combined strength of the relationship (max of edge weights) */
    strength: number;
    
    /** Description of the relationship */
    description: string;
    
    /** IDs of chains this relationship belongs to */
    chainIds?: string[];
    
    /** Flag indicating if this relationship is part of any chain */
    inChain?: boolean;
    
    /** Number of hops between source and target (max k=5) */
    hopCount?: number;
}

/**
 * Maximum hop count for dependency analysis (k=5 from paper)
 */
export const MAX_DEPENDENCY_HOPS = 5;

/**
 * Represents a chain of technical debt items (weakly connected subgraph)
 */
export interface Chain {
    /** Unique identifier for the chain */
    id: string;
    
    /** Set of node IDs in the chain (weakly connected component) */
    nodes: string[];
    
    /** Length of the chain (number of nodes) */
    length: number;
    
    /** Maximum SIR score in the chain (chain representative) */
    maxSirScore?: number;
    
    /** ID of the node with max SIR score */
    representativeNodeId?: string;
    
    /** Total weighted edges in the chain */
    totalWeight?: number;
}

/**
 * CAIG ranking weights from paper
 * Rank(t_i) = η1·SIR(t_i) + η2·CommitRel(t_i) + η3·(1-S^t) + η4·f_i
 * Where (η1,η2,η3,η4) = (0.4, 0.3, 0.15, 0.15)
 */
export interface CAIGWeights {
    /** Weight for SIR score */
    eta1: number;
    
    /** Weight for commit relevance */
    eta2: number;
    
    /** Weight for effort score (inverted - lower effort preferred) */
    eta3: number;
    
    /** Weight for fix potential */
    eta4: number;
}

/**
 * Default CAIG weights from paper
 */
export const DEFAULT_CAIG_WEIGHTS: CAIGWeights = {
    eta1: 0.4,
    eta2: 0.3,
    eta3: 0.15,
    eta4: 0.15
};

/**
 * Sliding window size for commit analysis (W=50 from paper)
 */
export const COMMIT_WINDOW_SIZE = 50;

/**
 * Historical effort score configuration
 * S^t = λ·(RT_t/max(RT)) + (1-λ)·(FM_t/max(FM))
 */
export interface EffortScoreConfig {
    /** Lambda weight balancing resolution time vs file modifications */
    lambda: number;
}

/**
 * Default effort score configuration (λ=0.5 from paper)
 */
export const DEFAULT_EFFORT_CONFIG: EffortScoreConfig = {
    lambda: 0.5
};

/**
 * Commit information for CAIG analysis
 */
export interface CommitInfo {
    /** Commit hash */
    hash: string;
    
    /** Commit message */
    message: string;
    
    /** Author name */
    author: string;
    
    /** Author email */
    authorEmail: string;
    
    /** Commit timestamp */
    timestamp: Date;
    
    /** Files modified in this commit */
    modifiedFiles: string[];
    
    /** Diff content */
    diff?: string;
}

/**
 * Developer familiarity tracking for CAIG
 */
export interface DeveloperInterest {
    /** Developer identifier (email or name) */
    developerId: string;
    
    /** Map of file paths to modification count */
    fileModifications: Map<string, number>;
    
    /** Total interest score */
    totalScore: number;
}

/**
 * LLM classification result for SID
 */
export interface SATDClassificationResult {
    /** Whether the comment is classified as SATD */
    isSATD: boolean;
    
    /** Confidence score (0-100 from LLM, normalized to 0-1) */
    confidence: number;
    
    /** Raw LLM response */
    rawResponse?: string;
    
    /** Error message if classification failed */
    error?: string;
}

/**
 * Fix potential assessment result from CAIG Prompt 2
 */
export interface FixPotentialResult {
    /** Fix potential level */
    potential: FixPotential;
    
    /** Numeric value (1.0, 0.5, 0.0) */
    value: number;
    
    /** Brief justification */
    justification?: string;
}

/**
 * Remediation plan from CAIG Prompt 3
 */
export interface RemediationPlan {
    /** Why address this debt now */
    whyNow: string;
    
    /** Step-by-step approach */
    steps: string[];
    
    /** Expected benefits */
    benefits: string[];
    
    /** Potential risks */
    risks: string[];
    
    /** Priority level */
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    
    /** Full plan text */
    fullPlan: string;
}

/**
 * SATD dependency graph structure
 */
export interface SATDGraph {
    /** All SATD nodes (technical debt items) */
    nodes: TechnicalDebt[];
    
    /** All weighted edges */
    edges: WeightedEdge[];
    
    /** Discovered chains (weakly connected subgraphs) */
    chains: Chain[];
    
    /** Adjacency list for forward traversal */
    adjacencyList: Map<string, WeightedEdge[]>;
    
    /** Reverse adjacency list for backward traversal */
    reverseAdjacencyList: Map<string, WeightedEdge[]>;
}

/**
 * Neo4j node representation for SATD
 */
export interface Neo4jSATDNode {
    id: string;
    file: string;
    line: number;
    content: string;
    description: string;
    debtType: string;
    sirScore: number;
    confidence: number;
    createdCommit: string;
    createdDate: string;
}

/**
 * Neo4j relationship representation
 */
export interface Neo4jSATDRelationship {
    sourceId: string;
    targetId: string;
    type: RelationshipType;
    weight: number;
    hops: number;
    description: string;
}

/**
 * Analysis result containing all RapidPay outputs
 */
export interface RapidPayAnalysisResult {
    /** Detected SATD instances (SID output) */
    satdInstances: TechnicalDebt[];
    
    /** SATD dependency graph (IRD output) */
    graph: SATDGraph;
    
    /** Ranked SATD instances by SIR score */
    rankedBySIR: TechnicalDebt[];
    
    /** Commit-aware recommendations (CAIG output) */
    recommendations: TechnicalDebt[];
    
    /** Analysis timestamp */
    timestamp: Date;
    
    /** Repository information */
    repository?: {
        path: string;
        branch: string;
        commitHash: string;
    };
}
