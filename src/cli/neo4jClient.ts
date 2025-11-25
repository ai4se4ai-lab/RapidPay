// src/cli/neo4jClient.ts
/**
 * Neo4j Client for storing and querying SATD graph data
 * 
 * This client provides integration with Neo4j graph database for:
 * - Storing SATD instances as nodes
 * - Storing relationships as edges with weights
 * - Querying impact chains
 * - Visualizing dependency graphs
 */

import { 
    TechnicalDebt, 
    SatdRelationship, 
    RelationshipType,
    Chain,
    Neo4jSATDNode,
    Neo4jSATDRelationship
} from '../models';

// Neo4j driver types (dynamically imported to avoid bundle issues)
type Driver = any;
type Session = any;

/**
 * Neo4j client for SATD graph storage
 */
export class Neo4jClient {
    private uri: string;
    private user: string;
    private password: string;
    private driver: Driver | null = null;
    
    constructor(uri: string, user: string, password: string) {
        this.uri = uri;
        this.user = user;
        this.password = password;
    }
    
    /**
     * Connect to Neo4j database
     */
    public async connect(): Promise<void> {
        try {
            // Dynamic import to avoid bundling issues
            const neo4j = await import('neo4j-driver');
            
            this.driver = neo4j.default.driver(
                this.uri,
                neo4j.default.auth.basic(this.user, this.password)
            );
            
            // Verify connection
            const session = this.driver.session();
            await session.run('RETURN 1');
            await session.close();
            
            console.log('Connected to Neo4j database');
        } catch (error) {
            console.error('Failed to connect to Neo4j:', error);
            throw error;
        }
    }
    
    /**
     * Close the connection
     */
    public async close(): Promise<void> {
        if (this.driver) {
            await this.driver.close();
            this.driver = null;
        }
    }
    
    /**
     * Store SATD graph (nodes and relationships)
     */
    public async storeSATDGraph(
        debtItems: TechnicalDebt[],
        relationships: SatdRelationship[]
    ): Promise<void> {
        if (!this.driver) {
            throw new Error('Not connected to Neo4j');
        }
        
        const session = this.driver.session();
        
        try {
            // Clear existing data
            await session.run('MATCH (n:SATD) DETACH DELETE n');
            
            // Create SATD nodes
            console.log(`Creating ${debtItems.length} SATD nodes...`);
            
            for (const debt of debtItems) {
                await session.run(
                    `CREATE (s:SATD {
                        id: $id,
                        file: $file,
                        line: $line,
                        content: $content,
                        description: $description,
                        debtType: $debtType,
                        sirScore: $sirScore,
                        confidence: $confidence,
                        createdCommit: $createdCommit,
                        createdDate: $createdDate,
                        effortScore: $effortScore
                    })`,
                    {
                        id: debt.id,
                        file: debt.file,
                        line: debt.line,
                        content: debt.content.substring(0, 500),
                        description: debt.description.substring(0, 1000),
                        debtType: debt.debtType || 'Unknown',
                        sirScore: debt.sirScore || 0,
                        confidence: debt.confidence || 0,
                        createdCommit: debt.createdCommit || '',
                        createdDate: debt.createdDate || '',
                        effortScore: debt.effortScore || 0
                    }
                );
            }
            
            // Create relationships
            console.log(`Creating ${relationships.length} relationships...`);
            
            for (const rel of relationships) {
                for (const edge of rel.edges) {
                    const relType = this.sanitizeRelType(edge.type);
                    
                    await session.run(
                        `MATCH (a:SATD {id: $sourceId})
                         MATCH (b:SATD {id: $targetId})
                         CREATE (a)-[:${relType} {
                             weight: $weight,
                             hops: $hops,
                             description: $description
                         }]->(b)`,
                        {
                            sourceId: rel.sourceId,
                            targetId: rel.targetId,
                            weight: edge.weight,
                            hops: edge.hops,
                            description: rel.description.substring(0, 500)
                        }
                    );
                }
            }
            
            // Create indexes
            await session.run('CREATE INDEX satd_id IF NOT EXISTS FOR (s:SATD) ON (s.id)');
            await session.run('CREATE INDEX satd_file IF NOT EXISTS FOR (s:SATD) ON (s.file)');
            await session.run('CREATE INDEX satd_sir IF NOT EXISTS FOR (s:SATD) ON (s.sirScore)');
            
            console.log('SATD graph stored successfully');
            
        } finally {
            await session.close();
        }
    }
    
