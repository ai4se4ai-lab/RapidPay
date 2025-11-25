// src/analyzers/dataDependencyAnalyzer.ts
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

/**
 * Analyzes data dependencies between technical debt items.
 * If data produced or modified by code associated with SATD A 
 * is consumed or used by code associated with SATD B, this forms a potential link
 * with data dependency weight (0.6-0.8).
 */
export class DataDependencyAnalyzer {
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
     * Find relationships between technical debt items based on data dependencies
     * @param debtItems List of technical debt items to analyze
     * @param fileContentMap Map of file paths to their content
     * @returns List of data dependency relationships with weighted edges
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
            if (!this.isParsableFile(filePath)) {
                // For Python files, use Python-specific analysis
                if (filePath.endsWith('.py')) {
                    const pythonRelationships = await this.findPythonDataDependencies(
                        filePath, 
                        fileContent, 
                        debtsInFile
                    );
                    relationships.push(...pythonRelationships);
                }
                continue;
            }
            
            // Find data dependencies within the file
            const intraFileRelationships = await this.findIntraFileDataDependencies(
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
     * Calculate edge weight based on def-use distance
     * Closer definitions and uses have higher weights
     */
    private calculateEdgeWeight(defLine: number, useLine: number): number {
        const weights = DEFAULT_RELATIONSHIP_WEIGHTS[RelationshipType.DATA];
        const distance = Math.abs(useLine - defLine);
        
        // Weight decreases with distance
        // Within 10 lines: max weight
        // Within 50 lines: mid weight
        // Beyond: min weight
        if (distance <= 10) {
            return weights.max;
        } else if (distance <= 50) {
            const ratio = (distance - 10) / 40;
            return weights.max - (ratio * (weights.max - weights.default));
        } else {
            return weights.min;
        }
    }
    
    /**
     * Find Python data dependencies using def-use analysis
     */
    private async findPythonDataDependencies(
        filePath: string, 
        fileContent: string,
        debtsInFile: TechnicalDebt[]
    ): Promise<SatdRelationship[]> {
        const relationships: SatdRelationship[] = [];
        const lines = fileContent.split('\n');
        
        // Track variable definitions and uses
        const variableDefs = new Map<string, Array<{ line: number; debt?: TechnicalDebt }>>();
        const variableUses = new Map<string, Array<{ line: number; debt?: TechnicalDebt }>>();
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNumber = i + 1;
            
            // Find debt at this location
            const debtAtLine = debtsInFile.find(debt => {
                const start = Math.max(1, debt.line - 5);
                const end = debt.line + 5;
                return lineNumber >= start && lineNumber <= end;
            });
            
            // Check for variable assignments (definitions)
            const assignmentMatch = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=/);
            if (assignmentMatch && debtAtLine) {
                const varName = assignmentMatch[1];
                if (!variableDefs.has(varName)) {
                    variableDefs.set(varName, []);
                }
                variableDefs.get(varName)!.push({ line: lineNumber, debt: debtAtLine });
            }
            
            // Check for variable uses (excluding assignment targets)
            const identifiers = line.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
            for (const identifier of identifiers) {
                // Skip if this is the assignment target
                if (line.match(new RegExp(`^\\s*${identifier}\\s*=`))) continue;
                // Skip common keywords
                if (['def', 'class', 'if', 'else', 'elif', 'for', 'while', 'return', 'import', 'from', 'as', 'try', 'except', 'finally', 'with', 'True', 'False', 'None'].includes(identifier)) continue;
                
                if (debtAtLine) {
                    if (!variableUses.has(identifier)) {
                        variableUses.set(identifier, []);
                    }
                    variableUses.get(identifier)!.push({ line: lineNumber, debt: debtAtLine });
                }
            }
        }
        
