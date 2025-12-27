// Conditional import for vscode (only available in VS Code extension context)
let vscode: typeof import('vscode') | undefined;
try {
  vscode = require('vscode');
} catch {
  // vscode module not available (CLI mode)
  vscode = undefined;
}

import { DebtType } from './models';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as path from 'path';

/**
 * Interface for language-specific SATD detection patterns
 */
interface LanguagePatterns {
    /** Comment style indicators for the language */
    commentStyles: string[];
    
    /** File extensions associated with this language */
    fileExtensions: string[];
    
    /** Patterns that indicate technical debt */
    debtPatterns: {
        /** Explicit markers like TODO, FIXME */
        explicit: string[];
        
        /** Implicit phrases that suggest technical debt */
        implicit: string[];
        
        /** Custom user-defined patterns */
        custom: string[];
    };
}

/**
 * SatdDetector is responsible for detecting and classifying
 * Self-Admitted Technical Debt in code, focusing on Python, Java, and JavaScript
 */
export class SatdDetector {
    private workspaceRoot: string | null = null;
    private languagePatterns: Map<string, LanguagePatterns> = new Map();
    
    /**
     * Constructor initializes the language patterns
     */
    constructor() {
        this.initLanguagePatterns();
    }
    
    /**
     * Initialize the detector with the workspace path
     * @param workspaceRoot The root path of the workspace
     */
    public async initialize(workspaceRoot: string): Promise<void> {
        this.workspaceRoot = workspaceRoot;
        
        // Try to load custom patterns from .satdrc or .satdrc.json if they exist
        await this.loadCustomPatterns();
    }
    
    /**
     * Load custom patterns from configuration files in the repository
     * Supports .satdrc and .satdrc.json formats
     */
    private async loadCustomPatterns(): Promise<void> {
        if (!this.workspaceRoot) {
            return;
        }
        
        // Check for .satdrc or .satdrc.json
        const rcPath = join(this.workspaceRoot, '.satdrc');
        const jsonRcPath = join(this.workspaceRoot, './examples/satdrc.json');
        console.log(`Loading custom patterns from: ${rcPath} or ${jsonRcPath}`);
        let customConfig: any = null;
        
        if (existsSync(rcPath)) {
            try {
                const content = readFileSync(rcPath, 'utf-8');
                customConfig = JSON.parse(content);
            } catch (error) {
                console.error(`Failed to parse .satdrc: ${error}`);
            }
        } else if (existsSync(jsonRcPath)) {
            try {
                const content = readFileSync(jsonRcPath, 'utf-8');
                customConfig = JSON.parse(content);
            } catch (error) {
                console.error(`Failed to parse .satdrc.json: ${error}`);
            }
        }
        
        if (customConfig) {
            // Apply custom patterns to language configurations
            if (customConfig.customPatterns && Array.isArray(customConfig.customPatterns)) {
                // Add custom patterns to all languages
                for (const [lang, patterns] of this.languagePatterns.entries()) {
                    patterns.debtPatterns.custom = customConfig.customPatterns;
                }
            }
        }
    }
    
