// src/satdChainAnalyzer.ts
import * as vscode from 'vscode';
import { 
    TechnicalDebt, 
    SatdRelationship, 
    RelationshipType,
    WeightedEdge,
    Chain,
    SIRComponents,
    SIRWeights,
    DEFAULT_SIR_WEIGHTS,
    SATDGraph
} from './models';

/**
 * SatdChainAnalyzer discovers chains of technical debt relationships
 * and calculates SATD Impact Ripple (SIR) scores.
 * 
 * Implements Algorithm 3: SATD Impact Ripple (SIR) Score Computation
 * 
 * SIR(t_i) = α·Fanout_w(t_i) + β·ChainLen_w(t_i) + γ·Reachability_w(t_i)
 * Where (α,β,γ) = (0.4, 0.3, 0.3) by default
 */
export class SatdChainAnalyzer {
    // SIR weight configuration
    private weights: SIRWeights = { ...DEFAULT_SIR_WEIGHTS };
    
    // Memoization cache for ChainLen computation
    private chainLenCache: Map<string, number> = new Map();
    
    // Memoization cache for Reachability computation
    private reachabilityCache: Map<string, number> = new Map();

    /**
     * Set weights for SIR score calculation
     * @param alpha Weight for Fanout_w component (default: 0.4)
     * @param beta Weight for ChainLen_w component (default: 0.3)
     * @param gamma Weight for Reachability_w component (default: 0.3)
     */
    public setSirWeights(alpha: number, beta: number, gamma: number): void {
        // Normalize weights to sum to 1
        const sum = alpha + beta + gamma;
        this.weights = {
            alpha: alpha / sum,
            beta: beta / sum,
            gamma: gamma / sum
        };
    }
    
    /**
     * Get current SIR weights
     */
    public getSirWeights(): SIRWeights {
        return { ...this.weights };
    }

