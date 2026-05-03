# Configuration MCP pour Cursor

Ajouter dans les parametres MCP de Cursor (Settings > MCP Servers) :

```json
{
  "mcpServers": {
    "iris": {
      "command": "node",
      "args": ["D:/Parent-Studio/iris-mcp-server/dist/index.js"],
      "env": {
        "OLLAMA_BASE_URL": "http://localhost:11434",
        "ALLOWED_ROOTS": "D:/Parent-Studio,D:/Companion-OS"
      }
    }
  }
}
```

Apres modification, redemarrer Cursor. Verifier avec `iris-ping-v1` que le serveur repond.
