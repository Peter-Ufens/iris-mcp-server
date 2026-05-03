# Guide : ajouter un outil MCP a Iris

## 1. Copier un outil existant comme template

```bash
cp src/tools/iris-ping-v1.ts src/tools/mon-outil-v1.ts
```

## 2. Adapter le fichier

Chaque outil exporte un objet `tool` conforme a l'interface `IrisTool` :

```typescript
import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';

export const tool: IrisTool = {
  id: 'mon-outil-v1',              // ID unique versionne
  description: 'Description pour le LLM client.',
  category: 'iris',                 // iris | ollama | filesystem | git | cloud | memory | web | agent | model
  inputSchema: {
    param1: z.string().describe('Description du parametre'),
    param2: z.number().optional().describe('Parametre optionnel'),
  },
  execute: async (input) => {
    const param1 = input.param1 as string;
    // ... logique ...
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ result: 'ok' }, null, 2) }],
    };
  },
};
```

## 3. Build + test

```bash
npm run build
npm test
```

## 4. Redemarrer le serveur

L'outil est automatiquement decouvert par le registre (`_registry.ts`).
Redemarrer Cursor ou Claude Desktop pour que l'outil apparaisse.

## Regles

- **1 fichier = 1 outil** dans `src/tools/`
- Les fichiers prefixes par `_` sont ignores par le registre (`_types.ts`, `_registry.ts`)
- L'ID doit etre unique et versionne (`nom-v1`, `nom-v2`)
- Schema Zod obligatoire pour la validation
- Ne JAMAIS planter : retourner une erreur propre dans le JSON

## Ressources MCP externes

- https://registry.modelcontextprotocol.io/
- https://www.pulsemcp.com/servers
- https://mcpservers.org/
- https://mcp.so/
- https://github.com/topics/mcp-server
