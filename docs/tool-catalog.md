# Catalogue des outils MCP - iris-mcp-server v0.5.0

25 outils operationnels avec auto-decouverte (`src/tools/_registry.ts`).  
Chaque outil a un ID unique versionne (`<nom>-v<version>`).

## iris (1)

| ID | Fichier | Description |
|---|---|---|
| `iris-ping-v1` | `iris-ping-v1.ts` | Healthcheck : version, uptime, liste des outils, timestamp |

## ollama (2)

| ID | Fichier | Description |
|---|---|---|
| `ollama-list-v1` | `ollama-list-v1.ts` | Liste les modeles Ollama (`GET /api/tags`) |
| `ollama-chat-v1` | `ollama-chat-v1.ts` | Chat avec un modele Ollama (`POST /api/chat`) |

## memory (1)

Ajoute en phase 2 RAG (2026-09-02).

| ID | Fichier | Description |
|---|---|---|
| `rag-query-v1` | `rag-query-v1.ts` | Interroge le RAG vault (Qdrant `:6334` + embeddings Ollama) |

| Outil | Entrees | Sorties |
|---|---|---|
| `rag-query-v1` | `query` (requis), `limit` (1-25, defaut 5), `project`, `sourceContains`, `includeZoneA` (defaut false) | `hits[]` (`score`, `sourceFile`, `source_filename`, `excerpt`), `meta` (`filterZoneA`, `intimeAlwaysFiltered`, `zonePatternsVersion`, `excludePatterns`, `count`, `collection`, `error?`) |

**Gouvernance Zone A - non negociable.** Par defaut les conversations brutes sont
exclues. `includeZoneA: true` ouvre les conversations brutes (Copilot, Ollama, Claude)
mais **jamais** la zone sensible A-2 (liste complete dans le depot prive
`iris-mcp-server-private`, fichier `zone-a-patterns.json`).
Les motifs sont charges via la variable d'environnement `ZONE_A_PATTERNS_FILE`.
Ouvrir la zone sensible reste un geste manuel de Peter via
`query-rag.ps1 -IncludeZoneA -AllowIntime`.

Details ops : depot prive `iris-mcp-server-private` · hub RAG local.

## filesystem (2)

| ID | Fichier | Description |
|---|---|---|
| `fs-read-v1` | `fs-read-v1.ts` | Lit un fichier (sandbox `ALLOWED_ROOTS`) |
| `fs-list-v1` | `fs-list-v1.ts` | Liste un repertoire (sandbox `ALLOWED_ROOTS`) |

## git (4)

| ID | Fichier | Description |
|---|---|---|
| `git-status-v1` | `git-status-v1.ts` | Statut Git (staged, unstaged, untracked) |
| `git-log-v1` | `git-log-v1.ts` | N derniers commits |
| `git-diff-v1` | `git-diff-v1.ts` | Diff staged / unstaged / head |
| `git-commit-v1` | `git-commit-v1.ts` | Commit (fichiers deja stages uniquement) |

## cloud / APIs publiques (12)

Sans cle API perso sauf NASA (DEMO_KEY integree).

| ID | Fichier | API / source |
|---|---|---|
| `weather-v1` | `weather-v1.ts` | Open-Meteo (lat/lon requis) |
| `time-v1` | `time-v1.ts` | WorldTimeAPI |
| `ip-info-v1` | `ip-info-v1.ts` | ip-api.com |
| `exchange-rates-v1` | `exchange-rates-v1.ts` | open.er-api.com |
| `holidays-v1` | `holidays-v1.ts` | date.nager.at |
| `dictionary-v1` | `dictionary-v1.ts` | dictionaryapi.dev |
| `geocoding-v1` | `geocoding-v1.ts` | Open-Meteo Geocoding |
| `sunrise-v1` | `sunrise-v1.ts` | sunrise-sunset.org |
| `news-v1` | `news-v1.ts` | Hacker News (Algolia) |
| `translate-v1` | `translate-v1.ts` | MyMemory |
| `random-fact-v1` | `random-fact-v1.ts` | uselessfacts.jsph.pl |
| `nasa-apod-v1` | `nasa-apod-v1.ts` | NASA APOD (DEMO_KEY) |

## web (3)

Ajoutes en v0.5.0. Sans cle API. Regles reseau : [securite-web.md](securite-web.md)
(https only, hotes locaux et IP privees refuses, plafonds, redirections limitees).

| ID | Fichier | API / source |
|---|---|---|
| `fetch-url-v1` | `fetch-url-v1.ts` | GET https direct, garde SSRF, texte plafonne (HTML converti en texte) |
| `web-search-ddg-v1` | `web-search-ddg-v1.ts` | DuckDuckGo Instant Answer (api.duckduckgo.com) |
| `wikipedia-search-v1` | `wikipedia-search-v1.ts` | API MediaWiki (`<lang>.wikipedia.org`) |

Entrees / sorties principales :

| Outil | Entrees | Sorties |
|---|---|---|
| `fetch-url-v1` | `url` (https), `max_chars` (200 a 200000) | `url`, `final_url`, `status`, `content_type`, `format`, `text`, `truncated`, `bytes_approx`, `redirects` |
| `web-search-ddg-v1` | `query` (1-200), `limit` (1-8, defaut 5) | `query`, `source`, `count`, `results[]` (`title`, `url`, `snippet`), `note` si vide |
| `wikipedia-search-v1` | `query` (1-200), `lang` (defaut `fr`), `limit` (1-8, defaut 5) | `query`, `lang`, `count`, `total_hits`, `results[]` (`title`, `pageid`, `url`, `snippet`) |

Limite connue : `web-search-ddg-v1` s'appuie sur l'API Instant Answer, qui n'est pas un
index web complet. Sur une requete pointue elle peut ne rien retourner : l'outil renvoie
alors `results: []` et une `note`, pas une erreur.

## Pattern d'ID

`<nom>-v<version>`. Nouvelle version = nouvel ID (cohabitation possible).

## Outils a venir

Voir [roadmap.md](roadmap.md) : memory, lyla-health, HTTP/SSE, etc.

## Ajouter un outil

Voir [GUIDE-AJOUTER-OUTIL.md](GUIDE-AJOUTER-OUTIL.md).
