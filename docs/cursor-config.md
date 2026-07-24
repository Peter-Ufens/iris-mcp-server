# Configuration MCP pour Cursor

Ajouter dans `~/.cursor/mcp.json` (ou Settings > MCP Servers) :

```json
{
  "mcpServers": {
    "iris": {
      "command": "node",
      "args": ["D:\\IA-CURSOR\\Iris-MCP\\iris-mcp-server\\dist\\index.js"],
      "env": {
        "OLLAMA_BASE_URL": "http://localhost:11434",
        "ALLOWED_ROOTS": "D:\\IA-CURSOR\\Iris-MCP,D:\\IA-CURSOR,D:\\Hybrid-Agentic-Studio,D:\\Lyla-OS,D:\\Obsidian\\Obsidian\\Peter-Vault-Local"
      }
    }
  }
}
```

Canon code (depuis 2026-07-22) : `D:\IA-CURSOR\Iris-MCP\iris-mcp-server`  
Repo GitHub : `Peter-Ufens/iris-mcp-server`  
Ancien chemin Audit-GitHub : obsolete (dossier voue a suppression).

Apres modification, recharger les MCP Cursor. Verifier avec `iris-ping-v1`.
