// src/analyzers/moduleDependencyAnalyzer.ts
import * as vscode from 'vscode';
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
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

/**
 * Analyzes module/file dependencies between technical debt items.
 * If module X (with SATD A) depends on module Y (with SATD B), 
 * this establishes a higher-level link with module dependency weight (0.8-1.0).
 */
export class ModuleDependencyAnalyzer {
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
     * Find relationships between technical debt items based on module dependencies
     * @param debtItems List of technical debt items to analyze
     * @param fileContentMap Map of file paths to their content
     * @returns List of module dependency relationships with weighted edges
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
        
        // Build a module dependency map with hop counts
        const dependencyMap = await this.buildModuleDependencyMap(
            debtByFile.keys(), 
            fileContentMap,
            debtByFile
        );
        
        // Find relationships based on module dependencies
        for (const [sourceFile, dependencies] of dependencyMap.entries()) {
            const sourceDebts = debtByFile.get(sourceFile) || [];
            
            for (const { targetFile, hops, isDirect } of dependencies) {
                if (hops > this.maxHops) continue;
                
                const targetDebts = debtByFile.get(targetFile) || [];
                
                for (const sourceDebt of sourceDebts) {
                    for (const targetDebt of targetDebts) {
                        if (sourceDebt.id === targetDebt.id) continue;
                        
                        const weight = this.calculateEdgeWeight(hops, isDirect);
                        
                        const edge: WeightedEdge = {
                            sourceId: sourceDebt.id,
                            targetId: targetDebt.id,
                            type: RelationshipType.MODULE,
                            weight,
                            hops
                        };
                        
                        relationships.push({
                            sourceId: sourceDebt.id,
                            targetId: targetDebt.id,
                            types: [RelationshipType.MODULE],
                            edges: [edge],
                            strength: weight,
                            description: `SATD in module ${path.basename(sourceFile)} depends on module ${path.basename(targetFile)} which contains another SATD (${hops} hop(s)).`,
                            hopCount: hops
                        });
                    }
                }
            }
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
     * Calculate edge weight based on hop count and directness
     */
    private calculateEdgeWeight(hops: number, isDirect: boolean): number {
        const weights = DEFAULT_RELATIONSHIP_WEIGHTS[RelationshipType.MODULE];
        
        if (isDirect) {
            // Direct imports get higher weight
            return weights.max;
        }
        
        // Weight decreases with hop count
        const normalizedHops = Math.min(hops, this.maxHops) / this.maxHops;
        return weights.max - (normalizedHops * (weights.max - weights.min));
    }
    
    /**
     * Build a map of module dependencies with hop counts
     */
    private async buildModuleDependencyMap(
        filePaths: IterableIterator<string>,
        fileContentMap: Map<string, string>,
        debtByFile: Map<string, TechnicalDebt[]>
    ): Promise<Map<string, Array<{ targetFile: string; hops: number; isDirect: boolean }>>> {
        const dependencyMap = new Map<string, Array<{ targetFile: string; hops: number; isDirect: boolean }>>();
        const directDependencies = new Map<string, Set<string>>();
        
        // First pass: collect direct dependencies
        for (const filePath of Array.from(fileContentMap.keys())) {
            const fileContent = fileContentMap.get(filePath);
            if (!fileContent) continue;
            
            const dependencies = await this.findFileDependencies(filePath, fileContent, debtByFile);
            directDependencies.set(filePath, dependencies);
        }
        
        // Second pass: compute transitive dependencies up to maxHops
        for (const filePath of Array.from(debtByFile.keys())) {
            const reachable = this.computeReachableModules(filePath, directDependencies, debtByFile);
            dependencyMap.set(filePath, reachable);
        }
        
        return dependencyMap;
    }
    
    /**
     * Compute reachable modules using BFS with hop counting
     */
    private computeReachableModules(
        startFile: string,
        directDependencies: Map<string, Set<string>>,
        debtByFile: Map<string, TechnicalDebt[]>
    ): Array<{ targetFile: string; hops: number; isDirect: boolean }> {
        const reachable: Array<{ targetFile: string; hops: number; isDirect: boolean }> = [];
        const visited = new Set<string>();
        const queue: Array<{ file: string; hops: number }> = [{ file: startFile, hops: 0 }];
        
        while (queue.length > 0) {
            const { file, hops } = queue.shift()!;
            
            if (hops >= this.maxHops) continue;
            if (visited.has(file)) continue;
            visited.add(file);
            
            const deps = directDependencies.get(file) || new Set();
            
            for (const dep of deps) {
                // Only include if the dependency has SATD
                if (debtByFile.has(dep) && dep !== startFile) {
                    // Check if we already have this target with fewer hops
                    const existing = reachable.find(r => r.targetFile === dep);
                    if (!existing || existing.hops > hops + 1) {
                        if (existing) {
                            existing.hops = hops + 1;
                            existing.isDirect = hops === 0;
                        } else {
                            reachable.push({
                                targetFile: dep,
                                hops: hops + 1,
                                isDirect: hops === 0
                            });
                        }
                    }
                }
                
                if (!visited.has(dep)) {
                    queue.push({ file: dep, hops: hops + 1 });
                }
            }
        }
        
        return reachable;
    }
    
    /**
     * Check if a file is a parsable file
     */
    private isParsableFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return ['.js', '.jsx', '.ts', '.tsx', '.py'].includes(ext);
    }
    
