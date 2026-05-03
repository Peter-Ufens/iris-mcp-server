# Prompt pour Agent Manage Anthropic — Creation iris-mcp-server

> Ce prompt est destine a etre donne a un agent manage Anthropic (Claude Agent SDK)
> qui aura acces a un repo GitHub prive via token.
> L'agent doit creer un serveur MCP complet, teste, pret a l'emploi.

---

## Contexte

Tu es un agent specialise dans la creation de serveurs MCP (Model Context Protocol).
Tu dois creer un serveur MCP TypeScript complet dans un repo GitHub prive.

Le serveur s'appelle **iris-mcp-server**. Il est le point d'entree UNIQUE d'un
ecosysteme IA **local-first** (60-80% local, 20-40% cloud) pour un developpeur
nomme **Peter** qui utilise :
- **Cursor** (IDE avec MCP natif)
- **Claude Desktop** (avec MCP natif) — les agents de Peter s'appellent
  **Sharon** (Claude Opus/Sonnet dans Claude Desktop) et d'autres
- **Ollama** sur localhost:11434 avec un GPU **RTX 5090**
- **API Anthropic** pour les taches cloud (cle API en .env)
- **Brave Search API** (compte existant, cle en .env)
- **PostgreSQL + Redis + Qdrant** (Docker Compose, deja en place pour Lyla-OS)

### Les agents de Peter (ecosysteme nomme)

Peter a un ecosysteme d'agents avec des **noms et roles definis**. Le serveur
MCP doit connaitre ces agents pour le routage :

