# Catalogue des outils MCP — iris-mcp-server v0.4.2

21 outils operationnels avec auto-decouverte (`src/tools/_registry.ts`).  
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

## Pattern d'ID

`<nom>-v<version>`. Nouvelle version = nouvel ID (cohabitation possible).

## Outils a venir

Voir [roadmap.md](roadmap.md) : memory, lyla-health, web-search, HTTP/SSE, etc.

## Ajouter un outil

Voir [GUIDE-AJOUTER-OUTIL.md](GUIDE-AJOUTER-OUTIL.md).