    /**
     * Find dependencies of a file
     */
    private async findFileDependencies(
        filePath: string,
        fileContent: string,
        debtByFile: Map<string, TechnicalDebt[]>
    ): Promise<Set<string>> {
        const dependencies = new Set<string>();
        
        if (!this.isParsableFile(filePath)) {
            return dependencies;
        }
        
        const ext = path.extname(filePath).toLowerCase();
        
        if (ext === '.py') {
            return this.findPythonDependencies(filePath, fileContent, debtByFile);
        }
        
        try {
            const ast = this.parseCode(filePath, fileContent);
            if (!ast) return dependencies;
            
            const moduleSpecifiers: string[] = [];
            
            traverse(ast, {
                ImportDeclaration: (path) => {
                    const source = path.node.source.value;
                    if (typeof source === 'string') {
                        moduleSpecifiers.push(source);
                    }
                },
                CallExpression: (path) => {
                    if (t.isIdentifier(path.node.callee) && path.node.callee.name === 'require') {
                        const args = path.node.arguments;
                        if (args.length > 0 && t.isStringLiteral(args[0])) {
                            moduleSpecifiers.push(args[0].value);
                        }
                    }
                }
            });
            
            for (const specifier of moduleSpecifiers) {
                const resolvedPath = await this.resolveModulePath(filePath, specifier, debtByFile);
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
     * Find Python file dependencies
     */
    private async findPythonDependencies(
        filePath: string,
        fileContent: string,
        debtByFile: Map<string, TechnicalDebt[]>
    ): Promise<Set<string>> {
        const dependencies = new Set<string>();
        const lines = fileContent.split('\n');
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            // Skip non-import lines
            if (!trimmedLine.startsWith('import') && !trimmedLine.startsWith('from')) continue;
            if (trimmedLine.startsWith('#')) continue;
            
            // Handle "import module" syntax
            const importMatch = trimmedLine.match(/^import\s+([a-zA-Z0-9_.]+)/);
            if (importMatch) {
                const modulePath = this.resolvePythonModule(filePath, importMatch[1], debtByFile);
                if (modulePath) {
                    dependencies.add(modulePath);
                }
                continue;
            }
            
            // Handle "from module import ..." syntax
            const fromImportMatch = trimmedLine.match(/^from\s+([a-zA-Z0-9_.]+)\s+import/);
            if (fromImportMatch) {
                const modulePath = this.resolvePythonModule(filePath, fromImportMatch[1], debtByFile);
                if (modulePath) {
                    dependencies.add(modulePath);
                }
            }
        }
        
        return dependencies;
    }
    
    /**
     * Resolve Python module to file path
     */
    private resolvePythonModule(
        currentFile: string,
        moduleName: string,
        debtByFile: Map<string, TechnicalDebt[]>
    ): string | null {
        const possiblePaths = [
            moduleName.replace(/\./g, '/') + '.py',
            moduleName.replace(/\./g, '/') + '/__init__.py',
            path.join(path.dirname(currentFile), moduleName.replace(/\./g, '/') + '.py'),
            path.join(path.dirname(currentFile), moduleName.replace(/\./g, '/'), '__init__.py')
        ];
        
        for (const possiblePath of possiblePaths) {
            const normalizedPath = path.normalize(possiblePath);
            if (debtByFile.has(normalizedPath)) {
                return normalizedPath;
            }
            // Also check without leading ./
            const cleanPath = normalizedPath.replace(/^\.[\\/]/, '');
            if (debtByFile.has(cleanPath)) {
                return cleanPath;
            }
        }
        
        return null;
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
     * Resolve a module specifier to an actual file path
     */
    private async resolveModulePath(
        sourcePath: string, 
        specifier: string,
        debtByFile: Map<string, TechnicalDebt[]>
    ): Promise<string | null> {
        if (!this.workspaceRoot) {
            return null;
        }
        
        // Skip external modules (npm packages)
        if (specifier.startsWith('@') || !specifier.startsWith('.')) {
            return null;
        }
        
        // Resolve relative paths
        const sourceDir = path.dirname(sourcePath);
        let resolvedPath = path.join(sourceDir, specifier);
        resolvedPath = path.normalize(resolvedPath);
        
        // Check various extensions
        const extensions = ['.js', '.jsx', '.ts', '.tsx', ''];
        
        for (const ext of extensions) {
            const fullPath = resolvedPath + ext;
            if (debtByFile.has(fullPath)) {
                return fullPath;
            }
            // Try without leading ./
            const cleanPath = fullPath.replace(/^\.[\\/]/, '');
            if (debtByFile.has(cleanPath)) {
                return cleanPath;
            }
        }
        
        // Check if it's a directory with an index file
        for (const ext of extensions) {
            if (ext === '') continue;
            const indexPath = path.join(resolvedPath, `index${ext}`);
            if (debtByFile.has(indexPath)) {
                return indexPath;
            }
        }
        
        return null;
    }
}
