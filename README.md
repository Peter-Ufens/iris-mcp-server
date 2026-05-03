# iris-mcp-server

> Repo GitHub `Peter-Ufens/iris-mcp-server` depuis 2026-05-03 (PRIVE, decision Peter). Pivot du scaffold Python (Lot F) vers cette base TypeScript : [docs/adr/0003-pivot-python-vers-typescript.md](docs/adr/0003-pivot-python-vers-typescript.md).

Serveur MCP (Model Context Protocol) modulaire pour Iris - ecosysteme IA local-first.

## Documentation projet

- Decisions d'architecture : [docs/adr/](docs/adr/)
- Identite Iris : [docs/identity/](docs/identity/)
- Brouillons (ex. sprint Lot G) : [docs/drafts/](docs/drafts/)
- Recherche MCP (gateways, open source, Cursor) : [docs/mcp-native-gateways-research.md](docs/mcp-native-gateways-research.md), [docs/mcp-open-source-et-local.md](docs/mcp-open-source-et-local.md), [docs/mcp-cursor-config.md](docs/mcp-cursor-config.md)

## Demarrage rapide

```bash
# 1. Cloner le depot
gh repo clone Peter-Ufens/iris-mcp-server
cd iris-mcp-server

# 2. Installer les dependances
npm install

# 3. Configurer l'environnement
cp .env.example .env
# Editer .env si necessaire (OLLAMA_BASE_URL, ALLOWED_ROOTS)

# 4. Build + tests
npm run build
npm test

# 5. Brancher dans Cursor ou Claude Desktop
# Voir docs/cursor-config.md ou docs/claude-desktop-config.md
```

## Outils disponibles (Sprint 1)

| ID | Description | Categorie |
|----|-------------|-----------|
| `iris-ping-v1` | Healthcheck : version, uptime, liste des outils, timestamp | iris |
| `ollama-list-v1` | Liste les modeles Ollama locaux (GET /api/tags) | ollama |
| `ollama-chat-v1` | Chat avec un modele Ollama local (POST /api/chat) | ollama |
| `fs-read-v1` | Lit un fichier (securise par ALLOWED_ROOTS) | filesystem |
| `fs-list-v1` | Liste un repertoire (securise par ALLOWED_ROOTS) | filesystem |

## Ajouter un outil

Voir [docs/GUIDE-AJOUTER-OUTIL.md](docs/GUIDE-AJOUTER-OUTIL.md).

En resume : deposer un fichier dans `src/tools/`, exporter un objet `tool: IrisTool`, rebuild. L'outil est auto-decouvert.

## Architecture

```
iris-mcp-server/
├── src/
│   ├── index.ts              # Point d'entree stdio
│   ├── server.ts             # Creation du serveur MCP + enregistrement auto
│   ├── tools/
│   │   ├── _types.ts         # Interface IrisTool (contrat extensibilite)
│   │   ├── _registry.ts      # Auto-decouverte des outils au demarrage
│   │   ├── iris-ping-v1.ts
│   │   ├── ollama-list-v1.ts
│   │   ├── ollama-chat-v1.ts
│   │   ├── fs-read-v1.ts
│   │   └── fs-list-v1.ts
│   └── utils/
│       ├── env.ts            # Chargement .env
│       └── path-guard.ts     # Validation ALLOWED_ROOTS, anti path-traversal
├── tests/                    # Tests Vitest
├── docs/
│   ├── adr/                  # ADR (dont pivot Python -> TypeScript)
│   ├── identity/             # IRIS-MANIFESTE, IRIS-PERSONA
│   ├── drafts/
│   ├── cursor-config.md
│   ├── claude-desktop-config.md
│   ├── GUIDE-AJOUTER-OUTIL.md
│   └── mcp-*.md              # Notes recherche MCP
├── .env.example
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Sprints futurs

- **Sprint 2** : memory-read/write, lyla-health, git-surgery wrapper
- **Sprint 3** : tech-watch, brave-search, notion-bridge
- **Sprint 4** : transport HTTP/SSE, multi-client
- **Sprint 5+** : agents, routing, orchestration

## Licence

MIT. Voir [LICENSE](LICENSE).
