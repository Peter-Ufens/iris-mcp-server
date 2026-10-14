# Configuration MCP pour Cursor

Ajouter dans `~/.cursor/mcp.json` (ou Settings > MCP Servers) :

```json
{
  "mcpServers": {
    "iris": {
      "command": "node",
      "args": ["C:\\chemin\\vers\\iris-mcp-server\\dist\\index.js"],
      "env": {
        "OLLAMA_BASE_URL": "http://localhost:11434",
        "ALLOWED_ROOTS": "C:\\chemin\\vers\\iris-mcp-server,C:\\chemin\\vers\\vault"
      }
    }
  }
}
```

Sur Linux / macOS : chemins du type `/home/vous/projets/iris-mcp-server/dist/index.js`.  
Repo GitHub : `Peter-Ufens/iris-mcp-server`.

Apres modification, recharger les MCP Cursor. Verifier avec `iris-ping-v1`.
