// src/utils/debtScanner.ts
// Conditional import for vscode (only available in VS Code extension context)
let vscode: typeof import('vscode') | undefined;
try {
  vscode = require('vscode');
} catch {
  // vscode module not available (CLI mode)
  vscode = undefined;
}

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { TechnicalDebt, DEFAULT_SATD_CONFIG, SatdConfig, DebtType } from '../models';
import { getWorkspaceRoot } from './gitUtils';
import { classifySATD, analyzeTechnicalDebtComment, batchClassifySATD } from './openaiClient';
import { SatdDetector } from '../satdDetector';

const execPromise = promisify(exec);

/**
 * Lexical patterns for Stage 1 filtering (P from Algorithm 1)
 * Expanded based on pilot study with 1,000 comments from Apache Commons, React, SciPy
 * Intentionally favors recall (>96%) over precision
 */
export const LEXICAL_PATTERNS = [
  // Explicit SATD markers
  'TODO', 'FIXME', 'HACK', 'XXX', 'BUG', 'ISSUE', 'DEBT',
  'NOTE', 'WARNING', 'OPTIMIZE', 'REVIEW', 'REVISIT', 'REFACTOR',
  
  // Implicit SATD patterns (from pilot analysis)
  'workaround', 'temporary', 'hacky', 'should be improved',
  'quick fix', 'quick and dirty', 'not ideal', 'not optimal',
  'needs refactoring', 'needs work', 'needs cleanup',
  'could be better', 'could be improved', 'to be improved',
  'fix later', 'refactor later', 'clean up later',
  'technical debt', 'tech debt', 'code smell',
  'ugly', 'messy', 'dirty', 'poor', 'bad design',
  'magic number', 'hardcoded', 'hard-coded', 'hard coded',
  'deprecated', 'legacy', 'obsolete',
  'performance issue', 'slow', 'inefficient',
  'memory leak', 'resource leak',
  'race condition', 'deadlock', 'concurrency issue',
  'security issue', 'vulnerability', 'insecure',
  'not tested', 'untested', 'needs test', 'missing test',
  'incomplete', 'unfinished', 'work in progress', 'wip',
  'placeholder', 'stub', 'dummy',
  'copy-paste', 'duplicate', 'duplicated',
  'brittle', 'fragile', 'flaky',
  'assumption', 'assumes', 'expecting',
  'simplistic', 'naive', 'brute force',
  'overkill', 'over-engineered', 'complex',
  
  // Language-specific implicit patterns
  'type: ignore', 'noqa', 'pylint: disable', 'eslint-disable',
  'suppress', '@SuppressWarnings', 'noinspection',
  'NOSONAR', 'checkstyle:off', 'sonar:off'
];

/**
 * Build regex pattern for lexical filtering
 */
