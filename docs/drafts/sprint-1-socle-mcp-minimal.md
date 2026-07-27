# Sprint 1 — Socle MCP minimal fiable

> **ARCHIVE HISTORIQUE (avril 2026)** — sprint depasse. Etat live : v0.4.2 · 21 outils. Ne pas suivre les chemins Hybrid ci-dessous.

> Prompt pour agent manage Anthropic. Objectif : un serveur MCP qui FONCTIONNE
> avec 5 outils, stdio, tests, branchable dans Cursor + Claude Desktop en 10 min.
> PAS de routing, PAS de multi-backend, PAS de registre. Juste un socle solide.

---

## Contexte

Tu crees un serveur MCP TypeScript appele **iris-mcp-server** dans un repo
GitHub prive. C'est le socle minimal d'un ecosysteme IA local-first.

**L'utilisateur (Peter)** utilise :
- **Cursor** (IDE, MCP natif via stdio)
- **Claude Desktop** (MCP natif via stdio)
- **Ollama** sur `http://localhost:11434` avec une RTX 5090
- **Windows 11** (chemins D:\, PowerShell disponible)

**Ce sprint livre 5 outils seulement.** D'autres outils seront ajoutes dans
des sprints futurs via le pattern d'extensibilite pose ici.

---

## Les 5 outils de ce sprint

### 1. `iris-ping-v1`
- **But** : healthcheck du serveur MCP
- **Input** : aucun
- **Output** : `{ version, uptime_seconds, tools_count, tools_list, timestamp }`
- **Pourquoi en premier** : c'est le test de validation que tout fonctionne

### 2. `ollama-list-v1`
- **But** : lister les modeles Ollama charges sur localhost:11434
- **Input** : aucun (ou `{ endpoint?: string }` pour override)
- **Output** : `{ models: [{ name, size, modified_at, digest }] }`
- **Appelle** : `GET http://localhost:11434/api/tags`
- **Si Ollama est eteint** : retourner `{ models: [], error: "Ollama unreachable" }`
  (ne PAS planter)

### 3. `ollama-chat-v1`
- **But** : envoyer un message a un modele Ollama local et recevoir la reponse
- **Input** : `{ model: string, messages: [{role, content}], temperature?: number }`
- **Output** : `{ response: string, model: string, duration_ms: number }`
- **Appelle** : `POST http://localhost:11434/api/chat` (stream: false)
- **Si le modele n'existe pas** : retourner une erreur claire, ne pas planter

### 4. `fs-read-v1`
- **But** : lire le contenu d'un fichier
- **Input** : `{ path: string }`
- **Output** : `{ content: string, size_bytes: number, encoding: string }`
- **Securite OBLIGATOIRE** :
  - Valider que le chemin resolu (apres path.resolve + realpath) est sous
    l'un des repertoires autorises dans `ALLOWED_ROOTS` (env var, comma-separated)
  - Refuser tout chemin contenant `..` apres resolution
  - Refuser les symlinks qui sortent des ALLOWED_ROOTS
- **Si le fichier n'existe pas** : erreur claire, ne pas planter

### 5. `fs-list-v1`
- **But** : lister le contenu d'un repertoire
- **Input** : `{ path: string, pattern?: string }` (pattern = glob optionnel)
- **Output** : `{ entries: [{ name, type: "file"|"dir", size_bytes }] }`
- **Meme securite** que fs-read-v1 (ALLOWED_ROOTS)

---

## Architecture

```
iris-mcp-server/
├── src/
│   ├── index.ts              # Point d'entree stdio
│   ├── server.ts             # Creation du serveur MCP, enregistrement des outils
│   ├── tools/
│   │   ├── _types.ts         # Interface IrisTool (contrat pour TOUS les outils)
│   │   ├── _registry.ts      # Auto-decouverte : scanne src/tools/*.ts au demarrage
│   │   ├── iris-ping-v1.ts
│   │   ├── ollama-list-v1.ts
│   │   ├── ollama-chat-v1.ts
│   │   ├── fs-read-v1.ts
│   │   └── fs-list-v1.ts
│   └── utils/
│       ├── env.ts            # Charger .env, valider les vars requises
│       └── path-guard.ts     # Validation ALLOWED_ROOTS, anti path-traversal
├── tests/
│   ├── iris-ping-v1.test.ts
│   ├── ollama-list-v1.test.ts
│   ├── ollama-chat-v1.test.ts
│   ├── fs-read-v1.test.ts
│   ├── fs-list-v1.test.ts
│   ├── path-guard.test.ts
│   └── registry.test.ts
├── docs/
│   ├── cursor-config.md      # Config JSON pour Cursor (copier-coller)
│   ├── claude-desktop-config.md  # Config JSON pour Claude Desktop
│   └── GUIDE-AJOUTER-OUTIL.md   # Comment creer un outil (futur sprint)
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md                 # En francais, clair, demarrage rapide
```

---

## Interface IrisTool (contrat extensibilite)

C'est LE pattern que les sprints futurs utiliseront pour ajouter des outils.
Il doit etre pose des maintenant.

