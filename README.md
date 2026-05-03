# mcp-server

Serveur MCP personnel exposant des tools a un ecosysteme d'agents IA (Claude Desktop, Cursor, Ollama, n8n).

## Statut

roadmap (pre-implementation V1).

## Public vise

Profils techniques IA, integrateurs MCP, jury technique pour evaluation portfolio.

## Objectif du projet

- Centraliser les capacites accessibles aux agents IA (filesystem, web, APIs publiques, controle systeme).
- Permettre aux LLM locaux (Ollama) de devenir de vrais agents capables d'agir.
- Exposer une API REST pour les usages humains/scripts (testable via Bruno).
- Servir de socle pour l'integration Cloudflare tunnel (acces distant via smartphone).

## Pre-requis

- Python 3.11 ou plus
- `uv` (`winget install --id=astral-sh.uv`)
- Compte Cloudflare (pour exposition distante, V2+)
- Ollama installe en local (pour V2+)

## Architecture cible

```
[Smartphone/N8N/Telegram]
        |
        v
[Cloudflare Tunnel]
        |
        v
[Orchestrateur Nora N8N]  --> lit AGENTS.md au demarrage
        |
        v
[Ollama LLM local]
   <-> JSON-RPC <->
[mcp-server (ce repo) ]  --> tools : filesystem, web, ollama, etc.
        |
        v
[Action sur le PC de Peter]
```

## Roadmap

| Version | Contenu | Statut |
|---|---|---|
| V1 | 1 tool filesystem MCP, interop Claude Desktop / Cursor / n8n | pre-implementation |
| V2 | Integration Ollama (Ollama agent via MCP), API REST extension | pre-implementation |
| V3 | Auto-orchestration (selection LLM dynamique) | pre-implementation |

Chacune detaillee dans `docs/roadmap/`.

## Securite et limites assumees

- Pas d'auth en V1 local (loopback uniquement). Auth obligatoire des V2 (exposition distante).
- Pas de rate-limiting en V1. A introduire en V2.
- Logs structures (JSON Lines) en V1.

## Comment contribuer / etendre

Reserve pour V1 (sera enrichi en V2).

## Licence

MIT.
