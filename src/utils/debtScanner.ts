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
    // Build grep pattern from lexical patterns
    const grepPattern = LEXICAL_PATTERNS.slice(0, 20).join('|'); // Use first 20 patterns for git grep
    
    // Get all files with potential SATD comments using git grep
    const { stdout } = await execPromise(
      `git grep -n -E "\\b(${grepPattern})\\b" -- "*.py" "*.js" "*.ts" "*.tsx" "*.jsx" "*.java" "*.c" "*.cpp" "*.h" "*.hpp" "*.cs" "*.go" "*.rb" "*.php"`,
      { cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 }
    ).catch(() => ({ stdout: '' }));
    
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
      try {
        const { stdout: blame } = await execPromise(
          `git blame -L ${lineNum},${lineNum} --porcelain "${file}"`,
          { cwd: workspaceRoot }
        );
        
        const commitHash = blame.split('\n')[0].split(' ')[0];
        const { stdout: commitDate } = await execPromise(
          `git show -s --format=%ci ${commitHash}`,
          { cwd: workspaceRoot }
        );
        
        candidates.push({
          file,
          line: lineNum,
          content: content.trim(),
          context,
          commitHash,
          commitDate: commitDate.trim(),
          matchedPattern
        });
      } catch (error) {
        // Skip files that can't be blamed (e.g., uncommitted files)
        console.warn(`Could not get blame info for ${file}:${lineNum}`);
      }
    }
  } catch (error) {
    console.error(`Lexical filtering error: ${error}`);
  }
  
  return candidates;
}

/**
 * Check if a line is likely a comment based on file extension
 */
function isCommentLine(content: string, filePath: string): boolean {
  const trimmed = content.trim();
  const ext = path.extname(filePath).toLowerCase();
  
  // Python comments
  if (ext === '.py') {
    return trimmed.startsWith('#') || trimmed.startsWith('"""') || trimmed.startsWith("'''");
  }
  
  // C-style comments (JS, TS, Java, C, C++, Go, etc.)
  if (['.js', '.jsx', '.ts', '.tsx', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go'].includes(ext)) {
    return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
  }
  
  // Ruby comments
  if (ext === '.rb') {
    return trimmed.startsWith('#');
  }
  
  // PHP comments
  if (ext === '.php') {
    return trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*') || trimmed.startsWith('*');
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
      if (typeof vscode !== 'undefined' && vscode.window) {
        vscode.window.showInformationMessage('No workspace folder open');
      }
      return [];
    }
    
    // Use quick scan for initial detection, then classify with LLM
    const candidates = await lexicalFiltering(workspaceRoot);
    
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
    const grepPattern = LEXICAL_PATTERNS.slice(0, 20).join('|');
    
    const { stdout } = await execPromise(
      `git grep -n -E "\\b(${grepPattern})\\b" -- "*.py" "*.js" "*.ts" "*.tsx" "*.jsx" "*.java" "*.c" "*.cpp" "*.h" "*.hpp" "*.cs" "*.go" "*.rb" "*.php"`,
      { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }
    ).catch(() => ({ stdout: '' }));
    
    const lines = stdout.split('\n').filter(line => line.trim() !== '');
    
    for (const line of lines) {
      const match = line.match(/^([^:]+):(\d+):(.*)$/);
      if (!match) continue;
      
      const [, file, lineNumber, content] = match;
      const lineNum = parseInt(lineNumber, 10);
      
      if (!file || !lineNum || !content) continue;
      if (!isCommentLine(content, file)) continue;
      
      const patternMatch = content.match(LEXICAL_REGEX);
      const matchedPattern = patternMatch ? patternMatch[0] : 'unknown';
      const context = await getSurroundingContext(repoPath, file, lineNum, 5);
      
      try {
        const { stdout: blame } = await execPromise(
          `git blame -L ${lineNum},${lineNum} --porcelain "${file}"`,
          { cwd: repoPath }
        );
        
        const commitHash = blame.split('\n')[0].split(' ')[0];
        const { stdout: commitDate } = await execPromise(
          `git show -s --format=%ci ${commitHash}`,
          { cwd: repoPath }
        );
        
        candidates.push({
          file,
          line: lineNum,
          content: content.trim(),
          context,
          commitHash,
          commitDate: commitDate.trim(),
          matchedPattern
        });
      } catch (error) {
        // Skip files that can't be blamed
      }
    }
  } catch (error) {
    console.error(`Lexical filtering error: ${error}`);
  }
  
  return candidates;
}
