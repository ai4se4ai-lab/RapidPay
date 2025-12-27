#!/usr/bin/env node
/**
 * IRD Bridge - Node.js bridge to call TypeScript IRD (Inter-SATD Relationship Discovery) functions
 * 
 * This bridge allows Python scripts to invoke the compiled TypeScript IRD module
 * for discovering relationships between SATD instances.
 * 
 * Usage:
 *   node ird_bridge.js '{"repo_path": "/path/to/repo", "satd_instances": [...], "max_hops": 5}'
 * 
 * Output:
 *   JSON object with relationships, chains, and edges
 */

const path = require('path');
const fs = require('fs');

// Resolve paths relative to project root
const projectRoot = path.resolve(__dirname, '..', '..', '..');
const outDir = path.join(projectRoot, 'out');

// Check if compiled TypeScript exists
if (!fs.existsSync(outDir)) {
    console.error(JSON.stringify({
        error: 'TypeScript not compiled. Run "npm run compile" first.',
        details: `Expected output directory: ${outDir}`
    }));
    process.exit(1);
}

// Import compiled TypeScript modules
let satdRelationshipAnalyzer, satdChainAnalyzer;

try {
    satdRelationshipAnalyzer = require(path.join(outDir, 'satdRelationshipAnalyzer'));
    satdChainAnalyzer = require(path.join(outDir, 'satdChainAnalyzer'));
} catch (err) {
    console.error(JSON.stringify({
        error: 'Failed to import TypeScript modules',
        details: err.message
    }));
    process.exit(1);
}

const { SatdRelationshipAnalyzer } = satdRelationshipAnalyzer;
const { SatdChainAnalyzer } = satdChainAnalyzer;

/**
 * Run Inter-SATD Relationship Discovery
 * 
 * @param {string} repoPath - Path to the repository
 * @param {Array} satdInstances - Array of detected SATD instances
 * @param {number} maxHops - Maximum dependency hops
 * @returns {Promise<Object>} Object with relationships, chains, and edges
 */
async function runIRD(repoPath, satdInstances, maxHops = 5) {
    // Validate inputs
    if (!fs.existsSync(repoPath)) {
        throw new Error(`Repository path does not exist: ${repoPath}`);
    }
    
    if (!Array.isArray(satdInstances) || satdInstances.length === 0) {
        console.error('[IRD] No SATD instances provided');
        return {
            relationships: [],
            chains: [],
            edges: [],
            stats: {
                total_satd: 0,
                total_relationships: 0,
                total_chains: 0,
                total_edges: 0
            }
        };
    }
    
    console.error(`[IRD] Processing ${satdInstances.length} SATD instances`);
    console.error(`[IRD] Max hops: ${maxHops}`);
    console.error(`[IRD] Repository: ${repoPath}`);
    
    // Initialize the relationship analyzer
    const analyzer = new SatdRelationshipAnalyzer();
    await analyzer.initialize(repoPath);
    analyzer.setMaxHops(maxHops);
    
    console.error('[IRD] Analyzer initialized, discovering relationships...');
    
    // Analyze relationships between SATD instances
    const relationships = await analyzer.analyzeRelationships(satdInstances);
    
    console.error(`[IRD] Found ${relationships.length} relationships`);
    
    // Build the SATD graph
    const graph = analyzer.buildSATDGraph(satdInstances, relationships);
    
    console.error(`[IRD] Built graph with ${graph.chains.length} chains and ${graph.edges.length} edges`);
    
    // Enhance relationships with chain info
    const enhancedRelationships = analyzer.enhanceRelationshipsWithChainInfo(
        relationships,
        graph.chains
    );
    
    // Calculate relationship type distribution
    const typeDistribution = calculateTypeDistribution(enhancedRelationships);
    
    // Format results for output
    const formattedRelationships = enhancedRelationships.map(rel => ({
        id: rel.id || `rel-${Math.random().toString(36).substr(2, 9)}`,
        source_id: rel.sourceId,
        target_id: rel.targetId,
        types: rel.types || [],
        strength: rel.strength || 0,
        hops: rel.hops || 1,
        description: rel.description || '',
        in_chain: rel.inChain || false,
        chain_ids: rel.chainIds || [],
        edges: (rel.edges || []).map(e => ({
            source_id: e.sourceId,
            target_id: e.targetId,
            type: e.type,
            weight: e.weight,
            hops: e.hops
        }))
    }));
    
    const formattedChains = graph.chains.map(chain => ({
        id: chain.id,
        nodes: chain.nodes,
        length: chain.length,
        root_node: chain.rootNode || chain.nodes[0],
        max_sir_score: chain.maxSirScore || 0,
        total_weight: chain.totalWeight || 0
    }));
    
    const formattedEdges = graph.edges.map(edge => ({
        source_id: edge.sourceId,
        target_id: edge.targetId,
        type: edge.type,
        weight: edge.weight,
        hops: edge.hops
    }));
    
    return {
        relationships: formattedRelationships,
        chains: formattedChains,
        edges: formattedEdges,
        stats: {
            total_satd: satdInstances.length,
            total_relationships: formattedRelationships.length,
            total_chains: formattedChains.length,
            total_edges: formattedEdges.length,
            type_distribution: typeDistribution,
            average_chain_length: calculateAverageChainLength(formattedChains)
        }
    };
}

