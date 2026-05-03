# Catalogue des outils MCP — Iris

Chaque outil a un **ID stable** (`<nom>-v<version>`). Nouvelle version = nouvel ID (cohabitation possible).

| ID | Fichier | Description |
|----|---------|-------------|
| `iris-ping-v1` | `src/tools/iris-ping-v1.ts` | Santé du serveur ; `echo` optionnel ; sans I/O disque ni réseau |
| `ollama-tags-v1` | `src/tools/ollama-tags-v1.ts` | Liste les modèles Ollama locaux (`GET /api/tags`) ; `OLLAMA_BASE_URL` ou argument `baseUrl` |

*(À étendre : fs-safe, git-surgery, lyla-health, ollama-chat si validé, etc.)*
