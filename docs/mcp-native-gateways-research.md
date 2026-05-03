# Passerelles et serveurs MCP « natifs » — recherche (avril 2026)

**Contexte Peter** : tentatives Cursor + **LiteLLM** / proxy type **127.0.0.1:11434** pour parler à Ollama sans succès fiable ; idée d’un **hub** puis bascule vers **serveur MCP maison** (`iris-mcp-server`). En parallèle, recherche pour des solutions **MCP-first** (pas seulement OpenAI-compat) branchables dans **Cursor** et **Claude Desktop** avec clés API cloud quand besoin.

**Source du comparatif ci-dessous** : synthèse fournie par **Claude Code** à Peter, **intégrée et recoupée** par Iris (Cursor) le **2026-04-12**. Les dépôts GitHub listés ont été **vérifiés comme existants** à cette date ; les détails fonctionnels (modes « consensus », pourcentages d’économie de tokens, benchmarks « 50× ») restent à **valider en lisant le README / le code** de chaque projet — ce ne sont pas des faits établis par ce dépôt.

---

## Où est LiteLLM chez Peter (éviter la confusion)

Ce n’est **pas** un dossier `LiteLLM\` à la racine de `IA` : la config, les scripts et la doc vivent sous  
**`C:\Users\Peter\Desktop\Importants\IA\Ollama local\`** (voir `docs\litellm-cursor-proxy.example.yaml`, `docs\LITELLM-AUTOSTART-WINDOWS.md`). Carte complète : **`docs/peter-ia-infrastructure-map.md`**.

---

## Pourquoi ça peut mieux marcher que LiteLLM pour ton cas

- **LiteLLM** expose surtout une **API de type OpenAI** ; Cursor et les clients MCP attendent souvent un **canal MCP** ou une intégration modèle différente. Les échecs que tu décris sont **plausibles** sans que ce fichier diagnostique la cause exacte (réseau, config, version, pare-feu Windows, etc.).
- Un serveur **MCP** enregistré dans Cursor / Claude Desktop est un **processus stdio** (ou parfois HTTP/SSE) qui expose des **outils** au modèle : le chemin d’intégration est **celui prévu** par le protocole, pas un contournement via compatibilité REST.

---

## A) [pal-mcp-server](https://github.com/BeehiveInnovations/pal-mcp-server) (BeehiveInnovations)

**Observé (GitHub, 2026-04-12)** : dépôt public, description du type *Claude Code / GeminiCLI / CodexCLI + plusieurs fournisseurs (Gemini, OpenAI, OpenRouter, Azure, Grok, Ollama, etc.)* ; **~11k stars** — projet visiblement très suivi.

**À lire dans leur doc** : exactes capacités (routing, « consensus », mémoire persistante, sélection auto de modèle). Claude Code les a listées ; **non vérifiées ligne par ligne ici**.

**Config type (exemple, clés à mettre dans l’environnement du process MCP — jamais commitées)** :

```json
{
  "mcpServers": {
    "pal": {
      "command": "npx",
      "args": ["-y", "pal-mcp-server@latest"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "OLLAMA_BASE_URL": "http://localhost:11434"
      }
    }
  }
}
```

---

## B) [OllamaClaude](https://github.com/Jadael/OllamaClaude)

**Observé** : dépôt public, thème *MCP pour que Claude Code utilise Ollama local* ; **très peu d’étoiles** à la date vérifiée (~10). **Recommandation prudente** : lire issues / derniers commits avant de t’en servir en production ; comparer avec **pal** ou **ollama-mcp**.

---

## C) [ollama-mcp](https://github.com/rawveg/ollama-mcp)

**Observé** : serveur MCP dédié **Ollama** ; ~151 stars. Bon candidat comme **référence d’implémentation** pour des outils type list / chat / generate (aligné avec ce qu’on peut ajouter progressivement dans `iris-mcp-server`).

---

## D) [Bifrost](https://github.com/maximhq/bifrost) (maximhq)

**Observé** : gateway **Go**, positionnée comme alternative performante à LiteLLM ; support multi-fournisseurs annoncé sur le dépôt. Les chiffres marketing (« 50× », « &lt;100 µs ») viennent du **README upstream** — à traiter comme **affirmation éditeur**, pas comme mesure faite dans ce workspace.

---

## Comparatif rapide (intentionnel, pas un bench)

| Critère | pal-mcp-server | OllamaClaude | ollama-mcp | Bifrost |
|--------|----------------|--------------|------------|---------|
| Ollama local | annoncé | annoncé | oui (cœur) | annoncé |
| Plusieurs clouds (API keys) | annoncé | non (rôle différent) | non | annoncé |
| Cursor / Claude Desktop (MCP) | typique `npx` | à confirmer usage | typique `npx` | selon doc (client/serveur MCP) |
| Communauté visible (proxy) | très large | très petite | moyenne | large |

---

## Recommandation Iris pour **Hybrid-Agentic-Studio** (sans jeter le travail déjà fait)

1. **Composition, pas remplacement brutal** : tu peux avoir **deux entrées** `mcpServers` — par ex. **`iris`** (outils maison : ping, tags Ollama, futurs `lyla-health`, fs-safe, …) et **`pal`** ou **`ollama-mcp`** (routing / outils Ollama complets). Cursor agrège les outils des **deux** processus.
2. **Fork de pal** : possible plus tard si tu veux une **seule** base ; coût = suivre les mises à jour upstream, licence, sécurité des clés. **Pas obligatoire** tant que `npx pal-mcp-server@latest` + `iris` local suffisent.
3. **`ollama-mcp`** : sert surtout de **cahier des charges** pour enrichir `iris-mcp-server` si tu préfères tout garder sous ton contrôle.
4. **Bifrost** : à considérer si tu veux une **gateway centralisée** (plus proche de l’ancienne idée « hub ») avec perf et garde-fous — lire si le mode d’emploi MCP colle à Cursor Desktop actuel.

---

## Liens additionnels mentionnés par la recherche Claude Code

À explorer si besoin : [claude-sidekick](https://github.com/andrewbrereton/claude-sidekick), [mcp-local-llm](https://github.com/aplaceforallmystuff/mcp-local-llm), [MCPJungle](https://github.com/mcpjungle/MCPJungle). Non audités dans ce document.

---

## Prochaine action concrète pour Peter

1. Dans Cursor : ajouter **une** entrée test (`pal` **ou** `ollama-mcp` via `npx`) **en plus** de `iris`, recharger MCP.
2. Vérifier que **Ollama** répond toujours sur `http://127.0.0.1:11434` hors Cursor (`curl` ou navigateur selon doc Ollama).
3. Si ça tient la route, documenter **ta** config finale (sans clés) dans un snippet à côté de `docs/mcp-cursor-config.md`.
