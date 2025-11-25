// src/analyzers/controlFlowAnalyzer.ts
// Conditional import for vscode (only available in VS Code extension context)
let vscode: typeof import('vscode') | undefined;
try {
  vscode = require('vscode');
} catch {
  // vscode module not available (CLI mode)
  vscode = undefined;
}

import { 
    TechnicalDebt, 
    SatdRelationship, 
    RelationshipType,
    WeightedEdge,
    DEFAULT_RELATIONSHIP_WEIGHTS,
    MAX_DEPENDENCY_HOPS
} from '../models';
import * as path from 'path';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import { NodePath } from '@babel/traverse';
import * as t from '@babel/types';

/**
 * Analyzes control flow dependencies between technical debt items.
 * Examines how the execution flow influenced by SATD A might affect 
 * the conditions or execution of code associated with SATD B.
 * Control dependency weight: 0.5-0.7
 */
export class ControlFlowAnalyzer {
    private workspaceRoot: string | null = null;
    private maxHops: number = MAX_DEPENDENCY_HOPS;
    
    /**
     * Initialize the analyzer with workspace root
     */
    public async initialize(workspaceRoot: string): Promise<void> {
        this.workspaceRoot = workspaceRoot;
    }
    
    /**
     * Set maximum hop count for dependency analysis
     */
    public setMaxHops(hops: number): void {
        this.maxHops = Math.min(hops, MAX_DEPENDENCY_HOPS);
    }
    
    /**
     * Find relationships between technical debt items based on control flow
     * @param debtItems List of technical debt items to analyze
     * @param fileContentMap Map of file paths to their content
     * @returns List of control flow relationships with weighted edges
     */
    public async findRelationships(
        debtItems: TechnicalDebt[], 
        fileContentMap: Map<string, string>
    ): Promise<SatdRelationship[]> {
        if (!this.workspaceRoot) {
            return [];
        }
        
        const relationships: SatdRelationship[] = [];
        
        // Map debt items by file for easier access
        const debtByFile = this.groupDebtItemsByFile(debtItems);
        
        // For each file with debt, analyze its control flow
        for (const [filePath, debtsInFile] of debtByFile.entries()) {
            const fileContent = fileContentMap.get(filePath);
            if (!fileContent) continue;
            
            // Handle Python files
            if (filePath.endsWith('.py')) {
                const pythonRelationships = await this.findPythonControlFlowDependencies(
                    filePath, 
                    fileContent, 
                    debtsInFile
                );
                relationships.push(...pythonRelationships);
                continue;
            }
            
            // Skip non-parsable files
            if (!this.isParsableFile(filePath)) {
                continue;
            }
            
            // Find control flow relationships within the file
            const intraFileRelationships = await this.findIntraFileControlFlowDependencies(
                filePath, 
                fileContent, 
                debtsInFile
            );
            
            relationships.push(...intraFileRelationships);
        }
        
        return relationships;
    }
    
    /**
     * Group technical debt items by file
     */
    private groupDebtItemsByFile(debtItems: TechnicalDebt[]): Map<string, TechnicalDebt[]> {
        const debtByFile = new Map<string, TechnicalDebt[]>();
        
        for (const item of debtItems) {
            if (!debtByFile.has(item.file)) {
                debtByFile.set(item.file, []);
            }
            debtByFile.get(item.file)!.push(item);
        }
        
        return debtByFile;
    }
    
