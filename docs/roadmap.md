# Roadmap iris-mcp-server

> **Etat live (2026-08-07) :** **v0.5.0 livree** · **24 outils** · **205 tests** · repo **public** GitHub.  
> Extensions (memoire, Lyla, HTTP/SSE) : roadmap, pas urgent.

---

## Etat present : v0.5.0 (aout 2026)

| Palier | Contenu | Statut |
|---|---|---|
| v0.2.0 | ping, ollama×2, fs×2 | ✅ |
| v0.3.0 | git×4 | ✅ |
| v0.4.0 | 6 APIs cloud (meteo, heure, IP, devises, feries, dictionnaire) | ✅ |
| v0.4.2 | +6 APIs (geocoding, sunrise, news, translate, random-fact, NASA APOD) | ✅ |
| v0.5.0 | outils **web** : `fetch-url-v1`, `web-search-ddg-v1`, `wikipedia-search-v1` + garde anti-SSRF | ✅ |

Liste complete : [tool-catalog.md](tool-catalog.md).

**Avance sur le plan initial :** le lot web etait prevu en v0.6.0 et la memoire partagee
en v0.5.0. C'est le lot web qui a ete livre en premier (besoin reel de Karen / Sharon),
donc il porte le numero 0.5.0. La memoire partagee garde son contenu, decalee ci-dessous.
Decision et regles de securite : ADR-0005 (hub Iris-MCP) et [securite-web.md](securite-web.md).

---

## Roadmap a venir (non engagee tant que pause)

Les sections ci-dessous decrivent la **vision** Sharon (mai 2026). Dates indicatives, reversibles.

### v0.4.5 — APIs etendues

Largement **deja livre** en v0.4.2 (geocoding, sunrise, news, translate, random-fact, nasa-apod).

### Memoire partagee locale (ex v0.5.0, a replanifier)

`memory-write-v1`, `memory-read-v1`, `memory-search-v1` (JSON V1, extensible Qdrant).
Non livre : le numero 0.5.0 a ete pris par le lot web.

### ~~v0.6.0 — Recherche web gratuite~~ : **livre en v0.5.0**

`web-search-ddg-v1`, `wikipedia-search-v1`, `fetch-url-v1` : livres le 2026-08-07.
Reste ouvert sur ce theme (non engage) : recherche web indexee avec cle (Brave Search
API, `BRAVE_API_KEY` commente dans `.env.example`), l'Instant Answer de DuckDuckGo ne
couvrant pas tout le web.

### v0.7.0 — Surveillance ecosysteme

`lyla-health-v1`, `ollama-status-v1`, `system-stats-v1`.

### v0.8.0 — Routing intelligent

`route-v1` (choix LLM local vs cloud).

### v0.9.0 — Registres dynamiques

`agent-list/add/update`, `model-list/add/remove/test`.

### v1.0.0 — Transport HTTP/SSE + exposition distante

- Transport HTTP/SSE en parallele de stdio
- Integration Cloudflare tunnel
- **Demo VAE / portfolio** : milestone cible pour montrer « Mon IA accessible de partout »
- **Bascule repo public GitHub** possible apres Lot Securite (auth, rate-limit, audit deps)

---

## Securite (etat reel v0.5.0)

iris-mcp-server suit les bonnes pratiques MCP quand c'est applicable en **mode lab local** :

| Mesure | Detail |
|---|---|
| Validation inputs | Zod sur chaque outil |
| Filesystem | Sandbox `ALLOWED_ROOTS`, anti path-traversal |
| Reseau runtime | Ollama localhost + **appels HTTP sortants** vers APIs cloud listees (meteo, news, NASA, etc.) |
| URL fournies par le client | Garde anti-SSRF (`url-guard.ts`) : https only, hotes locaux / IP privees / metadonnees cloud refuses, DNS revalide, redirections limitees a 3, plafonds taille et timeout. Voir [securite-web.md](securite-web.md) |
| Secrets | Pas de token perso dans le code ; `.env` local ; NASA utilise **DEMO_KEY** publique (limite 30 req/h) |
| Git write | `git-commit-v1` limite aux repos sous `ALLOWED_ROOTS` |

### Avant bascule publique ou v1.0.0 HTTP distant

Lot Securite dedie (auth, rate-limit, audit logs, durcissement `ollama-list` endpoint, plafond `fs-read`, HTTPS time-v1, etc.). Voir audit croise Iris-MCP 2026-07-26.

---

## Outils de developpement

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

### Complement CLI (parké, hub 2026-09-02)

CLI mince **optionnel** (ping, list-tools, debug) reutilisant les modules `src/`,
sans refaire les 24 outils en commandes. MCP reste le canal principal pour les clients IA.
Detail : hub `planning/backlog-cli-iris-2026-09-02.md` (projet Iris-MCP **`cloture`**).

## Hors scope (projets separes)

- **n8n / Nora** : orchestration (appelle Iris)
- **Ollama / Lana** : LLM local
- **Lyla-OS** : produit compagne
- **Hub Iris-MCP** (`D:\IA-CURSOR\Iris-MCP`) : planning, ADR, configs

## References

- [docs/adr/](adr/) — heritage Hybrid (lire bandeau contexte)
- [docs/identity/](identity/) — manifeste / persona Iris
- Specification MCP : https://modelcontextprotocol.io/

---

*Roadmap initiale : 2026-05-03 Sharon · MAJ etat live : 2026-07-27 Karen (audit V2) · MAJ lot web v0.5.0 : 2026-08-07 Claude Code.*
