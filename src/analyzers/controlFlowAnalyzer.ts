// src/analyzers/controlFlowAnalyzer.ts
import * as vscode from 'vscode';
import { TechnicalDebt, SatdRelationship, RelationshipType } from '../models';
import * as path from 'path';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import { NodePath } from '@babel/traverse';
import * as t from '@babel/types';

/**
 * Analyzes control flow dependencies between technical debt items.
 * Examines how the execution flow influenced by SATD A might affect 
 * the conditions or execution of code associated with SATD B.
 */
export class ControlFlowAnalyzer {
    private workspaceRoot: string | null = null;
    
    /**
     * Initialize the analyzer with workspace root
     * @param workspaceRoot Root directory of the workspace
     */
    public async initialize(workspaceRoot: string): Promise<void> {
        this.workspaceRoot = workspaceRoot;
    }
    
    /**
     * Find relationships between technical debt items based on control flow
     * @param debtItems List of technical debt items to analyze
     * @param fileContentMap Map of file paths to their content
     * @returns List of control flow relationships
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
            
            // Skip files based on extension
            if (!this.isJsOrTsFile(filePath)) {
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
     * @param debtItems List of technical debt items
     * @returns Map of file paths to debt items in them
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
     * @param filePath Path to the file
     * @returns True if the file is JavaScript or TypeScript
     */
    private isJsOrTsFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return ['.js', '.jsx', '.ts', '.tsx'].includes(ext);
    }
    
    /**
     * Find control flow dependencies within a single file
     * @param filePath Path to the file
     * @param fileContent Content of the file
     * @param debtsInFile List of debt items in the file
     * @returns List of control flow relationships
     */
    private async findIntraFileControlFlowDependencies(
        filePath: string, 
        fileContent: string,
        debtsInFile: TechnicalDebt[]
    ): Promise<SatdRelationship[]> {
        const relationships: SatdRelationship[] = [];
        
        try {
            // Parse the code into an AST
            const ast = this.parseCode(filePath, fileContent);
            if (!ast) return relationships;
            
            // Maps for tracking control structures
            const controlStructures: {
                type: string;
                node: t.Node;
                debt: TechnicalDebt;
                affects: Set<number>; // Line numbers affected by this control structure
            }[] = [];
            
            // Find control structures in technical debt contexts
            traverse(ast, {
                IfStatement: (path) => {
                    this.processControlStructure('if statement', path, debtsInFile, controlStructures);
                },
                SwitchStatement: (path) => {
                    this.processControlStructure('switch statement', path, debtsInFile, controlStructures);
                },
                ForStatement: (path) => {
                    this.processControlStructure('for loop', path, debtsInFile, controlStructures);
                },
                WhileStatement: (path) => {
                    this.processControlStructure('while loop', path, debtsInFile, controlStructures);
                },
                DoWhileStatement: (path) => {
                    this.processControlStructure('do-while loop', path, debtsInFile, controlStructures);
                },
                ForInStatement: (path) => {
                    this.processControlStructure('for-in loop', path, debtsInFile, controlStructures);
                },
                ForOfStatement: (path) => {
                    this.processControlStructure('for-of loop', path, debtsInFile, controlStructures);
                },
                TryStatement: (path) => {
                    this.processControlStructure('try-catch block', path, debtsInFile, controlStructures);
                }
            });
            
            // Find relationships between control structures and debt items
            for (const controlStructure of controlStructures) {
                // Find debt items affected by this control structure
                for (const debt of debtsInFile) {
                    // Skip if the debt is the same as the one in the control structure
                    if (debt.id === controlStructure.debt.id) continue;
                    
                    // Check if this debt is affected by the control structure
                    if (controlStructure.affects.has(debt.line)) {
                        relationships.push({
                            sourceId: controlStructure.debt.id,
                            targetId: debt.id,
                            types: [RelationshipType.CONTROL_FLOW],
                            strength: 0.6, // Control flow dependencies are moderately strong
                            description: `SATD in line ${controlStructure.debt.line} involves a ${controlStructure.type} that controls the execution flow affecting SATD in line ${debt.line}.`
                        });
                    }
                }
            }
            
        } catch (error) {
            console.error(`Error analyzing control flow in ${filePath}:`, error);
        }
        
        return relationships;
    }
    
    /**
     * Parse code into an AST
     * @param filePath Path to the file
     * @param fileContent Content of the file
     * @returns Parsed AST
     */
    private parseCode(filePath: string, fileContent: string): any {
        try {
            const ext = path.extname(filePath).toLowerCase();
            const plugins: any[] = [];
            
            // Add appropriate plugins based on file extension
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
     * @param type Type of control structure
     * @param path NodePath object for the control structure
     * @param debtsInFile List of debt items in the file
     * @param controlStructures List to store control structures in debt contexts
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
        }[]
    ): void {
        const node = path.node;
        const loc = node.loc;
        
        if (loc) {
            // Find the debt context for this control structure
            const debtContext = this.findDebtAtLocation(debtsInFile, loc.start.line);
            
            if (debtContext) {
                // Find all lines affected by this control structure
                const affectedLines = new Set<number>();
                
                // For simplicity, we consider all lines in the body of the control structure
                // as affected by it. For a more precise analysis, a full control flow graph
                // would be needed.
                this.collectLinesInNode(node, affectedLines);
                
                controlStructures.push({
                    type,
                    node,
                    debt: debtContext,
                    affects: affectedLines
                });
            }
        }
    }
    
    /**
     * Collect all line numbers in a node and its children
     * @param node AST node
     * @param lines Set to collect line numbers
     */
    private collectLinesInNode(node: t.Node, lines: Set<number>): void {
        if (node.loc) {
            // Add all lines in this node's range
            for (let i = node.loc.start.line; i <= node.loc.end.line; i++) {
                lines.add(i);
            }
        }
        
        // Recursively process child nodes
        for (const key in node) {
            const child = (node as any)[key];
            
            if (child && typeof child === 'object') {
                if (Array.isArray(child)) {
                    // Process array of nodes
                    for (const item of child) {
                        if (item && typeof item === 'object' && 'type' in item) {
                            this.collectLinesInNode(item, lines);
                        }
                    }
                } else if ('type' in child) {
                    // Process single node
                    this.collectLinesInNode(child, lines);
                }
            }
        }
    }
    
    /**
     * Find a technical debt item at a specific line
     * @param debtsInFile List of debt items in the file
     * @param line Line number
     * @returns Technical debt item at the line or undefined
     */
    private findDebtAtLocation(debtsInFile: TechnicalDebt[], line: number): TechnicalDebt | undefined {
        // Get the context of each debt (5 lines before and after)
        return debtsInFile.find(debt => {
            const debtContextStart = Math.max(1, debt.line - 5);
            const debtContextEnd = debt.line + 5;
            return line >= debtContextStart && line <= debtContextEnd;
        });
    }
}