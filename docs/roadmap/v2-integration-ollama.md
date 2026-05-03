# V2 - Integration Ollama + API REST

## Objectif

Etendre le serveur MCP V1 pour :
- Permettre aux LLM Ollama locaux d'utiliser les tools MCP.
- Exposer une API REST publique (port distinct ou sous-chemin).
- Securiser l'acces distant (Cloudflare tunnel + auth durcie).

## Critere de validation

- [ ] Un script Python qui pilote Ollama via le MCP.
- [ ] Endpoint `/api/tools/{name}` POST en REST avec auth token.
- [ ] Documentation OpenAPI auto-generee accessible a `/docs`.
- [ ] Collection Bruno dans `bruno/` couvrant tous les endpoints REST.
- [ ] Rate-limiting actif (10 req/sec par defaut).
- [ ] Tunnel Cloudflare configurable via .env.

## Tools cibles V2

- filesystem (V1)
- ollama (chat completion locale)
- weather (API publique gratuite, ex: open-meteo.com)
- time (heure courante)
