// src/analyzers/callGraphAnalyzer.ts
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
 * Analyzes method/function call relationships between technical debt items.
 * If SATD A is in method m1 which calls method m2 containing SATD B, 
 * this forms a potential link with call dependency weight (0.7-0.9).
 */
export class CallGraphAnalyzer {
    private workspaceRoot: string | null = null;
    private maxHops: number = MAX_DEPENDENCY_HOPS;
    
    /**
     * Initialize the analyzer with workspace root
     * @param workspaceRoot Root directory of the workspace
     */
    public async initialize(workspaceRoot: string): Promise<void> {
        this.workspaceRoot = workspaceRoot;
    }
    
    /**
     * Set maximum hop count for dependency analysis
     * @param hops Maximum number of hops (default: 5)
     */
    public setMaxHops(hops: number): void {
        this.maxHops = Math.min(hops, MAX_DEPENDENCY_HOPS);
    }
    
    /**
     * Find relationships between technical debt items based on call graphs
     * @param debtItems List of technical debt items to analyze
     * @param fileContentMap Map of file paths to their content
     * @returns List of call graph relationships with weighted edges
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
        
        // Build call graph for all files
        const callGraph = await this.buildCallGraph(debtByFile, fileContentMap);
        
        // First analyze intra-file relationships
        for (const [filePath, debtsInFile] of debtByFile.entries()) {
            const fileContent = fileContentMap.get(filePath);
            if (!fileContent) continue;
            
            // Skip files based on extension
            if (!this.isParsableFile(filePath)) {
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
                fileContentMap,
                callGraph
            );
            
            relationships.push(...callRelationships);
        }
        
        // Add inter-file Python relationships
        const pythonInterFileRelationships = await this.findPythonInterFileRelationships(
            debtByFile,
            fileContentMap
        );
        relationships.push(...pythonInterFileRelationships);
        
        return relationships;
    }
    
    /**
     * Build a call graph for dependency path checking
     */
    private async buildCallGraph(
        debtByFile: Map<string, TechnicalDebt[]>,
        fileContentMap: Map<string, string>
    ): Promise<Map<string, Set<string>>> {
        const callGraph = new Map<string, Set<string>>();
        
        for (const [filePath, debtsInFile] of debtByFile.entries()) {
            const fileContent = fileContentMap.get(filePath);
            if (!fileContent || !this.isParsableFile(filePath)) continue;
            
            const functions = this.extractFunctions(filePath, fileContent);
            for (const func of functions) {
                const funcId = `${filePath}:${func.name}`;
                if (!callGraph.has(funcId)) {
                    callGraph.set(funcId, new Set());
                }
                for (const call of func.calls) {
                    callGraph.get(funcId)!.add(call);
                }
            }
        }
        
        return callGraph;
    }
    
    /**
     * Check if dependency exists within k hops
     * DependencyExists(t_i, t_j, r, k) from Algorithm 2
     */
    public checkDependencyWithinHops(
        sourceFunc: string,
        targetFunc: string,
        callGraph: Map<string, Set<string>>,
        maxHops: number = this.maxHops
    ): { exists: boolean; hops: number } {
        if (sourceFunc === targetFunc) {
            return { exists: true, hops: 0 };
        }
        
        // BFS to find shortest path
        const visited = new Set<string>();
        const queue: Array<{ func: string; hops: number }> = [{ func: sourceFunc, hops: 0 }];
        
        while (queue.length > 0) {
            const { func, hops } = queue.shift()!;
            
            if (hops >= maxHops) continue;
            if (visited.has(func)) continue;
            visited.add(func);
            
            const calls = callGraph.get(func) || new Set();
            for (const calledFunc of calls) {
                if (calledFunc === targetFunc) {
                    return { exists: true, hops: hops + 1 };
                }
                if (!visited.has(calledFunc)) {
                    queue.push({ func: calledFunc, hops: hops + 1 });
                }
            }
        }
        
        return { exists: false, hops: -1 };
    }
    
