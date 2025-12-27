#!/usr/bin/env node
/**
 * SID Bridge - Node.js bridge to call TypeScript SID (SATD Instance Detection) functions
 * 
 * This bridge allows Python scripts to invoke the compiled TypeScript SID module
 * without reimplementing the detection logic.
 * 
 * Usage:
 *   node sid_bridge.js '{"repo_path": "/path/to/repo", "config": {...}}'
 * 
 * Output:
 *   JSON array of detected SATD instances
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
let debtScanner, models, openaiClient;

try {
    debtScanner = require(path.join(outDir, 'utils', 'debtScanner'));
    models = require(path.join(outDir, 'models'));
    openaiClient = require(path.join(outDir, 'utils', 'openaiClient'));
} catch (err) {
    console.error(JSON.stringify({
        error: 'Failed to import TypeScript modules',
        details: err.message
    }));
    process.exit(1);
}

const { lexicalFiltering, scanRepositoryCLI, llmClassification } = debtScanner;
const { DEFAULT_SATD_CONFIG } = models;
const { initializeOpenAICLI, getOpenAIClient } = openaiClient;

/**
 * Run SATD Instance Detection on a repository
 * 
 * @param {string} repoPath - Path to the repository
 * @param {Object} config - Configuration options
 * @returns {Promise<Array>} Array of detected SATD instances
 */
async function runSID(repoPath, config = {}) {
    const threshold = config.confidence_threshold || 0.7;
    const useLLM = config.use_llm || false;
    const modelName = config.model_name || 'gpt-4o';
    const apiKey = config.openai_api_key || process.env.OPENAI_API_KEY;
    
    // Validate repo path
    if (!fs.existsSync(repoPath)) {
        throw new Error(`Repository path does not exist: ${repoPath}`);
    }
    
    let satdInstances = [];
    
    if (useLLM && apiKey) {
        // Full detection with LLM classification
        console.error(`[SID] Initializing OpenAI with model: ${modelName}`);
        
        const initialized = initializeOpenAICLI(apiKey, modelName);
        if (!initialized) {
            throw new Error('Failed to initialize OpenAI client');
        }
        
        console.error('[SID] Running full SID pipeline with LLM...');
        
        satdInstances = await scanRepositoryCLI(repoPath, {
            ...DEFAULT_SATD_CONFIG,
            confidenceThreshold: threshold
        });
        
        console.error(`[SID] LLM classification complete: ${satdInstances.length} instances`);
        
    } else {
        // Lexical filtering only (quick mode)
        console.error('[SID] Running lexical filtering only (no LLM)...');
        
        const candidates = await lexicalFiltering(repoPath);
        
        console.error(`[SID] Found ${candidates.length} candidates via lexical patterns`);
        
        // Convert candidates to SATD instances format
        satdInstances = candidates.map((c, i) => ({
            id: `satd-${i}`,
            file: c.file,
            line: c.line,
            content: c.content,
            context: c.context || '',
            pattern_matched: c.patternMatched || null,
            is_explicit: isExplicitSATD(c.content),
            is_implicit: isImplicitSATD(c.content),
            commit_hash: c.commitHash || null,
            commit_date: c.commitDate || null,
            confidence: undefined,
            detection_mode: 'lexical'
        }));
    }
    
    return satdInstances;
}

/**
 * Check if comment contains explicit SATD patterns
 */
function isExplicitSATD(content) {
    const explicitPatterns = [
        /\bTODO\b/i,
        /\bFIXME\b/i,
        /\bHACK\b/i,
        /\bXXX\b/i,
        /\bBUG\b/i,
        /\bKLUDGE\b/i,
        /\bTRICKY\b/i,
        /\bWARNING\b/i,
        /\bNOTE\b/i,
        /\bTEMP\b/i,
        /\bTEMPORARY\b/i,
        /\bDEPRECATED\b/i
    ];
    
    return explicitPatterns.some(pattern => pattern.test(content));
}

/**
 * Check if comment contains implicit SATD patterns
 */
function isImplicitSATD(content) {
    const implicitPatterns = [
        /\bworkaround\b/i,
        /\bquick.?fix\b/i,
        /\bdirty\b/i,
        /\bugly\b/i,
        /\bshould.?be\b/i,
        /\bneed.?to\b/i,
        /\bneeds?.?refactor\b/i,
        /\bcleanup\b/i,
        /\bclean.?up\b/i,
        /\boptimize\b/i,
        /\bimprove\b/i,
        /\bbetter.?way\b/i,
        /\bfor.?now\b/i,
        /\btemporarily\b/i,
        /\bnot.?ideal\b/i,
        /\bsuboptimal\b/i,
        /\bshould.?fix\b/i,
        /\bmust.?fix\b/i,
        /\bbroken\b/i,
        /\bincomplete\b/i,
        /\bmissing\b/i,
        /\bplaceholder\b/i,
        /\bstub\b/i,
        /\bdummy\b/i,
        /\bmagic.?number\b/i,
        /\bhardcode[d]?\b/i,
        /\bhard.?code[d]?\b/i
    ];
    
    return implicitPatterns.some(pattern => pattern.test(content));
}

/**
 * Run lexical filtering only and return candidates
 */
async function runLexicalOnly(repoPath) {
    console.error('[SID] Running lexical filtering...');
    
    const candidates = await lexicalFiltering(repoPath);
    
    return candidates.map((c, i) => ({
        id: `candidate-${i}`,
        file: c.file,
        line: c.line,
        content: c.content,
        context: c.context || '',
        is_explicit: isExplicitSATD(c.content),
        is_implicit: isImplicitSATD(c.content),
        detection_mode: 'lexical'
    }));
}

// Main execution
async function main() {
    try {
        // Parse command line arguments
        if (process.argv.length < 3) {
            console.error(JSON.stringify({
                error: 'Missing arguments',
                usage: 'node sid_bridge.js \'{"repo_path": "/path", "config": {...}}\''
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
        
        const repoPath = path.resolve(args.repo_path);
        const config = args.config || {};
        
        console.error(`[SID] Processing repository: ${repoPath}`);
        console.error(`[SID] Config: ${JSON.stringify(config)}`);
        
        let results;
        
        if (args.lexical_only) {
            results = await runLexicalOnly(repoPath);
        } else {
            results = await runSID(repoPath, config);
        }
        
        // Output results as JSON to stdout
        console.log(JSON.stringify({
            success: true,
            count: results.length,
            results: results
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

