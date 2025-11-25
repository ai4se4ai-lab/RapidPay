// src/satdRelationshipAnalyzer.ts
import * as vscode from 'vscode';
import { 
    TechnicalDebt, 
    SatdRelationship, 
    RelationshipType,
    WeightedEdge,
    Chain,
    SATDGraph,
    MAX_DEPENDENCY_HOPS
} from './models';
import { CallGraphAnalyzer } from './analyzers/callGraphAnalyzer';
import { DataDependencyAnalyzer } from './analyzers/dataDependencyAnalyzer';
import { ControlFlowAnalyzer } from './analyzers/controlFlowAnalyzer';
import { ModuleDependencyAnalyzer } from './analyzers/moduleDependencyAnalyzer';

/**
 * SatdRelationshipAnalyzer identifies relationships between different
 * technical debt instances to form chains and help understand their impact.
 * Implements Algorithm 2: Dependency Graph Construction (IRD)
 */
export class SatdRelationshipAnalyzer {
    private callGraphAnalyzer: CallGraphAnalyzer;
    private dataDependencyAnalyzer: DataDependencyAnalyzer;
    private controlFlowAnalyzer: ControlFlowAnalyzer;
    private moduleDependencyAnalyzer: ModuleDependencyAnalyzer;
    
    private workspaceRoot: string | null = null;
    private maxHops: number = MAX_DEPENDENCY_HOPS;
    
    /**
     * Constructor initializes the sub-analyzers
     */
    constructor() {
        this.callGraphAnalyzer = new CallGraphAnalyzer();
        this.dataDependencyAnalyzer = new DataDependencyAnalyzer();
        this.controlFlowAnalyzer = new ControlFlowAnalyzer();
        this.moduleDependencyAnalyzer = new ModuleDependencyAnalyzer();
    }
    
    /**
     * Initialize the analyzer with workspace root
     * @param workspaceRoot Root directory of the workspace
     */
    public async initialize(workspaceRoot: string): Promise<void> {
        this.workspaceRoot = workspaceRoot;
        await this.callGraphAnalyzer.initialize(workspaceRoot);
        await this.dataDependencyAnalyzer.initialize(workspaceRoot);
        await this.controlFlowAnalyzer.initialize(workspaceRoot);
        await this.moduleDependencyAnalyzer.initialize(workspaceRoot);
    }
    
    /**
     * Set maximum hop count for all analyzers
     * @param hops Maximum number of hops (default: 5)
     */
    public setMaxHops(hops: number): void {
        this.maxHops = Math.min(hops, MAX_DEPENDENCY_HOPS);
        this.callGraphAnalyzer.setMaxHops(this.maxHops);
        this.dataDependencyAnalyzer.setMaxHops(this.maxHops);
        this.controlFlowAnalyzer.setMaxHops(this.maxHops);
        this.moduleDependencyAnalyzer.setMaxHops(this.maxHops);
    }
    
    /**
     * Algorithm 2: Dependency Graph Construction (IRD)
     * Analyze relationships between technical debt items and build the SATD graph
     * 
     * @param debtItems List of technical debt items to analyze
     * @returns SATD dependency graph with relationships and chains
     */
    public async analyzeRelationships(debtItems: TechnicalDebt[]): Promise<SatdRelationship[]> {
        if (!this.workspaceRoot) {
            throw new Error('Analyzer not initialized');
        }
        
        // Collect file content for all files with technical debt
        const fileContentMap = await this.collectFileContent(debtItems);
        
        console.log(`IRD: Analyzing ${debtItems.length} SATD instances across ${fileContentMap.size} files`);
        console.log(`IRD: Max hop limit set to k=${this.maxHops}`);
        
        // Run all analyzers in parallel
        // Each analyzer checks DependencyExists(t_i, t_j, r, k) for their respective dependency type
        const [callRelationships, dataRelationships, controlFlowRelationships, moduleRelationships] = await Promise.all([
            this.callGraphAnalyzer.findRelationships(debtItems, fileContentMap),
            this.dataDependencyAnalyzer.findRelationships(debtItems, fileContentMap),
            this.controlFlowAnalyzer.findRelationships(debtItems, fileContentMap),
            this.moduleDependencyAnalyzer.findRelationships(debtItems, fileContentMap)
        ]);
        
        console.log(`IRD: Found ${callRelationships.length} call, ${dataRelationships.length} data, ${controlFlowRelationships.length} control, ${moduleRelationships.length} module relationships`);
        
        // Combine all relationships
        const allRelationships = [
            ...callRelationships,
            ...dataRelationships,
            ...controlFlowRelationships,
            ...moduleRelationships
        ];
        
        // Deduplicate and merge relationships
        const mergedRelationships = this.deduplicateRelationships(allRelationships);
        
        console.log(`IRD: Total ${mergedRelationships.length} unique relationships after deduplication`);
        
        return mergedRelationships;
    }
    