| Nom agent | Role | Modele par defaut | Emplacement |
|-----------|------|-------------------|-------------|
| **Lyla** | Interface conversationnelle (voix, personnalite) | Ollama local (qwen3:32b) | `D:\Lyla-OS\` |
| **Iris** | Atelier technique, constructrice de Lyla | Cursor + MCP | `D:\Hybrid-Agentic-Studio\` |
| **Sharon** | Architecte, scribe, planificatrice | Claude Opus / Sonnet (cloud) | Claude Desktop |
| **Karen** | Hub n8n, scripts, automatisation | Ollama local | `C:\...\Ollama local\` |
| **Nora** | Modeles locaux Ollama | Ollama multi-modeles | localhost:11434 |

**IMPORTANT** : cette liste est un EXEMPLE initial. L'utilisateur doit pouvoir
**ajouter, renommer, supprimer ou modifier** ses agents a tout moment
(voir section "Registre des agents").

---

## Objectif principal

Creer un serveur MCP **modulaire, extensible et durable** avec :

1. **24+ outils MCP** de base (voir catalogue ci-dessous)
2. **Routage intelligent** 80/20 local/cloud avec fallback
3. **Registre d'agents** nommables et configurables
4. **Registre de modeles** ajoutable/supprimable sans toucher au code
5. **Memoire partagee** persistante (multi-backend)
6. **Auto-decouverte** des nouveaux outils (drop un fichier → outil actif)
7. **Pret pour Cloudflare Tunnel** plus tard (HTTP/SSE en plus de stdio)

---

## 1. EXTENSIBILITE — Comment ajouter de nouveaux outils MCP

C'est le point le plus important. Le serveur doit etre **extensible sans
modifier le code existant**.

### Pattern d'auto-decouverte des outils

```
src/tools/
├── fs-read-v1.ts          ← outil existant
├── fs-write-v1.ts         ← outil existant
├── mon-nouvel-outil-v1.ts ← NOUVEAU : je depose ce fichier, il est detecte
```

**Chaque fichier dans `src/tools/` qui exporte un objet conforme a l'interface
`IrisTool` est automatiquement enregistre au demarrage du serveur.**

```typescript
// src/tools/_registry.ts — Auto-decouverte
// Au demarrage : lire tous les fichiers dans src/tools/,
// importer dynamiquement ceux qui exportent un IrisTool,
// les enregistrer dans le serveur MCP.
// PAS de liste manuelle a maintenir.
```

### Interface IrisTool (contrat pour chaque outil)

```typescript
export interface IrisTool {
  id: string;              // ex: "fs-read-v1" — unique, versionne
  description: string;     // description pour le LLM client
  category: string;        // "filesystem" | "git" | "ollama" | "cloud" | "memory" | "web" | "iris"
  inputSchema: ZodSchema;  // validation Zod de l'entree
  outputSchema: ZodSchema; // validation Zod de la sortie
  execute: (input: unknown) => Promise<unknown>;
}
```

### Comment Peter ajoute un nouvel outil

1. Creer un fichier `src/tools/mon-outil-v1.ts`
2. Exporter un objet conforme a `IrisTool`
3. `npm run build`
4. Redemarrer le serveur MCP → l'outil est disponible dans Cursor et Claude Desktop

**Generer un fichier `docs/GUIDE-AJOUTER-OUTIL.md`** qui explique cette
procedure pas a pas, avec un exemple complet copier-collable.

### Ou trouver de nouveaux outils MCP a installer

**Generer un fichier `docs/GUIDE-DECOUVRIR-MCP.md`** qui liste :
- **MCP Registry officiel** : https://registry.modelcontextprotocol.io/
- **PulseMCP** (annuaire communautaire) : https://www.pulsemcp.com/servers
- **Awesome MCP Servers** : https://mcpservers.org/
- **MCP.so** : https://mcp.so/
- **GitHub topic** : https://github.com/topics/mcp-server
- Comment installer un MCP server tiers en parallele d'iris-mcp-server
  (config multi-serveurs dans Cursor et Claude Desktop)
- Comment IMPORTER un outil d'un MCP tiers dans iris-mcp-server
  (wrapper pattern : un fichier dans src/tools/ qui appelle le serveur tiers)

---

## 2. ROUTAGE INTELLIGENT — 80% local / 20% cloud

### Fichier de configuration : `config/routing.json`

```json
{
  "default_strategy": "local_first",
  "local_target_percent": 80,
  "cloud_target_percent": 20,
  "timeout_local_ms": 30000,
  "fallback_to_cloud": true,

  "complexity_rules": [
    {
      "level": "low",
      "description": "Taches simples : reformulation, traduction courte, formatage",
      "route_to": "local",
      "preferred_models": ["mistral:7b", "llama3.1:8b"]
    },
    {
      "level": "medium",
      "description": "Taches moyennes : resume, analyse de code simple, generation courte",
      "route_to": "local",
      "preferred_models": ["qwen3:14b"]
    },
    {
      "level": "high",
      "description": "Taches complexes : architecture, raisonnement multi-etapes, code complexe",
      "route_to": "local",
      "preferred_models": ["qwen3:32b"],
      "fallback": "cloud"
    },
    {
      "level": "critical",
      "description": "Taches critiques : decisions architecture, audits securite, planification",
      "route_to": "cloud",
      "preferred_models": ["claude-opus-4-20250514"]
    }
  ],

  "fallback_chain": [
    "qwen3:32b",
    "qwen3:14b",
    "claude-sonnet-4-20250514",
    "claude-opus-4-20250514"
  ]
}
```

**Le routeur doit** :
- Lire `config/routing.json` au demarrage (hot-reload si fichier modifie)
- Accepter un parametre `complexity` (low/medium/high/critical) OU le deduire
  automatiquement de la longueur + mots-cles de la requete
- Logger chaque decision de routage (quel modele, pourquoi, duree)
- Calculer et afficher les statistiques local/cloud dans `iris-ping-v1`
  (ex: "72% local / 28% cloud cette session")

---

## 3. REGISTRE DES AGENTS — Nommables, configurables

### Fichier de configuration : `config/agents.json`

```json
{
  "agents": [
    {
      "name": "Lyla",
      "role": "Interface conversationnelle personnelle",
      "default_model": "qwen3:32b",
      "location": "local",
      "notes": "Voix, personnalite, memoire episodique. Projet D:\\Lyla-OS"
    },
    {
      "name": "Sharon",
      "role": "Architecte, scribe, planificatrice",
      "default_model": "claude-opus-4-20250514",
      "location": "cloud",
      "notes": "Claude Desktop. Analyse approfondie, plans, decisions."
    },
    {
      "name": "Iris",
      "role": "Atelier technique, constructrice",
      "default_model": "cursor",
      "location": "local",
      "notes": "Cursor IDE. Code, tests, MCP. D:\\Hybrid-Agentic-Studio"
    },
    {
      "name": "Karen",
      "role": "Automatisation n8n, scripts",
      "default_model": "qwen3:14b",
      "location": "local",
      "notes": "Hub n8n existant."
    },
    {
      "name": "Nora",
      "role": "Modeles locaux Ollama",
      "default_model": "ollama-multi",
      "location": "local",
      "notes": "Gere les 11 modeles Ollama."
    }
  ]
}
```

**Outils MCP pour gerer les agents** :
- `agent-list-v1` : Lister tous les agents enregistres
- `agent-get-v1` : Obtenir le detail d'un agent par nom
- `agent-add-v1` : Ajouter un nouvel agent (nom, role, modele, location)
- `agent-update-v1` : Modifier un agent existant
- `agent-remove-v1` : Supprimer un agent

**Peter doit pouvoir** : ajouter un agent "Judy" demain, le mapper sur un
nouveau modele Ollama, et c'est pris en compte au prochain appel sans rebuild.

---

## 4. REGISTRE DES MODELES — Ajouter/supprimer sans toucher au code

### Fichier de configuration : `config/models.json`

```json
{
  "local_models": [
    {
      "id": "qwen3:32b",
      "provider": "ollama",
      "endpoint": "http://localhost:11434",
      "capabilities": ["code", "reasoning", "analysis", "chat"],
      "max_context": 32768,
      "speed": "medium",
      "cost": "free"
    },
    {
      "id": "qwen3:14b",
      "provider": "ollama",
      "endpoint": "http://localhost:11434",
      "capabilities": ["code", "chat", "summary"],
      "max_context": 32768,
      "speed": "fast",
      "cost": "free"
    },
    {
      "id": "llama3.1:8b",
      "provider": "ollama",
      "endpoint": "http://localhost:11434",
      "capabilities": ["chat", "simple"],
      "max_context": 8192,
      "speed": "very_fast",
      "cost": "free"
    },
    {
      "id": "mistral:7b",
      "provider": "ollama",
      "endpoint": "http://localhost:11434",
      "capabilities": ["chat", "simple", "translation"],
      "max_context": 8192,
      "speed": "very_fast",
      "cost": "free"
    },
    {
      "id": "nomic-embed-text",
      "provider": "ollama",
      "endpoint": "http://localhost:11434",
      "capabilities": ["embeddings"],
      "speed": "fast",
      "cost": "free"
    }
  ],
  "cloud_models": [
    {
      "id": "claude-opus-4-20250514",
      "provider": "anthropic",
      "api_key_env": "ANTHROPIC_API_KEY",
      "capabilities": ["architecture", "reasoning", "analysis", "code", "planning"],
      "max_context": 200000,
      "speed": "slow",
      "cost": "high"
    },
    {
      "id": "claude-sonnet-4-20250514",
      "provider": "anthropic",
      "api_key_env": "ANTHROPIC_API_KEY",
      "capabilities": ["code", "reasoning", "chat", "analysis"],
      "max_context": 200000,
      "speed": "medium",
      "cost": "medium"
    },
    {
      "id": "claude-haiku-4-5-20251001",
      "provider": "anthropic",
      "api_key_env": "ANTHROPIC_API_KEY",
      "capabilities": ["chat", "simple", "fast_response"],
      "max_context": 200000,
      "speed": "very_fast",
      "cost": "low"
    }
  ]
}
```

**Outils MCP pour gerer les modeles** :
- `model-list-v1` : Lister tous les modeles (locaux + cloud) avec leurs capabilities
- `model-add-v1` : Ajouter un modele (local Ollama ou cloud API)
- `model-remove-v1` : Retirer un modele du registre
- `model-test-v1` : Tester si un modele repond (ping + generation courte)

**Quand Peter installe un nouveau modele Ollama** (`ollama pull nouveau:modele`),
il fait `model-add-v1` et c'est pris en compte. Meme chose s'il change de
provider cloud (OpenAI, Mistral API, etc.) — il ajoute le modele dans le registre.

**Quand un modele devient obsolete** : `model-remove-v1` et le routeur ne l'utilise
plus. Zero code a toucher.

---

## 5. MEMOIRE PARTAGEE — Multi-backend

C'est CRITIQUE. La memoire est le coeur de l'ecosysteme. Voici l'architecture :

### Backend memoire (configurable dans `config/memory.json`)

```json
{
  "backends": {
    "facts": {
      "type": "json",
      "path": "data/memory-facts.json",
      "description": "Faits simples, preferences, notes rapides"
    },
    "structured": {
      "type": "postgresql",
      "connection_env": "POSTGRES_URL",
      "description": "Memoire structuree : conversations archivees, projets, historique"
    },
    "vectors": {
      "type": "qdrant",
      "endpoint_env": "QDRANT_URL",
      "collection": "iris-memory",
      "description": "Recherche semantique, RAG, embeddings"
    }
  },
  "default_backend": "facts",
  "fallback_if_unavailable": "facts"
}
```

**Logique** :
- Si PostgreSQL est disponible (Docker tourne) → utiliser pour les donnees structurees
- Si Qdrant est disponible → utiliser pour les recherches semantiques
- **Si aucun n'est disponible** (Docker arrete) → **tout tombe sur le backend JSON**
  (le serveur MCP ne doit JAMAIS planter parce qu'un backend est absent)
- Les faits JSON sont TOUJOURS disponibles comme fallback

### Outils MCP memoire

- `memory-write-v1` : Ecrire un fait (backend auto-detecte selon contenu)
  Input : `{ content, category, backend?: "facts"|"structured"|"vectors", tags? }`
- `memory-read-v1` : Lire des faits (par ID, par categorie, par date)
- `memory-search-v1` : Recherche par mot-cle (JSON) ou semantique (Qdrant si dispo)
- `memory-stats-v1` : Statistiques memoire (nombre de faits, backends actifs, espace disque)

**La memoire est PARTAGEE entre tous les agents.** Sharon ecrit un fait via
Claude Desktop, Iris le lit via Cursor, Lyla le lit via son serveur Node.js.
Le serveur MCP est le point d'acces unique a la memoire.

---

## 6. CATALOGUE COMPLET DES OUTILS MCP (24+ outils)

### Categorie 1 : Filesystem (sandboxe)
- `fs-read-v1` : Lire un fichier (validation anti path-traversal, ALLOWED_ROOTS)
- `fs-write-v1` : Ecrire un fichier (backup .bak automatique)
- `fs-list-v1` : Lister un repertoire (glob pattern optionnel)
- `fs-search-v1` : Rechercher du contenu (regex + glob filter)

### Categorie 2 : Git
- `git-status-v1` : Status du repo
- `git-diff-v1` : Diff staged + unstaged
- `git-log-v1` : Derniers N commits
- `git-commit-v1` : Stage + commit avec message

### Categorie 3 : Ollama local
- `ollama-list-v1` : Lister les modeles charges
- `ollama-chat-v1` : Chat avec un modele specifique
- `ollama-generate-v1` : Generation texte brut
- `ollama-embeddings-v1` : Generer embeddings
- `ollama-pull-v1` : Telecharger un modele

### Categorie 4 : Routage intelligent
- `route-v1` : Routage intelligent (accepte requete + complexity optionnel,
  choisit le meilleur modele local ou cloud selon config/routing.json)

### Categorie 5 : Cloud
- `cloud-chat-v1` : Appeler un modele cloud (provider + model_id depuis registre)

### Categorie 6 : Memoire
- `memory-write-v1`, `memory-read-v1`, `memory-search-v1`, `memory-stats-v1`

### Categorie 7 : Agents
- `agent-list-v1`, `agent-get-v1`, `agent-add-v1`, `agent-update-v1`, `agent-remove-v1`

### Categorie 8 : Modeles
- `model-list-v1`, `model-add-v1`, `model-remove-v1`, `model-test-v1`

### Categorie 9 : Web / Recherche
- `fetch-url-v1` : HTTP GET/POST
- `brave-search-v1` : Recherche web Brave API

### Categorie 10 : Metier Iris
- `iris-ping-v1` : Healthcheck serveur (version, uptime, stats routage local/cloud)
- `lyla-health-v1` : Healthcheck Lyla-OS
- `surgery-clone-v1` : Clone chirurgical Lyla-OS (ADR-0001)

---

## 7. ARCHITECTURE DU PROJET

```
iris-mcp-server/
├── src/
│   ├── index.ts              # Point d'entree (stdio + optionnel HTTP/SSE)
│   ├── server.ts             # Config serveur MCP
│   ├── router.ts             # Routage intelligent (lit config/routing.json)
│   ├── tools/
│   │   ├── _registry.ts      # AUTO-DECOUVERTE des outils (scan src/tools/*.ts)
│   │   ├── _types.ts         # Interface IrisTool + helpers
│   │   ├── fs-read-v1.ts
│   │   ├── fs-write-v1.ts
│   │   ├── ... (tous les outils)
│   │   └── surgery-clone-v1.ts
│   ├── memory/
│   │   ├── backend-json.ts   # Backend JSON (toujours disponible)
│   │   ├── backend-pg.ts     # Backend PostgreSQL (optionnel)
│   │   ├── backend-qdrant.ts # Backend Qdrant (optionnel)
│   │   └── manager.ts        # Gestionnaire multi-backend
│   └── utils/
│       ├── env.ts            # Chargement .env + validation Zod
│       ├── logger.ts         # Logger console
│       └── path-guard.ts     # Validation anti path-traversal
├── config/
│   ├── agents.json           # Registre des agents (nommables, modifiables)
│   ├── models.json           # Registre des modeles (ajoutables/supprimables)
│   ├── routing.json          # Regles de routage (80/20, fallback, timeouts)
│   └── memory.json           # Config backends memoire (JSON, PG, Qdrant)
├── data/
│   ├── memory-facts.json     # Store memoire JSON (fallback toujours dispo)
│   └── .gitkeep
├── tests/
│   ├── *.test.ts             # Un test par outil + tests router + tests memory
│   └── fixtures/
├── docs/
│   ├── GUIDE-AJOUTER-OUTIL.md         # Pas a pas pour creer un outil
│   ├── GUIDE-DECOUVRIR-MCP.md         # Ou trouver des MCP servers externes
│   ├── GUIDE-AJOUTER-MODELE.md        # Ajouter un modele Ollama ou cloud
│   ├── GUIDE-AJOUTER-AGENT.md         # Ajouter un agent nomme
│   ├── cursor-config.md               # Config JSON pour Cursor
│   ├── claude-desktop-config.md        # Config JSON pour Claude Desktop
│   ├── cloudflare-exposition.md        # (futur) Comment exposer via Cloudflare
│   └── tool-catalog.md                # Catalogue complet avec schemas
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