function buildLexicalPattern(): RegExp {
  const escapedPatterns = LEXICAL_PATTERNS.map(p => 
    p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  return new RegExp(`\\b(${escapedPatterns.join('|')})\\b`, 'i');
}

const LEXICAL_REGEX = buildLexicalPattern();

/**
 * Supported source file extensions for scanning
 */
const SUPPORTED_EXTENSIONS = ['.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rb', '.php'];

/**
 * Recursively get all source files in a directory
 */
async function getAllSourceFiles(dirPath: string, files: string[] = []): Promise<string[]> {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      // Skip hidden directories and common non-source directories
      if (entry.name.startsWith('.') || 
          entry.name === 'node_modules' || 
          entry.name === '__pycache__' ||
          entry.name === 'venv' ||
          entry.name === 'dist' ||
          entry.name === 'build' ||
          entry.name === 'out') {
        continue;
      }
      
      if (entry.isDirectory()) {
        await getAllSourceFiles(fullPath, files);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch (error) {
    console.warn(`Could not read directory ${dirPath}: ${error}`);
  }
  
  return files;
}

/**
 * Fallback filesystem-based lexical filtering (when git grep is unavailable)
 * This searches all source files directly without requiring Git
 */
async function filesystemLexicalFiltering(workspaceRoot: string): Promise<CandidateComment[]> {
  const candidates: CandidateComment[] = [];
  
  console.log('Using filesystem search (Git not available or no matches found)');
  console.log(`Scanning directory: ${workspaceRoot}`);
  
  try {
    // Get all source files
    const sourceFiles = await getAllSourceFiles(workspaceRoot);
    console.log(`Found ${sourceFiles.length} source files to scan`);
    
    for (const filePath of sourceFiles) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const relativePath = path.relative(workspaceRoot, filePath);
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lineNumber = i + 1;
          
          // Check if line contains any SATD pattern
          const patternMatch = line.match(LEXICAL_REGEX);
          const hasComment = isCommentLine(line, filePath);
          
          if (patternMatch && hasComment) {
            const matchedPattern = patternMatch[0];
            
            // Get surrounding context
            const startLine = Math.max(0, i - 5);
            const endLine = Math.min(lines.length, i + 6);
            const context = lines.slice(startLine, endLine).join('\n');
            
            // Try to get commit info, but don't fail if unavailable
            let commitHash = 'untracked';
            let commitDate = new Date().toISOString();
            
            try {
              const { stdout: blame } = await execPromise(
                `git blame -L ${lineNumber},${lineNumber} --porcelain "${relativePath}"`,
                { cwd: workspaceRoot }
              );
              commitHash = blame.split('\n')[0].split(' ')[0];
              
              const { stdout: date } = await execPromise(
                `git show -s --format=%ci ${commitHash}`,
                { cwd: workspaceRoot }
              );
              commitDate = date.trim();
            } catch {
              // File not tracked by git, use defaults
            }
            
            candidates.push({
              file: relativePath,
              line: lineNumber,
              content: line.trim(),
              context,
              commitHash,
              commitDate,
              matchedPattern
            });
          }
        }
      } catch (error) {
        console.warn(`Could not read file ${filePath}: ${error}`);
      }
    }
  } catch (error) {
    console.error(`Filesystem filtering error: ${error}`);
  }
  
  console.log(`Filesystem search found ${candidates.length} candidate comments`);
  return candidates;
}

/**
 * Candidate comment from Stage 1 lexical filtering
 */
interface CandidateComment {
  file: string;
  line: number;
  content: string;
  context: string;
  commitHash: string;
  commitDate: string;
  matchedPattern: string;
}

/**
 * Stage 1: Lexical Filtering
 * Applies pattern set P to get filtered candidate subset C'
 * C' = { c_i ∈ C | ∃ p_j ∈ P : p_j matches c_i }
 * 
 * @param workspaceRoot Repository root path
 * @returns Filtered candidate comments
 */
