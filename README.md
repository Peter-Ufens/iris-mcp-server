# iris-mcp-server

> Repo GitHub public : [github.com/Peter-Ufens/iris-mcp-server](https://github.com/Peter-Ufens/iris-mcp-server)  
> Projet perso · reconversion ingenieur IA (Peter UFENS) · lab local-first.

Serveur MCP (Model Context Protocol) modulaire pour **Iris** : multiprise outils pour Cursor, Claude Desktop et Ollama.

**Version :** `0.13.0` · **31 outils** · Vitest · licence **Apache-2.0**.

---

## Pour les visiteurs (conseiller FT, recruteurs, curieux)

**C'est quoi ?** Un serveur qui branche des assistants IA (Cursor, Claude) sur des outils concrets : fichiers locaux, Git, Ollama (LLM local), APIs publiques (meteo, traduction, etc.). Standard ouvert [Model Context Protocol](https://modelcontextprotocol.io/).

**Presentation grand public (Gamma) :**
- Produit Iris : [Iris-MCP : brancher les IA sur des outils reels](https://gamma.app/docs/Iris-MCP-brancher-les-IA-sur-des-outils-reels-rzpbly9kqpju074)
- Concept MCP (voisin) : [MCP explique simplement](https://gamma.app/docs/MCP-explique-simplement-zdk7hi92hsxsnn1)

**Ce qui fonctionne aujourd'hui (novembre 2026)**

| Element | Etat |
|---|---|
| 31 outils MCP operationnels | OK, testes (Vitest) |
| Integration Cursor + Claude Desktop | OK (stdio local) |
| Ollama local (liste modeles + chat) | OK |
| Lecture fichiers + Git (status, log, diff, commit) | OK, sandbox `ALLOWED_ROOTS` |
| APIs cloud sans compte perso | OK (meteo, news HN, traduction, NASA APOD, etc.) |
| Heure locale (`time-v1`) | OK, Intl serveur |
| Debit reseau (`connectivite-v1`) | OK, sonde locale |
| Outils web (fetch, `web-search-v2`, Wikipedia, actu RSS) | OK, garde anti-SSRF ([securite-web.md](docs/securite-web.md)) |
| RAG vault (`rag-query-v1` + `rag-search-v2` + `rag-hybrid-v1`) | OK, local (Qdrant + Ollama) · sans embeddings : `rag-hybrid-v1` en mots exacts |
| Journal des recherches RAG (opt-in) | OK, desactive par defaut |
| Zone reservee (opt-in) | OK, fermee par defaut |
| Deploiement distant / HTTP public | Pas encore (roadmap) |

**Auteur :** Peter UFENS · licence **Apache-2.0** (voir [LICENSE](LICENSE) et [NOTICE](NOTICE)).

---

| Sujet | Fichier |
|---|---|
| Config Cursor | [docs/cursor-config.md](docs/cursor-config.md) |
| Config Claude Desktop | [docs/claude-desktop-config.md](docs/claude-desktop-config.md) |
| Catalogue outils | [docs/tool-catalog.md](docs/tool-catalog.md) |
| Securite outils web (SSRF, plafonds) | [docs/securite-web.md](docs/securite-web.md) |
| Roadmap | [docs/roadmap.md](docs/roadmap.md) |
| Ajouter un outil | [docs/GUIDE-AJOUTER-OUTIL.md](docs/GUIDE-AJOUTER-OUTIL.md) |
| ADR serveur (heritage) | [docs/adr/](docs/adr/) |
| Identite Iris | [docs/identity/](docs/identity/) |

## Demarrage rapide

```bash
cd iris-mcp-server
npm install
cp .env.example .env   # editer ALLOWED_ROOTS si besoin
npm run build
npm test
node dist/index.js     # stdio MCP (lance par Cursor/Claude)
```

Cle Qdrant (RAG) : en pratique, Iris lit souvent une cle **lecture seule** depuis un fichier d'environnement voisin du labo (ex. `../RAG/stack/.env`). Ne jamais committer de secret.

Brancher dans Cursor ou Claude : voir `docs/cursor-config.md` / `docs/claude-desktop-config.md`.

## Outils disponibles (v0.13.0 - 31)

| ID | Categorie | Description courte |
|---|---|---|
| `iris-ping-v1` | iris | Healthcheck version, uptime, liste outils |
| `time-v1` | iris | Heure / date par fuseau |
| `connectivite-v1` | iris | Mesure de debit (OK / SLOW / DOWN) |
| `ollama-list-v1` | ollama | Modeles Ollama locaux |
| `ollama-chat-v1` | ollama | Chat avec un modele Ollama |
| `fs-read-v1` | filesystem | Lit un fichier (`ALLOWED_ROOTS`) |
| `fs-list-v1` | filesystem | Liste un repertoire |
| `git-status-v1` | git | Statut Git |
| `git-log-v1` | git | Derniers commits |
| `git-diff-v1` | git | Diff staged / unstaged / head |
| `git-commit-v1` | git | Commit (fichiers deja stages) |
| `weather-v1` | cloud | Meteo (Open-Meteo, prevision horaire optionnelle) |
| `ip-info-v1` | cloud | Geoloc IP |
| `exchange-rates-v1` | cloud | Taux de change |
| `holidays-v1` | cloud | Jours feries (dont region Alsace-Moselle) |
| `dictionary-v1` | cloud | Definition mot anglais |
| `geocoding-v1` | cloud | Ville vers coordonnees |
| `sunrise-v1` | cloud | Lever / coucher soleil |
| `news-v1` | cloud | Titres Hacker News |
| `translate-v1` | cloud | Traduction |
| `random-fact-v1` | cloud | Fait aleatoire |
| `nasa-apod-v1` | cloud | Image astronomique du jour |
| `fetch-url-v1` | web | Contenu texte d'une URL https (garde SSRF) |
| `web-search-v2` | web | Recherche web (SearXNG local / repli DDG) |
| `web-search-ddg-v1` | web | DuckDuckGo Instant Answer |
| `wikipedia-search-v1` | web | Recherche Wikipedia |
| `actu-rss-v1` | web | Actualite (RSS + Bing + zone officiel) |
| `rag-query-v1` | memory | RAG vault rapide |
| `rag-search-v2` | memory | RAG glossaire + reformulations |
| `rag-hybrid-v1` | memory | RAG vectoriel + lexical |
| `rag-journal-link-v1` | memory | Journal opt-in des recherches |

Detail : [docs/tool-catalog.md](docs/tool-catalog.md).

## Architecture

```
iris-mcp-server/
├── src/
│   ├── index.ts
│   ├── server.ts
│   ├── tools/          # 31 outils auto-decouverts
│   └── utils/          # gardes path / URL / HTTP / RAG
├── tests/              # Vitest
├── docs/
├── dist/
├── LICENSE             # Apache-2.0
├── NOTICE
└── package.json
```

## Licence

Apache License 2.0. Voir [LICENSE](LICENSE) et [NOTICE](NOTICE).
