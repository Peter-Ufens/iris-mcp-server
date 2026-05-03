# Brancher `iris-mcp-server` dans Cursor

1. Compiler le serveur :  
   `cd D:\Hybrid-Agentic-Studio\iris-mcp-server` puis `npm install` (déjà fait si tu as build) et **`npm run build`**.

2. Dans Cursor : **Settings → MCP** (ou fichier de config MCP utilisateur / projet selon ta version).

3. Exemple d’entrée serveur (adapter les chemins si besoin) :

```json
{
  "mcpServers": {
    "iris": {
      "command": "node",
      "args": ["D:/Hybrid-Agentic-Studio/iris-mcp-server/dist/index.js"]
    }
  }
}
```

4. Mode développement (sans rebuild à chaque fois) : remplacer `command` par `npx` et `args` par `["tsx", "D:/Hybrid-Agentic-Studio/iris-mcp-server/src/index.ts"]` si `tsx` est disponible dans le PATH du process lancé par Cursor.

5. Vérifier : le client MCP doit lister les outils **`iris-ping-v1`** et **`ollama-tags-v1`**.

6. **Ollama** : si Ollama tourne sur un autre hôte/port, ajouter dans l’entrée serveur (exemple) :

```json
{
  "mcpServers": {
    "iris": {
      "command": "node",
      "args": ["D:/Hybrid-Agentic-Studio/iris-mcp-server/dist/index.js"],
      "env": {
        "OLLAMA_BASE_URL": "http://127.0.0.1:11434"
      }
    }
  }
}
```

7. **Serveurs MCP open source en parallèle** : tu peux ajouter une deuxième clé sous `mcpServers` (ex. filesystem depuis [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)) — Cursor lance **un processus par serveur**. Voir aussi `docs/mcp-open-source-et-local.md`.

8. **Passerelle multi-modèles (Ollama + clés API cloud)** : recherche et exemples type **pal-mcp-server** / **ollama-mcp** / **Bifrost** dans **`docs/mcp-native-gateways-research.md`** — tu peux cumuler **`iris`** (outils atelier) et **`pal`** (ou équivalent) dans le même `mcpServers`.

---

*Pas de secrets dans ce fichier. `ollama-tags-v1` n’appelle que ton Ollama local (lecture des tags).*
