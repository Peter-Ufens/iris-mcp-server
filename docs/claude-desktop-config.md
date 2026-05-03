# Configuration MCP pour Claude Desktop

Ouvrir le fichier `%APPDATA%\Claude\claude_desktop_config.json` et ajouter :

```json
{
  "mcpServers": {
    "iris": {
      "command": "node",
      "args": ["D:/Hybrid-Agentic-Studio/iris-mcp-server/dist/index.js"],
      "env": {
        "OLLAMA_BASE_URL": "http://localhost:11434",
        "ALLOWED_ROOTS": "D:/Hybrid-Agentic-Studio,D:/Lyla-OS"
      }
    }
  }
}
```

Apres modification, redemarrer Claude Desktop. Verifier avec `iris-ping-v1` que le serveur repond.
