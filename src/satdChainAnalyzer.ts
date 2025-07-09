// src/satdChainAnalyzer.ts
import * as vscode from 'vscode';
import { TechnicalDebt, SatdRelationship, RelationshipType } from './models';

/**
 * SatdChainAnalyzer discovers chains of technical debt relationships
 * by analyzing direct and indirect connections between debt items.
 */
export class SatdChainAnalyzer {

    // Add this method to the SatdChainAnalyzer class

/**
 * Set weights for SIR score calculation
 * @param severityWeight Weight for intrinsic severity
 * @param outgoingWeight Weight for outgoing chain influence
 * @param incomingWeight Weight for incoming chain dependency
 * @param chainLengthWeight Weight for chain length factor
 */
public setSirWeights(
    severityWeight: number,
    outgoingWeight: number,
    incomingWeight: number,
    chainLengthWeight: number
): void {
    this.severityWeight = severityWeight;
    this.outgoingWeight = outgoingWeight;
    this.incomingWeight = incomingWeight;
    this.chainLengthWeight = chainLengthWeight;
}

// And add these properties at the class level
private severityWeight: number = 0.4;
private outgoingWeight: number = 0.3;
private incomingWeight: number = -0.1;
private chainLengthWeight: number = 0.4;

    /**
     * Find all chains in the relationship graph
     * @param debtItems Technical debt items
     * @param relationships Direct relationships between debt items
     * @returns Enhanced relationships with chain information
     */
    public findChains(
        debtItems: TechnicalDebt[], 
        relationships: SatdRelationship[]
    ): { 
        relationships: SatdRelationship[], 
        chains: Chain[] 
    } {
        // Build a dependency graph from the relationships
        const graph = this.buildDependencyGraph(relationships);
        
        // Find all chains in the graph
        const chains: Chain[] = [];
        const visited = new Set<string>();
        
        // Start from each node to find all possible chains
        for (const debt of debtItems) {
            if (!visited.has(debt.id)) {
                this.findChainsFromNode(debt.id, graph, [], chains, visited, new Set<string>());
            }
        }
        
        // Enhance relationships with chain information
        const enhancedRelationships = this.enhanceRelationshipsWithChainInfo(relationships, chains);
        
        return {
            relationships: enhancedRelationships,
            chains
        };
    }
    
    /**
     * Build a directed dependency graph from relationships
     * @param relationships List of relationships
     * @returns Adjacency list representation of the graph
     */
    private buildDependencyGraph(relationships: SatdRelationship[]): Map<string, string[]> {
        const graph = new Map<string, string[]>();
        
        for (const rel of relationships) {
            if (!graph.has(rel.sourceId)) {
                graph.set(rel.sourceId, []);
            }
            
            graph.get(rel.sourceId)!.push(rel.targetId);
        }
        
        return graph;
    }
    
    /**
     * Find all chains starting from a specific node
     * @param nodeId Current node ID
     * @param graph Dependency graph
     * @param currentPath Current path being explored
     * @param chains Output list of found chains
     * @param visited Set of visited nodes
     * @param currentVisited Set of nodes visited in the current path (to detect cycles)
     */
    private findChainsFromNode(
        nodeId: string, 
        graph: Map<string, string[]>, 
        currentPath: string[], 
        chains: Chain[], 
        visited: Set<string>,
        currentVisited: Set<string>
    ): void {
        // Mark node as visited in the current path
        currentVisited.add(nodeId);
        
        // Add node to current path
        const newPath = [...currentPath, nodeId];
        
        // If path has at least 2 nodes, it's a chain
        if (newPath.length >= 2) {
            chains.push({
                id: `chain-${chains.length + 1}`,
                nodes: [...newPath],
                length: newPath.length
            });
        }
        
        // Continue to neighbors
        const neighbors = graph.get(nodeId) || [];
        for (const neighbor of neighbors) {
            // Avoid cycles in the current path
            if (!currentVisited.has(neighbor)) {
                this.findChainsFromNode(neighbor, graph, newPath, chains, visited, currentVisited);
            }
        }
        
        // Mark the overall node as visited
        visited.add(nodeId);
        
        // Remove from current path visited set when backtracking
        currentVisited.delete(nodeId);
    }
    
    /**
     * Enhance relationships with chain information
     * @param relationships Original relationships
     * @param chains Discovered chains
     * @returns Enhanced relationships
     */
    private enhanceRelationshipsWithChainInfo(
        relationships: SatdRelationship[],
        chains: Chain[]
    ): SatdRelationship[] {
        // Build a map of edges to chains they belong to
        const edgeToChains = new Map<string, string[]>();
        
        for (const chain of chains) {
            for (let i = 0; i < chain.nodes.length - 1; i++) {
                const edge = `${chain.nodes[i]}-${chain.nodes[i + 1]}`;
                if (!edgeToChains.has(edge)) {
                    edgeToChains.set(edge, []);
                }
                edgeToChains.get(edge)!.push(chain.id);
            }
        }
        
        // Enhance each relationship with chain information
        return relationships.map(rel => {
            const edge = `${rel.sourceId}-${rel.targetId}`;
            const chainIds = edgeToChains.get(edge) || [];
            
            return {
                ...rel,
                chainIds,
                inChain: chainIds.length > 0
            };
        });
    }
    
