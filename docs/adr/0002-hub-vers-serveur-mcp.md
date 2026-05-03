# ADR-0002 : Abandon du hub n8n au profit d'un serveur MCP custom

| Champ       | Valeur                                    |
|-------------|-------------------------------------------|
| **Statut**  | Accepte                                   |
| **Date**    | 2026-04-11 (decision Peter 18h00)         |
| **Auteur**  | Peter (decision), Sharon-001 (redaction)  |
| **Tags**    | architecture, mcp, n8n, pivot, fondation  |

## Contexte

Le plan v8 et le plan v9 (sections 1-3) prevoyaient un **hub n8n centralise**
comme orchestrateur principal d'Iris, avec CrewAI + LiteLLM + n8n en 5 couches.

Le 11/04/2026 a 18h00, Peter a eu une "illumination" et a propose un virage
architectural complet : remplacer le hub n8n par un **serveur MCP custom**
(Model Context Protocol, standard Anthropic).

Raisons invoquees par Peter :
- Un hub n8n = vendor lock-in visuel, pas standard, pas natif Cursor/Claude
- Un serveur MCP = protocole standard, natif dans Cursor (2025+) et Claude
  Desktop (2024+), modulaire, evolutif
- Chaque outil doit avoir un **ID unique** permettant la cohabitation de
  versions (ex: outlook-v1 + outlook-v2)
- Le serveur doit etre le **point d'entree unique** de tout l'ecosysteme
- Mise a jour tous les **4 mois** (pas 2, jugee trop frequente)

Reference : https://github.com/modelcontextprotocol/servers (7 serveurs
officiels de reference)

## Decision

Nous abandonnons l'architecture hub n8n au profit d'un **serveur MCP custom
TypeScript** (`iris-mcp-server/`).

- **Transport** : stdio (Cursor, Claude Desktop) + HTTP/SSE (futur cluster)
- **SDK** : `@modelcontextprotocol/sdk` (TypeScript)
- **Validation** : Zod (schemas entree/sortie par tool)
- **Tests** : Vitest
- **Identification** : chaque tool a un ID unique format `<nom>-v<version>`
- **12 tools envisages** : voir `iris-mcp-server/README.md`

## Alternatives rejetees

| Alternative | Avantages | Inconvenients | Raison du rejet |
|-------------|-----------|---------------|-----------------|
| Hub n8n centralise | Workflow visuel, communaute | Pas MCP natif, vendor lock-in, overhead | Peter veut standard MCP |
| LangFlow | Open source, visual | Python-only, pas MCP natif | Pas standard |
| Dify | RAG integre, UI | SaaS-oriented, pas local-first | Budget 0 EUR |
| OpenWebUI | UI chat | Pas un orchestrateur, pas MCP | Mauvais scope |
| RAGFlow | RAG specialise | Trop niche, pas modulaire | Pas le bon outil |

## Consequences

### Positives
- Natif Cursor + Claude Desktop (zero config supplementaire)
- Standard Anthropic = perennite, pas de vendor lock-in
- 1 tool = 1 fichier (KISS, Single Responsibility)
- Cohabitation de versions via ID unique
- Extensible par ajout de fichiers, sans refonte

### Negatives / Risques
- n8n existant (Karen) n'est plus le centre — Karen garde son hub n8n
  pour ses propres endpoints, mais Iris ne l'utilise plus comme orchestrateur
- Plus de code a ecrire qu'un workflow visuel (TS vs drag-and-drop)
- Le MCP SDK TypeScript est recent — documentation encore en evolution

### Neutres
- Les 5 couches du plan v9 restent conceptuellement valides, mais la
  couche 3 (n8n) est remplacee par le serveur MCP
- Karen conserve son hub n8n — pas de destruction, juste un changement
  de centre de gravite

## Impact sur le plan v9

Le plan v9 doit etre lu avec les corrections suivantes :
- **Ligne 147** : "Orchestratrice Hub" → "Serveur MCP custom"
- **Section 3 (5 couches)** : couche 3 n8n → couche 3 iris-mcp-server
- **Toute mention de "hub central"** → "serveur MCP"
- Le reste du plan v9 (posture, cloisonnement, ADR, presentations,
  memoire 16 couches, ReAct loop) reste **inchange**

## References

- Plan v9 section 1-3 (architecture originale hub, maintenant depassee)
- Session Sharon-001 du 11/04/2026 18h00 (decision Peter verbatim)
- https://github.com/modelcontextprotocol/servers
- https://spec.modelcontextprotocol.io/
- `iris-mcp-server/README.md` (architecture cible)
- `tech-watch/update-policy.json` (politique 4 mois)
