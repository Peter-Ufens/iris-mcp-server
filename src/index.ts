import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createIrisMcpServer } from './server.js';

async function main(): Promise<void> {
  const mcp = await createIrisMcpServer();
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  console.error('[iris-mcp] connecte (stdio)');
}

main().catch((err) => {
  console.error('[iris-mcp] erreur fatale:', err);
  process.exit(1);
});
