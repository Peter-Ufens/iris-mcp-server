# Configuration MCP pour Claude Desktop

Ouvrir `%APPDATA%\Claude\claude_desktop_config.json` et configurer `iris` ainsi :

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
Apres sauvegarde : quitter Claude Desktop completement puis relancer. Verifier avec `iris-ping-v1`.
