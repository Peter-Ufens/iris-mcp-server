# ADR-0003 : Pivot Python (uv) -> TypeScript pour iris-mcp-server

| Champ       | Valeur                                          |
|-------------|-------------------------------------------------|
| **Statut**  | Accepte                                         |
| **Date**    | 2026-05-03                                      |
| **Auteur**  | Peter (decision), Sharon (Claude Code, redaction) |
| **Tags**    | architecture, stack, mcp, pivot                 |

## Contexte

Le 2026-05-03, deux scaffolds existaient pour le serveur MCP de Peter :

1. **`Peter-Ufens/mcp-server`** (Python + uv) : scaffold cree au Lot F le matin du 2026-05-03, basee sur la decision du cours Udemy MCP de Nikolai Schuller (Python + uv). Pas de code fonctionnel.

2. **`D:\Hybrid-Agentic-Studio\iris-mcp-server\`** (TypeScript + npm) : code fonctionnel cree par Sharon-001 le 2026-04-12, avec outils operationnels (`iris-ping-v1`, `ollama-list-v1`, `ollama-chat-v1`, `fs-read-v1`, `fs-list-v1`), tests Vitest, configs Cursor + Claude Desktop documentees. Base sur ADR-0002 (hub n8n -> serveur MCP custom).

Sharon (Claude Code) a fait l'analyse comparative et recommande TypeScript. Peter a valide.

## Decision

Adopter le code TypeScript existant de `Hybrid-Agentic-Studio/iris-mcp-server/` comme base pour le repo prive `Peter-Ufens/iris-mcp-server`. Abandonner le scaffold Python (archive en local : `D:\Audit-GitHub\repos\mcp-server-python-bak\`).

Stack figee :

- TypeScript strict
- Node.js 20+
- `@modelcontextprotocol/sdk` (TypeScript officiel)
- Validation Zod
- Tests Vitest
- Transport stdio (HTTP/SSE plus tard)
- IDs uniques versionnees pour chaque tool (`<nom>-v<version>`)

## Alternatives rejetees

| Alternative | Raison du rejet |
|-------------|-----------------|
| Garder Python (uv) et reecrire from scratch | Jeter du code fonctionnel + ADRs deja redigees (gachis) |
| Faire les deux en parallele | Duplication, confusion entretien long terme |
| Reecrire le TypeScript en Python | Sur-effort sans gain (SDK Python plus jeune que TS) |

## Consequences

### Positives

- Reutilisation du code teste : plusieurs outils operationnels des le commit pivot.
- ADRs existantes (0001 alliee familiale, 0002 abandon hub n8n) recuperees.
- Identity Iris (manifeste, persona) recuperee.
- Drafts precieux (sprint-1, prompt-managed-agent) recuperes pour Lot G.
- Documentation MCP existante (Cursor, Claude Desktop, gateway research) recuperee.
- Stack TypeScript SDK MCP plus mature en mai 2026 que le SDK Python.

### Negatives

- Decision cours Udemy MCP (uv + Python) reportee pour un futur projet d'apprentissage personnel.
- Le scaffold Python du Lot F (commit `eb694ed`) est ecrase dans l'historique Git du repo renomme (backup local `mcp-server-python-bak`).
- Effort de migration : ordre de grandeur 30-40 min operateur.

## Suite

- Lot G futur : implementer le sprint-1 (`docs/drafts/sprint-1-socle-mcp-minimal.md`) si des ecarts restent par rapport a l'etat cible ; tag v0.3.0 quand le socle sera complet et teste.
