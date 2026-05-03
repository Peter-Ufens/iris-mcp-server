import type * as z from 'zod/v4';

export type ToolCategory =
  | 'iris'
  | 'ollama'
  | 'filesystem'
  | 'git'
  | 'cloud'
  | 'memory'
  | 'web'
  | 'agent'
  | 'model';

export interface ToolContent {
  type: 'text';
  text: string;
}

export interface ToolResult {
  content: ToolContent[];
}

/**
 * Contrat pour TOUS les outils Iris MCP.
 * Chaque fichier src/tools/*.ts (hors _*.ts) exporte `tool: IrisTool`.
 * Le registre (_registry.ts) les decouvre et les enregistre automatiquement.
 */
export interface IrisTool {
  /** ID unique versionne, ex: "fs-read-v1" */
  id: string;
  /** Description pour le LLM client (1-2 phrases) */
  description: string;
  /** Categorie pour le classement */
  category: ToolCategory;
  /** Schema Zod pour l'input (cles = noms des parametres) */
  inputSchema: Record<string, z.ZodType>;
  /** Fonction d'execution */
  execute: (input: Record<string, unknown>) => Promise<ToolResult>;
}
