// src/analyzers/callGraphAnalyzer.ts
import * as vscode from 'vscode';
import { TechnicalDebt, SatdRelationship, RelationshipType } from '../models';
import * as path from 'path';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import { NodePath } from '@babel/traverse';
import * as t from '@babel/types';

/**
 * Analyzes method/function call relationships between technical debt items.
 * If SATD A is in method m1 which calls method m2 containing SATD B, 
 * this forms a potential link.
 */
export class CallGraphAnalyzer {
    private workspaceRoot: string | null = null;
    
    /**
     * Initialize the analyzer with workspace root
     * @param workspaceRoot Root directory of the workspace
     */
    public async initialize(workspaceRoot: string): Promise<void> {
        this.workspaceRoot = workspaceRoot;
    }
    
    /**
     * Find relationships between technical debt items based on call graphs
     * @param debtItems List of technical debt items to analyze
     * @param fileContentMap Map of file paths to their content
     * @returns List of call graph relationships
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
        
        // For each file with debt, analyze its call graph
        for (const [filePath, debtsInFile] of debtByFile.entries()) {
            const fileContent = fileContentMap.get(filePath);
            if (!fileContent) continue;
            
            // Skip files based on extension
            if (!this.isJsOrTsFile(filePath)) {
                continue;
            }
            
            // Identify all methods/functions in the file and which debt items are in them
            const methodsWithDebt = await this.identifyMethodsWithDebt(filePath, fileContent, debtsInFile);
            
            // Find method calls and create relationships if the caller and callee both have debt
            const callRelationships = await this.findMethodCallRelationships(
                filePath, 
                fileContent, 
                methodsWithDebt,
                debtByFile,
                fileContentMap
            );
            
            relationships.push(...callRelationships);
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
     * Identify methods/functions in a file and which debt items are in them
     * @param filePath Path to the file
     * @param fileContent Content of the file
     * @param debtsInFile List of debt items in the file
     * @returns Map of method names to the debt items in them
     */
    private async identifyMethodsWithDebt(
        filePath: string, 
        fileContent: string,
        debtsInFile: TechnicalDebt[]
    ): Promise<Map<string, TechnicalDebt[]>> {
        const methodsWithDebt = new Map<string, TechnicalDebt[]>();
        
        try {
            // Parse the code into an AST
            const ast = this.parseCode(filePath, fileContent);
            if (!ast) return methodsWithDebt;
            
            // Traverse the AST to find methods and functions
            traverse(ast, {
                FunctionDeclaration: (path) => {
                    this.processFunction(path.node, path, debtsInFile, methodsWithDebt);
                },
                ArrowFunctionExpression: (path) => {
                    this.processFunctionExpression(path.node, path, debtsInFile, methodsWithDebt);
                },
                FunctionExpression: (path) => {
                    this.processFunctionExpression(path.node, path, debtsInFile, methodsWithDebt);
                },
                ClassMethod: (path) => {
                    this.processMethod(path.node, path, debtsInFile, methodsWithDebt);
                },
                ObjectMethod: (path) => {
                    this.processMethod(path.node, path, debtsInFile, methodsWithDebt);
                }
            });
            
        } catch (error) {
            console.error(`Error analyzing functions in ${filePath}:`, error);
        }
        
        return methodsWithDebt;
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
     * Process a function declaration and check if it contains debt items
     * @param node Function declaration node
     * @param path NodePath object
     * @param debtsInFile List of debt items in the file
     * @param methodsWithDebt Map to store methods with debt
     */
    private processFunction(
        node: t.FunctionDeclaration, 
        path: NodePath<t.FunctionDeclaration>,
        debtsInFile: TechnicalDebt[],
        methodsWithDebt: Map<string, TechnicalDebt[]>
    ): void {
        const functionName = node.id?.name || 'anonymous';
        const loc = node.loc;
        
        if (loc) {
            // Find debt items that are inside this function
            const debtsInFunction = debtsInFile.filter(debt => {
                return debt.line >= loc.start.line && debt.line <= loc.end.line;
            });
            
            if (debtsInFunction.length > 0) {
                methodsWithDebt.set(functionName, debtsInFunction);
            }
        }
    }
    
    /**
     * Process a function expression and check if it contains debt items
     * @param node Function expression node
     * @param path NodePath object
     * @param debtsInFile List of debt items in the file
     * @param methodsWithDebt Map to store methods with debt
     */
    private processFunctionExpression(
        node: t.FunctionExpression | t.ArrowFunctionExpression, 
        path: NodePath<t.FunctionExpression | t.ArrowFunctionExpression>,
        debtsInFile: TechnicalDebt[],
        methodsWithDebt: Map<string, TechnicalDebt[]>
    ): void {
        // Try to get the name if this is a variable assignment
        let functionName = 'anonymous';
        
        // Check if this is part of a variable declaration
        if (path.parent.type === 'VariableDeclarator' && t.isIdentifier(path.parent.id)) {
            functionName = path.parent.id.name;
        }
        // Check if this is part of an object property
        else if (path.parent.type === 'ObjectProperty' && t.isIdentifier(path.parent.key)) {
            functionName = path.parent.key.name;
        }
        // Check if this is part of an assignment expression
        else if (path.parent.type === 'AssignmentExpression' && t.isIdentifier(path.parent.left)) {
            functionName = path.parent.left.name;
        }
        
        const loc = node.loc;
        
        if (loc) {
            // Find debt items that are inside this function
            const debtsInFunction = debtsInFile.filter(debt => {
                return debt.line >= loc.start.line && debt.line <= loc.end.line;
            });
            
            if (debtsInFunction.length > 0) {
                methodsWithDebt.set(functionName, debtsInFunction);
            }
        }
    }
    
    /**
     * Process a class or object method and check if it contains debt items
     * @param node Method node
     * @param path NodePath object
     * @param debtsInFile List of debt items in the file
     * @param methodsWithDebt Map to store methods with debt
     */
    private processMethod(
        node: t.ClassMethod | t.ObjectMethod, 
        path: NodePath<t.ClassMethod | t.ObjectMethod>,
        debtsInFile: TechnicalDebt[],
        methodsWithDebt: Map<string, TechnicalDebt[]>
    ): void {
        // Get method name
        let methodName = 'anonymous';
        
        if (t.isIdentifier(node.key)) {
            methodName = node.key.name;
        } else if (t.isStringLiteral(node.key)) {
            methodName = node.key.value;
        }
        
        // If this is a class method, add the class name as prefix
        let className = '';
        let parent = path.findParent(p => p.isClassDeclaration());
        
        if (parent && parent.node.type === 'ClassDeclaration' && parent.node.id) {
            className = parent.node.id.name;
            methodName = `${className}.${methodName}`;
        }
        
        const loc = node.loc;
        
        if (loc) {
            // Find debt items that are inside this method
            const debtsInMethod = debtsInFile.filter(debt => {
                return debt.line >= loc.start.line && debt.line <= loc.end.line;
            });
            
            if (debtsInMethod.length > 0) {
                methodsWithDebt.set(methodName, debtsInMethod);
            }
        }
    }
    
    /**
     * Find method call relationships where both the caller and callee have debt
     * @param filePath Path to the file
     * @param fileContent Content of the file
     * @param methodsWithDebt Map of method names to the debt items in them
     * @param debtByFile Map of file paths to debt items in them
     * @param fileContentMap Map of file paths to their content
     * @returns List of call graph relationships
     */
    private async findMethodCallRelationships(
        filePath: string,
        fileContent: string,
        methodsWithDebt: Map<string, TechnicalDebt[]>,
        debtByFile: Map<string, TechnicalDebt[]>,
        fileContentMap: Map<string, string>
    ): Promise<SatdRelationship[]> {
        const relationships: SatdRelationship[] = [];
        
        try {
            // Parse the code into an AST
            const ast = this.parseCode(filePath, fileContent);
            if (!ast) return relationships;
            
            // Track which method we're currently in
            let currentMethod: string | null = null;
            
            // Traverse the AST to find method calls
            traverse(ast, {
                FunctionDeclaration: {
                    enter(path) {
                        const node = path.node;
                        currentMethod = node.id?.name || null;
                    },
                    exit() {
                        currentMethod = null;
                    }
                },
                ArrowFunctionExpression: {
                    enter(path) {
                        // Try to get the name if this is a variable assignment
                        if (path.parent.type === 'VariableDeclarator' && t.isIdentifier(path.parent.id)) {
                            currentMethod = path.parent.id.name;
                        }
                        // Check if this is part of an object property
                        else if (path.parent.type === 'ObjectProperty' && t.isIdentifier(path.parent.key)) {
                            currentMethod = path.parent.key.name;
                        }
                        // Check if this is part of an assignment expression
                        else if (path.parent.type === 'AssignmentExpression' && t.isIdentifier(path.parent.left)) {
                            currentMethod = path.parent.left.name;
                        }
                    },
                    exit() {
                        currentMethod = null;
                    }
                },
                ClassMethod: {
                    enter(path) {
                        const node = path.node;
                        // Get method name
                        let methodName = 'anonymous';
                        
                        if (t.isIdentifier(node.key)) {
                            methodName = node.key.name;
                        } else if (t.isStringLiteral(node.key)) {
                            methodName = node.key.value;
                        }
                        
                        // If this is a class method, add the class name as prefix
                        let className = '';
                        let parent = path.findParent(p => p.isClassDeclaration());
                        
                        if (parent && parent.node.type === 'ClassDeclaration' && parent.node.id) {
                            className = parent.node.id.name;
                            methodName = `${className}.${methodName}`;
                        }
                        
                        currentMethod = methodName;
                    },
                    exit() {
                        currentMethod = null;
                    }
                },
                CallExpression(path) {
                    // If we're in a method with debt and we're calling another method with debt
                    if (currentMethod && methodsWithDebt.has(currentMethod)) {
                        const callerDebt = methodsWithDebt.get(currentMethod)!;
                        
                        // Get the called method name
                        let calledMethod = 'unknown';
                        
                        if (t.isIdentifier(path.node.callee)) {
                            calledMethod = path.node.callee.name;
                        } else if (t.isMemberExpression(path.node.callee) && 
                                  t.isIdentifier(path.node.callee.property)) {
                            // Handle method calls on objects
                            calledMethod = path.node.callee.property.name;
                            
                            // If the object is an identifier, add it as prefix
                            if (t.isIdentifier(path.node.callee.object)) {
                                const objName = path.node.callee.object.name;
                                calledMethod = `${objName}.${calledMethod}`;
                            }
                        }
                        
                        // Check if the called method has debt
                        if (methodsWithDebt.has(calledMethod)) {
                            const calleeDebt = methodsWithDebt.get(calledMethod)!;
                            
                            // Create relationships from each caller debt to each callee debt
                            for (const sourceDebt of callerDebt) {
                                for (const targetDebt of calleeDebt) {
                                    // Skip self-relationships
                                    if (sourceDebt.id === targetDebt.id) continue;
                                    
                                    relationships.push({
                                        sourceId: sourceDebt.id,
                                        targetId: targetDebt.id,
                                        types: [RelationshipType.CALL_GRAPH],
                                        strength: 0.8, // Call graph relationships are strong
                                        description: `SATD in method ${currentMethod} calls method ${calledMethod} which contains another SATD.`
                                    });
                                }
                            }
                        }
                    }
                }
            });
            
        } catch (error) {
            console.error(`Error analyzing method calls in ${filePath}:`, error);
        }
        
        return relationships;
    }
}