    /**
     * Calculate edge weight based on hop count
     * Closer relationships have higher weights
     */
    private calculateEdgeWeight(hops: number): number {
        const weights = DEFAULT_RELATIONSHIP_WEIGHTS[RelationshipType.CALL];
        // Weight decreases with hop count: max at 1 hop, min at maxHops
        const range = weights.max - weights.min;
        const normalizedHops = Math.min(hops, this.maxHops) / this.maxHops;
        return weights.max - (range * normalizedHops);
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
     * Check if a file is a JavaScript, TypeScript, or Python file
     * @param filePath Path to the file
     * @returns True if the file is parsable
     */
    private isParsableFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return ['.js', '.jsx', '.ts', '.tsx', '.py'].includes(ext);
    }
    
    /**
     * Extract functions from a file
     */
    private extractFunctions(filePath: string, fileContent: string): Array<{
        name: string;
        startLine: number;
        endLine: number;
        calls: string[];
    }> {
        const ext = path.extname(filePath).toLowerCase();
        
        if (ext === '.py') {
            return this.extractPythonFunctions(fileContent);
        } else {
            return this.extractJSFunctions(filePath, fileContent);
        }
    }
    
    /**
     * Extract functions from Python file
     */
    private extractPythonFunctions(fileContent: string): Array<{
        name: string;
        startLine: number;
        endLine: number;
        calls: string[];
    }> {
        const functions: Array<{
            name: string;
            startLine: number;
            endLine: number;
            calls: string[];
        }> = [];
        
        const lines = fileContent.split('\n');
        let currentFunction: {
            name: string;
            startLine: number;
            endLine: number;
            calls: string[];
        } | null = null;
        let indentLevel = 0;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNumber = i + 1;
            
            if (line.trim() === '') continue;
            
            const currentIndent = line.length - line.trimStart().length;
            
            const funcDefMatch = line.match(/^\s*def\s+([a-zA-Z0-9_]+)\s*\(/);
            if (funcDefMatch) {
                if (currentFunction) {
                    currentFunction.endLine = lineNumber - 1;
                    functions.push(currentFunction);
                }
                
                currentFunction = {
                    name: funcDefMatch[1],
                    startLine: lineNumber,
                    endLine: lineNumber,
                    calls: []
                };
                indentLevel = currentIndent;
                continue;
            }
            
            if (currentFunction && currentIndent <= indentLevel && !line.trim().startsWith('#')) {
                currentFunction.endLine = lineNumber - 1;
                functions.push(currentFunction);
                currentFunction = null;
            }
            
            if (currentFunction) {
                const funcCallMatches = line.match(/([a-zA-Z0-9_]+)\s*\(/g);
                if (funcCallMatches) {
                    for (const match of funcCallMatches) {
                        const funcName = match.replace(/\s*\($/, '');
                        if (funcName !== currentFunction.name && !currentFunction.calls.includes(funcName)) {
                            currentFunction.calls.push(funcName);
                        }
                    }
                }
            }
        }
        
        if (currentFunction) {
            currentFunction.endLine = lines.length;
            functions.push(currentFunction);
        }
        
        return functions;
    }
    
    /**
     * Extract functions from JavaScript/TypeScript file
     */
    private extractJSFunctions(filePath: string, fileContent: string): Array<{
        name: string;
        startLine: number;
        endLine: number;
        calls: string[];
    }> {
        const functions: Array<{
            name: string;
            startLine: number;
            endLine: number;
            calls: string[];
        }> = [];
        
        try {
            const ast = this.parseCode(filePath, fileContent);
            if (!ast) return functions;
            
            traverse(ast, {
                FunctionDeclaration: (path) => {
                    const node = path.node;
                    if (node.id && node.loc) {
                        const func = {
                            name: node.id.name,
                            startLine: node.loc.start.line,
                            endLine: node.loc.end.line,
                            calls: this.extractCallsFromNode(path)
                        };
                        functions.push(func);
                    }
                },
                ArrowFunctionExpression: (path) => {
                    let name = 'anonymous';
                    if (path.parent.type === 'VariableDeclarator' && t.isIdentifier(path.parent.id)) {
                        name = path.parent.id.name;
                    }
                    if (path.node.loc && name !== 'anonymous') {
                        const func = {
                            name,
                            startLine: path.node.loc.start.line,
                            endLine: path.node.loc.end.line,
                            calls: this.extractCallsFromNode(path)
                        };
                        functions.push(func);
                    }
                },
                ClassMethod: (path) => {
                    const node = path.node;
                    if (t.isIdentifier(node.key) && node.loc) {
                        let className = '';
                        const classParent = path.findParent(p => p.isClassDeclaration());
                        if (classParent && classParent.node.type === 'ClassDeclaration' && classParent.node.id) {
                            className = classParent.node.id.name + '.';
                        }
                        const func = {
                            name: className + node.key.name,
                            startLine: node.loc.start.line,
                            endLine: node.loc.end.line,
                            calls: this.extractCallsFromNode(path)
                        };
                        functions.push(func);
                    }
                }
            });
        } catch (error) {
            console.error(`Error extracting functions from ${filePath}:`, error);
        }
        
        return functions;
    }
    
    /**
     * Extract function calls from AST node
     */
    private extractCallsFromNode(path: NodePath): string[] {
        const calls: string[] = [];
        
        path.traverse({
            CallExpression: (callPath) => {
                if (t.isIdentifier(callPath.node.callee)) {
                    const name = callPath.node.callee.name;
                    if (!calls.includes(name)) {
                        calls.push(name);
                    }
                } else if (t.isMemberExpression(callPath.node.callee) && t.isIdentifier(callPath.node.callee.property)) {
                    const name = callPath.node.callee.property.name;
                    if (!calls.includes(name)) {
                        calls.push(name);
                    }
                }
            }
        });
        
        return calls;
    }
    
    /**
     * Identify methods/functions in a file and which debt items are in them
     */
    private async identifyMethodsWithDebt(
        filePath: string, 
        fileContent: string,
        debtsInFile: TechnicalDebt[]
    ): Promise<Map<string, TechnicalDebt[]>> {
        const methodsWithDebt = new Map<string, TechnicalDebt[]>();
        
        try {
            const ast = this.parseCode(filePath, fileContent);
            if (!ast) return methodsWithDebt;
            
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
            
            if (ext === '.py') {
                return this.parsePythonCode(fileContent);
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

    private parsePythonCode(fileContent: string): any {
        const ast: { type: string; body: any[] } = {
            type: 'Program',
            body: []
        };
        
        const functions = this.extractPythonFunctions(fileContent);
        
        for (const func of functions) {
            ast.body.push({
                type: 'FunctionDeclaration',
                id: { name: func.name },
                loc: {
                    start: { line: func.startLine },
                    end: { line: func.endLine }
                },
                calls: func.calls
            });
        }
        
        return ast;
    }
    
    /**
     * Process a function declaration and check if it contains debt items
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
     */
    private processFunctionExpression(
        node: t.FunctionExpression | t.ArrowFunctionExpression, 
        path: NodePath<t.FunctionExpression | t.ArrowFunctionExpression>,
        debtsInFile: TechnicalDebt[],
        methodsWithDebt: Map<string, TechnicalDebt[]>
    ): void {
        let functionName = 'anonymous';
        
        if (path.parent.type === 'VariableDeclarator' && t.isIdentifier(path.parent.id)) {
            functionName = path.parent.id.name;
        } else if (path.parent.type === 'ObjectProperty' && t.isIdentifier(path.parent.key)) {
            functionName = path.parent.key.name;
        } else if (path.parent.type === 'AssignmentExpression' && t.isIdentifier(path.parent.left)) {
            functionName = path.parent.left.name;
        }
        
        const loc = node.loc;
        
        if (loc) {
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
     */
    private processMethod(
        node: t.ClassMethod | t.ObjectMethod, 
        path: NodePath<t.ClassMethod | t.ObjectMethod>,
        debtsInFile: TechnicalDebt[],
        methodsWithDebt: Map<string, TechnicalDebt[]>
    ): void {
        let methodName = 'anonymous';
        
        if (t.isIdentifier(node.key)) {
            methodName = node.key.name;
        } else if (t.isStringLiteral(node.key)) {
            methodName = node.key.value;
        }
        
        let className = '';
        let parent = path.findParent(p => p.isClassDeclaration());
        
        if (parent && parent.node.type === 'ClassDeclaration' && parent.node.id) {
            className = parent.node.id.name;
            methodName = `${className}.${methodName}`;
        }
        
        const loc = node.loc;
        
        if (loc) {
            const debtsInMethod = debtsInFile.filter(debt => {
                return debt.line >= loc.start.line && debt.line <= loc.end.line;
            });
            
            if (debtsInMethod.length > 0) {
                methodsWithDebt.set(methodName, debtsInMethod);
            }
        }
    }
    
    /**
     * Find method call relationships with weighted edges
     */
    private async findMethodCallRelationships(
        filePath: string,
        fileContent: string,
        methodsWithDebt: Map<string, TechnicalDebt[]>,
        debtByFile: Map<string, TechnicalDebt[]>,
        fileContentMap: Map<string, string>,
        callGraph: Map<string, Set<string>>
    ): Promise<SatdRelationship[]> {
        const relationships: SatdRelationship[] = [];
        
        try {
            const ast = this.parseCode(filePath, fileContent);
            if (!ast) return relationships;
            
            let currentMethod: string | null = null;
            const ext = path.extname(filePath).toLowerCase();
            
            if (ast && ext === '.py') {
                for (const node of ast.body) {
                    if (node.type === 'FunctionDeclaration') {
                        const funcName = node.id.name;
                        
                        if (methodsWithDebt.has(funcName)) {
                            const callerDebt = methodsWithDebt.get(funcName)!;
                            
                            for (const calledFunc of node.calls || []) {
                                if (methodsWithDebt.has(calledFunc)) {
                                    const calleeDebt = methodsWithDebt.get(calledFunc)!;
                                    
                                    for (const sourceDebt of callerDebt) {
                                        for (const targetDebt of calleeDebt) {
                                            if (sourceDebt.id === targetDebt.id) continue;
                                            
                                            // Check hop count
                                            const { exists, hops } = this.checkDependencyWithinHops(
                                                `${filePath}:${funcName}`,
                                                `${filePath}:${calledFunc}`,
                                                callGraph
                                            );
                                            
                                            if (!exists || hops > this.maxHops) continue;
                                            
                                            const weight = this.calculateEdgeWeight(hops);
                                            
                                            const edge: WeightedEdge = {
                                                sourceId: sourceDebt.id,
                                                targetId: targetDebt.id,
                                                type: RelationshipType.CALL,
                                                weight,
                                                hops
                                            };
                                            
                                            relationships.push({
                                                sourceId: sourceDebt.id,
                                                targetId: targetDebt.id,
                                                types: [RelationshipType.CALL],
                                                edges: [edge],
                                                strength: weight,
                                                description: `SATD in function ${funcName} calls function ${calledFunc} which contains another SATD (${hops} hop(s)).`,
                                                hopCount: hops
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } else if (ast && ['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
                traverse(ast, {
                    FunctionDeclaration: {
                        enter(path) {
                            currentMethod = path.node.id?.name || null;
                        },
                        exit() {
                            currentMethod = null;
                        }
                    },
                    ArrowFunctionExpression: {
                        enter(path) {
                            if (path.parent.type === 'VariableDeclarator' && t.isIdentifier(path.parent.id)) {
                                currentMethod = path.parent.id.name;
                            }
                        },
                        exit() {
                            currentMethod = null;
                        }
                    },
                    ClassMethod: {
                        enter(path) {
                            const node = path.node;
                            let methodName = 'anonymous';
                            
                            if (t.isIdentifier(node.key)) {
                                methodName = node.key.name;
                            }
                            
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
                    CallExpression(callPath) {
                        if (currentMethod && methodsWithDebt.has(currentMethod)) {
                            const callerDebt = methodsWithDebt.get(currentMethod)!;
                            
                            let calledMethod = 'unknown';
                            
                            if (t.isIdentifier(callPath.node.callee)) {
                                calledMethod = callPath.node.callee.name;
                            } else if (t.isMemberExpression(callPath.node.callee) && 
                                    t.isIdentifier(callPath.node.callee.property)) {
                                calledMethod = callPath.node.callee.property.name;
                                
                                if (t.isIdentifier(callPath.node.callee.object)) {
                                    const objName = callPath.node.callee.object.name;
                                    calledMethod = `${objName}.${calledMethod}`;
                                }
                            }
                            
                            if (methodsWithDebt.has(calledMethod)) {
                                const calleeDebt = methodsWithDebt.get(calledMethod)!;
                                
                                for (const sourceDebt of callerDebt) {
                                    for (const targetDebt of calleeDebt) {
                                        if (sourceDebt.id === targetDebt.id) continue;
                                        
                                        const weight = DEFAULT_RELATIONSHIP_WEIGHTS[RelationshipType.CALL].default;
                                        
                                        const edge: WeightedEdge = {
                                            sourceId: sourceDebt.id,
                                            targetId: targetDebt.id,
                                            type: RelationshipType.CALL,
                                            weight,
                                            hops: 1
                                        };
                                        
                                        relationships.push({
                                            sourceId: sourceDebt.id,
                                            targetId: targetDebt.id,
                                            types: [RelationshipType.CALL],
                                            edges: [edge],
                                            strength: weight,
                                            description: `SATD in method ${currentMethod} calls method ${calledMethod} which contains another SATD.`,
                                            hopCount: 1
                                        });
                                    }
                                }
                            }
                        }
                    }
                });
            }
            
        } catch (error) {
            console.error(`Error analyzing method calls in ${filePath}:`, error);
        }
        
        return relationships;
    }

    /**
     * Find inter-file relationships between Python files
     */
    private async findPythonInterFileRelationships(
        debtByFile: Map<string, TechnicalDebt[]>,
        fileContentMap: Map<string, string>
    ): Promise<SatdRelationship[]> {
        const relationships: SatdRelationship[] = [];
        
        const functionsByModule = new Map<string, {
            name: string;
            startLine: number;
            endLine: number;
            calls: string[];
            debtItems: TechnicalDebt[];
        }[]>();
        
        for (const [filePath, debtsInFile] of debtByFile.entries()) {
            if (!filePath.endsWith('.py')) continue;
            const fileContent = fileContentMap.get(filePath);
            if (!fileContent) continue;
            
            const functions = this.extractPythonFunctionsWithDebt(fileContent, filePath, debtsInFile);
            functionsByModule.set(filePath, functions);
        }
        
        for (const [filePath, functions] of functionsByModule.entries()) {
            const fileContent = fileContentMap.get(filePath);
            if (!fileContent) continue;
            
            const imports = this.extractPythonImports(fileContent);
            
            for (const func of functions) {
                if (func.debtItems.length === 0) continue;
                
                // Process intra-file calls
                this.processPythonIntraFileCalls(func, functions, relationships);
                
                // Process inter-file calls
                for (const calledFuncName of func.calls) {
                    for (const importInfo of imports) {
                        let targetModulePath: string | null = null;
                        let resolvedFunctionName = calledFuncName;

                        if (importInfo.imported && importInfo.imported.includes(calledFuncName)) {
                            targetModulePath = this.resolvePythonImport(filePath, importInfo.module, functionsByModule.keys());
                        } else if (!importInfo.imported) {
                            const parts = calledFuncName.split('.');
                            if (parts.length > 1 && parts[0] === importInfo.module) {
                                resolvedFunctionName = parts.slice(1).join('.');
                                targetModulePath = this.resolvePythonImport(filePath, importInfo.module, functionsByModule.keys());
                            }
                        }

                        if (targetModulePath && functionsByModule.has(targetModulePath)) {
                            const targetFunctions = functionsByModule.get(targetModulePath)!;
                            const calledFunc = targetFunctions.find(f => f.name === resolvedFunctionName);

                            if (calledFunc && calledFunc.debtItems.length > 0) {
                                for (const sourceDebt of func.debtItems) {
                                    for (const targetDebt of calledFunc.debtItems) {
                                        if (sourceDebt.id === targetDebt.id) continue;
                                        
                                        const weight = DEFAULT_RELATIONSHIP_WEIGHTS[RelationshipType.CALL].max;
                                        
                                        const edge: WeightedEdge = {
                                            sourceId: sourceDebt.id,
                                            targetId: targetDebt.id,
                                            type: RelationshipType.CALL,
                                            weight,
                                            hops: 1
                                        };
                                        
                                        relationships.push({
                                            sourceId: sourceDebt.id,
                                            targetId: targetDebt.id,
                                            types: [RelationshipType.CALL],
                                            edges: [edge],
                                            strength: weight,
                                            description: `SATD in function ${func.name} (${this.getRelativePath(filePath)}) calls function ${calledFunc.name} in ${this.getRelativePath(targetModulePath)} which contains another SATD.`,
                                            hopCount: 1
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        return relationships;
    }

    /**
     * Process relationships between functions in the same Python file
     */
    private processPythonIntraFileCalls(
        func: {
            name: string;
            startLine: number;
            endLine: number;
            calls: string[];
            debtItems: TechnicalDebt[];
        },
        allFunctionsInFile: {
            name: string;
            startLine: number;
            endLine: number;
            calls: string[];
            debtItems: TechnicalDebt[];
        }[],
        relationships: SatdRelationship[]
    ): void {
        for (const calledFuncName of func.calls) {
            const calledFunc = allFunctionsInFile.find(f => f.name === calledFuncName);
            if (!calledFunc || calledFunc.debtItems.length === 0) continue;
            
            for (const sourceDebt of func.debtItems) {
                for (const targetDebt of calledFunc.debtItems) {
                    if (sourceDebt.id === targetDebt.id) continue;
                    
                    const weight = DEFAULT_RELATIONSHIP_WEIGHTS[RelationshipType.CALL].default;
                    
                    const edge: WeightedEdge = {
                        sourceId: sourceDebt.id,
                        targetId: targetDebt.id,
                        type: RelationshipType.CALL,
                        weight,
                        hops: 1
                    };
                    
                    relationships.push({
                        sourceId: sourceDebt.id,
                        targetId: targetDebt.id,
                        types: [RelationshipType.CALL],
                        edges: [edge],
                        strength: weight,
                        description: `SATD in function ${func.name} calls function ${calledFunc.name} which contains another SATD.`,
                        hopCount: 1
                    });
                }
            }
        }
    }

    /**
     * Extract functions with associated debt items from Python code
     */
    private extractPythonFunctionsWithDebt(
        fileContent: string,
        filePath: string,
        debtsInFile: TechnicalDebt[]
    ): {
        name: string;
        startLine: number;
        endLine: number;
        calls: string[];
        debtItems: TechnicalDebt[];
    }[] {
        const functions = this.extractPythonFunctions(fileContent);
        
        return functions.map(func => {
            const debtItems = debtsInFile.filter(debt => {
                if (debt.line >= func.startLine && debt.line <= func.endLine) {
                    return true;
                }
                if (debt.line >= func.startLine - 2 && debt.line < func.startLine) {
                    return true;
                }
                return false;
            });
            
            return {
                ...func,
                debtItems
            };
        });
    }

    /**
     * Extract Python import statements from file content
     */
    private extractPythonImports(fileContent: string): Array<{
        module: string;
        imported?: string[];
    }> {
        const imports: Array<{ module: string; imported?: string[] }> = [];
        const lines = fileContent.split('\n');
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            if (!trimmedLine.startsWith('import') && !trimmedLine.startsWith('from') || trimmedLine.startsWith('#')) {
                continue;
            }
            
            const importMatch = trimmedLine.match(/^import\s+([a-zA-Z0-9_.]+)/);
            if (importMatch) {
                imports.push({ module: importMatch[1] });
                continue;
            }
            
            const fromImportMatch = trimmedLine.match(/^from\s+([a-zA-Z0-9_.]+)\s+import\s+(.+)/);
            if (fromImportMatch) {
                const module = fromImportMatch[1];
                const importedItems = fromImportMatch[2].split(',').map(item => item.trim());
                imports.push({ module, imported: importedItems });
            }
        }
        
        return imports;
    }
    
    /**
     * Resolve a Python import to an actual file path
     */
    private resolvePythonImport(currentFilePath: string, importedModule: string, existingModuleKeys: Iterable<string>): string | null {
        if (!this.workspaceRoot) {
            return null;
        }

        const knownRelativeFilePaths = new Set<string>();
        const originalKeysByRelativePath = new Map<string, string>();

        for (const key of existingModuleKeys) {
            const relativePath = this.getRelativePath(key);
            if (relativePath) {
                const normalizedRelativePath = path.normalize(relativePath);
                knownRelativeFilePaths.add(normalizedRelativePath);
                if (!originalKeysByRelativePath.has(normalizedRelativePath)) {
                    originalKeysByRelativePath.set(normalizedRelativePath, key);
                }
            }
        }
        
        const currentFileRelativePath = this.getRelativePath(currentFilePath);
        if (!currentFileRelativePath) {
            return null;
        }
        const currentDirRelative = path.dirname(currentFileRelativePath);

        if (importedModule.startsWith('.')) {
            let dots = 0;
            let moduleNamePart = importedModule;
            while(moduleNamePart.startsWith('.')) {
                dots++;
                moduleNamePart = moduleNamePart.substring(1);
            }

            let baseDir = currentDirRelative;
            for (let i = 1; i < dots; i++) {
                baseDir = path.dirname(baseDir);
            }
            
            const potentialModulePaths: string[] = [];
            if (moduleNamePart) {
                potentialModulePaths.push(path.join(baseDir, moduleNamePart + '.py'));
                potentialModulePaths.push(path.join(baseDir, moduleNamePart, '__init__.py'));
            } else {
                potentialModulePaths.push(path.join(baseDir, '__init__.py'));
            }
            
            for (const attempt of potentialModulePaths) {
                const normalizedAttempt = path.normalize(attempt);
                if (knownRelativeFilePaths.has(normalizedAttempt)) {
                    return originalKeysByRelativePath.get(normalizedAttempt) || null;
                }
            }
        } else {
            const modulePathParts = importedModule.split('.');
            
            const directFilePath = path.join(...modulePathParts) + '.py';
            const packageInitPath = path.join(...modulePathParts, '__init__.py');

            const potentialAbsolutePaths = [directFilePath, packageInitPath];

            for (const attempt of potentialAbsolutePaths) {
                const normalizedAttempt = path.normalize(attempt);
                if (knownRelativeFilePaths.has(normalizedAttempt)) {
                    return originalKeysByRelativePath.get(normalizedAttempt) || null;
                }
            }

            if (currentDirRelative && currentDirRelative !== '.') {
                 const relativeToCurrentDirFilePath = path.join(currentDirRelative, ...modulePathParts) + '.py';
                 const relativeToCurrentDirPackagePath = path.join(currentDirRelative, ...modulePathParts, '__init__.py');
                 const potentialRelativePaths = [relativeToCurrentDirFilePath, relativeToCurrentDirPackagePath];
                 for (const attempt of potentialRelativePaths) {
                    const normalizedAttempt = path.normalize(attempt);
                    if (knownRelativeFilePaths.has(normalizedAttempt)) {
                        return originalKeysByRelativePath.get(normalizedAttempt) || null;
                    }
                }
            }
        }

        if (!importedModule.includes('.')) {
            const simpleModuleFile = path.normalize(importedModule + ".py");
            if (knownRelativeFilePaths.has(simpleModuleFile)) {
                 return originalKeysByRelativePath.get(simpleModuleFile) || null;
            }
        }
        
        return null;
    }

    private getRelativePath(filePath: string): string {
        if (this.workspaceRoot && filePath.startsWith(this.workspaceRoot)) {
            const relPath = path.relative(this.workspaceRoot, filePath);
            return path.normalize(relPath);
        }
        return filePath;
    }
}