    /**
     * Check if a file is a JavaScript or TypeScript file
     */
    private isParsableFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return ['.js', '.jsx', '.ts', '.tsx'].includes(ext);
    }
    
    /**
     * Calculate edge weight based on control structure nesting depth
     */
    private calculateEdgeWeight(nestingDepth: number): number {
        const weights = DEFAULT_RELATIONSHIP_WEIGHTS[RelationshipType.CONTROL];
        // Deeper nesting = stronger control dependency
        const normalizedDepth = Math.min(nestingDepth, 5) / 5;
        return weights.min + (normalizedDepth * (weights.max - weights.min));
    }
    
    /**
     * Find Python control flow dependencies
     */
    private async findPythonControlFlowDependencies(
        filePath: string, 
        fileContent: string,
        debtsInFile: TechnicalDebt[]
    ): Promise<SatdRelationship[]> {
        const relationships: SatdRelationship[] = [];
        const lines = fileContent.split('\n');
        
        // Track control structures
        const controlStructures: Array<{
            type: string;
            startLine: number;
            endLine: number;
            debt?: TechnicalDebt;
            affectedLines: Set<number>;
            nestingDepth: number;
        }> = [];
        
        let currentIndent = 0;
        let controlStack: Array<{ indent: number; startLine: number; type: string }> = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNumber = i + 1;
            
            if (line.trim() === '') continue;
            
            const indent = line.length - line.trimStart().length;
            
            // Check for control structure keywords
            const controlMatch = line.match(/^\s*(if|elif|else|for|while|try|except|finally|with)\s*[:(]/);
            if (controlMatch) {
                const debtAtLine = debtsInFile.find(debt => {
                    const start = Math.max(1, debt.line - 3);
                    const end = debt.line + 3;
                    return lineNumber >= start && lineNumber <= end;
                });
                
                controlStack.push({ indent, startLine: lineNumber, type: controlMatch[1] });
                
                if (debtAtLine) {
                    controlStructures.push({
                        type: controlMatch[1],
                        startLine: lineNumber,
                        endLine: lineNumber, // Will be updated
                        debt: debtAtLine,
                        affectedLines: new Set(),
                        nestingDepth: controlStack.length
                    });
                }
            }
            
            // Update control structure end lines based on indentation
            while (controlStack.length > 0 && indent <= controlStack[controlStack.length - 1].indent) {
                const popped = controlStack.pop()!;
                const structure = controlStructures.find(s => s.startLine === popped.startLine);
                if (structure) {
                    structure.endLine = lineNumber - 1;
                }
            }
            
            // Add current line to affected lines of all active control structures
            for (const structure of controlStructures) {
                if (lineNumber > structure.startLine && (structure.endLine === structure.startLine || lineNumber <= structure.endLine)) {
                    structure.affectedLines.add(lineNumber);
                }
            }
        }
        
        // Close any remaining control structures
        for (const ctrl of controlStack) {
            const structure = controlStructures.find(s => s.startLine === ctrl.startLine);
            if (structure) {
                structure.endLine = lines.length;
            }
        }
        
        // Create relationships
        for (const structure of controlStructures) {
            if (!structure.debt) continue;
            
            for (const debt of debtsInFile) {
                if (debt.id === structure.debt.id) continue;
                if (!structure.affectedLines.has(debt.line)) continue;
                
                const hops = Math.ceil(Math.abs(debt.line - structure.startLine) / 10);
                if (hops > this.maxHops) continue;
                
                const weight = this.calculateEdgeWeight(structure.nestingDepth);
                
                const edge: WeightedEdge = {
                    sourceId: structure.debt.id,
                    targetId: debt.id,
                    type: RelationshipType.CONTROL,
                    weight,
                    hops: Math.min(hops, this.maxHops)
                };
                
                relationships.push({
                    sourceId: structure.debt.id,
                    targetId: debt.id,
                    types: [RelationshipType.CONTROL],
                    edges: [edge],
                    strength: weight,
                    description: `SATD at line ${structure.debt.line} involves a ${structure.type} statement that controls execution affecting SATD at line ${debt.line}.`,
                    hopCount: hops
                });
            }
        }
        
        return relationships;
    }
    
    /**
     * Find control flow dependencies within a single file (JS/TS)
     */
    private async findIntraFileControlFlowDependencies(
        filePath: string, 
        fileContent: string,
        debtsInFile: TechnicalDebt[]
    ): Promise<SatdRelationship[]> {
        const relationships: SatdRelationship[] = [];
        
        try {
            const ast = this.parseCode(filePath, fileContent);
            if (!ast) return relationships;
            
            // Track control structures
            const controlStructures: {
                type: string;
                node: t.Node;
                debt: TechnicalDebt;
                affects: Set<number>;
                nestingDepth: number;
            }[] = [];
            
            let nestingDepth = 0;
            
            // Find control structures in technical debt contexts
            traverse(ast, {
                IfStatement: {
                    enter: (path) => {
                        nestingDepth++;
                        this.processControlStructure('if statement', path, debtsInFile, controlStructures, nestingDepth);
                    },
                    exit: () => { nestingDepth--; }
                },
                SwitchStatement: {
                    enter: (path) => {
                        nestingDepth++;
                        this.processControlStructure('switch statement', path, debtsInFile, controlStructures, nestingDepth);
                    },
                    exit: () => { nestingDepth--; }
                },
                ForStatement: {
                    enter: (path) => {
                        nestingDepth++;
                        this.processControlStructure('for loop', path, debtsInFile, controlStructures, nestingDepth);
                    },
                    exit: () => { nestingDepth--; }
                },
                WhileStatement: {
                    enter: (path) => {
                        nestingDepth++;
                        this.processControlStructure('while loop', path, debtsInFile, controlStructures, nestingDepth);
                    },
                    exit: () => { nestingDepth--; }
                },
                DoWhileStatement: {
                    enter: (path) => {
                        nestingDepth++;
                        this.processControlStructure('do-while loop', path, debtsInFile, controlStructures, nestingDepth);
                    },
                    exit: () => { nestingDepth--; }
                },
                ForInStatement: {
                    enter: (path) => {
                        nestingDepth++;
                        this.processControlStructure('for-in loop', path, debtsInFile, controlStructures, nestingDepth);
                    },
                    exit: () => { nestingDepth--; }
                },
                ForOfStatement: {
                    enter: (path) => {
                        nestingDepth++;
                        this.processControlStructure('for-of loop', path, debtsInFile, controlStructures, nestingDepth);
                    },
                    exit: () => { nestingDepth--; }
                },
                TryStatement: {
                    enter: (path) => {
                        nestingDepth++;
                        this.processControlStructure('try-catch block', path, debtsInFile, controlStructures, nestingDepth);
                    },
                    exit: () => { nestingDepth--; }
                }
            });
            
            // Find relationships between control structures and debt items
            for (const controlStructure of controlStructures) {
                for (const debt of debtsInFile) {
                    if (debt.id === controlStructure.debt.id) continue;
                    if (!controlStructure.affects.has(debt.line)) continue;
                    
                    const hops = Math.ceil(Math.abs(debt.line - controlStructure.debt.line) / 10);
                    if (hops > this.maxHops) continue;
                    
                    const weight = this.calculateEdgeWeight(controlStructure.nestingDepth);
                    
                    const edge: WeightedEdge = {
                        sourceId: controlStructure.debt.id,
                        targetId: debt.id,
                        type: RelationshipType.CONTROL,
                        weight,
                        hops: Math.min(hops, this.maxHops)
                    };
                    
                    relationships.push({
                        sourceId: controlStructure.debt.id,
                        targetId: debt.id,
                        types: [RelationshipType.CONTROL],
                        edges: [edge],
                        strength: weight,
                        description: `SATD at line ${controlStructure.debt.line} involves a ${controlStructure.type} that controls execution affecting SATD at line ${debt.line}.`,
                        hopCount: hops
                    });
                }
            }
            
        } catch (error) {
            console.error(`Error analyzing control flow in ${filePath}:`, error);
        }
        
        return relationships;
    }
    
    /**
     * Parse code into an AST
     */
    private parseCode(filePath: string, fileContent: string): any {
        try {
            const ext = path.extname(filePath).toLowerCase();
            const plugins: any[] = [];
            
            if (['.ts', '.tsx'].includes(ext)) {
                plugins.push('typescript');
            }
            if (['.jsx', '.tsx'].includes(ext)) {
                plugins.push('jsx');
            }
            
            return parser.parse(fileContent, {
                sourceType: 'module',
                plugins: plugins
            });
        } catch (error) {
            console.error(`Error parsing ${filePath}:`, error);
            return null;
        }
    }
    
    /**
     * Process a control structure and check if it's in a debt context
     */
    private processControlStructure(
        type: string,
        path: NodePath<t.Node>,
        debtsInFile: TechnicalDebt[],
        controlStructures: {
            type: string;
            node: t.Node;
            debt: TechnicalDebt;
            affects: Set<number>;
            nestingDepth: number;
        }[],
        nestingDepth: number
    ): void {
        const node = path.node;
        const loc = node.loc;
        
        if (loc) {
            const debtContext = this.findDebtAtLocation(debtsInFile, loc.start.line);
            
            if (debtContext) {
                const affectedLines = new Set<number>();
                this.collectLinesInNode(node, affectedLines);
                
                controlStructures.push({
                    type,
                    node,
                    debt: debtContext,
                    affects: affectedLines,
                    nestingDepth
                });
            }
        }
    }
    
    /**
     * Collect all line numbers in a node and its children
     */
    private collectLinesInNode(node: t.Node, lines: Set<number>): void {
        if (node.loc) {
            for (let i = node.loc.start.line; i <= node.loc.end.line; i++) {
                lines.add(i);
            }
        }
        
        for (const key in node) {
            const child = (node as any)[key];
            
            if (child && typeof child === 'object') {
                if (Array.isArray(child)) {
                    for (const item of child) {
                        if (item && typeof item === 'object' && 'type' in item) {
                            this.collectLinesInNode(item, lines);
                        }
                    }
                } else if ('type' in child) {
                    this.collectLinesInNode(child, lines);
                }
            }
        }
    }
    
    /**
     * Find a technical debt item at a specific line
     */
    private findDebtAtLocation(debtsInFile: TechnicalDebt[], line: number): TechnicalDebt | undefined {
        return debtsInFile.find(debt => {
            const debtContextStart = Math.max(1, debt.line - 5);
            const debtContextEnd = debt.line + 5;
            return line >= debtContextStart && line <= debtContextEnd;
        });
    }
}