        // Create relationships between definitions and uses
        for (const [varName, defs] of variableDefs.entries()) {
            const uses = variableUses.get(varName) || [];
            
            for (const def of defs) {
                for (const use of uses) {
                    // Skip if same debt or use before definition
                    if (!def.debt || !use.debt) continue;
                    if (def.debt.id === use.debt.id) continue;
                    if (use.line <= def.line) continue;
                    
                    // Check hop count (line distance as proxy)
                    const distance = use.line - def.line;
                    const hops = Math.ceil(distance / 10); // Approximate hops
                    
                    if (hops > this.maxHops) continue;
                    
                    const weight = this.calculateEdgeWeight(def.line, use.line);
                    
                    const edge: WeightedEdge = {
                        sourceId: def.debt.id,
                        targetId: use.debt.id,
                        type: RelationshipType.DATA,
                        weight,
                        hops: Math.min(hops, this.maxHops)
                    };
                    
                    relationships.push({
                        sourceId: def.debt.id,
                        targetId: use.debt.id,
                        types: [RelationshipType.DATA],
                        edges: [edge],
                        strength: weight,
                        description: `SATD at line ${def.debt.line} defines variable '${varName}' used by SATD at line ${use.debt.line}.`,
                        hopCount: hops
                    });
                }
            }
        }
        
        return relationships;
    }
    
    /**
     * Find data dependencies within a single file (JS/TS)
     */
    private async findIntraFileDataDependencies(
        filePath: string, 
        fileContent: string,
        debtsInFile: TechnicalDebt[]
    ): Promise<SatdRelationship[]> {
        const relationships: SatdRelationship[] = [];
        
        try {
            const ast = this.parseCode(filePath, fileContent);
            if (!ast) return relationships;
            
            // Maps for tracking variable declarations and references
            const variableDeclarations = new Map<string, { debt: TechnicalDebt, node: t.Node, line: number }>();
            const variableReferences = new Map<string, { debt: TechnicalDebt, node: t.Node, line: number }[]>();
            
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
                    // Skip self-references
                    if (declaration.debt.id === reference.debt.id) continue;
                    
                    // Calculate weight based on distance
                    const weight = this.calculateEdgeWeight(declaration.line, reference.line);
                    const hops = Math.ceil(Math.abs(reference.line - declaration.line) / 10);
                    
                    if (hops > this.maxHops) continue;
                    
                    const edge: WeightedEdge = {
                        sourceId: declaration.debt.id,
                        targetId: reference.debt.id,
                        type: RelationshipType.DATA,
                        weight,
                        hops: Math.min(hops, this.maxHops)
                    };
                    
                    relationships.push({
                        sourceId: declaration.debt.id,
                        targetId: reference.debt.id,
                        types: [RelationshipType.DATA],
                        edges: [edge],
                        strength: weight,
                        description: `SATD at line ${declaration.debt.line} defines or modifies variable '${varName}' which is used by SATD at line ${reference.debt.line}.`,
                        hopCount: hops
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
     * Process a variable declaration and check if it's in a debt context
     */
    private processVariableDeclaration(
        path: NodePath<t.VariableDeclarator>,
        debtsInFile: TechnicalDebt[],
        variableDeclarations: Map<string, { debt: TechnicalDebt, node: t.Node, line: number }>
    ): void {
        const node = path.node;
        const loc = node.loc;
        
        if (loc && t.isIdentifier(node.id)) {
            const varName = node.id.name;
            const debtContext = this.findDebtAtLocation(debtsInFile, loc.start.line);
            
            if (debtContext) {
                variableDeclarations.set(varName, { 
                    debt: debtContext, 
                    node,
                    line: loc.start.line
                });
            }
        }
    }
    
    /**
     * Process an assignment expression and check if it's in a debt context
     */
    private processAssignment(
        path: NodePath<t.AssignmentExpression>,
        debtsInFile: TechnicalDebt[],
        variableDeclarations: Map<string, { debt: TechnicalDebt, node: t.Node, line: number }>
    ): void {
        const node = path.node;
        const loc = node.loc;
        
        if (loc && t.isIdentifier(node.left)) {
            const varName = node.left.name;
            const debtContext = this.findDebtAtLocation(debtsInFile, loc.start.line);
            
            if (debtContext) {
                variableDeclarations.set(varName, { 
                    debt: debtContext, 
                    node,
                    line: loc.start.line
                });
            }
        }
    }
    
    /**
     * Process an identifier and check if it's in a debt context
     */
    private processIdentifier(
        path: NodePath<t.Identifier>,
        debtsInFile: TechnicalDebt[],
        variableReferences: Map<string, { debt: TechnicalDebt, node: t.Node, line: number }[]>
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
                variableReferences.get(varName)!.push({ 
                    debt: debtContext, 
                    node,
                    line: loc.start.line
                });
            }
        }
    }
    
    /**
     * Find a technical debt item at a specific line
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