```typescript
// src/tools/_types.ts
import { z } from "zod";

export interface IrisTool {
  /** ID unique versionne, ex: "fs-read-v1" */
  id: string;
  /** Description pour le LLM client (1-2 phrases) */
  description: string;
  /** Categorie pour le classement */
  category: "filesystem" | "ollama" | "iris" | "git" | "cloud" | "memory" | "web" | "agent" | "model";
  /** Schema Zod pour l'input */
  inputSchema: z.ZodType;
  /** Fonction d'execution */
  execute: (input: unknown) => Promise<unknown>;
}
```

### Auto-decouverte (`_registry.ts`)

Au demarrage, `_registry.ts` :
1. Liste tous les fichiers `src/tools/*.ts` (sauf `_*.ts`)
2. Importe dynamiquement chacun
3. Verifie qu'il exporte un objet conforme a `IrisTool`
4. L'enregistre dans le serveur MCP

**Resultat** : pour ajouter un outil dans un sprint futur, Peter (ou Iris)
depose un fichier dans `src/tools/`, rebuild, et c'est actif. Aucun autre
fichier a modifier.

**IMPORTANT** : genere un `docs/GUIDE-AJOUTER-OUTIL.md` qui explique :
1. Copier un outil existant comme template
2. Changer l'ID, la description, le schema, la logique
3. `npm run build && npm test`
4. Redemarrer le serveur → l'outil apparait dans Cursor/Claude Desktop

Et mentionne aussi ou trouver d'autres outils MCP externes :
- https://registry.modelcontextprotocol.io/
- https://www.pulsemcp.com/servers
- https://mcpservers.org/
- https://mcp.so/
- https://github.com/topics/mcp-server

---

## Contraintes techniques

- **Runtime** : Node.js 20+
- **MCP SDK** : `@modelcontextprotocol/sdk` (derniere version stable)
- **Validation** : Zod pour tous les schemas
- **Tests** : Vitest. TOUS les 5 outils testes + path-guard + registry.
  Les tests ollama-* doivent fonctionner MEME si Ollama est eteint (mock HTTP
  ou test de graceful degradation).
- **TypeScript** : strict mode, no `any`
- **Transport** : stdio uniquement (ce sprint). HTTP/SSE viendra au sprint 4.
- **Resilience** : si Ollama est eteint, les outils ollama-* retournent une
  erreur propre. Le serveur MCP ne plante PAS.
- **Zero secret en dur** : ANTHROPIC_API_KEY pas utilise dans ce sprint,
  mais le .env.example le mentionne pour le futur.
- **Clean Code** : KISS + YAGNI > DRY + SOLID. Pas d'abstraction prematuree.
  Pas de routing, pas de registre agents/modeles, pas de multi-backend memoire.
  Ca viendra dans les sprints suivants.

---

## .env.example

```bash
# === Sprint 1 : Ollama + Filesystem ===
OLLAMA_BASE_URL=http://localhost:11434
ALLOWED_ROOTS=D:/Hybrid-Agentic-Studio,D:/Lyla-OS

# === Sprint 2+ (pas utilise maintenant, mais prepare) ===
# ANTHROPIC_API_KEY=sk-ant-...
# BRAVE_API_KEY=...
# POSTGRES_URL=postgresql://...
# QDRANT_URL=http://localhost:6333
```

---

## Config MCP a generer

### Pour Cursor (`docs/cursor-config.md`)
```json
{
  "mcpServers": {
    "iris": {
      "command": "node",
      "args": ["D:/Hybrid-Agentic-Studio/iris-mcp-server/dist/index.js"],
      "env": {
        "OLLAMA_BASE_URL": "http://localhost:11434",
        "ALLOWED_ROOTS": "D:/Hybrid-Agentic-Studio,D:/Lyla-OS"
      }
    }
  }
}
```

### Pour Claude Desktop (`docs/claude-desktop-config.md`)

Meme config, a coller dans `%APPDATA%\Claude\claude_desktop_config.json`.

---

## README.md (en francais)

Le README doit contenir exactement :
1. **Demarrage rapide** : 5 etapes (clone, install, .env, build+test, brancher)
2. **Outils disponibles** : tableau des 5 outils avec ID et description
3. **Ajouter un outil** : lien vers GUIDE-AJOUTER-OUTIL.md
4. **Architecture** : schema arbre
5. **Sprints futurs** : mentionner ce qui viendra (routing, agents, memoire, cloud)
   sans l'implementer

---

## Validation de fin de sprint

Le sprint est considere REUSSI si :
1. `npm run build` → zero erreur
2. `npm test` → tous les tests verts
3. Le serveur demarre en stdio sans planter
4. `iris-ping-v1` retourne la liste des 5 outils
5. `ollama-list-v1` retourne les modeles (ou une erreur propre si Ollama off)
6. `ollama-chat-v1` envoie un message et recoit une reponse
7. `fs-read-v1` lit un fichier dans ALLOWED_ROOTS et refuse un fichier hors roots
8. `fs-list-v1` liste un repertoire dans ALLOWED_ROOTS
9. La config Cursor fonctionne (doc generee)
10. `GUIDE-AJOUTER-OUTIL.md` explique clairement comment ajouter un outil
