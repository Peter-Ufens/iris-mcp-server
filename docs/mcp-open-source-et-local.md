# MCP open source — comprendre, local, et brancher Cursor + Claude

**Pour Peter** — 2026-04-12. À lire après déjeuner si tu veux le fil complet.

---

## 1. C’est quoi, un « serveur MCP open source » ?

- **MCP** (Model Context Protocol) est un **standard ouvert** ([spec](https://spec.modelcontextprotocol.io/)). Ce n’est pas un produit fermé.
- Le **SDK TypeScript** qu’utilise Iris (`@modelcontextprotocol/sdk`, licence MIT) est **open source** : c’est le même socle que beaucoup d’exemples officiels.
- Le dépôt **[modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)** regroupe des **serveurs de référence** (fichiers, Git, SQLite, etc.), souvent lançables avec `npx …`. Tu peux les utiliser **en parallèle** d’Iris : Cursor et Claude Desktop supportent **plusieurs** serveurs MCP en même temps.

Donc : **oui**, tu peux t’appuyer sur des serveurs MCP open source **et** avoir **ton** serveur `iris-mcp-server` pour tout ce qui est spécifique à Lyla / Iris / Ollama / scripts Peter.

---

## 2. Ce qu’on a **déjà** en local dans ton dépôt

| Élément | Rôle |
|---------|------|
| `iris-mcp-server/` | **Ton** serveur MCP (stdio), outils avec **ID unique** (`iris-ping-v1`, `ollama-tags-v1`, …). |
| `npm run build` → `dist/index.js` | Binaire que Cursor lance comme **process enfant** ; communication par **stdin/stdout** (protocole MCP). |
| Aucun cloud obligatoire | Tout peut rester **127.0.0.1** (Ollama par défaut sur le port 11434). |

Ce n’est **pas** encore sur GitHub : tout tourne **sur ton PC**, comme tu le souhaites pour l’instant.

---

## 3. Brancher **plusieurs** outils (Cursor + Ollama + serveurs officiels)

1. **Iris** : une entrée MCP qui pointe vers `node …/dist/index.js` (voir `docs/mcp-cursor-config.md`).
2. **Serveurs officiels** (optionnel) : une **deuxième** entrée, par ex. filesystem, avec `npx` + args documentés dans le repo `servers`.
3. **Claude Desktop** : même idée dans son fichier de config MCP (chemins adaptés).

Les modèles **dans le chat** (Claude, Cursor) **appellent** les outils MCP ; **Iris** peut exposer un outil qui fait un **HTTP local** vers Ollama (`/api/tags`, plus tard `/api/chat` si tu valides le risque / la charge).

---

## 4. Suite logique (alignée avec ton idée « hub »)

| Étape | Contenu |
|-------|---------|
| **Maintenant** | MCP local + `iris-ping-v1` + **`ollama-tags-v1`** (liste des modèles sur ton poste). |
| **Option parallèle** | Serveurs MCP multi-modèles (**pal-mcp-server**, **ollama-mcp**, **Bifrost**, etc.) — voir **`docs/mcp-native-gateways-research.md`**. |
| **Ensuite** | Outils plus riches (santé Lyla, fs-safe, etc.) — toujours **un ID par outil**. |
| **Plus tard** | Deuxième PC / portable, HTTP/SSE si besoin ; **GitHub** : 2ᵉ repo privé quand tu juges « tout prêt » (`docs/github-repo-strategy.md`). |

---

## 5. Variables utiles (local)

| Variable | Défaut | Rôle |
|----------|--------|------|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Base URL Ollama pour l’outil `ollama-tags-v1` |

Pas de clé API pour lister les tags Ollama en local.

---

## 6. Passerelles MCP multi-modèles (LiteLLM, hub maison, PAL…)

Si l’objectif est **Cursor + Claude Desktop + Ollama local + APIs cloud** sans repasser par un proxy OpenAI fragile, le fichier dédié résume les options récentes et la stratégie **Iris + PAL en parallèle** : `docs/mcp-native-gateways-research.md`.

---

Bon appétit — au retour, tu peux enchaîner avec `npm run build` dans `iris-mcp-server` et recharger le MCP dans Cursor pour voir **`ollama-tags-v1`**.
