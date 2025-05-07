// src/analyzers/dataDependencyAnalyzer.ts
import * as vscode from 'vscode';
import { TechnicalDebt, SatdRelationship, RelationshipType } from '../models';
import * as path from 'path';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import { NodePath } from '@babel/traverse';
import * as t from '@babel/types';

/**
 * Analyzes data dependencies between technical debt items.
 * If data produced or modified by code associated with SATD A 
 * is consumed or used by code associated with SATD B, this forms a potential link.
 */
export class DataDependencyAnalyzer {
    private workspaceRoot: string | null = null;
    
    /**
     * Initialize the analyzer with workspace root
     * @param workspaceRoot Root directory of the workspace
     */
    public async initialize(workspaceRoot: string): Promise<void> {
        this.workspaceRoot = workspaceRoot;
    }
    
    /**
     * Find relationships between technical debt items based on data dependencies
     * @param debtItems List of technical debt items to analyze
     * @param fileContentMap Map of file paths to their content
     * @returns List of data dependency relationships
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
        
        // For each file with debt, analyze its data dependencies
        for (const [filePath, debtsInFile] of debtByFile.entries()) {
            const fileContent = fileContentMap.get(filePath);
            if (!fileContent) continue;
            
            // Skip files based on extension
            if (!this.isJsOrTsFile(filePath)) {
                continue;
            }
            
            // Find data dependencies within the file
            const intraFileRelationships = await this.findIntraFileDataDependencies(
                filePath, 
                fileContent, 
                debtsInFile
            );
            
            relationships.push(...intraFileRelationships);
            
            // TODO: Find inter-file data dependencies (across modules)
            // This would require more complex analysis and potentially
            // tracking exports/imports between files
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
     * Find data dependencies within a single file
     * @param filePath Path to the file
     * @param fileContent Content of the file
     * @param debtsInFile List of debt items in the file
     * @returns List of data dependency relationships
     */
    private async findIntraFileDataDependencies(
        filePath: string, 
        fileContent: string,
        debtsInFile: TechnicalDebt[]
    ): Promise<SatdRelationship[]> {
        const relationships: SatdRelationship[] = [];
        
        try {
            // Parse the code into an AST
            const ast = this.parseCode(filePath, fileContent);
            if (!ast) return relationships;
            
            // Maps for tracking variable declarations and references
            const variableDeclarations = new Map<string, { debt: TechnicalDebt, node: t.Node }>();
            const variableReferences = new Map<string, { debt: TechnicalDebt, node: t.Node }[]>();
            
            // Find variable declarations and references in technical debt contexts
            traverse(ast, {
                VariableDeclarator: (path) => {
                    this.processVariableDeclaration(path, debtsInFile, variableDeclarations);
                },
                AssignmentExpression: (path) => {
                    this.processAssignment(path, debtsInFile, variableDeclarations);
                },
                Identifier: (path) => {
                    this.processIdentifier(path, debtsInFile, variableReferences);
                }
            });
            
            // Create relationships for each variable where a declaration is in one debt context
            // and a reference is in another debt context
            for (const [varName, declaration] of variableDeclarations.entries()) {
                const references = variableReferences.get(varName) || [];
                
                for (const reference of references) {
                    // Skip self-references (debt items referencing themselves)
                    if (declaration.debt.id === reference.debt.id) continue;
                    
                    relationships.push({
                        sourceId: declaration.debt.id,
                        targetId: reference.debt.id,
                        types: [RelationshipType.DATA_DEPENDENCY],
                        strength: 0.7, // Data dependencies are moderately strong
                        description: `SATD in line ${declaration.debt.line} defines or modifies variable '${varName}' which is used by SATD in line ${reference.debt.line}.`
                    });
                }
            }
            
        } catch (error) {
            console.error(`Error analyzing data dependencies in ${filePath}:`, error);
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
     * Process a variable declaration and check if it's in a debt context
     * @param path NodePath object for the variable declarator
     * @param debtsInFile List of debt items in the file
     * @param variableDeclarations Map to store variable declarations in debt contexts
     */
    private processVariableDeclaration(
        path: NodePath<t.VariableDeclarator>,
        debtsInFile: TechnicalDebt[],
        variableDeclarations: Map<string, { debt: TechnicalDebt, node: t.Node }>
    ): void {
        const node = path.node;
        const loc = node.loc;
        
        if (loc && t.isIdentifier(node.id)) {
            const varName = node.id.name;
            const debtContext = this.findDebtAtLocation(debtsInFile, loc.start.line);
            
            if (debtContext) {
                variableDeclarations.set(varName, { debt: debtContext, node });
            }
        }
    }
    
    /**
     * Process an assignment expression and check if it's in a debt context
     * @param path NodePath object for the assignment expression
     * @param debtsInFile List of debt items in the file
     * @param variableDeclarations Map to store variable declarations in debt contexts
     */
    private processAssignment(
        path: NodePath<t.AssignmentExpression>,
        debtsInFile: TechnicalDebt[],
        variableDeclarations: Map<string, { debt: TechnicalDebt, node: t.Node }>
    ): void {
        const node = path.node;
        const loc = node.loc;
        
        if (loc && t.isIdentifier(node.left)) {
            const varName = node.left.name;
            const debtContext = this.findDebtAtLocation(debtsInFile, loc.start.line);
            
            if (debtContext) {
                variableDeclarations.set(varName, { debt: debtContext, node });
            }
        }
    }
    
    /**
     * Process an identifier and check if it's in a debt context
     * @param path NodePath object for the identifier
     * @param debtsInFile List of debt items in the file
     * @param variableReferences Map to store variable references in debt contexts
     */
    private processIdentifier(
        path: NodePath<t.Identifier>,
        debtsInFile: TechnicalDebt[],
        variableReferences: Map<string, { debt: TechnicalDebt, node: t.Node }[]>
    ): void {
        // Skip identifiers in declarations
        if (path.parent.type === 'VariableDeclarator' && path.parent.id === path.node) {
            return;
        }
        
        // Skip identifiers in assignment target
        if (path.parent.type === 'AssignmentExpression' && path.parent.left === path.node) {
            return;
        }
        
        const node = path.node;
        const loc = node.loc;
        
        if (loc) {
            const varName = node.name;
            const debtContext = this.findDebtAtLocation(debtsInFile, loc.start.line);
            
            if (debtContext) {
                if (!variableReferences.has(varName)) {
                    variableReferences.set(varName, []);
                }
                variableReferences.get(varName)!.push({ debt: debtContext, node });
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