// src/analyzers/moduleDependencyAnalyzer.ts
import * as vscode from 'vscode';
import { TechnicalDebt, SatdRelationship, RelationshipType } from '../models';
import * as path from 'path';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

/**
 * Analyzes module/file dependencies between technical debt items.
 * If module X (with SATD A) depends on module Y (with SATD B), 
 * this establishes a higher-level link.
 */
export class ModuleDependencyAnalyzer {
    private workspaceRoot: string | null = null;
    
    /**
     * Initialize the analyzer with workspace root
     * @param workspaceRoot Root directory of the workspace
     */
    public async initialize(workspaceRoot: string): Promise<void> {
        this.workspaceRoot = workspaceRoot;
    }
    
    /**
     * Find relationships between technical debt items based on module dependencies
     * @param debtItems List of technical debt items to analyze
     * @param fileContentMap Map of file paths to their content
     * @returns List of module dependency relationships
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
        
        // Build a module dependency map
        const dependencyMap = await this.buildModuleDependencyMap(debtByFile.keys(), fileContentMap);
        
        // Find relationships based on module dependencies
        for (const [sourceFile, targetFiles] of dependencyMap.entries()) {
            const sourceDebts = debtByFile.get(sourceFile) || [];
            
            for (const targetFile of targetFiles) {
                const targetDebts = debtByFile.get(targetFile) || [];
                
                // Create relationships between all debt items in the source file
                // and all debt items in the target file
                for (const sourceDebt of sourceDebts) {
                    for (const targetDebt of targetDebts) {
                        relationships.push({
                            sourceId: sourceDebt.id,
                            targetId: targetDebt.id,
                            types: [RelationshipType.MODULE_DEPENDENCY],
                            strength: 0.5, // Module dependencies are moderately weak
                            description: `SATD in module ${sourceFile} depends on module ${targetFile} which contains another SATD.`
                        });
                    }
                }
            }
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
     * Build a map of module dependencies
     * @param filePaths Paths of files to analyze
     * @param fileContentMap Map of file paths to their content
     * @returns Map of source files to target files they depend on
     */
    private async buildModuleDependencyMap(
        filePaths: IterableIterator<string>,
        fileContentMap: Map<string, string>
    ): Promise<Map<string, Set<string>>> {
        const dependencyMap = new Map<string, Set<string>>();
        
        // For each file, find its dependencies
        for (const filePath of filePaths) {
            const fileContent = fileContentMap.get(filePath);
            if (!fileContent) continue;
            
            // Skip files based on extension
            if (!this.isJsOrTsFile(filePath)) {
                continue;
            }
            
            // Find imports and requires in the file
            const dependencies = await this.findFileDependencies(filePath, fileContent);
            
            // Add to the dependency map
            dependencyMap.set(filePath, dependencies);
        }
        
        return dependencyMap;
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
     * Find dependencies of a file
     * @param filePath Path to the file
     * @param fileContent Content of the file
     * @returns Set of target files the file depends on
     */
    private async findFileDependencies(
        filePath: string,
        fileContent: string
    ): Promise<Set<string>> {
        const dependencies = new Set<string>();
        
        try {
            // Parse the code into an AST
            const ast = this.parseCode(filePath, fileContent);
            if (!ast) return dependencies;
            
            // Track import and require statements
            const moduleSpecifiers: string[] = [];
            
            // Find import statements
            traverse(ast, {
                ImportDeclaration: (path) => {
                    const source = path.node.source.value;
                    if (typeof source === 'string') {
                        moduleSpecifiers.push(source);
                    }
                },
                CallExpression: (path) => {
                    // Find require statements
                    if (t.isIdentifier(path.node.callee) && path.node.callee.name === 'require') {
                        const args = path.node.arguments;
                        if (args.length > 0 && t.isStringLiteral(args[0])) {
                            moduleSpecifiers.push(args[0].value);
                        }
                    }
                }
            });
            
            // Resolve module specifiers to actual file paths
            for (const specifier of moduleSpecifiers) {
                const resolvedPath = await this.resolveModulePath(filePath, specifier);
                if (resolvedPath) {
                    dependencies.add(resolvedPath);
                }
            }
            
        } catch (error) {
            console.error(`Error finding dependencies in ${filePath}:`, error);
        }
        
        return dependencies;
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
     * Resolve a module specifier to an actual file path
     * @param sourcePath Path of the source file
     * @param specifier Module specifier
     * @returns Resolved file path or null
     */
    private async resolveModulePath(sourcePath: string, specifier: string): Promise<string | null> {
        if (!this.workspaceRoot) {
            return null;
        }
        
        // Skip external modules
        if (specifier.startsWith('@') || !specifier.startsWith('.')) {
            return null;
        }
        
        // Resolve relative paths
        const sourceDir = path.dirname(sourcePath);
        let resolvedPath = path.resolve(sourceDir, specifier);
        
        // Check if the resolved path exists
        // If not, try adding extensions
        const extensions = ['.js', '.jsx', '.ts', '.tsx'];
        for (const ext of extensions) {
            try {
                // Check if file exists with this extension
                const fullPath = resolvedPath + ext;
                await vscode.workspace.fs.stat(vscode.Uri.file(`${this.workspaceRoot}/${fullPath}`));
                return fullPath;
            } catch (error) {
                // File doesn't exist with this extension, try the next one
            }
        }
        
        // Check if it's a directory with an index file
        for (const ext of extensions) {
            try {
                const indexPath = path.join(resolvedPath, `index${ext}`);
                await vscode.workspace.fs.stat(vscode.Uri.file(`${this.workspaceRoot}/${indexPath}`));
                return indexPath;
            } catch (error) {
                // Index file doesn't exist with this extension, try the next one
            }
        }
        
        return null;
    }
}