    /**
     * Classifies the type of technical debt based on the content
     * @param content The debt comment content
     * @param context Optional surrounding context
     * @returns The classified debt type
     */
    public classifyDebtType(content: string, context: string = ''): DebtType {
        const fullContent = (content + ' ' + context).toLowerCase();
        
        // Check for test debt FIRST (before defect) - look for test-specific keywords
        if (this.containsAny(fullContent, [
            'unit test', 'integration test', 'needs test', 'add test', 'write test',
            'test coverage', 'test case', 'test suite', 'test function',
            'lack of test', 'insufficient test', 'untested', 'more test',
            'regression test', 'automated test', 'manual test', 'test this',
            'mock', 'stub', 'testing framework'
        ])) {
            return DebtType.TEST;
        }
        
        // Check for implementation debt EARLY (before defect) - captures HACK, workarounds
        if (this.containsAny(fullContent, [
            'hack', 'workaround', 'temporary', 'temporary solution',
            'quick fix', 'optimize', 'optimization', 'slow',
            'efficient', 'inefficient', 'magic number',
            'duplicated', 'duplication', 'duplicate code', 'copy paste',
            'ugly', 'messy', 'needs refactoring', 'needs work',
            'could be better', 'quick and dirty', 'fix later', 'refactor later',
            'not ideal', 'not optimal', 'suboptimal', 'revisit', 'rework',
            'rewrite', 'simplify', 'complex', 'complicated',
            'simplistic', 'naive', 'brute force'
        ])) {
            return DebtType.IMPLEMENTATION;
        }
        
        // Check for architecture debt (before design - more specific)
        if (this.containsAny(fullContent, [
            'architecture', 'component coupling', 'cohesion', 'module dependency',
            'layer', 'microservice', 'monolith', 'separation of concerns', 
            'single responsibility', 'service layer', 'infrastructure',
            'scaling', 'scalability', 'throughput', 'latency', 'response time', 
            'bottleneck', 'distributed', 'reliability', 'availability', 'resilience'
        ])) {
            return DebtType.ARCHITECTURE;
        }
        
        // Check for design debt
        if (this.containsAny(fullContent, [
            'bad design', 'poor design', 'could be designed better', 'design debt', 'refactor',
            'abstraction', 'flexibility', 'maintainability', 'extensibility', 'poorly designed',
            'clean up', 'cleanup', 'clean this up', 'redesign', 'better design',
            'code smell', 'technical debt', 'tech debt', 'antipattern', 'anti-pattern',
            'decoupling', 'coupling', 'encapsulation', 'design pattern',
            'inheritance', 'hardcoded', 'hard-coded', 'hard coded', 'hard-coding'
        ])) {
            return DebtType.DESIGN;
        }
        
        // Check for documentation debt
        if (this.containsAny(fullContent, [
            'documentation', 'docs', 'document', 'comment', 'needs explanation',
            'explain', 'clarify', 'what this does', 'why this works', 'how this works',
            'javadoc', 'jsdoc', 'docstring', 'readme', 'wiki', 'undocumented',
            'missing documentation', 'update docs', 'document this', 'add comment',
            'commenting', 'improve comment', 'better comment', 'better documentation',
            'needs documentation', 'document usage', 'document parameters', 'document return'
        ])) {
            return DebtType.DOCUMENTATION;
        }
        
        // Check for defect debt
        if (this.containsAny(fullContent, [
            'bug', 'defect', 'issue', 'problem', 'error', 'incorrect',
            'wrong', 'broken', 'doesn\'t work', 'not working', 'fails', 'failure',
            'exception', 'crash', 'corrupted', 'corruption', 'overflow', 'underflow',
            'memory leak', 'resource leak', 'null pointer', 'segfault', 'infinite loop',
            'race condition', 'deadlock', 'concurrency issue', 'out of bounds', 
            'boundary check', 'edge case', 'corner case', 'vulnerability', 
            'security hole', 'security issue'
        ])) {
            return DebtType.DEFECT;
        }
        
        // Check for requirement debt
        if (this.containsAny(fullContent, [
            'requirement', 'specification', 'spec', 'required', 'need to support',
            'feature', 'enhancement', 'user story', 'use case', 'product owner',
            'stakeholder', 'business rule', 'functional requirement', 'acceptance criteria',
            'product backlog', 'missing feature', 'incomplete feature', 'unfinished feature',
            'planned feature', 'roadmap', 'milestone', 'not implemented yet'
        ])) {
            return DebtType.REQUIREMENT;
        }
        
        // Default
        return DebtType.OTHER;
    }
    
    /**
     * Checks if text contains any of the patterns
     * @param text The text to check
     * @param patterns Array of patterns to look for
     * @returns True if text contains any of the patterns
     */
    private containsAny(text: string, patterns: string[]): boolean {
        return patterns.some(pattern => text.includes(pattern.toLowerCase()));
    }
    
    /**
     * Get language-specific patterns based on file path
     * @param filePath Path to the file
     * @returns Language patterns for the given file
     */
    public getLanguagePatterns(filePath: string): LanguagePatterns {
        const extension = path.extname(filePath).toLowerCase().replace('.', '');
        
        // First try direct extension match
        for (const [language, patterns] of this.languagePatterns.entries()) {
            if (patterns.fileExtensions.includes(extension)) {
                return patterns;
            }
        }
        
        // Fallback to generic patterns if no language match
        return this.languagePatterns.get('generic') || this.getGenericPatterns();
    }
    