    /**
     * Find all chains in the relationship graph as weakly connected subgraphs
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
        // Collect all weighted edges
        const edges: WeightedEdge[] = [];
        for (const rel of relationships) {
            edges.push(...rel.edges);
        }
        
        // Build undirected adjacency list for weakly connected component analysis
        const undirectedAdj = new Map<string, Set<string>>();
        
        for (const debt of debtItems) {
            undirectedAdj.set(debt.id, new Set());
        }
        
        for (const edge of edges) {
            if (!undirectedAdj.has(edge.sourceId)) {
                undirectedAdj.set(edge.sourceId, new Set());
            }
            if (!undirectedAdj.has(edge.targetId)) {
                undirectedAdj.set(edge.targetId, new Set());
            }
            
            // Add edges in both directions for undirected graph
            undirectedAdj.get(edge.sourceId)!.add(edge.targetId);
            undirectedAdj.get(edge.targetId)!.add(edge.sourceId);
        }
        
        // Find weakly connected components using BFS
        const chains: Chain[] = [];
        const visited = new Set<string>();
        let chainId = 0;
        
        for (const debt of debtItems) {
            if (visited.has(debt.id)) continue;
            
            // BFS to find all nodes in this component
            const component: string[] = [];
            const queue: string[] = [debt.id];
            
            while (queue.length > 0) {
                const nodeId = queue.shift()!;
                if (visited.has(nodeId)) continue;
                
                visited.add(nodeId);
                component.push(nodeId);
                
                const neighbors = undirectedAdj.get(nodeId) || new Set();
                for (const neighbor of neighbors) {
                    if (!visited.has(neighbor)) {
                        queue.push(neighbor);
                    }
                }
            }
            
            // Only create a chain if there's more than one node connected
            if (component.length > 1) {
                // Calculate total weight of edges in this chain
                let totalWeight = 0;
                const componentSet = new Set(component);
                for (const edge of edges) {
                    if (componentSet.has(edge.sourceId) && componentSet.has(edge.targetId)) {
                        totalWeight += edge.weight;
                    }
                }
                
                chains.push({
                    id: `chain-${++chainId}`,
                    nodes: component,
                    length: component.length,
                    totalWeight
                });
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
     * Enhance relationships with chain information
     */
    private enhanceRelationshipsWithChainInfo(
        relationships: SatdRelationship[],
        chains: Chain[]
    ): SatdRelationship[] {
        const edgeToChains = new Map<string, string[]>();
        
        for (const chain of chains) {
            for (let i = 0; i < chain.nodes.length; i++) {
                for (let j = i + 1; j < chain.nodes.length; j++) {
                    const edge1 = `${chain.nodes[i]}-${chain.nodes[j]}`;
                    const edge2 = `${chain.nodes[j]}-${chain.nodes[i]}`;
                    
                    if (!edgeToChains.has(edge1)) {
                        edgeToChains.set(edge1, []);
                    }
                    if (!edgeToChains.has(edge2)) {
                        edgeToChains.set(edge2, []);
                    }
                    
                    edgeToChains.get(edge1)!.push(chain.id);
                    edgeToChains.get(edge2)!.push(chain.id);
                }
            }
        }
        
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
     * Algorithm 3: SATD Impact Ripple (SIR) Score Computation
     * 
     * SIR(t_i) = α·Fanout_w(t_i) + β·ChainLen_w(t_i) + γ·Reachability_w(t_i)
     * 
     * @param debtItems Technical debt items
     * @param relationships Relationships between debt items
     * @returns Debt items with SIR scores
     */
    public calculateSIRScores(
        debtItems: TechnicalDebt[],
        relationships: SatdRelationship[]
    ): TechnicalDebt[] {
        // Clear memoization caches
        this.chainLenCache.clear();
        this.reachabilityCache.clear();
        
        // Build directed adjacency list with weighted edges
        const adjacencyList = new Map<string, WeightedEdge[]>();
        
        for (const debt of debtItems) {
            adjacencyList.set(debt.id, []);
        }
        
        for (const rel of relationships) {
            for (const edge of rel.edges) {
                if (!adjacencyList.has(edge.sourceId)) {
                    adjacencyList.set(edge.sourceId, []);
                }
                adjacencyList.get(edge.sourceId)!.push(edge);
            }
        }
        
        // Calculate raw SIR components for each debt item
        const rawComponents: Map<string, { fanout: number; chainLen: number; reachability: number }> = new Map();
        
        for (const debt of debtItems) {
            // Fanout_w: Sum of weighted out-degrees
            const fanout = this.calculateFanoutW(debt.id, adjacencyList);
            
            // ChainLen_w: Max weighted path length via DFS with memoization
            const chainLen = this.calculateChainLenW(debt.id, adjacencyList, new Set());
            
            // Reachability_w: Sum of max path strengths to reachable SATD nodes
            const reachability = this.calculateReachabilityW(debt.id, adjacencyList);
            
            rawComponents.set(debt.id, { fanout, chainLen, reachability });
        }
        
        // Min-max normalize each component to [0, 1]
        const normalizedComponents = this.normalizeComponents(rawComponents);
        
        // Calculate final SIR scores
        const debtWithScores = debtItems.map(debt => {
            const components = normalizedComponents.get(debt.id)!;
            const rawComps = rawComponents.get(debt.id)!;
            
            // SIR(t_i) = α·Fanout_w + β·ChainLen_w + γ·Reachability_w
            const sirScore = 
                this.weights.alpha * components.fanout +
                this.weights.beta * components.chainLen +
                this.weights.gamma * components.reachability;
            
            const sirComponents: SIRComponents = {
                fanout_w: components.fanout,
                chainLen_w: components.chainLen,
                reachability_w: components.reachability,
                rawFanout: rawComps.fanout,
                rawChainLen: rawComps.chainLen,
                rawReachability: rawComps.reachability
            };
            
            return {
                ...debt,
                sirScore,
                sirComponents
            };
        });
        
        // Normalize final SIR scores to [0, 1]
        const maxSir = Math.max(...debtWithScores.map(d => d.sirScore || 0));
        const minSir = Math.min(...debtWithScores.map(d => d.sirScore || 0));
        const range = maxSir - minSir || 1;
        
        return debtWithScores.map(debt => ({
            ...debt,
            sirScore: (debt.sirScore! - minSir) / range
        }));
    }
    
    /**
     * Calculate Fanout_w(t_i): Sum of weighted out-degrees
     * Captures how many and how strongly this node influences other SATD-bearing entities
     */
    private calculateFanoutW(nodeId: string, adjacencyList: Map<string, WeightedEdge[]>): number {
        const edges = adjacencyList.get(nodeId) || [];
        return edges.reduce((sum, edge) => sum + edge.weight, 0);
    }
    
    /**
     * Calculate ChainLen_w(t_i): Maximum weighted path length via DFS with memoization
     * Uses visited set to avoid infinite recursion in cycles
     */
    private calculateChainLenW(
        nodeId: string, 
        adjacencyList: Map<string, WeightedEdge[]>,
        visited: Set<string>
    ): number {
        // Check memoization cache
        const cacheKey = `${nodeId}-${Array.from(visited).sort().join(',')}`;
        if (this.chainLenCache.has(cacheKey)) {
            return this.chainLenCache.get(cacheKey)!;
        }
        
        // Avoid cycles
        if (visited.has(nodeId)) {
            return 0;
        }
        
        visited.add(nodeId);
        
        const edges = adjacencyList.get(nodeId) || [];
        
        if (edges.length === 0) {
            visited.delete(nodeId);
            this.chainLenCache.set(cacheKey, 0);
            return 0;
        }
        
        let maxPathLength = 0;
        
        for (const edge of edges) {
            // Recursively compute path length to child
            const childPathLength = this.calculateChainLenW(edge.targetId, adjacencyList, visited);
            const pathLength = edge.weight + childPathLength;
            
            if (pathLength > maxPathLength) {
                maxPathLength = pathLength;
            }
        }
        
        visited.delete(nodeId);
        this.chainLenCache.set(cacheKey, maxPathLength);
        
        return maxPathLength;
    }
    
    /**
     * Calculate Reachability_w(t_i): Sum of max path strengths to all reachable SATD nodes
     * Uses BFS/DFS with cycle detection
     */
    private calculateReachabilityW(
        startNodeId: string, 
        adjacencyList: Map<string, WeightedEdge[]>
    ): number {
        // Check cache
        if (this.reachabilityCache.has(startNodeId)) {
            return this.reachabilityCache.get(startNodeId)!;
        }
        
        // Track max path strength to each reachable node
        const maxPathStrength = new Map<string, number>();
        
        // BFS with path strength tracking
        const queue: Array<{ nodeId: string; pathStrength: number }> = [
            { nodeId: startNodeId, pathStrength: 0 }
        ];
        const visited = new Set<string>();
        
        while (queue.length > 0) {
            const { nodeId, pathStrength } = queue.shift()!;
            
            const edges = adjacencyList.get(nodeId) || [];
            
            for (const edge of edges) {
                const newPathStrength = Math.max(pathStrength, edge.weight);
                const existingStrength = maxPathStrength.get(edge.targetId) || 0;
                
                if (newPathStrength > existingStrength) {
                    maxPathStrength.set(edge.targetId, newPathStrength);
                    
                    // Only continue if we haven't processed this node with a stronger path
                    if (!visited.has(edge.targetId) || existingStrength < newPathStrength) {
                        visited.add(edge.targetId);
                        queue.push({ nodeId: edge.targetId, pathStrength: newPathStrength });
                    }
                }
            }
        }
        
        // Remove self from reachability
        maxPathStrength.delete(startNodeId);
        
        // Sum of max path strengths to all reachable nodes
        const reachability = Array.from(maxPathStrength.values()).reduce((sum, strength) => sum + strength, 0);
        
        this.reachabilityCache.set(startNodeId, reachability);
        
        return reachability;
    }
    
    /**
     * Min-max normalize SIR components to [0, 1]
     */
    private normalizeComponents(
        rawComponents: Map<string, { fanout: number; chainLen: number; reachability: number }>
    ): Map<string, { fanout: number; chainLen: number; reachability: number }> {
        const normalized = new Map<string, { fanout: number; chainLen: number; reachability: number }>();
        
        // Find min and max for each component
        let minFanout = Infinity, maxFanout = -Infinity;
        let minChainLen = Infinity, maxChainLen = -Infinity;
        let minReachability = Infinity, maxReachability = -Infinity;
        
        for (const [, components] of rawComponents) {
            minFanout = Math.min(minFanout, components.fanout);
            maxFanout = Math.max(maxFanout, components.fanout);
            minChainLen = Math.min(minChainLen, components.chainLen);
            maxChainLen = Math.max(maxChainLen, components.chainLen);
            minReachability = Math.min(minReachability, components.reachability);
            maxReachability = Math.max(maxReachability, components.reachability);
        }
        
        // Avoid division by zero
        const fanoutRange = maxFanout - minFanout || 1;
        const chainLenRange = maxChainLen - minChainLen || 1;
        const reachabilityRange = maxReachability - minReachability || 1;
        
        // Normalize each component
        for (const [nodeId, components] of rawComponents) {
            normalized.set(nodeId, {
                fanout: (components.fanout - minFanout) / fanoutRange,
                chainLen: (components.chainLen - minChainLen) / chainLenRange,
                reachability: (components.reachability - minReachability) / reachabilityRange
            });
        }
        
        return normalized;
    }
    
    /**
     * Rank SATD instances by SIR score
     * @param debtItems Debt items with SIR scores
     * @returns Sorted array (highest SIR first)
     */
    public rankBySIR(debtItems: TechnicalDebt[]): TechnicalDebt[] {
        return [...debtItems].sort((a, b) => (b.sirScore || 0) - (a.sirScore || 0));
    }
    
    /**
     * Get chain-level SIR score (max SIR within chain)
     * Used for chain-level analyses in RQ2
     */
    public getChainSIRScore(chain: Chain, debtItems: TechnicalDebt[]): number {
        const chainNodeIds = new Set(chain.nodes);
        const chainDebts = debtItems.filter(d => chainNodeIds.has(d.id));
        
        if (chainDebts.length === 0) return 0;
        
        return Math.max(...chainDebts.map(d => d.sirScore || 0));
    }
    
    /**
     * Enhance chains with SIR information
     */
    public enhanceChainsWithSIR(chains: Chain[], debtItems: TechnicalDebt[]): Chain[] {
        return chains.map(chain => {
            const chainNodeIds = new Set(chain.nodes);
            const chainDebts = debtItems.filter(d => chainNodeIds.has(d.id));
            
            const maxSirScore = chainDebts.length > 0 
                ? Math.max(...chainDebts.map(d => d.sirScore || 0))
                : 0;
            
            const representativeNode = chainDebts.find(d => d.sirScore === maxSirScore);
            
            return {
                ...chain,
                maxSirScore,
                representativeNodeId: representativeNode?.id
            };
        });
    }
}