    /**
     * Calculate the SATD Impact Ripple (SIR) Score for each debt item
     * @param debtItems Technical debt items
     * @param relationships Relationships between debt items
     * @returns Debt items with SIR scores
     */
    public calculateSIRScores(
        debtItems: TechnicalDebt[],
        relationships: SatdRelationship[]
    ): TechnicalDebt[] {
        // Build forward and backward dependency graphs
        const forwardGraph = this.buildDependencyGraph(relationships);
        const backwardGraph = new Map<string, string[]>();

        for (const rel of relationships) {
            if (!backwardGraph.has(rel.targetId)) {
                backwardGraph.set(rel.targetId, []);
            }
            
            backwardGraph.get(rel.targetId)!.push(rel.sourceId);
        }
        
        // Find all chains for chain length factor
        const { chains } = this.findChains(debtItems, relationships);
        
        // Calculate maximum chain length for normalization
        const maxChainLength = chains.reduce((max, chain) => Math.max(max, chain.length), 0);
        
        // Calculate node participation in chains
        const nodeToChains = new Map<string, Set<string>>();
        for (const chain of chains) {
            for (const node of chain.nodes) {
                if (!nodeToChains.has(node)) {
                    nodeToChains.set(node, new Set<string>());
                }
                nodeToChains.get(node)!.add(chain.id);
            }
        }
        
        // Calculate SIR score components for each debt item
        return debtItems.map(debt => {
            // Intrinsic Severity (S) - based on debt type
            const severity = this.calculateIntrinsicSeverity(debt);
            
            // Outgoing Chain Influence (OCI) - number of other debt items dependent on this
            const outDependencies = this.calculateDependencyCount(debt.id, forwardGraph);
            
            // Incoming Chain Dependency (ICD) - number of other debt items this depends on
            const inDependencies = this.calculateDependencyCount(debt.id, backwardGraph);
            
            // Chain Length Factor (CLF) - normalized length of longest chain this participates in
            const chainLengthFactor = this.calculateChainLengthFactor(debt.id, chains, maxChainLength);
            
            // Calculate SIR score with weighted components
            // We're using weights: severity (0.4), outDependencies (0.3), inDependencies (-0.1), chainLengthFactor (0.4)
            //const sirScore = (0.4 * severity + 0.3 * outDependencies - 0.1 * inDependencies + 0.4 * chainLengthFactor);
            const sirScore = (
                this.severityWeight * severity + 
                this.outgoingWeight * outDependencies - 
                Math.abs(this.incomingWeight) * inDependencies + 
                this.chainLengthWeight * chainLengthFactor
            );
            return {
                ...debt,
                sirScore,
                sirComponents: {
                    severity,
                    outDependencies,
                    inDependencies,
                    chainLengthFactor
                }
            };
        });
    }
    
    /**
     * Calculate intrinsic severity based on debt type and content
     * @param debt Technical debt item
     * @returns Severity score (1-10)
     */
    private calculateIntrinsicSeverity(debt: TechnicalDebt): number {
        const debtTypeScores: { [key: string]: number } = {
            'Design': 8,
            'Architecture': 9,
            'Defect': 7,
            'Test': 6,
            'Implementation': 5,
            'Requirement': 7,
            'Documentation': 4,
            'Other': 5
        };
        
        // Base score from debt type
        let score = debtTypeScores[debt.debtType || 'Other'] || 5;
        
        // Check for critical keywords that increase severity
        const content = (debt.content || '').toLowerCase();
        if (content.includes('critical') || content.includes('blocker') || content.includes('urgent')) {
            score += 2;
        } else if (content.includes('major') || content.includes('important')) {
            score += 1;
        } else if (content.includes('minor') || content.includes('cosmetic') || content.includes('trivial')) {
            score -= 2;
        }
        
        // Clamp to 1-10 range
        return Math.max(1, Math.min(10, score));
    }
    
    /**
     * Calculate the number of dependencies in a graph
     * @param nodeId Node ID
     * @param graph Dependency graph
     * @returns Number of dependencies
     */
    private calculateDependencyCount(nodeId: string, graph: Map<string, string[]>): number {
        const visited = new Set<string>();
        const queue: string[] = [nodeId];
        
        // Don't count the node itself
        visited.add(nodeId);
        
        while (queue.length > 0) {
            const current = queue.shift()!;
            const neighbors = graph.get(current) || [];
            
            for (const neighbor of neighbors) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push(neighbor);
                }
            }
        }
        
        // Return the count of visited nodes, excluding the starting node
        return visited.size - 1;
    }
    
    /**
     * Calculate chain length factor
     * @param nodeId Node ID
     * @param chains List of chains
     * @param maxChainLength Maximum chain length for normalization
     * @returns Normalized chain length factor (0-1)
     */
    private calculateChainLengthFactor(nodeId: string, chains: Chain[], maxChainLength: number): number {
        if (maxChainLength <= 1) {
            return 0;
        }
        
        // Find the longest chain this node participates in
        let longestChainLength = 0;
        
        for (const chain of chains) {
            if (chain.nodes.includes(nodeId) && chain.length > longestChainLength) {
                longestChainLength = chain.length;
            }
        }
        
        // Normalize by maximum chain length
        return longestChainLength / maxChainLength;
    }
}

/**
 * Chain of technical debt items
 */
export interface Chain {
    /** Unique identifier for the chain */
    id: string;
    
    /** Ordered list of node IDs in the chain */
    nodes: string[];
    
    /** Length of the chain */
    length: number;
}