    /**
     * Get all patterns for SATD detection from a specific language
     * @param language The language to get patterns for
     * @param detectionLevel The level of detection to use (basic, standard, comprehensive)
     * @param includeImplicit Whether to include implicit patterns
     * @returns Combined array of patterns
     */
    public getAllPatternsForLanguage(
        language: string, 
        detectionLevel: string = 'standard',
        includeImplicit: boolean = true
    ): string[] {
        const patterns = this.languagePatterns.get(language);
        if (!patterns) {
            return this.getAllPatternsForLanguage('generic', detectionLevel, includeImplicit);
        }
        
        let result: string[] = [];
        
        // Add explicit patterns based on detection level
        if (detectionLevel === 'basic') {
            // Basic includes only core TODO/FIXME
            result = result.concat(patterns.debtPatterns.explicit.filter(p => 
                p === 'TODO' || p === 'FIXME'
            ));
        } else {
            // Standard and comprehensive include all explicit patterns
            result = result.concat(patterns.debtPatterns.explicit);
        }
        
        // Add implicit patterns for comprehensive level
        if (detectionLevel === 'comprehensive' && includeImplicit) {
            result = result.concat(patterns.debtPatterns.implicit);
        }
        
        // Always include custom patterns
        result = result.concat(patterns.debtPatterns.custom);
        
        return result;
    }
    
    /**
     * Get fallback generic patterns
     * @returns Generic language patterns
     */
    private getGenericPatterns(): LanguagePatterns {
        return {
            commentStyles: ['//', '#', '/*', '<!--'],
            fileExtensions: [],
            debtPatterns: {
                explicit: ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG', 'ISSUE', 'DEBT', 'NOTE', 'WARNING'],
                implicit: [
                    'temporary solution', 'quick fix', 'will be refactored', 
                    'needs refactoring', 'could be better', 
                    'not elegant', 'workaround for',
                    'technical debt', 'to be improved', 'refactor this'
                ],
                custom: []
            }
        };
    }
    
