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
        
        // Python file analysis (need to handle imports and function calls between files)
        for (const [filePath, debtsInFile] of debtByFile.entries()) {
            // Only process Python files
            if (!filePath.endsWith('.py')) continue;
            
            const fileContent = fileContentMap.get(filePath);
            if (!fileContent) continue;
            
            try {
                // Parse the Python file
                const ast = this.parsePythonCode(fileContent);
                if (!ast) continue;
                
                // Extract module imports
                const imports = this.extractPythonImports(fileContent);
                
                // For each function in the file
                for (const node of ast.body) {
                    if (node.type === 'FunctionDeclaration') {
                        const funcName = node.id.name;
                        
                        // Find debt items in or near this function - same expanded range as in identifyMethodsWithDebt
                        const debtsInFunction = debtsInFile.filter(debt => {
                            // Include debt if it's within 5 lines before or inside the function
                            return (debt.line >= node.loc.start.line - 5 && debt.line <= node.loc.end.line);
                        });
                        
                        if (debtsInFunction.length === 0) continue;
                        
                        // Check function calls
                        for (const calledFunc of node.calls || []) {
                            // Skip built-in function calls and common library functions
                            if (['print', 'len', 'str', 'int', 'float', 'list', 'dict', 'set', 'tuple'].includes(calledFunc)) {
                                continue;
                            }
                            
                            // Check if this is a local call or an imported function call
                            let isLocalCall = false;
                            
                            // Check if the called function is defined in this file
                            for (const otherNode of ast.body) {
                                if (otherNode.type === 'FunctionDeclaration' && otherNode.id.name === calledFunc) {
                                    isLocalCall = true;
                                    break;
                                }
                            }
                            
                            if (!isLocalCall) {
                                // This might be an imported function, check each import
                                for (const importInfo of imports) {
                                    // Check if this import could contain the called function
                                    if (importInfo.imported && importInfo.imported.includes(calledFunc)) {
                                        const importedModulePath = this.resolvePythonImport(filePath, importInfo.module);
                                        if (!importedModulePath) continue;
                                        
                                        // Check if the imported module has debt items
                                        if (debtByFile.has(importedModulePath)) {
                                            const importedContent = fileContentMap.get(importedModulePath);
                                            if (!importedContent) continue;
                                            
                                            const importedAst = this.parsePythonCode(importedContent);
                                            if (!importedAst) continue;
                                            
                                            // Find the called function in the imported module
                                            for (const importedNode of importedAst.body) {
                                                if (importedNode.type === 'FunctionDeclaration' && 
                                                    importedNode.id.name === calledFunc) {
                                                    
                                                    // Find debt items in or near the called function
                                                    const importedDebts = debtByFile.get(importedModulePath)!;
                                                    const debtsInCalledFunction = importedDebts.filter(debt => {
                                                        return (debt.line >= importedNode.loc.start.line - 5 && 
                                                                debt.line <= importedNode.loc.end.line);
                                                    });
                                                    
                                                    if (debtsInCalledFunction.length > 0) {
                                                        // Create relationships between functions
                                                        for (const sourceDebt of debtsInFunction) {
                                                            for (const targetDebt of debtsInCalledFunction) {
                                                                // Skip self-relationships
                                                                if (sourceDebt.id === targetDebt.id) continue;
                                                                
                                                                relationships.push({
                                                                    sourceId: sourceDebt.id,
                                                                    targetId: targetDebt.id,
                                                                    types: [RelationshipType.CALL_GRAPH],
                                                                    strength: 0.9, // Inter-file relationships are very strong
                                                                    description: `SATD in function ${funcName} (${filePath}) calls function ${importedNode.id.name} in ${importedModulePath} which contains another SATD.`
                                                                });
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                console.error(`Error analyzing inter-file relationships for ${filePath}:`, error);
            }
        }
        
        return relationships;
    }

    /**
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
     * Resolve a Python import to an actual file path
     * @param currentFilePath Path of the current file
     * @param importedModule Name of the imported module
     * @returns Resolved file path or null
     */
    private resolvePythonImport(currentFilePath: string, importedModule: string): string | null {
        if (!this.workspaceRoot) {
            return null;
        }
        
        const currentDir = path.dirname(currentFilePath);
        
        // Check if it's a relative import (.module)
        if (importedModule.startsWith('.')) {
            // Resolve relative to current directory
            const relativePath = importedModule.substring(1); // Remove the leading dot
            const resolvedPath = path.join(currentDir, `${relativePath}.py`);
            return resolvedPath;
        }
        
        // For simplicity in this fix, just look for the module name + .py in the same directory
        // In a full implementation, this would search through PYTHONPATH and handle packages
        const directMatch = path.join(currentDir, `${importedModule}.py`);
        
        // Try direct match first, which is most common for the networking_legacy.py -> printData.py case
        return directMatch;
    }
}