# Roadmap iris-mcp-server

> **Etat live (2026-07-27) :** **v0.4.2 livree** · **21 outils** · **88 tests** · repo **public** GitHub.  
> Extensions (memoire, Lyla, HTTP/SSE) : roadmap, pas urgent.

---

## Etat present : v0.4.2 (livre mai 2026, stable juillet 2026)

| Palier | Contenu | Statut |
|---|---|---|
| v0.2.0 | ping, ollama×2, fs×2 | ✅ |
| v0.3.0 | git×4 | ✅ |
| v0.4.0 | 6 APIs cloud (meteo, heure, IP, devises, feries, dictionnaire) | ✅ |
| v0.4.2 | +6 APIs (geocoding, sunrise, news, translate, random-fact, NASA APOD) | ✅ |

Liste complete : [tool-catalog.md](tool-catalog.md).

---

## Roadmap a venir (non engagee tant que pause)

Les sections ci-dessous decrivent la **vision** Sharon (mai 2026). Dates indicatives, reversibles.

### v0.4.5 — APIs etendues

Largement **deja livre** en v0.4.2 (geocoding, sunrise, news, translate, random-fact, nasa-apod).

### v0.5.0 — Memoire partagee locale

`memory-write-v1`, `memory-read-v1`, `memory-search-v1` (JSON V1, extensible Qdrant).

### v0.6.0 — Recherche web gratuite

`web-search-ddg-v1`, `wikipedia-search-v1`, `fetch-url-v1`.

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

## Securite (etat reel v0.4.2)

iris-mcp-server suit les bonnes pratiques MCP quand c'est applicable en **mode lab local** :

| Mesure | Detail |
|---|---|
| Validation inputs | Zod sur chaque outil |
| Filesystem | Sandbox `ALLOWED_ROOTS`, anti path-traversal |
| Reseau runtime | Ollama localhost + **appels HTTP sortants** vers APIs cloud listees (meteo, news, NASA, etc.) |
| Secrets | Pas de token perso dans le code ; `.env` local ; NASA utilise **DEMO_KEY** publique (limite 30 req/h) |
| Git write | `git-commit-v1` limite aux repos sous `ALLOWED_ROOTS` |

### Avant bascule publique ou v1.0.0 HTTP distant

Lot Securite dedie (auth, rate-limit, audit logs, durcissement `ollama-list` endpoint, plafond `fs-read`, HTTPS time-v1, etc.). Voir audit croise Iris-MCP 2026-07-26.

---

## Outils de developpement

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

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

*Roadmap initiale : 2026-05-03 Sharon · MAJ etat live : 2026-07-27 Karen (audit V2).*
