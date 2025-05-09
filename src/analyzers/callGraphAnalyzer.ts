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
                fileContentMap
            );
            
            relationships.push(...callRelationships);
        }
        
        // Add this new section to analyze inter-file Python relationships
        const pythonInterFileRelationships = await this.findPythonInterFileRelationships(
            debtByFile,
            fileContentMap
        );
        relationships.push(...pythonInterFileRelationships);
        
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
    private isParsableFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return ['.js', '.jsx', '.ts', '.tsx', '.py'].includes(ext);
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
            
            // For Python files, we need a different approach since Babel doesn't support Python
            if (ext === '.py') {
                // Basic parsing for Python files
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
        // A very simple Python parser that just identifies function definitions and calls
        const ast: { type: string; body: { type: string; id: { name: string }; loc: { start: { line: number }; end: { line: number } }; calls: string[] }[] } = {
            type: 'Program',
            body: []
        };
        
        const lines = fileContent.split('\n');
        const functions: {[name: string]: {start: number, end: number, calls: string[]}} = {};
        let currentFunction: string | null = null;
        let indentLevel = 0;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNumber = i + 1;
            
            // Skip empty lines
            if (line.trim() === '') continue;
            
            // Calculate indent level
            const currentIndent = line.length - line.trimLeft().length;
            
            // Detect function definition
            const funcDefMatch = line.match(/^\s*def\s+([a-zA-Z0-9_]+)\s*\(/);
            if (funcDefMatch) {
                currentFunction = funcDefMatch[1];
                indentLevel = currentIndent;
                functions[currentFunction] = {
                    start: lineNumber,
                    end: lineNumber, // Will be updated when the function ends
                    calls: []
                };
                continue;
            }
            
            // Check if we're exiting a function based on indentation
            if (currentFunction && currentIndent <= indentLevel && !line.trim().startsWith('#')) {
                functions[currentFunction].end = lineNumber - 1;
                currentFunction = null;
            }
            
            // Detect function calls within a function
            if (currentFunction) {
                const funcCallMatches = line.match(/([a-zA-Z0-9_]+)\s*\(/g);
                if (funcCallMatches) {
                    for (const match of funcCallMatches) {
                        const funcName = match.replace(/\s*\($/, '');
                        if (funcName !== currentFunction) { // Avoid self-recursion detection
                            functions[currentFunction].calls.push(funcName);
                        }
                    }
                }
            }
        }
        
        // If we ended the file inside a function, close it
        if (currentFunction) {
            functions[currentFunction].end = lines.length;
        }
        
        // Build the AST representation
        for (const [name, data] of Object.entries(functions)) {
            ast.body.push({
                type: 'FunctionDeclaration',
                id: { name },
                loc: {
                    start: { line: data.start },
                    end: { line: data.end }
                },
                calls: data.calls
            });
        }
        
        return ast;
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
            const ext = path.extname(filePath).toLowerCase();
            
            if (ast && ext === '.py') {
                // Process Python function calls within the same file
                for (const node of ast.body) {
                    if (node.type === 'FunctionDeclaration') {
                        const funcName = node.id.name;
                        
                        // Use both plain function name and qualified name
                        const qualifiedName = `${filePath}:${funcName}`;
                        
                        // Check if this function has debt
                        if (methodsWithDebt.has(funcName) || methodsWithDebt.has(qualifiedName)) {
                            const callerDebt = methodsWithDebt.get(funcName) || methodsWithDebt.get(qualifiedName)!;
                            
                            // Check each call from this function
                            for (const calledFunc of node.calls || []) {
                                // Check if the called function has debt
                                if (methodsWithDebt.has(calledFunc)) {
                                    const calleeDebt = methodsWithDebt.get(calledFunc)!;
                                    
                                    // Create relationships
                                    for (const sourceDebt of callerDebt) {
                                        for (const targetDebt of calleeDebt) {
                                            // Skip self-relationships
                                            if (sourceDebt.id === targetDebt.id) continue;
                                            
                                            relationships.push({
                                                sourceId: sourceDebt.id,
                                                targetId: targetDebt.id,
                                                types: [RelationshipType.CALL_GRAPH],
                                                strength: 0.8, // Call graph relationships are strong
                                                description: `SATD in function ${funcName} calls function ${calledFunc} which contains another SATD.`
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } else if (ast && ['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
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
            }
            
        } catch (error) {
            console.error(`Error analyzing method calls in ${filePath}:`, error);
        }
        
        return relationships;
    }

     /**
     * Find inter-file relationships between Python files
     * @param debtByFile Map of file paths to debt items in them
     * @param fileContentMap Map of file paths to their content
     * @returns List of call graph relationships between files
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
            
            const functions = this.extractPythonFunctions(fileContent, filePath, debtsInFile);
            // Ensure filePath used as key is consistent (e.g., relative to workspaceRoot)
            // For simplicity, assuming filePaths from debtByFile are already in a consistent format.
            functionsByModule.set(filePath, functions);
        }
        
        for (const [filePath, functions] of functionsByModule.entries()) {
            const fileContent = fileContentMap.get(filePath);
            if (!fileContent) continue;
            
            const imports = this.extractPythonImports(fileContent);
            
            for (const func of functions) {
                if (func.debtItems.length === 0) continue;
                
                // Process intra-file calls (assuming this part is working as per problem description)
                this.processPythonIntraFileCalls(func, functions, relationships);
                
                // Process inter-file calls
                // This replaces the old processPythonInterFileCalls and its problematic special case
                for (const calledFuncName of func.calls) {
                    for (const importInfo of imports) {
                        let targetModulePath: string | null = null;
                        let resolvedFunctionName = calledFuncName; // By default, the function name is as called

                        if (importInfo.imported && importInfo.imported.includes(calledFuncName)) {
                            // Case: from module import funcName
                            // calledFuncName is 'funcName', importInfo.module is 'module'
                            targetModulePath = this.resolvePythonImport(filePath, importInfo.module, functionsByModule.keys());
                        } else if (!importInfo.imported) {
                            // Case: import module (then called as module.funcName)
                            // Here, calledFuncName might be "module.funcName" if AST captured it that way,
                            // or just "funcName" if it's a simple call and `module` is the prefix.
                            // For simplicity, if calledFuncName is prefixed like "module.function", split it.
                            const parts = calledFuncName.split('.');
                            if (parts.length > 1 && parts[0] === importInfo.module) {
                                resolvedFunctionName = parts.slice(1).join('.'); // Actual function name
                                targetModulePath = this.resolvePythonImport(filePath, importInfo.module, functionsByModule.keys());
                            } else if (parts.length === 1 && importInfo.module === calledFuncName && functionsByModule.has(calledFuncName + '.py')) {
                                // This could be an import of a module that is then called, but less common for direct function calls.
                                // This case needs more robust parsing of call sites (e.g. `module_name()`)
                                // For now, we focus on explicit function calls from resolved modules.
                            }
                        }

                        if (targetModulePath && functionsByModule.has(targetModulePath)) {
                            const targetFunctions = functionsByModule.get(targetModulePath)!;
                            const calledFunc = targetFunctions.find(f => f.name === resolvedFunctionName);

                            if (calledFunc && calledFunc.debtItems.length > 0) {
                                for (const sourceDebt of func.debtItems) {
                                    for (const targetDebt of calledFunc.debtItems) {
                                        if (sourceDebt.id === targetDebt.id) continue;
                                        relationships.push({
                                            sourceId: sourceDebt.id,
                                            targetId: targetDebt.id,
                                            types: [RelationshipType.CALL_GRAPH],
                                            strength: 0.9,
                                            description: `SATD in function ${func.name} (${this.getRelativePath(filePath)}) calls function ${calledFunc.name} in ${this.getRelativePath(targetModulePath)} which contains another SATD.`
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
    // For each function call made by this function
    for (const calledFuncName of func.calls) {
        // Find the called function in the same file
        const calledFunc = allFunctionsInFile.find(f => f.name === calledFuncName);
        if (!calledFunc || calledFunc.debtItems.length === 0) continue;
        
        // Create relationships between SATD in caller and callee
        for (const sourceDebt of func.debtItems) {
            for (const targetDebt of calledFunc.debtItems) {
                // Skip self-relationships
                if (sourceDebt.id === targetDebt.id) continue;
                
                relationships.push({
                    sourceId: sourceDebt.id,
                    targetId: targetDebt.id,
                    types: [RelationshipType.CALL_GRAPH],
                    strength: 0.8, // Call graph relationships are strong
                    description: `SATD in function ${func.name} calls function ${calledFunc.name} which contains another SATD.`
                });
            }
        }
    }
}

/**
 * Extract functions, their locations, and function calls from Python code
 */
private extractPythonFunctions(
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
    // Temporary array to hold functions without debtItems
    const tempFunctions: {
        name: string;
        startLine: number;
        endLine: number;
        calls: string[];
    }[] = [];
    
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
        
        // Skip empty lines
        if (line.trim() === '') continue;
        
        // Calculate indent level
        const currentIndent = line.length - line.trimLeft().length;
        
        // Detect function definition
        const funcDefMatch = line.match(/^\s*def\s+([a-zA-Z0-9_]+)\s*\(/);
        if (funcDefMatch) {
            if (currentFunction) {
                // Close the previous function
                currentFunction.endLine = lineNumber - 1;
                tempFunctions.push(currentFunction);
            }
            
            currentFunction = {
                name: funcDefMatch[1],
                startLine: lineNumber,
                endLine: lineNumber, // Will be updated later
                calls: []
            };
            indentLevel = currentIndent;
            continue;
        }
        
        // Check if we're exiting a function based on indentation
        if (currentFunction && currentIndent <= indentLevel && !line.trim().startsWith('#')) {
            currentFunction.endLine = lineNumber - 1;
            tempFunctions.push(currentFunction);
            currentFunction = null;
        }
        
        // Detect function calls within a function
        if (currentFunction) {
            const funcCallMatches = line.match(/([a-zA-Z0-9_]+)\s*\(/g);
            if (funcCallMatches) {
                for (const match of funcCallMatches) {
                    const funcName = match.replace(/\s*\($/, '');
                    if (funcName !== currentFunction.name) { // Avoid self-recursion detection
                        if (!currentFunction.calls.includes(funcName)) {
                            currentFunction.calls.push(funcName);
                        }
                    }
                }
            }
        }
    }
    
    // If we ended the file inside a function, close it
    if (currentFunction) {
        currentFunction.endLine = lines.length;
        tempFunctions.push(currentFunction);
    }
    
    // Create the functions array with debtItems
    const functions: {
        name: string;
        startLine: number;
        endLine: number;
        calls: string[];
        debtItems: TechnicalDebt[];
    }[] = [];
    
    // Associate debt items with functions
    for (const func of tempFunctions) {
        const debtItems = debtsInFile.filter(debt => {
            // Include debt in the function body
            if (debt.line >= func.startLine && debt.line <= func.endLine) {
                return true;
            }
            
            // Include debt comments just above the function (within 2 lines)
            if (debt.line >= func.startLine - 2 && debt.line < func.startLine) {
                return true;
            }
            
            return false;
        });
        
        functions.push({
            ...func,
            debtItems
        });
    }
    
    return functions;
}


    /**currentFunction
     * Extract Python import statements from file content
     * @param fileContent Content of the Python file
     * @returns List of import information
     */
    private extractPythonImports(fileContent: string): Array<{
        module: string;
        imported?: string[];
    }> {
        const imports: Array<{ module: string; imported?: string[] }> = [];
        const lines = fileContent.split('\n');
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            // Skip non-import lines and comments
            if (!trimmedLine.startsWith('import') && !trimmedLine.startsWith('from') || trimmedLine.startsWith('#')) {
                continue;
            }
            
            // Handle simple imports: "import module"
            const importMatch = trimmedLine.match(/^import\s+([a-zA-Z0-9_.]+)/);
            if (importMatch) {
                imports.push({ module: importMatch[1] });
                continue;
            }
            
            // Handle "from module import ..." syntax
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
     * Resolve a Python import to an actual file path.
     * This version emphasizes consistent normalization and clear lookup strategies.
     * @param currentFilePath Path of the current file (absolute).
     * @param importedModule Name of the imported module (e.g., "myModule" or "myPackage.myModule").
     * @param existingModuleKeys Iterable of absolute file paths for all known Python modules.
     * @returns Resolved absolute file path or null.
     */
    private resolvePythonImport(currentFilePath: string, importedModule: string, existingModuleKeys: Iterable<string>): string | null {
        if (!this.workspaceRoot) {
            console.warn("Workspace root is not set. Python import resolution might be unreliable.");
            return null;
        }

        // Create a normalized set of known relative module paths from the absolute paths.
        // These paths are relative to the workspace root and used as the ground truth.
        const knownRelativeFilePaths = new Set<string>();
        const originalKeysByRelativePath = new Map<string, string>();

        for (const key of existingModuleKeys) {
            const relativePath = this.getRelativePath(key); // Should be canonical relative to workspace root
            if (relativePath) { // Ensure getRelativePath didn't return the original absolute path due to error
                const normalizedRelativePath = path.normalize(relativePath); // Extra normalization for safety
                knownRelativeFilePaths.add(normalizedRelativePath);
                if (!originalKeysByRelativePath.has(normalizedRelativePath)) {
                    originalKeysByRelativePath.set(normalizedRelativePath, key);
                }
            }
        }
        
        const currentFileRelativePath = this.getRelativePath(currentFilePath);
        if (!currentFileRelativePath) {
            console.warn(`Could not get relative path for current file: ${currentFilePath}`);
            return null; // Cannot proceed without a relative context for the current file
        }
        const currentDirRelative = path.dirname(currentFileRelativePath);

        // Strategy 1: Handle relative imports (e.g., "from . import my_sibling" or "from ..parent_module import something")
        if (importedModule.startsWith('.')) {
            let dots = 0;
            let moduleNamePart = importedModule;
            while(moduleNamePart.startsWith('.')) {
                dots++;
                moduleNamePart = moduleNamePart.substring(1);
            }

            let baseDir = currentDirRelative;
            // For "from . import X", currentDirRelative is the base.
            // For "from .. import X", we need to go up one level from currentDirRelative.
            for (let i = 1; i < dots; i++) { // Start at 1 because one dot means current package
                baseDir = path.dirname(baseDir);
            }
            
            const potentialModulePaths: string[] = [];
            if (moduleNamePart) { // from .module import ...
                potentialModulePaths.push(path.join(baseDir, moduleNamePart + '.py'));
                potentialModulePaths.push(path.join(baseDir, moduleNamePart, '__init__.py'));
            } else { // from . import specific_function (module is the __init__.py of currentDir)
                potentialModulePaths.push(path.join(baseDir, '__init__.py'));
            }
            
            for (const attempt of potentialModulePaths) {
                const normalizedAttempt = path.normalize(attempt);
                if (knownRelativeFilePaths.has(normalizedAttempt)) {
                    return originalKeysByRelativePath.get(normalizedAttempt) || null;
                }
            }
        } else {
            // Strategy 2: Handle absolute imports (e.g., "import myModule" or "from myPackage import myModule")
            // These are resolved relative to the workspace root or Python's search path (approximated here by workspace root).

            const modulePathParts = importedModule.split('.');
            
            // Attempt 2a: Resolve as a file (myModule.py) or package (myModule/__init__.py)
            // This covers "import printData" -> "printData.py"
            // And "import package" -> "package/__init__.py"
            // And "import package.module" -> "package/module.py"
            const directFilePath = path.join(...modulePathParts) + '.py';
            const packageInitPath = path.join(...modulePathParts, '__init__.py');

            const potentialAbsolutePaths = [directFilePath, packageInitPath];

            for (const attempt of potentialAbsolutePaths) {
                const normalizedAttempt = path.normalize(attempt);
                if (knownRelativeFilePaths.has(normalizedAttempt)) {
                    return originalKeysByRelativePath.get(normalizedAttempt) || null;
                }
            }

            // Attempt 2b: If current file is in a subdirectory, try resolving relative to that dir first,
            // then bubble up to workspace root. This handles cases where a module might be resolved
            // as a sibling before a top-level module of the same name.
            // Example: project/src/utils.py, project/utils.py. Inside src/main.py, "import utils" might mean src/utils.py
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

        // Fallback for the original problematic case: "from printData import print_data"
        // where importedModule is "printData". We expect "printData.py" at the top level or sibling.
        // This is largely covered by Strategy 2a if paths are simple.
        // The previous logic had a specific section:
        // const directModuleFile = `${importedModule}.py`;
        // This is essentially path.normalize(importedModule + ".py") if importedModule has no dots.
        // Let's ensure this very direct case is checked if importedModule is simple.
        if (!importedModule.includes('.')) {
            const simpleModuleFile = path.normalize(importedModule + ".py");
            if (knownRelativeFilePaths.has(simpleModuleFile)) {
                 return originalKeysByRelativePath.get(simpleModuleFile) || null;
            }
        }
        
        // If still not found, log for debugging if necessary
        // console.debug(`Python module ${importedModule} not found in known paths for file ${currentFilePath}. Known paths: ${Array.from(knownRelativeFilePaths)}`);
        return null; // Module could not be resolved
    }

    // Ensure getRelativePath is robust:
    private getRelativePath(filePath: string): string {
        if (this.workspaceRoot && filePath.startsWith(this.workspaceRoot)) {
            const relPath = path.relative(this.workspaceRoot, filePath);
            // path.relative might return an empty string if filePath IS workspaceRoot, handle this if it's a file.
            // It typically doesn't produce leading './' but normalize just in case.
            return path.normalize(relPath);
        }
        // If not under workspaceRoot, or workspaceRoot is null, it's harder to get a consistent relative path.
        // Returning the filePath as is might lead to inconsistencies if some are absolute and others are not.
        // For this analyzer, we expect files to be within the workspace.
        console.warn(`File path ${filePath} is not within the workspace root ${this.workspaceRoot} or workspace root is not set.`);
        return filePath; // Or consider returning null/empty to signal an issue earlier.
    }
}