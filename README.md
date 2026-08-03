# iris-mcp-server

> Repo GitHub public : [github.com/Peter-Ufens/iris-mcp-server](https://github.com/Peter-Ufens/iris-mcp-server)  
> Projet perso · reconversion ingenieur IA (Peter UFENS) · lab local-first.

Serveur MCP (Model Context Protocol) modulaire pour **Iris** : multiprise outils pour Cursor, Claude Desktop et Ollama.

**Version :** `0.4.2` · **21 outils** · **88 tests** Vitest · statut : **socle stable** (extensions prevues, voir roadmap).

---

## Pour les visiteurs (conseiller FT, recruteurs, curieux)

**C'est quoi ?** Un serveur qui branche des assistants IA (Cursor, Claude) sur des outils concrets : fichiers locaux, Git, Ollama (LLM local), APIs publiques (meteo, traduction, etc.). Standard ouvert [Model Context Protocol](https://modelcontextprotocol.io/).

**Presentation grand public (Gamma) :**
- Produit Iris : [Iris-MCP : brancher les IA sur des outils reels](https://gamma.app/docs/Iris-MCP-brancher-les-IA-sur-des-outils-reels-rzpbly9kqpju074)
- Concept MCP (voisin) : [MCP explique simplement](https://gamma.app/docs/MCP-explique-simplement-zdk7hi92hsxsnn1)

**Ce qui fonctionne aujourd'hui (juillet 2026)**

| Element | Etat |
|---|---|
| 21 outils MCP operationnels | OK, testes (Vitest 88/88) |
| Integration Cursor + Claude Desktop | OK (stdio local) |
| Ollama local (liste modeles + chat) | OK |
| Lecture fichiers + Git (status, log, diff, commit) | OK, sandbox `ALLOWED_ROOTS` |
| 12 APIs cloud sans compte perso | OK (meteo, heure, news, traduction, NASA APOD, etc.) |
| Deploiement distant / HTTP public | Pas encore (roadmap v1.0.0) |
| Memoire partagee, sante Lyla, n8n | Planifies, pas livres |

**Ce que ca demontre :** capacite a concevoir un outil technique documente, teste, versionne, utile dans un ecosysteme IA personnel (vault Obsidian + agents + LLM local). Projet en **pause fonctionnelle** : le socle est la, la suite viendra avec Lyla / Agent-Communication.

**Auteur :** Peter UFENS · licence MIT.

---

| Sujet | Fichier |
|---|---|
| Config Cursor | [docs/cursor-config.md](docs/cursor-config.md) |
| Config Claude Desktop | [docs/claude-desktop-config.md](docs/claude-desktop-config.md) |
| Catalogue outils | [docs/tool-catalog.md](docs/tool-catalog.md) |
| Roadmap | [docs/roadmap.md](docs/roadmap.md) |
| Ajouter un outil | [docs/GUIDE-AJOUTER-OUTIL.md](docs/GUIDE-AJOUTER-OUTIL.md) |
| ADR serveur (heritage, identite) | [docs/adr/](docs/adr/) — **musée** ; regles actives = hub Iris-MCP |
| Identite Iris | [docs/identity/](docs/identity/) |
| ~~mcp-cursor-config~~ | **obsolete** → `cursor-config.md` |

## Demarrage rapide

```bash
cd iris-mcp-server
npm install
cp .env.example .env   # editer ALLOWED_ROOTS si besoin
npm run build
npm test
node dist/index.js     # stdio MCP (lance par Cursor/Claude)
```

Brancher dans Cursor ou Claude : voir `docs/cursor-config.md` / `docs/claude-desktop-config.md`.

## Outils disponibles (v0.4.2 — 21)

| ID | Categorie | Description courte |
|---|---|---|
| `iris-ping-v1` | iris | Healthcheck version, uptime, liste outils |
| `ollama-list-v1` | ollama | Modeles Ollama locaux |
| `ollama-chat-v1` | ollama | Chat avec un modele Ollama |
| `fs-read-v1` | filesystem | Lit un fichier (ALLOWED_ROOTS) |
| `fs-list-v1` | filesystem | Liste un repertoire (ALLOWED_ROOTS) |
| `git-status-v1` | git | Statut Git d'un repo |
| `git-log-v1` | git | Derniers commits |
| `git-diff-v1` | git | Diff staged / unstaged / head |
| `git-commit-v1` | git | Commit (fichiers deja stages) |
| `weather-v1` | cloud | Meteo (lat/lon, Open-Meteo) |
| `time-v1` | cloud | Heure par fuseau (WorldTimeAPI) |
| `ip-info-v1` | cloud | Geoloc IP |
| `exchange-rates-v1` | cloud | Taux de change |
| `holidays-v1` | cloud | Jours feries par pays |
| `dictionary-v1` | cloud | Definition mot anglais |
| `geocoding-v1` | cloud | Ville → coordonnees GPS |
| `sunrise-v1` | cloud | Lever / coucher soleil |
| `news-v1` | cloud | Titres Hacker News |
| `translate-v1` | cloud | Traduction (MyMemory) |
| `random-fact-v1` | cloud | Fait aleatoire |
| `nasa-apod-v1` | cloud | Image astronomique du jour (DEMO_KEY) |

Detail : [docs/tool-catalog.md](docs/tool-catalog.md).

## Architecture

```
iris-mcp-server/
├── src/
│   ├── index.ts              # Point d'entree stdio
│   ├── server.ts             # McpServer + enregistrement outils
│   ├── version.ts            # Version depuis package.json
│   ├── tools/
│   │   ├── _types.ts         # Interface IrisTool
│   │   ├── _registry.ts      # Auto-decouverte
│   │   └── *-v1.ts           # 21 outils
│   └── utils/
│       ├── env.ts
│       ├── path-guard.ts     # ALLOWED_ROOTS, anti traversal
│       └── git-guard.ts
├── tests/                    # Vitest (88 tests)
├── docs/
├── dist/                     # Build TypeScript
└── package.json
```

## Ajouter un outil

Deposer un fichier dans `src/tools/`, exporter `tool: IrisTool`, `npm run build`. Voir [GUIDE-AJOUTER-OUTIL.md](docs/GUIDE-AJOUTER-OUTIL.md).

## File reprise (hors ce repo)

- `lyla-health-v1`, `memory-read/write-v1` (Lyla)
- MCP Bitwarden, catalogue apps PC (projet Iris-MCP hub)
- Transport HTTP/SSE (v1.0.0 roadmap)

## Licence

MIT. Voir [LICENSE](LICENSE).
