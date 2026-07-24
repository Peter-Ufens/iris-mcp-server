# Configuration MCP pour Claude Desktop

Ouvrir `%APPDATA%\Claude\claude_desktop_config.json` et configurer `iris` ainsi :

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

Canon : `D:\IA-CURSOR\Iris-MCP\iris-mcp-server`.  
Apres sauvegarde : quitter Claude Desktop completement puis relancer. Verifier avec `iris-ping-v1`.
