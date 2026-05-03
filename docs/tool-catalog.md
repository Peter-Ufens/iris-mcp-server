# Catalogue des outils MCP - iris-mcp-server v0.2.0

5 outils operationnels avec auto-decouverte (`src/tools/_registry.ts`). Chaque outil a un ID unique versionne, nouvelle version = nouvel ID (cohabitation possible).

## Outils v0.2.0

| ID | Fichier | Categorie | Description |
|----|---------|-----------|-------------|
| `iris-ping-v1` | `src/tools/iris-ping-v1.ts` | iris | Healthcheck : version, uptime, liste des outils, timestamp |
| `ollama-list-v1` | `src/tools/ollama-list-v1.ts` | ollama | Liste les modeles Ollama locaux (`GET /api/tags`) |
| `ollama-chat-v1` | `src/tools/ollama-chat-v1.ts` | ollama | Chat avec un modele Ollama (`POST /api/chat`, stream off) |
| `fs-read-v1` | `src/tools/fs-read-v1.ts` | filesystem | Lit un fichier (sandbox `ALLOWED_ROOTS`, anti path-traversal) |
| `fs-list-v1` | `src/tools/fs-list-v1.ts` | filesystem | Liste un repertoire (sandbox `ALLOWED_ROOTS`) |

## Pattern d'ID

`<nom>-v<version>`. Exemples :
- `outlook-classic-v1` vs `outlook-new-v1` : differenciation par versions distinctes
- `fs-read-v1` -> `fs-read-v2` : ajout retro-compatible (cohabitation possible)

## Outils a venir

Voir [`docs/roadmap.md`](./roadmap.md) pour la planification complete v0.3.0 -> v1.0.0.

## Comment ajouter un outil

Voir [`docs/GUIDE-AJOUTER-OUTIL.md`](./GUIDE-AJOUTER-OUTIL.md). En resume : deposer un fichier dans `src/tools/`, exporter un objet `tool: IrisTool`, rebuild. L'outil est auto-decouvert.
