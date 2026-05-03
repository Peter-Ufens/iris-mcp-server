# V1 - Tool filesystem

## Objectif

Implementer un serveur MCP minimal exposant 1 seul tool : lecture/ecriture
de fichiers dans un dossier sandboxe. Verifier l'interoperabilite avec
Claude Desktop, Cursor, et n8n.

## Critere de validation

- [ ] `uv run server.py` demarre le serveur sans erreur.
- [ ] Claude Desktop voit le serveur dans sa config MCP et peut lister
      les fichiers du sandbox.
- [ ] Cursor en mode agent peut appeler le tool et recevoir une reponse.
- [ ] n8n connecte le serveur via un node MCP et peut declencher
      une lecture/ecriture.
- [ ] Tests pytest passent (couverture > 60%).
- [ ] Logs JSON Lines emis pour chaque appel.
- [ ] `/health` retourne 200 OK avec timestamp.

## Manques inclus en V1 (parmi les 8 identifies par Sharon)

1. Auth simple via token (.env)
2. Logging structure (JSON Lines)
3. Healthcheck `/health`
4. Configuration centralisee (.env + pydantic settings)
5. Tests automatises (pytest)

## Manques reportes en V2 ou V3

6. Documentation OpenAPI : V2 (avec API REST)
7. Rate-limiting : V2
8. Versioning des tools : V3 (quand il y aura plusieurs tools)

## Etapes d'implementation (Lot G futur)

A definir dans le brief Lot G.
