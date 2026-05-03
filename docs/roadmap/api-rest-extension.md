# Extension API REST

## Role

La couche REST expose les memes capacites que MCP sous forme HTTP pour les humains, les scripts et les clients comme Bruno. MCP reste le canal privilegie pour les agents ; REST complete pour debug, automation et usages mobiles.

## Architecture prevue

- Partage de la logique via une couche `tools/` commune (voir ADR 0003).
- FastAPI ou Starlette pour l'implementation HTTP ; decision finale en V2.
- Prefixe suggere : `/api/` pour les routes applicatives, `/health` pour le probe.

## Conventions

- Corps JSON pour POST ; codes HTTP standards (200, 401, 429, 500).
- Auth : header `Authorization: Bearer <token>` aligne sur `MCP_AUTH_TOKEN` en V2 distant.
- Les erreurs renvoient un corps JSON minimal `{ "detail": "..." }`.

## Documentation et tests

- OpenAPI / Swagger sous `/docs` une fois le framework choisi.
- Collections Bruno dans `bruno/` ; environnements locaux exclus du depot (voir `.gitignore`).

## Relation avec la roadmap

- Details fonctionnels : `docs/roadmap/v2-integration-ollama.md`.
- Cette fiche reste le point d'entree transverse pour la couche REST.