---

## 8. CONTRAINTES TECHNIQUES

- **Runtime** : Node.js 20+
- **MCP SDK** : `@modelcontextprotocol/sdk` (derniere version stable)
- **Validation** : Zod pour TOUS les schemas
- **Tests** : Vitest, objectif > 80% couverture
- **TypeScript** : strict mode, no any
- **Zero secret en dur** : tout dans .env
- **Transport** : stdio par defaut + optionnel HTTP/SSE (port configurable,
  pour futur Cloudflare Tunnel : `cloudflared tunnel --url http://localhost:<port>`)
- **Clean Code** : KISS + YAGNI > DRY + SOLID
- **Resilience** : si PostgreSQL ou Qdrant sont down, fallback JSON. Le serveur
  ne plante JAMAIS a cause d'un backend manquant.
- **Hot-reload config** : les fichiers config/*.json sont relus automatiquement
  si modifies (fs.watch). Pas besoin de redemarrer le serveur pour ajouter un
  modele ou un agent.
- **Anti path-traversal** : ALLOWED_ROOTS dans .env, valide par chaque outil fs-*

---

## 9. VARIABLES D'ENVIRONNEMENT (.env.example)

```bash
# === Cles API ===
ANTHROPIC_API_KEY=sk-ant-votre-cle-ici
BRAVE_API_KEY=votre-cle-brave-ici

# === Ollama ===
OLLAMA_BASE_URL=http://localhost:11434

# === Memoire backends (optionnels) ===
POSTGRES_URL=postgresql://user:pass@localhost:5432/iris_memory
QDRANT_URL=http://localhost:6333

# === Securite ===
ALLOWED_ROOTS=D:/Hybrid-Agentic-Studio,D:/Lyla-OS

# === Serveur HTTP/SSE (optionnel, pour Cloudflare Tunnel futur) ===
HTTP_PORT=3100
HTTP_ENABLED=false
```

---

## 10. WORKFLOW FINAL POUR PETER

1. `git clone <repo-prive>` (ou `git pull` si deja clone)
2. `cd iris-mcp-server && npm install`
3. Copier `.env.example` → `.env`, remplir les cles
4. `npm run build && npm test` → tout doit etre vert
5. Coller la config MCP dans Cursor (Settings > MCP > New Server)
6. Coller la config MCP dans Claude Desktop (`claude_desktop_config.json`)
7. Tester : demander a Cursor ou Claude Desktop d'appeler `iris-ping-v1`
8. Ajouter/modifier agents et modeles via `config/*.json` → pris en compte live

---

## 11. DOCUMENTATION A GENERER

Le README.md doit etre **en francais**, clair, avec :
- Section "Demarrage rapide" (5 etapes)
- Section "Ajouter un outil" (lien vers le guide)
- Section "Ajouter un modele" (lien vers le guide)
- Section "Ajouter un agent" (lien vers le guide)
- Section "Ou trouver d'autres outils MCP" (lien vers le guide)
- Section "Architecture" (schema arbre)
- Section "Routage intelligent" (explication du 80/20)
- Section "Memoire partagee" (3 backends)
- Section "Exposer via Cloudflare" (futur)
- Tableau recapitulatif de TOUS les outils avec ID, description, categorie

---

## 12. STYLE DE CODE

- Pas de commentaires evidents. Commentaires si logique non triviale.
- Noms auto-documentants en anglais.
- Imports explicites.
- Chaque outil = 1 fichier autonome conforme a IrisTool.
- Early return systematique.
- Pas de god-class.
- Logs structures : `[iris] [tool:fs-read-v1] Reading file /path/to/file`