    /**
     * Initialize language-specific patterns for SATD detection
     * Focuses on JavaScript, Python, and Java
     */
    private initLanguagePatterns(): void {

        // Python patterns - ensure they are properly initialized
            this.languagePatterns.set('python', {
                commentStyles: ['#', '"""', "'''"],
                fileExtensions: ['py', 'pyw', 'pyi', 'pyc', 'pyd', 'pyo'],
                debtPatterns: {
                    explicit: ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG', 'ISSUE', 'DEBT', 'NOTE', 'OPTIMIZE', 'REVIEW', 'REVISIT'],
                    implicit: [
                        'temporary solution', 'quick fix', 'will be refactored', 
                        'needs refactoring', 'could be better', 
                        'not elegant', 'workaround for',
                        'technical debt', 'to be improved', 'refactor this',
                        // Python specific
                        'type: ignore', 'noqa', 'pylint: disable', 'dynamically typed', 
                        'type: Any', 'ignore mypy', 'type hint', 'type check',
                        'ignore flake8', 'ignore pep8', 'ignore pycodestyle',
                        'ignore bandit', 'skip coverage', 'skip test',
                        'monkey patch', 'monkey patching', 'monkeypatching',
                        'magic method', 'magic attribute', 'global variable', 
                        'globals', 'eval(', 'exec(', 'globals()', 'locals()',
                        'getattr(', 'setattr(', 'hasattr(', 'delattr(',
                        'list comprehension', 'nested loop', 'nested list comprehension',
                        'bare except', 'except:', 'except Exception:',
                        'circular import', 'from __future__',
                        'print(', 'logging.debug', 'pdb', 'pass',
                        'hardcoded', 'hard-coded', 'magic number',
                        'mutable default argument', '[])', '{})', 'dict()',
                        'isinstance', 'issubclass', 'type(',
                        'wildcard import', 'from module import *'
                    ],
                    custom: []
                }
        });

        // TypeScript patterns
        this.languagePatterns.set('typescript', {
            commentStyles: ['//', '/*', '/**'],
            fileExtensions: ['ts', 'tsx', 'mts', 'cts'],
            debtPatterns: {
                explicit: ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG', 'ISSUE', 'DEBT', 'NOTE', 'OPTIMIZE', 'PERF', 'REVIEW', 'REVISIT'],
                implicit: [
                    'temporary solution', 'quick fix', 'will be refactored', 
                    'needs refactoring', 'could be better', 
                    'not very elegant', 'workaround for', 'hack for',
                    'technical debt', 'to be improved', 'refactor this',
                    // TypeScript specific
                    'any type', 'as any', '// @ts-ignore', '// @ts-nocheck',
                    '@ts-expect-error', 'type assertion', 'non-null assertion',
                    'eslint-disable', 'tslint:disable', 'typescript-eslint',
                    'unknown type', 'never type', 'void type',
                    'interface vs type', 'generic constraint', 'type guard',
                    'discriminated union', 'exhaustive check', 'readonly',
                    'magic string', 'magic number', 'hardcoded',
                    'callback hell', 'spaghetti code', 'nested callbacks',
                    'console.log', 'debugger', 'tight coupling'
                ],
                custom: []
            }
        });

        // JavaScript patterns
        this.languagePatterns.set('javascript', {
            commentStyles: ['//', '/*', '/**'],
            fileExtensions: ['js', 'jsx', 'mjs', 'cjs'],
            debtPatterns: {
                explicit: ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG', 'ISSUE', 'DEBT', 'NOTE', 'OPTIMIZE', 'PERF', 'REVIEW', 'REVISIT'],
                implicit: [
                    'temporary solution', 'quick fix', 'will be refactored', 
                    'needs refactoring', 'could be better', 
                    'not very elegant', 'workaround for', 'hack for',
                    'technical debt', 'to be improved', 'refactor this',
                    'not production ready', 'experimental feature',
                    'needs cleanup', 'not efficient', 'dirty fix',
                    'this is a hack', 'race condition', 'memory leak',
                    'not optimal', 'inconsistent',
                    // JS specific
                    'callback hell', 'spaghetti code', 'disable eslint',
                    'magic string', 'magic number', 'hardcoded',
                    'nested callbacks', 'callback pyramid', 
                    'console.log', 'debugger', 'alert(', 
                    'eval(', 'setTimeout(', 'with(',
                    'document.write', 'browser specific',
                    'browser hack', 'tight coupling',
                    'parseInt(', 'parseFloat(', 'typeof',
                    'global variable', 'var ', 'prototype',
                    'instanceof', 'null check', 'undefined check'
                ],
                custom: []
            }
        });
        
        // Python patterns
        this.languagePatterns.set('python', {
            commentStyles: ['#', '"""', "'''"],
            fileExtensions: ['py', 'pyw', 'pyi', 'pyc', 'pyd', 'pyo'],
            debtPatterns: {
                explicit: ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG', 'ISSUE', 'DEBT', 'NOTE', 'OPTIMIZE', 'REVIEW', 'REVISIT'],
                implicit: [
                    'temporary solution', 'quick fix', 'will be refactored', 
                    'needs refactoring', 'could be better', 
                    'not elegant', 'workaround for',
                    'technical debt', 'to be improved', 'refactor this',
                    // Python specific
                    'type: ignore', 'noqa', 'pylint: disable', 'dynamically typed', 
                    'type: Any', 'ignore mypy', 'type hint', 'type check',
                    'ignore flake8', 'ignore pep8', 'ignore pycodestyle',
                    'ignore bandit', 'skip coverage', 'skip test',
                    'monkey patch', 'monkey patching', 'monkeypatching',
                    'magic method', 'magic attribute', 'global variable', 
                    'globals', 'eval(', 'exec(', 'globals()', 'locals()',
                    'getattr(', 'setattr(', 'hasattr(', 'delattr(',
                    'list comprehension', 'nested loop', 'nested list comprehension',
                    'bare except', 'except:', 'except Exception:',
                    'circular import', 'from __future__',
                    'print(', 'logging.debug', 'pdb', 'pass',
                    'hardcoded', 'hard-coded', 'magic number',
                    'mutable default argument', '[])', '{})', 'dict()',
                    'isinstance', 'issubclass', 'type(',
                    'wildcard import', 'from module import *'
                ],
                custom: []
            }
        });
        
        // Java patterns
        this.languagePatterns.set('java', {
            commentStyles: ['//', '/*', '/**'],
            fileExtensions: ['java', 'jsp', 'jspf', 'jspx'],
            debtPatterns: {
                explicit: ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG', 'ISSUE', 'DEBT', 'NOTE', 'OPTIMIZE', 'REVIEW', 'REVISIT'],
                implicit: [
                    'temporary solution', 'quick fix', 'will be refactored', 
                    'needs refactoring', 'could be better', 
                    'not elegant', 'workaround for',
                    'technical debt', 'to be improved', 'refactor this',
                    // Java specific
                    'raw type', 'unchecked cast', 'suppress warnings', 
                    'checkstyle:off', 'sonar:off', 'reflection',
                    'instanceof', 'unused parameter', 'dead code',
                    'deprecated', 'deprecation', 'unchecked',
                    'magic number', 'hard-coded', 'hardcoded',
                    'synchronized block', 'race condition',
                    'catch Exception', 'catch Throwable',
                    'finalize()', 'printStackTrace',
                    'System.out.print', 'System.err.print',
                    'null check', 'NPE', 'NullPointerException',
                    'object instantiation in loop', 'toArray with pre-sized array',
                    'class cast', 'ClassCastException', 'Thread.sleep',
                    'busy waiting', 'blocking call', 'blocking io',
                    'shallow copy', 'deep copy', 'clone()',
                    'instanceof', 'isAssignableFrom', 'Cloneable',
                    'Serializable', 'transient', 'volatile'
                ],
                custom: []
            }
        });
        
        // Generic patterns (fallback for other languages)
        this.languagePatterns.set('generic', {
            commentStyles: ['//', '#', '/*', '<!--'],
            fileExtensions: [],
            debtPatterns: {
                explicit: ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG', 'ISSUE', 'DEBT', 'NOTE', 'WARNING', 'OPTIMIZE', 'REVIEW', 'REVISIT'],
                implicit: [
                    'temporary solution', 'quick fix', 'will be refactored', 
                    'needs refactoring', 'could be better', 
                    'not elegant', 'workaround for',
                    'technical debt', 'to be improved', 'refactor this',
                    'experimental', 'prototype', 'poc', 'not tested',
                    'untested', 'needs testing', 'not production ready',
                    'performance issue', 'slow', 'optimize later',
                    'security issue', 'security risk', 'insecure',
                    'duplicate code', 'duplicated code', 'copy-paste',
                    'hard-coded', 'hardcoded', 'magic number',
                    'remove this', 'remove later', 'delete this',
                    'ugly solution', 'ugly hack', 'not ideal',
                    'work in progress', 'wip', 'not complete',
                    'incomplete', 'hacky', 'quick and dirty'
                ],
                custom: []
            }
        });
    }
    