    /**
     * Build complete SATD Graph structure
     * G = (T, E) where T is SATD nodes and E is weighted edges
     */
    public buildSATDGraph(debtItems: TechnicalDebt[], relationships: SatdRelationship[]): SATDGraph {
        // Collect all weighted edges
        const edges: WeightedEdge[] = [];
        for (const rel of relationships) {
            edges.push(...rel.edges);
        }
        
        // Build adjacency lists
        const adjacencyList = new Map<string, WeightedEdge[]>();
        const reverseAdjacencyList = new Map<string, WeightedEdge[]>();
        
        for (const debt of debtItems) {
            adjacencyList.set(debt.id, []);
            reverseAdjacencyList.set(debt.id, []);
        }
        
        for (const edge of edges) {
            if (!adjacencyList.has(edge.sourceId)) {
                adjacencyList.set(edge.sourceId, []);
            }
            adjacencyList.get(edge.sourceId)!.push(edge);
            
            if (!reverseAdjacencyList.has(edge.targetId)) {
                reverseAdjacencyList.set(edge.targetId, []);
            }
            reverseAdjacencyList.get(edge.targetId)!.push(edge);
        }
        
        // Discover chains using weakly connected components
        const chains = this.discoverChains(debtItems, edges);
        
        return {
            nodes: debtItems,
            edges,
            chains,
            adjacencyList,
            reverseAdjacencyList
        };
    }
    
    /**
     * Discover SATD chains as weakly connected subgraphs
     * A chain is a set of SATD nodes {t_1, t_2, ..., t_k} such that 
     * for any pair (t_i, t_j), a path exists between them in the undirected version of G
     */
    public discoverChains(debtItems: TechnicalDebt[], edges: WeightedEdge[]): Chain[] {
        const chains: Chain[] = [];
        
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
        
        console.log(`IRD: Discovered ${chains.length} SATD chains`);
        
        return chains;
    }
    
    /**
     * Update relationships with chain information
     */
    public enhanceRelationshipsWithChainInfo(
        relationships: SatdRelationship[],
        chains: Chain[]
    ): SatdRelationship[] {
        // Build a map of node IDs to chain IDs
        const nodeToChains = new Map<string, string[]>();
        
        for (const chain of chains) {
            for (const nodeId of chain.nodes) {
                if (!nodeToChains.has(nodeId)) {
                    nodeToChains.set(nodeId, []);
                }
                nodeToChains.get(nodeId)!.push(chain.id);
            }
        }
        
        // Enhance relationships with chain information
        return relationships.map(rel => {
            const sourceChains = nodeToChains.get(rel.sourceId) || [];
            const targetChains = nodeToChains.get(rel.targetId) || [];
            
            // Find common chains
            const commonChains = sourceChains.filter(c => targetChains.includes(c));
            
            return {
                ...rel,
                chainIds: commonChains,
                inChain: commonChains.length > 0
            };
        });
    }
    
    /**
     * Get connected SATD items for a given node (for CAIG)
     */
    public getConnectedSATDItems(
        nodeId: string,
        graph: SATDGraph
    ): TechnicalDebt[] {
        const connectedIds = new Set<string>();
        
        // Find chain containing this node
        for (const chain of graph.chains) {
            if (chain.nodes.includes(nodeId)) {
                for (const id of chain.nodes) {
                    if (id !== nodeId) {
                        connectedIds.add(id);
                    }
                }
            }
        }
        
        // Return connected debt items
        return graph.nodes.filter(node => connectedIds.has(node.id));
    }
    
    /**
     * Collect content of all files with technical debt
     */
    private async collectFileContent(debtItems: TechnicalDebt[]): Promise<Map<string, string>> {
        const fileContentMap = new Map<string, string>();
        const uniqueFiles = [...new Set(debtItems.map(item => item.file))];
        
        for (const filePath of uniqueFiles) {
            try {
                if (!this.workspaceRoot) {
                    continue;
                }
                
                const uri = vscode.Uri.file(`${this.workspaceRoot}/${filePath}`);
                const document = await vscode.workspace.openTextDocument(uri);
                fileContentMap.set(filePath, document.getText());
            } catch (error) {
                console.error(`Failed to read file: ${filePath}`, error);
            }
        }
        
        return fileContentMap;
    }
    
    /**
     * Deduplicate relationships by combining those between the same debt items
     * Merges multiple relationship types and edges between the same source-target pair
     */
    private deduplicateRelationships(relationships: SatdRelationship[]): SatdRelationship[] {
        const relationshipMap = new Map<string, SatdRelationship>();
        
        for (const relationship of relationships) {
            const key = `${relationship.sourceId}-${relationship.targetId}`;
            
            if (relationshipMap.has(key)) {
                const existing = relationshipMap.get(key)!;
                
                // Merge relationship types
                const newTypes = new Set([...existing.types, ...relationship.types]);
                existing.types = Array.from(newTypes);
                
                // Merge edges
                existing.edges = [...existing.edges, ...relationship.edges];
                
                // Update strength to max of all edge weights
                existing.strength = Math.max(
                    existing.strength, 
                    relationship.strength,
                    ...relationship.edges.map(e => e.weight)
                );
                
                // Update hop count to minimum
                if (relationship.hopCount !== undefined) {
                    existing.hopCount = existing.hopCount !== undefined 
                        ? Math.min(existing.hopCount, relationship.hopCount)
                        : relationship.hopCount;
                }
                
                // Combine descriptions
                existing.description = this.combineDescriptions(existing.description, relationship.description);
            } else {
                relationshipMap.set(key, { ...relationship });
            }
        }
        
        return Array.from(relationshipMap.values());
    }
    
    /**
     * Combine descriptions from multiple relationships
     */
    private combineDescriptions(desc1: string, desc2: string): string {
        if (desc1 === desc2) {
            return desc1;
        }
        return `${desc1}\n\nAdditional relationship:\n${desc2}`;
    }
}