export async function lexicalFiltering(workspaceRoot: string): Promise<CandidateComment[]> {
  const candidates: CandidateComment[] = [];
  
  try {
    // Build grep pattern from lexical patterns (only single-word patterns for git grep reliability)
    const singleWordPatterns = LEXICAL_PATTERNS.filter(p => !p.includes(' ')).slice(0, 15);
    const grepPattern = singleWordPatterns.join('|');
    
    console.log(`Lexical filtering: Searching for patterns in ${workspaceRoot}`);
    console.log(`Patterns: ${grepPattern}`);
    
    // Get all files with potential SATD comments using git grep
    let stdout = '';
    let useFilesystemFallback = false;
    
    try {
      const result = await execPromise(
        `git grep -n -E "\\b(${grepPattern})\\b" -- "*.py" "*.js" "*.ts" "*.tsx" "*.jsx" "*.java" "*.c" "*.cpp" "*.h" "*.hpp" "*.cs" "*.go" "*.rb" "*.php"`,
        { cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 }
      );
      stdout = result.stdout;
      const matchCount = stdout.split('\n').filter(l => l.trim()).length;
      console.log(`Git grep found ${matchCount} potential matches`);
      
      // If git grep succeeds but finds nothing, try filesystem fallback
      if (matchCount === 0) {
        console.log('Git grep found 0 matches - trying filesystem fallback...');
        useFilesystemFallback = true;
      }
    } catch (error: any) {
      // git grep returns exit code 1 when no matches found (not an error)
      // exit code 2+ indicates actual errors
      if (error.code === 1) {
        console.log('Git grep returned exit code 1 (no matches) - trying filesystem fallback...');
        useFilesystemFallback = true;
      } else {
        console.warn(`Git grep failed (code ${error.code}): ${error.message}`);
        console.log('Falling back to filesystem search...');
        useFilesystemFallback = true;
      }
    }
    
    // Fallback: If git grep failed or found nothing, use filesystem search
    if (useFilesystemFallback) {
      const fallbackCandidates = await filesystemLexicalFiltering(workspaceRoot);
      if (fallbackCandidates.length > 0) {
        return fallbackCandidates;
      }
      // If filesystem also found nothing, continue with git grep results (empty)
      console.log('Filesystem fallback also found no candidates');
    }
    
    const lines = stdout.split('\n').filter(line => line.trim() !== '');
    
    for (const line of lines) {
      const match = line.match(/^([^:]+):(\d+):(.*)$/);
      if (!match) continue;
      
      const [, file, lineNumber, content] = match;
      const lineNum = parseInt(lineNumber, 10);
      
      if (!file || !lineNum || !content) continue;
      
      // Check if line contains a comment (basic heuristic)
      if (!isCommentLine(content, file)) continue;
      
      // Find which pattern matched
      const patternMatch = content.match(LEXICAL_REGEX);
      const matchedPattern = patternMatch ? patternMatch[0] : 'unknown';
      
      // Get surrounding context for Stage 2
      const context = await getSurroundingContext(workspaceRoot, file, lineNum, 5);
      
      // Get commit information
      let commitHash = 'untracked';
      let commitDate = new Date().toISOString();
      
      try {
        const { stdout: blame } = await execPromise(
          `git blame -L ${lineNum},${lineNum} --porcelain "${file}"`,
          { cwd: workspaceRoot }
        );
        
        commitHash = blame.split('\n')[0].split(' ')[0];
        const { stdout: date } = await execPromise(
          `git show -s --format=%ci ${commitHash}`,
          { cwd: workspaceRoot }
        );
        commitDate = date.trim();
      } catch (error) {
        // File not tracked by git, use defaults but still include the candidate
        console.warn(`Could not get blame info for ${file}:${lineNum} - using defaults`);
      }
      
      candidates.push({
        file,
        line: lineNum,
        content: content.trim(),
        context,
        commitHash,
        commitDate,
        matchedPattern
      });
    }
  } catch (error) {
    console.error(`Lexical filtering error: ${error}`);
  }
  
  return candidates;
}

/**
 * Check if a line contains a comment based on file extension
 * Now properly handles inline comments (e.g., code # FIXME: comment)
 */
