# MCP open source — comprendre, local, et brancher Cursor + Claude

> **MAJ etat live (2026-07-27) :** v0.4.2 · **21 outils** · canon `D:\IA-CURSOR\Iris-MCP\iris-mcp-server` · repo GitHub **prive**.  
> Config Cursor : [cursor-config.md](cursor-config.md) (pas `mcp-cursor-config.md`).

**Pour Peter** — 2026-04-12, relecture juillet 2026.

---

## 1. C'est quoi, un « serveur MCP open source » ?

- **MCP** (Model Context Protocol) est un **standard ouvert** ([spec](https://spec.modelcontextprotocol.io/)). Ce n'est pas un produit fermé.
- Le **SDK TypeScript** qu'utilise Iris (`@modelcontextprotocol/sdk`, licence MIT) est **open source** : c'est le même socle que beaucoup d'exemples officiels.
- Le dépôt **[modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)** regroupe des **serveurs de référence** (fichiers, Git, SQLite, etc.), souvent lançables avec `npx …`. Tu peux les utiliser **en parallèle** d'Iris : Cursor et Claude Desktop supportent **plusieurs** serveurs MCP en même temps.

Donc : **oui**, tu peux t'appuyer sur des serveurs MCP open source **et** avoir **ton** serveur `iris-mcp-server` pour tout ce qui est spécifique à Lyla / Iris / Ollama / scripts Peter.

---

## 2. Ce qu'on a **déjà** en local dans ton dépôt

| Élément | Rôle |
|---------|------|
| `iris-mcp-server/` | **Ton** serveur MCP (stdio), outils avec **ID unique** (`iris-ping-v1`, `ollama-list-v1`, `ollama-chat-v1`, …). Voir [tool-catalog.md](tool-catalog.md). |
| `npm run build` → `dist/index.js` | Binaire que Cursor lance comme **process enfant** ; communication par **stdin/stdout** (protocole MCP). |
| Reseau | Ollama **127.0.0.1** + APIs cloud optionnelles (meteo, news, etc.) selon outils actives |

Repo GitHub `Peter-Ufens/iris-mcp-server` : **public** (vitrine juillet 2026).

---

## 3. Brancher **plusieurs** outils (Cursor + Ollama + serveurs officiels)

1. **Iris** : une entrée MCP qui pointe vers `node …/dist/index.js` (voir [cursor-config.md](cursor-config.md)).
2. **Serveurs officiels** (optionnel) : une **deuxième** entrée, par ex. filesystem, avec `npx` + args documentés dans le repo `servers`.
3. **Claude Desktop** : même idée dans son fichier de config MCP (voir [claude-desktop-config.md](claude-desktop-config.md)).

Les modèles **dans le chat** (Claude, Cursor) **appellent** les outils MCP ; **Iris** expose `ollama-list-v1` et `ollama-chat-v1` vers Ollama local.

---

## 4. Suite logique (alignée avec ton idée « hub »)

| Étape | Contenu |
|-------|---------|
| **Livre (v0.4.2)** | MCP local + 21 outils (ping, ollama, fs, git, APIs cloud). |
| **Option parallèle** | Serveurs MCP multi-modèles (**pal-mcp-server**, **ollama-mcp**, **Bifrost**, etc.) — voir **`docs/mcp-native-gateways-research.md`**. |
| **Ensuite** | Outils plus riches (santé Lyla, memoire, etc.) — toujours **un ID par outil**. |
| **Plus tard** | HTTP/SSE, demo VAE, bascule repo **public** apres lot securite ([roadmap.md](roadmap.md)). |

---

## 5. Variables utiles (local)

| Variable | Défaut | Rôle |
|----------|--------|------|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Base URL Ollama pour `ollama-list-v1` / `ollama-chat-v1` |
| `ALLOWED_ROOTS` | (voir `.env.example`) | Racines autorisees pour `fs-read` / `fs-list` / git |

Pas de clé API pour Ollama en local. Certaines APIs cloud sont sans cle ; NASA APOD utilise DEMO_KEY publique.

---

## 6. Passerelles MCP multi-modèles (LiteLLM, hub maison, PAL…)

Si l'objectif est **Cursor + Claude Desktop + Ollama local + APIs cloud** sans repasser par un proxy OpenAI fragile, le fichier dédié résume les options récentes et la stratégie **Iris + PAL en parallèle** : `docs/mcp-native-gateways-research.md`.

---

*Recharge le MCP dans Cursor apres `npm run build` pour voir les 21 outils via `iris-ping-v1`.*
