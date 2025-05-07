// src/satdRelationshipAnalyzer.ts
import * as vscode from 'vscode';
import { TechnicalDebt, SatdRelationship, RelationshipType } from './models';
import { CallGraphAnalyzer } from './analyzers/callGraphAnalyzer';
import { DataDependencyAnalyzer } from './analyzers/dataDependencyAnalyzer';
import { ControlFlowAnalyzer } from './analyzers/controlFlowAnalyzer';
import { ModuleDependencyAnalyzer } from './analyzers/moduleDependencyAnalyzer';

/**
 * SatdRelationshipAnalyzer identifies relationships between different
 * technical debt instances to form chains and help understand their impact
 */
export class SatdRelationshipAnalyzer {
    private callGraphAnalyzer: CallGraphAnalyzer;
    private dataDependencyAnalyzer: DataDependencyAnalyzer;
    private controlFlowAnalyzer: ControlFlowAnalyzer;
    private moduleDependencyAnalyzer: ModuleDependencyAnalyzer;
    
    private workspaceRoot: string | null = null;
    
    /**
     * Constructor initializes the sub-analyzers
     */
    constructor() {
        this.callGraphAnalyzer = new CallGraphAnalyzer();
        this.dataDependencyAnalyzer = new DataDependencyAnalyzer();
        this.controlFlowAnalyzer = new ControlFlowAnalyzer();
        this.moduleDependencyAnalyzer = new ModuleDependencyAnalyzer();
    }
    
    /**
     * Initialize the analyzer with workspace root
     * @param workspaceRoot Root directory of the workspace
     */
    public async initialize(workspaceRoot: string): Promise<void> {
        this.workspaceRoot = workspaceRoot;
        await this.callGraphAnalyzer.initialize(workspaceRoot);
        await this.dataDependencyAnalyzer.initialize(workspaceRoot);
        await this.controlFlowAnalyzer.initialize(workspaceRoot);
        await this.moduleDependencyAnalyzer.initialize(workspaceRoot);
    }
    
    /**
     * Analyze relationships between technical debt items
     * @param debtItems List of technical debt items to analyze
     * @returns List of relationships between technical debt items
     */
    public async analyzeRelationships(debtItems: TechnicalDebt[]): Promise<SatdRelationship[]> {
        if (!this.workspaceRoot) {
            throw new Error('Analyzer not initialized');
        }
        
        // Collect file content for all files with technical debt
        const fileContentMap = await this.collectFileContent(debtItems);
        
        // Run all analyzers in parallel
        const [callRelationships, dataRelationships, controlFlowRelationships, moduleRelationships] = await Promise.all([
            this.callGraphAnalyzer.findRelationships(debtItems, fileContentMap),
            this.dataDependencyAnalyzer.findRelationships(debtItems, fileContentMap),
            this.controlFlowAnalyzer.findRelationships(debtItems, fileContentMap),
            this.moduleDependencyAnalyzer.findRelationships(debtItems, fileContentMap)
        ]);
        
        // Combine all relationships
        const allRelationships = [
            ...callRelationships,
            ...dataRelationships,
            ...controlFlowRelationships,
            ...moduleRelationships
        ];
        
        return this.deduplicateRelationships(allRelationships);
    }
    
    /**
     * Collect content of all files with technical debt
     * @param debtItems List of technical debt items
     * @returns Map of file paths to their content
     */
    private async collectFileContent(debtItems: TechnicalDebt[]): Promise<Map<string, string>> {
        const fileContentMap = new Map<string, string>();
        const uniqueFiles = [...new Set(debtItems.map(item => item.file))];
        
        for (const filePath of uniqueFiles) {
            try {
                if (!this.workspaceRoot) {
                    continue;
                }
                
                const uri = vscode.Uri.file(`${this.workspaceRoot}/${filePath}`);
                const document = await vscode.workspace.openTextDocument(uri);
                fileContentMap.set(filePath, document.getText());
            } catch (error) {
                console.error(`Failed to read file: ${filePath}`, error);
            }
        }
        
        return fileContentMap;
    }
    
    /**
     * Deduplicate relationships by combining those between the same debt items
     * @param relationships List of relationships to deduplicate
     * @returns Deduplicated list of relationships
     */
    private deduplicateRelationships(relationships: SatdRelationship[]): SatdRelationship[] {
        const relationshipMap = new Map<string, SatdRelationship>();
        
        for (const relationship of relationships) {
            // Create a unique key for the relationship
            const key = `${relationship.sourceId}-${relationship.targetId}`;
            
            if (relationshipMap.has(key)) {
                // Combine relationship types if a relationship already exists
                const existing = relationshipMap.get(key)!;
                existing.types = [...new Set([...existing.types, ...relationship.types])];
                existing.strength = Math.max(existing.strength, relationship.strength);
                existing.description = this.combineDescriptions(existing.description, relationship.description);
            } else {
                relationshipMap.set(key, relationship);
            }
        }
        
        return Array.from(relationshipMap.values());
    }
    
    /**
     * Combine descriptions from multiple relationships
     * @param desc1 First description
     * @param desc2 Second description
     * @returns Combined description
     */
    private combineDescriptions(desc1: string, desc2: string): string {
        // If they're the same, just return one
        if (desc1 === desc2) {
            return desc1;
        }
        
        // Otherwise combine them
        return `${desc1}\n\nAdditional relationship:\n${desc2}`;
    }
}