    /**
     * Analyzes a file to detect SATD patterns
     * @param filePath Path to the file
     * @param content Content of the file
     * @param config Detection configuration
     * @returns Array of potential SATD items
     */
    public analyzePotentialSatd(
        filePath: string, 
        content: string, 
        config: {
            detectionLevel: string;
            includeImplicit: boolean;
        }
    ): { 
        line: number; 
        content: string;
        isSatd: boolean;
        confidence: number;
        debtType?: DebtType;
    }[] {
        const results: {
            line: number;
            content: string;
            isSatd: boolean;
            confidence: number;
            debtType?: DebtType;
        }[] = [];
        
        // Get language-specific patterns
        const language = this.getLanguagePatterns(filePath);
        
        // Split content into lines
        const lines = content.split('\n');
        
        // Patterns to look for based on detection level and configuration
        const explicitPatterns = this.getExplicitPatterns(language, config.detectionLevel);
        const implicitPatterns = config.includeImplicit ? language.debtPatterns.implicit : [];
        const customPatterns = language.debtPatterns.custom || [];
        
        // Combine all patterns
        const allPatterns = [
            ...explicitPatterns.map(p => ({ pattern: p, isExplicit: true })),
            ...implicitPatterns.map(p => ({ pattern: p, isExplicit: false })),
            ...customPatterns.map(p => ({ pattern: p, isExplicit: true }))
        ];
        
        // Check each line for patterns
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNumber = i + 1;
            
            // Check if line contains a comment
            const hasComment = language.commentStyles.some(style => 
                line.includes(style)
            );
            
            if (hasComment) {
                // Check for patterns
                for (const { pattern, isExplicit } of allPatterns) {
                    // Escape special regex characters in the pattern
                    const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(`\\b${escapedPattern}\\b`, 'i');
                    if (regex.test(line)) {
                        // Get context (up to 2 lines before and after)
                        const startLine = Math.max(0, i - 2);
                        const endLine = Math.min(lines.length - 1, i + 2);
                        const context = lines.slice(startLine, endLine + 1).join('\n');
                        
                        // Determine debt type
                        const debtType = this.classifyDebtType(line, context);
                        
                        // Calculate confidence (explicit patterns have higher confidence)
                        const confidence = isExplicit ? 0.9 : 0.7;
                        
                        results.push({
                            line: lineNumber,
                            content: line,
                            isSatd: true,
                            confidence,
                            debtType
                        });
                        
                        // Only report one match per line
                        break;
                    }
                }
            }
        }
        
        return results;
    }
    
    /**
     * Get explicit patterns based on detection level
     * @param language Language patterns to use
     * @param detectionLevel Detection level (basic, standard, comprehensive)
     * @returns Array of explicit patterns
     */
    private getExplicitPatterns(language: LanguagePatterns, detectionLevel: string): string[] {
        if (detectionLevel === 'basic') {
            // Basic includes only core TODO/FIXME
            return language.debtPatterns.explicit.filter(p => 
                p === 'TODO' || p === 'FIXME'
            );
        } else {
            // Standard and comprehensive include all explicit patterns
            return language.debtPatterns.explicit;
        }
    }
}