function isCommentLine(content: string, filePath: string): boolean {
  const trimmed = content.trim();
  const ext = path.extname(filePath).toLowerCase();
  
  // Python comments - check for # anywhere in the line (inline comments)
  if (ext === '.py') {
    return trimmed.includes('#') || trimmed.startsWith('"""') || trimmed.startsWith("'''");
  }
  
  // C-style comments (JS, TS, Java, C, C++, Go, etc.) - check for // or /* anywhere
  if (['.js', '.jsx', '.ts', '.tsx', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go'].includes(ext)) {
    return trimmed.includes('//') || trimmed.includes('/*') || trimmed.startsWith('*');
  }
  
  // Ruby comments - check for # anywhere
  if (ext === '.rb') {
    return trimmed.includes('#');
  }
  
  // PHP comments - check for comment markers anywhere
  if (ext === '.php') {
    return trimmed.includes('//') || trimmed.includes('#') || trimmed.includes('/*') || trimmed.startsWith('*');
  }
  
  // Default: accept any line that contains common comment markers
  return trimmed.includes('//') || trimmed.includes('#') || trimmed.includes('/*');
}

/**
 * Get surrounding code context for a line
 */
async function getSurroundingContext(
  workspaceRoot: string,
  filePath: string,
  lineNumber: number,
  contextLines: number
): Promise<string> {
  try {
    const fullPath = path.join(workspaceRoot, filePath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    
    const startLine = Math.max(0, lineNumber - contextLines - 1);
    const endLine = Math.min(lines.length, lineNumber + contextLines);
    
    return lines.slice(startLine, endLine).join('\n');
  } catch (error) {
    return '';
  }
}

/**
 * Stage 2: LLM Classification with confidence threshold
 * Uses Prompt 1 to classify each candidate c_i ∈ C'
 * C* = { c_i ∈ C' | s_i ≥ τ }
 * 
 * @param candidates Filtered candidates from Stage 1
 * @param threshold Confidence threshold τ (default: 0.7)
 * @returns Confirmed SATD instances
 */
export async function llmClassification(
  candidates: CandidateComment[],
  threshold: number = 0.7
): Promise<TechnicalDebt[]> {
  const satdInstances: TechnicalDebt[] = [];
  const satdDetector = new SatdDetector();
  
  // Process candidates in batches for efficiency
  const batchSize = 10;
  
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    
    const classificationPromises = batch.map(async (candidate) => {
      try {
        // Use LLM classification (Prompt 1)
        const result = await classifySATD(candidate.content, candidate.context);
        
        // Apply confidence threshold τ
        if (result.isSATD && result.confidence >= threshold) {
          // Classify debt type
          const debtType = satdDetector.classifyDebtType(candidate.content, candidate.context);
          
          // Create unique ID
          const id = `${candidate.file}-${candidate.line}-${candidate.commitHash.substring(0, 7)}`;
          
          return {
            id,
            file: candidate.file,
            line: candidate.line,
            content: candidate.content,
            extendedContent: candidate.context,
            description: candidate.content,
            createdCommit: candidate.commitHash,
            createdDate: candidate.commitDate,
            debtType,
            isActualDebt: true,
            confidence: result.confidence
          } as TechnicalDebt;
        }
        
        return null;
      } catch (error) {
        console.error(`LLM classification failed for ${candidate.file}:${candidate.line}: ${error}`);
        return null;
      }
    });
    
    const results = await Promise.all(classificationPromises);
    satdInstances.push(...results.filter((r): r is TechnicalDebt => r !== null));
    
    // Progress update
    if ((i + batchSize) % 50 === 0) {
      console.log(`Processed ${Math.min(i + batchSize, candidates.length)}/${candidates.length} candidates`);
    }
  }
  
  return satdInstances;
}

/**
 * Algorithm 1: SATD Instance Detection (SID)
 * Two-stage hybrid detection: lexical filtering + LLM classification
 * 
 * @param config SATD detection configuration
 * @returns Detected SATD instances C*
 */
export async function detectSATDInstances(
  config: Partial<SatdConfig> = {}
): Promise<TechnicalDebt[]> {
  const fullConfig = { ...DEFAULT_SATD_CONFIG, ...config };
  const workspaceRoot = getWorkspaceRoot();
  
  if (!workspaceRoot) {
    if (typeof vscode !== 'undefined' && vscode.window) {
      vscode.window.showInformationMessage('No workspace folder open');
    }
    return [];
  }
  
  console.log('Starting SATD Instance Detection (SID)...');
  console.log(`Configuration: threshold=${fullConfig.confidenceThreshold}, includeImplicit=${fullConfig.includeImplicit}`);
  
  // Stage 1: Lexical Filtering
  console.log('Stage 1: Lexical filtering...');
  const candidates = await lexicalFiltering(workspaceRoot);
  console.log(`Found ${candidates.length} candidate comments after lexical filtering`);
  
  if (candidates.length === 0) {
    return [];
  }
  
  // Stage 2: LLM Classification
  console.log('Stage 2: LLM classification...');
  const satdInstances = await llmClassification(candidates, fullConfig.confidenceThreshold);
  console.log(`Confirmed ${satdInstances.length} SATD instances after LLM classification`);
  
  return satdInstances;
}

/**
 * Quick scan using only lexical filtering (no LLM, faster but less accurate)
 * Useful for large codebases or when API is unavailable
 * 
 * @returns Potential SATD instances based on lexical patterns only
 */
export async function quickScanRepository(): Promise<TechnicalDebt[]> {
  const workspaceRoot = getWorkspaceRoot();
  
  if (!workspaceRoot) {
    return [];
  }
  
  const candidates = await lexicalFiltering(workspaceRoot);
  const satdDetector = new SatdDetector();
  
  return candidates.map(candidate => {
    const id = `${candidate.file}-${candidate.line}-${candidate.commitHash.substring(0, 7)}`;
    const debtType = satdDetector.classifyDebtType(candidate.content, candidate.context);
    
    return {
      id,
      file: candidate.file,
      line: candidate.line,
      content: candidate.content,
      extendedContent: candidate.context,
      description: candidate.content,
      createdCommit: candidate.commitHash,
      createdDate: candidate.commitDate,
      debtType,
      isActualDebt: undefined, // Not confirmed by LLM
      confidence: undefined // No confidence score
    } as TechnicalDebt;
  });
}

/**
 * Scan repository for technical debt comments (legacy function for compatibility)
 * Now uses the two-stage SID algorithm
 * 
 * @returns Array of technical debt items
 */
export async function scanRepositoryForTechnicalDebt(): Promise<TechnicalDebt[]> {
  try {
    const workspaceRoot = getWorkspaceRoot();
    
    if (!workspaceRoot) {
      console.error('scanRepositoryForTechnicalDebt: No workspace root found');
      if (typeof vscode !== 'undefined' && vscode.window) {
        vscode.window.showInformationMessage('No workspace folder open');
      }
      return [];
    }
    
    console.log(`scanRepositoryForTechnicalDebt: Scanning ${workspaceRoot}`);
    
    // Use quick scan for initial detection, then classify with LLM
    const candidates = await lexicalFiltering(workspaceRoot);
    
    console.log(`scanRepositoryForTechnicalDebt: Found ${candidates.length} candidates`);
    
    if (candidates.length === 0) {
      console.warn('scanRepositoryForTechnicalDebt: No candidates found. Possible causes:');
      console.warn('  - Files may not be tracked by Git (run: git add .)');
      console.warn('  - No SATD patterns (TODO, FIXME, HACK, etc.) found in comments');
      console.warn('  - Files may not have supported extensions (.py, .js, .ts, etc.)');
    }
    
    // Return candidates without LLM classification for faster initial scan
    // LLM classification can be done later via enhanceTechnicalDebtWithAI
    const satdDetector = new SatdDetector();
    
    return candidates.map(candidate => {
      const id = `${candidate.file}-${candidate.line}-${candidate.commitHash.substring(0, 7)}`;
      const debtType = satdDetector.classifyDebtType(candidate.content, candidate.context);
      
      return {
        id,
        file: candidate.file,
        line: candidate.line,
        content: candidate.content,
        extendedContent: candidate.context,
        description: candidate.content,
        createdCommit: candidate.commitHash,
        createdDate: candidate.commitDate,
        debtType,
        isActualDebt: undefined
      } as TechnicalDebt;
    });
  } catch (error) {
    console.error(`scanRepositoryForTechnicalDebt: Error - ${error}`);
    if (typeof vscode !== 'undefined' && vscode.window) {
      vscode.window.showErrorMessage(`Failed to scan repository: ${error}`);
    }
    return [];
  }
}

/**
 * Enhance technical debt items with AI-generated descriptions and classification
 * Performs Stage 2 LLM classification on pre-filtered items
 * 
 * @param debtItems Array of technical debt items from quick scan
 * @param threshold Confidence threshold (default: 0.7)
 * @returns Enhanced and classified technical debt items
 */
export async function enhanceTechnicalDebtWithAI(
  debtItems: TechnicalDebt[],
  threshold: number = 0.7
): Promise<TechnicalDebt[]> {
  const enhancedDebtItems: TechnicalDebt[] = [];
  
  for (const item of debtItems) {
    try {
      // Perform LLM classification (Stage 2 of SID)
      const classificationResult = await classifySATD(
        item.content,
        item.extendedContent || ''
      );
      
      // Apply confidence threshold
      if (classificationResult.confidence >= threshold) {
        // Get enhanced description
        const description = await analyzeTechnicalDebtComment(item.content);
        
        enhancedDebtItems.push({
          ...item,
          description,
          isActualDebt: classificationResult.isSATD,
          confidence: classificationResult.confidence
        });
      } else if (classificationResult.isSATD) {
        // Below threshold but still classified as SATD - include with flag
        enhancedDebtItems.push({
          ...item,
          isActualDebt: false, // Below confidence threshold
          confidence: classificationResult.confidence
        });
      }
    } catch (error) {
      console.error(`Failed to enhance technical debt item: ${error}`);
      enhancedDebtItems.push(item);
    }
  }
  
  return enhancedDebtItems;
}

/**
 * Get surrounding context for a technical debt item (legacy function)
 */
export async function getTechnicalDebtContext(
  filePath: string, 
  lineNumber: number, 
  contextLines: number = 2
): Promise<string> {
  const workspaceRoot = getWorkspaceRoot();
  
  if (!workspaceRoot) {
    return '';
  }
  
  return getSurroundingContext(workspaceRoot, filePath, lineNumber, contextLines);
}

/**
 * CLI-compatible scan function (no VS Code dependencies)
 */
export async function scanRepositoryCLI(
  repoPath: string,
  config: Partial<SatdConfig> = {}
): Promise<TechnicalDebt[]> {
  const fullConfig = { ...DEFAULT_SATD_CONFIG, ...config };
  
  console.log('Starting SATD Instance Detection (SID)...');
  console.log(`Repository: ${repoPath}`);
  console.log(`Configuration: threshold=${fullConfig.confidenceThreshold}`);
  
  // Stage 1: Lexical Filtering
  console.log('Stage 1: Lexical filtering...');
  const candidates = await lexicalFilteringCLI(repoPath);
  console.log(`Found ${candidates.length} candidate comments`);
  
  if (candidates.length === 0) {
    return [];
  }
  
  // Stage 2: LLM Classification
  console.log('Stage 2: LLM classification...');
  const satdInstances = await llmClassification(candidates, fullConfig.confidenceThreshold);
  console.log(`Confirmed ${satdInstances.length} SATD instances`);
  
  return satdInstances;
}

/**
 * CLI-compatible lexical filtering (no VS Code dependencies)
 */
async function lexicalFilteringCLI(repoPath: string): Promise<CandidateComment[]> {
  const candidates: CandidateComment[] = [];
  
  try {
    // Build grep pattern from lexical patterns (only single-word patterns for git grep reliability)
    const singleWordPatterns = LEXICAL_PATTERNS.filter(p => !p.includes(' ')).slice(0, 15);
    const grepPattern = singleWordPatterns.join('|');
    
    console.log(`Lexical filtering: Searching for patterns in ${repoPath}`);
    console.log(`Patterns: ${grepPattern}`);
    
    let stdout = '';
    let useFilesystemFallback = false;
    
    try {
      const result = await execPromise(
        `git grep -n -E "\\b(${grepPattern})\\b" -- "*.py" "*.js" "*.ts" "*.tsx" "*.jsx" "*.java" "*.c" "*.cpp" "*.h" "*.hpp" "*.cs" "*.go" "*.rb" "*.php"`,
        { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }
      );
      stdout = result.stdout;
      const matchCount = stdout.split('\n').filter(l => l.trim()).length;
      console.log(`Git grep found ${matchCount} potential matches`);
      
      // If git grep succeeds but finds nothing, try filesystem fallback
      if (matchCount === 0) {
        console.log('Git grep found 0 matches - trying filesystem fallback...');
        useFilesystemFallback = true;
      }
    } catch (error: any) {
      // git grep returns exit code 1 when no matches found (not an error)
      // exit code 2+ indicates actual errors
      if (error.code === 1) {
        console.log('Git grep returned exit code 1 (no matches) - trying filesystem fallback...');
        useFilesystemFallback = true;
      } else {
        console.warn(`Git grep failed (code ${error.code}): ${error.message}`);
        console.log('Falling back to filesystem search...');
        useFilesystemFallback = true;
      }
    }
    
    // Fallback: If git grep failed or found nothing, use filesystem search
    if (useFilesystemFallback) {
      const fallbackCandidates = await filesystemLexicalFiltering(repoPath);
      if (fallbackCandidates.length > 0) {
        return fallbackCandidates;
      }
      console.log('Filesystem fallback also found no candidates');
    }
    
    const lines = stdout.split('\n').filter(line => line.trim() !== '');
    console.log(`Processing ${lines.length} lines from git grep...`);
    
    for (const line of lines) {
      // Debug: Show raw line (first 100 chars)
      const rawLine = line.trim();
      console.log(`  Raw line (first 100 chars): "${rawLine.substring(0, 100)}"`);
      
      // More flexible regex to handle git grep output format: filepath:line:content
      // Pattern: filepath:line:content (filepath can contain colons on Windows)
      // Try multiple patterns to handle different formats
      let match = rawLine.match(/^([^:]+?):(\d+):(.*)$/);
      
      // If that doesn't work, try with non-greedy match for file path
      if (!match) {
        match = rawLine.match(/^(.+?):(\d+):(.*)$/);
      }
      
      // If still no match, try with spaces after colons
      if (!match) {
        match = rawLine.match(/^(.+?):\s*(\d+):\s*(.*)$/);
      }
      
      if (!match) {
        console.log(`  ❌ No regex match for line. Length: ${rawLine.length}, First 50 chars: "${rawLine.substring(0, 50)}"`);
        // Try to manually parse as last resort
        const colonIndex = rawLine.indexOf(':');
        if (colonIndex > 0) {
          const afterFirstColon = rawLine.substring(colonIndex + 1);
          const secondColonIndex = afterFirstColon.indexOf(':');
          if (secondColonIndex > 0) {
            const file = rawLine.substring(0, colonIndex);
            const lineNumStr = afterFirstColon.substring(0, secondColonIndex).trim();
            const content = afterFirstColon.substring(secondColonIndex + 1);
            const lineNum = parseInt(lineNumStr, 10);
            
            if (file && !isNaN(lineNum) && content) {
              console.log(`  ✓ Manual parse successful: file="${file}", line=${lineNum}`);
              // Use manual parse result
              const isComment = isCommentLine(content, file);
              if (!isComment) {
                console.log(`  Skipping line ${lineNum} in ${file} (not a comment): ${content.substring(0, 60)}...`);
                continue;
              }
              
              const patternMatch = content.match(LEXICAL_REGEX);
              const matchedPattern = patternMatch ? patternMatch[0] : 'unknown';
              const context = await getSurroundingContext(repoPath, file, lineNum, 5);
              
              console.log(`  ✓ Found candidate: ${file}:${lineNum} - ${matchedPattern}`);
              
              let commitHash = 'untracked';
              let commitDate = new Date().toISOString();
              
              try {
                const { stdout: blame } = await execPromise(
                  `git blame -L ${lineNum},${lineNum} --porcelain "${file}"`,
                  { cwd: repoPath }
                );
                
                commitHash = blame.split('\n')[0].split(' ')[0];
                const { stdout: date } = await execPromise(
                  `git show -s --format=%ci ${commitHash}`,
                  { cwd: repoPath }
                );
                commitDate = date.trim();
              } catch (error) {
                // File not tracked by git, use defaults
              }
              
              candidates.push({
                file,
                line: lineNum,
                content: content.trim(),
                context,
                commitHash,
                commitDate,
                matchedPattern
              });
              continue;
            }
          }
        }
        continue;
      }
      
      const [, file, lineNumber, content] = match;
      const lineNum = parseInt(lineNumber, 10);
      
      if (!file || !lineNum || !content) {
        console.log(`  Skipping line (missing data): file=${file}, line=${lineNum}, content=${content ? 'yes' : 'no'}`);
        continue;
      }
      
      const isComment = isCommentLine(content, file);
      if (!isComment) {
        console.log(`  Skipping line ${lineNum} in ${file} (not a comment): ${content.substring(0, 60)}...`);
        continue;
      }
      
      const patternMatch = content.match(LEXICAL_REGEX);
      const matchedPattern = patternMatch ? patternMatch[0] : 'unknown';
      const context = await getSurroundingContext(repoPath, file, lineNum, 5);
      
      console.log(`  ✓ Found candidate: ${file}:${lineNum} - ${matchedPattern}`);
      
      let commitHash = 'untracked';
      let commitDate = new Date().toISOString();
      
      try {
        const { stdout: blame } = await execPromise(
          `git blame -L ${lineNum},${lineNum} --porcelain "${file}"`,
          { cwd: repoPath }
        );
        
        commitHash = blame.split('\n')[0].split(' ')[0];
        const { stdout: date } = await execPromise(
          `git show -s --format=%ci ${commitHash}`,
          { cwd: repoPath }
        );
        commitDate = date.trim();
      } catch (error) {
        // File not tracked by git, use defaults but still include the candidate
        // Don't warn for untracked files - this is expected
      }
      
      candidates.push({
        file,
        line: lineNum,
        content: content.trim(),
        context,
        commitHash,
        commitDate,
        matchedPattern
      });
    }
  } catch (error) {
    console.error(`Lexical filtering error: ${error}`);
    // Try filesystem fallback on any error
    console.log('Attempting filesystem fallback due to error...');
    return await filesystemLexicalFiltering(repoPath);
  }
  
  return candidates;
}