/**
 * Calculate SIR scores for SATD instances
 */
async function calculateSIRScores(satdInstances, relationships, weights = null) {
    const chainAnalyzer = new SatdChainAnalyzer();
    
    if (weights) {
        chainAnalyzer.setSirWeights(weights.alpha, weights.beta, weights.gamma);
    }
    
    console.error('[IRD] Calculating SIR scores...');
    
    const scoredSATD = chainAnalyzer.calculateSIRScores(satdInstances, relationships);
    const rankedSATD = chainAnalyzer.rankBySIR(scoredSATD);
    
    return rankedSATD.map((satd, index) => ({
        id: satd.id,
        file: satd.file,
        line: satd.line,
        sir_score: satd.sirScore || 0,
        rank: index + 1,
        sir_components: satd.sirComponents || {}
    }));
}

/**
 * Calculate relationship type distribution
 */
function calculateTypeDistribution(relationships) {
    const distribution = {
        call: 0,
        data: 0,
        control: 0,
        module: 0
    };
    
    for (const rel of relationships) {
        const types = rel.types || [];
        for (const type of types) {
            const normalizedType = type.toLowerCase();
            if (normalizedType in distribution) {
                distribution[normalizedType]++;
            }
        }
    }
    
    // Also count from edges if available
    for (const rel of relationships) {
        const edges = rel.edges || [];
        for (const edge of edges) {
            const type = (edge.type || '').toLowerCase();
            if (type in distribution) {
                distribution[type]++;
            }
        }
    }
    
    return distribution;
}

/**
 * Calculate average chain length
 */
function calculateAverageChainLength(chains) {
    if (chains.length === 0) return 0;
    const totalLength = chains.reduce((sum, chain) => sum + (chain.length || chain.nodes.length), 0);
    return Math.round((totalLength / chains.length) * 100) / 100;
}

// Main execution
async function main() {
    try {
        // Parse command line arguments
        if (process.argv.length < 3) {
            console.error(JSON.stringify({
                error: 'Missing arguments',
                usage: 'node ird_bridge.js \'{"repo_path": "/path", "satd_instances": [...], "max_hops": 5}\''
            }));
            process.exit(1);
        }
        
        // Handle file-based arguments for large payloads
        let argsStr = process.argv[2];
        if (argsStr.startsWith('@file:')) {
            const filePath = argsStr.substring(6);
            argsStr = fs.readFileSync(filePath, 'utf-8');
        }
        const args = JSON.parse(argsStr);
        
        if (!args.repo_path) {
            throw new Error('repo_path is required');
        }
        
        if (!args.satd_instances) {
            throw new Error('satd_instances is required');
        }
        
        const repoPath = path.resolve(args.repo_path);
        const satdInstances = args.satd_instances;
        const maxHops = args.max_hops || 5;
        
        console.error(`[IRD] Processing repository: ${repoPath}`);
        console.error(`[IRD] SATD instances: ${satdInstances.length}`);
        
        // Run IRD
        const irdResults = await runIRD(repoPath, satdInstances, maxHops);
        
        // Optionally calculate SIR scores
        if (args.calculate_sir) {
            const sirResults = await calculateSIRScores(
                satdInstances,
                irdResults.relationships,
                args.sir_weights
            );
            irdResults.sir_ranking = sirResults;
        }
        
        // Output results as JSON to stdout
        console.log(JSON.stringify({
            success: true,
            ...irdResults
        }));
        
    } catch (err) {
        console.error(JSON.stringify({
            success: false,
            error: err.message,
            stack: err.stack
        }));
        process.exit(1);
    }
}

main();