    /**
     * Query SATD instances by file
     */
    public async querySATDByFile(filePath: string): Promise<Neo4jSATDNode[]> {
        if (!this.driver) {
            throw new Error('Not connected to Neo4j');
        }
        
        const session = this.driver.session();
        
        try {
            const result = await session.run(
                'MATCH (s:SATD) WHERE s.file = $file RETURN s ORDER BY s.sirScore DESC',
                { file: filePath }
            );
            
            return result.records.map((record: any) => {
                const node = record.get('s').properties;
                return {
                    id: node.id,
                    file: node.file,
                    line: node.line,
                    content: node.content,
                    description: node.description,
                    debtType: node.debtType,
                    sirScore: node.sirScore,
                    confidence: node.confidence,
                    createdCommit: node.createdCommit,
                    createdDate: node.createdDate
                };
            });
            
        } finally {
            await session.close();
        }
    }
    
    /**
     * Query top SATD instances by SIR score
     */
    public async queryTopSATD(limit: number = 10): Promise<Neo4jSATDNode[]> {
        if (!this.driver) {
            throw new Error('Not connected to Neo4j');
        }
        
        const session = this.driver.session();
        
        try {
            const result = await session.run(
                'MATCH (s:SATD) RETURN s ORDER BY s.sirScore DESC LIMIT $limit',
                { limit: limit }
            );
            
            return result.records.map((record: any) => {
                const node = record.get('s').properties;
                return {
                    id: node.id,
                    file: node.file,
                    line: node.line,
                    content: node.content,
                    description: node.description,
                    debtType: node.debtType,
                    sirScore: node.sirScore,
                    confidence: node.confidence,
                    createdCommit: node.createdCommit,
                    createdDate: node.createdDate
                };
            });
            
        } finally {
            await session.close();
        }
    }
    
    /**
     * Query SATD chain (connected component)
     */
    public async querySATDChain(nodeId: string): Promise<{
        nodes: Neo4jSATDNode[];
        relationships: Neo4jSATDRelationship[];
    }> {
        if (!this.driver) {
            throw new Error('Not connected to Neo4j');
        }
        
        const session = this.driver.session();
        
        try {
            // Find all connected nodes (undirected traversal)
            const result = await session.run(
                `MATCH (start:SATD {id: $nodeId})
                 CALL {
                     WITH start
                     MATCH (start)-[*]-(connected:SATD)
                     RETURN connected
                     UNION
                     WITH start
                     RETURN start as connected
                 }
                 WITH DISTINCT connected
                 OPTIONAL MATCH (connected)-[r]->(other:SATD)
                 RETURN connected, collect(r) as rels, collect(other) as others`,
                { nodeId }
            );
            
            const nodesMap = new Map<string, Neo4jSATDNode>();
            const relationships: Neo4jSATDRelationship[] = [];
            
            for (const record of result.records) {
                const node = record.get('connected').properties;
                nodesMap.set(node.id, {
                    id: node.id,
                    file: node.file,
                    line: node.line,
                    content: node.content,
                    description: node.description,
                    debtType: node.debtType,
                    sirScore: node.sirScore,
                    confidence: node.confidence,
                    createdCommit: node.createdCommit,
                    createdDate: node.createdDate
                });
                
                const rels = record.get('rels');
                const others = record.get('others');
                
                for (let i = 0; i < rels.length; i++) {
                    if (rels[i]) {
                        relationships.push({
                            sourceId: node.id,
                            targetId: others[i].properties.id,
                            type: rels[i].type as RelationshipType,
                            weight: rels[i].properties.weight,
                            hops: rels[i].properties.hops,
                            description: rels[i].properties.description
                        });
                    }
                }
            }
            
            return {
                nodes: Array.from(nodesMap.values()),
                relationships
            };
            
        } finally {
            await session.close();
        }
    }
    
