# Configuration MCP pour Claude Desktop

Ouvrir `%APPDATA%\Claude\claude_desktop_config.json` et configurer `iris` ainsi :

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

Canon : `<workspace>\Iris-MCP\iris-mcp-server`.  
Apres sauvegarde : quitter Claude Desktop completement puis relancer. Verifier avec `iris-ping-v1`.
