import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { discoverTools } from './tools/_registry.js';

/**
 * Construit le McpServer Iris avec auto-decouverte des outils.
 * Chaque fichier src/tools/*.ts (hors _*.ts) est importe et enregistre.
 */
export async function createIrisMcpServer(): Promise<McpServer> {
  const server = new McpServer(
    { name: 'iris-mcp-server', version: '1.0.0' },
    {
      instructions:
        'Serveur MCP Iris (Hybrid-Agentic Studio). Outils auto-decouverts avec ID versionne. Transport stdio.',
    },
  );

  const tools = await discoverTools();

  for (const tool of tools) {
    server.registerTool(
      tool.id,
      { description: tool.description, inputSchema: tool.inputSchema },
      tool.execute,
    );
  }

  console.error(`[iris-mcp] ${tools.length} outils enregistres : ${tools.map((t) => t.id).join(', ')}`);
  return server;
}