    /**
     * Query impact path between two SATD instances
     */
    public async queryImpactPath(
        sourceId: string,
        targetId: string,
        maxHops: number = 5
    ): Promise<{
        path: Neo4jSATDNode[];
        totalWeight: number;
    }> {
        if (!this.driver) {
            throw new Error('Not connected to Neo4j');
        }
        
        const session = this.driver.session();
        
        try {
            const result = await session.run(
                `MATCH path = shortestPath((a:SATD {id: $sourceId})-[*1..${maxHops}]->(b:SATD {id: $targetId}))
                 RETURN path, reduce(total = 0, r in relationships(path) | total + r.weight) as totalWeight`,
                { sourceId, targetId }
            );
            
            if (result.records.length === 0) {
                return { path: [], totalWeight: 0 };
            }
            
            const pathRecord = result.records[0];
            const pathNodes = pathRecord.get('path').segments.map((seg: any) => ({
                id: seg.start.properties.id,
                file: seg.start.properties.file,
                line: seg.start.properties.line,
                content: seg.start.properties.content,
                description: seg.start.properties.description,
                debtType: seg.start.properties.debtType,
                sirScore: seg.start.properties.sirScore,
                confidence: seg.start.properties.confidence,
                createdCommit: seg.start.properties.createdCommit,
                createdDate: seg.start.properties.createdDate
            }));
            
            // Add final node
            const lastSeg = pathRecord.get('path').segments.slice(-1)[0];
            if (lastSeg) {
                pathNodes.push({
                    id: lastSeg.end.properties.id,
                    file: lastSeg.end.properties.file,
                    line: lastSeg.end.properties.line,
                    content: lastSeg.end.properties.content,
                    description: lastSeg.end.properties.description,
                    debtType: lastSeg.end.properties.debtType,
                    sirScore: lastSeg.end.properties.sirScore,
                    confidence: lastSeg.end.properties.confidence,
                    createdCommit: lastSeg.end.properties.createdCommit,
                    createdDate: lastSeg.end.properties.createdDate
                });
            }
            
            return {
                path: pathNodes,
                totalWeight: pathRecord.get('totalWeight')
            };
            
        } finally {
            await session.close();
        }
    }
    
    /**
     * Get graph statistics
     */
    public async getGraphStats(): Promise<{
        totalNodes: number;
        totalRelationships: number;
        avgSirScore: number;
        relationshipTypeCounts: Record<string, number>;
    }> {
        if (!this.driver) {
            throw new Error('Not connected to Neo4j');
        }
        
        const session = this.driver.session();
        
        try {
            // Get node count and avg SIR
            const nodeResult = await session.run(
                'MATCH (s:SATD) RETURN count(s) as count, avg(s.sirScore) as avgSir'
            );
            
            // Get relationship count by type
            const relResult = await session.run(
                `MATCH ()-[r]->() 
                 RETURN type(r) as relType, count(r) as count`
            );
            
            const relationshipTypeCounts: Record<string, number> = {};
            let totalRelationships = 0;
            
            for (const record of relResult.records) {
                const type = record.get('relType');
                const count = record.get('count').toNumber();
                relationshipTypeCounts[type] = count;
                totalRelationships += count;
            }
            
            return {
                totalNodes: nodeResult.records[0].get('count').toNumber(),
                totalRelationships,
                avgSirScore: nodeResult.records[0].get('avgSir') || 0,
                relationshipTypeCounts
            };
            
        } finally {
            await session.close();
        }
    }
    
    /**
     * Sanitize relationship type for Cypher query
     */
    private sanitizeRelType(type: RelationshipType): string {
        return type.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    }
}

