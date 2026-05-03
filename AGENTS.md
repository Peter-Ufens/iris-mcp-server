# AGENTS.md - Briefing pour les agents IA

Ce fichier est lu une seule fois au demarrage par les LLM/orchestrateurs
qui interagissent avec ce repo. Il fournit le contexte necessaire pour
agir intelligemment sans avoir a explorer le repo a chaque requete.

## A propos de ce projet

Ce repo est un serveur MCP personnel. Il expose des tools (capacites
nominatives) a des agents IA via le protocole Model Context Protocol.

## Contraintes a respecter

- Code en Python 3.11+ avec gestionnaire `uv` (pas `pip` directement).
- Toute modification structurelle doit faire l'objet d'un ADR dans
  `docs/adr/`.
- Les tools MCP doivent respecter la specification officielle :
  https://modelcontextprotocol.io/llms-full.txt
- Aucune dependance reseau implicite : tout appel externe doit etre
  documente et avoir un fallback.

## Versions et conventions

- V1 = 1 tool filesystem fonctionnel + interop validee.
- V2 = ajout Ollama et API REST.
- V3 = auto-orchestration (selection dynamique LLM).

## Comment etendre

1. Lire la specification MCP avant d'ajouter un tool.
2. Creer une ADR si la decision est structurelle.
3. Ecrire les tests pytest associes.
4. Documenter le tool dans le README.

## Securite

- Auth via token simple en V1 local. mTLS ou JWT en V2 distant.
- Logs structures (JSON Lines).
- Healthcheck `/health` toujours disponible.
