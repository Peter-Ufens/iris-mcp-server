# Configuration MCP pour Cursor

Ajouter dans `~/.cursor/mcp.json` (ou Settings > MCP Servers) :

```json
{
  "mcpServers": {
    "iris": {
      "command": "node",
      "args": ["<workspace>\\Iris-MCP\\iris-mcp-server\\dist\\index.js"],
      "env": {
        "OLLAMA_BASE_URL": "http://localhost:11434",
        "ALLOWED_ROOTS": "<workspace>\\Iris-MCP,<workspace>,D:\\atelier-local,D:\\produit-compagnon,<VAULT>"
      }
    }
  }
}
```

Canon code (depuis 2026-07-22) : `<workspace>\Iris-MCP\iris-mcp-server`  
Repo GitHub : `Peter-Ufens/iris-mcp-server`  
Ancien chemin archive-locale : obsolete (dossier voue a suppression).

Apres modification, recharger les MCP Cursor. Verifier avec `iris-ping-v1`.
