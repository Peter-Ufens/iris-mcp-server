# Catalogue des outils MCP - iris-mcp-server v0.3.0

9 outils operationnels avec auto-decouverte (`src/tools/_registry.ts`). Chaque outil a un ID unique versionne, nouvelle version = nouvel ID (cohabitation possible).

## Outils v0.3.0

| ID | Fichier | Categorie | Description |
|----|---------|-----------|-------------|
| `iris-ping-v1` | `src/tools/iris-ping-v1.ts` | iris | Healthcheck : version, uptime, liste des outils, timestamp |
| `ollama-list-v1` | `src/tools/ollama-list-v1.ts` | ollama | Liste les modeles Ollama locaux (`GET /api/tags`) |
| `ollama-chat-v1` | `src/tools/ollama-chat-v1.ts` | ollama | Chat avec un modele Ollama (`POST /api/chat`, stream off) |
| `fs-read-v1` | `src/tools/fs-read-v1.ts` | filesystem | Lit un fichier (sandbox `ALLOWED_ROOTS`, anti path-traversal) |
| `fs-list-v1` | `src/tools/fs-list-v1.ts` | filesystem | Liste un repertoire (sandbox `ALLOWED_ROOTS`) |
| `git-status-v1` | `src/tools/git-status-v1.ts` | git | Retourne le statut Git d un repo local (staged, unstaged, untracked) |
| `git-log-v1` | `src/tools/git-log-v1.ts` | git | Retourne les N derniers commits d un repo local |
| `git-diff-v1` | `src/tools/git-diff-v1.ts` | git | Retourne la diff Git (staged, unstaged ou head) |
| `git-commit-v1` | `src/tools/git-commit-v1.ts` | git | Cree un commit sur les fichiers deja stages (pas de git add implicite) |

## Pattern d'ID

`<nom>-v<version>`. Exemples :
- `outlook-classic-v1` vs `outlook-new-v1` : differenciation par versions distinctes
- `fs-read-v1` -> `fs-read-v2` : ajout retro-compatible (cohabitation possible)

## Outils a venir

Voir [`docs/roadmap.md`](./roadmap.md) pour la planification complete v0.4.0 -> v1.0.0.

## Comment ajouter un outil

Voir [`docs/GUIDE-AJOUTER-OUTIL.md`](./GUIDE-AJOUTER-OUTIL.md). En resume : deposer un fichier dans `src/tools/`, exporter un objet `tool: IrisTool`, rebuild. L'outil est auto-decouvert.
