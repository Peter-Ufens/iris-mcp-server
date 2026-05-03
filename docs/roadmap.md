# Roadmap iris-mcp-server

Plan d'evolution v0.2.0 -> v1.0.0 etale sur 6 mois (mai-octobre 2026).
Calibre selon les jours productifs reels de Peter (telework + week-ends).

## Etat present : v0.2.0 (acheve mai 2026)

5 outils operationnels avec auto-decouverte. Tests Vitest passants (30).

| Outil | Categorie | Description |
|---|---|---|
| iris-ping-v1 | iris | Healthcheck du serveur (version, uptime, liste des outils) |
| ollama-list-v1 | ollama | Liste les modeles Ollama locaux (GET /api/tags) |
| ollama-chat-v1 | ollama | Chat avec un modele Ollama (POST /api/chat, stream off) |
| fs-read-v1 | filesystem | Lit un fichier (sandbox ALLOWED_ROOTS, anti path-traversal) |
| fs-list-v1 | filesystem | Liste un repertoire (sandbox ALLOWED_ROOTS) |

## Roadmap a venir

### v0.3.0 - Outils Git (cible : juin 2026)

**Outils ajoutes** : `git-status-v1`, `git-log-v1`, `git-diff-v1`, `git-commit-v1`

**Plus-value** : les agents IA (Sharon Code, Karen, Lyla) peuvent interagir directement avec les repos Git locaux. Lecture du status, des derniers commits, de la diff staged + unstaged. Un commit avec message peut etre declenche depuis le chat sans quitter l'agent.

**Cas d'usage concret** : Sharon Code revoit une PR -> demande au tool git-diff la liste exacte des changements -> peut commenter precisement.

**Effort estime** : ~2h.

### v0.4.0 - APIs publiques gratuites (cible : juin 2026)

**Outils ajoutes** : `weather-v1` (Open-Meteo), `time-v1`, `ip-info-v1`, `exchange-rates-v1`

**Plus-value** : Ollama est limite par sa date de coupure d'entrainement et n'a pas acces aux donnees temps reel. Avec ces outils, l'agent peut repondre "Quelle est la meteo a Haguenau ?" en interrogeant une API publique gratuite (sans cle API requise).

**Source** : selection depuis https://github.com/public-apis/public-apis (categories Weather, Time, IP, Currency).

**Cas d'usage concret** : Lyla, en mode chat avec Peter, repond a "Il fait quel temps demain ?" en appelant weather-v1.

**Effort estime** : ~2h.

### v0.5.0 - Memoire partagee locale (cible : juillet 2026)

**Outils ajoutes** : `memory-write-v1`, `memory-read-v1`, `memory-search-v1`

**Plus-value** : tous les agents (Sharon, Karen, Lyla, Iris) partagent une memoire commune persistante. Backend JSON simple en V1 (toujours disponible), extensible vers PostgreSQL/Qdrant en V2. Evite que chaque agent reparte de zero a chaque session.

**Cas d'usage concret** : Sharon Code apprend que Peter prefere les notations A/B/C -> ecrit dans la memoire partagee -> Karen lit cette preference au prochain demarrage Cursor.

**Effort estime** : ~3h.

### v0.6.0 - Recherche web gratuite (cible : juillet-aout 2026)

**Outils ajoutes** : `web-search-ddg-v1` (DuckDuckGo Instant Answer), `wikipedia-search-v1`, `fetch-url-v1`

**Plus-value** : recherche web et lecture de pages web sans cle API payante. DuckDuckGo Instant Answer pour les questions factuelles directes, Wikipedia pour les fondamentaux, fetch-url pour recuperer le contenu d'une URL specifique.

**Note** : alternative gratuite a Brave Search API qui est payant a l'annee. Pour une vraie web search puissante plus tard, option d'heberger SearXNG sur le Raspberry Pi 5.

**Cas d'usage concret** : Iris fait de la veille technologique en interrogeant Wikipedia et DuckDuckGo, sans budget cloud.

**Effort estime** : ~2h.

### v0.7.0 - Surveillance et auto-demarrage (cible : aout 2026)

**Outils ajoutes** : `lyla-health-v1`, `ollama-status-v1`, `ollama-start-v1`, `system-stats-v1`

**Plus-value** : monitoring de l'ecosysteme Peter. Le tool `ollama-start-v1` est appele par n8n dans un cron quotidien (ex: 9h) pour demarrer Ollama automatiquement sans intervention manuelle. Repond a un besoin concret de Peter (auto-demarrage Ollama via n8n / Nora).

**Cas d'usage concret** : n8n -> trigger 9h -> appelle iris-mcp-server.ollama-start-v1 -> Ollama demarre. Peter arrive au PC, tout est pret.

**Effort estime** : ~2h.

### v0.8.0 - Routing intelligent (cible : septembre 2026)

**Outils ajoutes** : `route-v1`

**Plus-value** : choix automatique du LLM selon la complexite de la requete. Tache simple -> Ollama gratuit local. Tache complexe -> Claude payant cloud. Optimisation cout/latence/qualite sans intervention humaine.

**Configuration** : `config/routing.json` avec regles 80% local / 20% cloud, fallback chains, etc.

**Cas d'usage concret** : "Reformule cette phrase" -> Ollama Mistral 7B (gratuit, rapide). "Audite cette architecture systeme" -> Claude Opus (qualite, cout).

**Effort estime** : ~3-4h.

### v0.9.0 - Registres dynamiques (cible : septembre 2026)

**Outils ajoutes** : `agent-list-v1`, `agent-add-v1`, `agent-update-v1`, `agent-remove-v1`, `model-list-v1`, `model-add-v1`, `model-remove-v1`, `model-test-v1`

**Plus-value** : configuration dynamique des agents et modeles via `config/*.json`. Ajouter un agent "Judy" demain ? 1 commande agent-add-v1, pris en compte au prochain appel sans rebuild.

**Cas d'usage concret** : Peter installe un nouveau modele Ollama -> `model-add-v1` -> le routeur l'utilise immediatement. Pas besoin de modifier le code source.

**Effort estime** : ~3-4h.

### v1.0.0 - Transport HTTP/SSE + Cloudflare (cible : octobre 2026)

**Ajout** : transport HTTP/SSE en parallele de stdio + integration Cloudflare tunnel pour exposition distante securisee.

**Plus-value** : iris-mcp-server accessible depuis le smartphone de Peter via Cloudflare tunnel, avec auth simple. Repond au scenario complet de la presentation Gamma "Mon IA accessible de partout". Premier vrai release stable, eligible pour bascule public GitHub.

**Cas d'usage concret** : Peter, dans le bus, ecrit a Lyla via Telegram -> Lyla appelle iris-mcp-server via HTTPS Cloudflare -> reponse en moins de 2 secondes.

**Demo VAE** : ce milestone v1.0.0 est l'aboutissement du parcours iris pour la VAE octobre 2026.

**Effort estime** : ~5-6h.

---

## Calendrier prudent

| Mois | Versions visees | Effort cumule |
|---|---|---|
| Mai 2026 | v0.2.0 (fait) | - |
| Juin 2026 | v0.3.0 + v0.4.0 | ~4h |
| Juillet 2026 | v0.5.0 + v0.6.0 | ~5h |
| Aout 2026 | v0.7.0 | ~2h |
| Septembre 2026 | v0.8.0 + v0.9.0 | ~7h |
| Octobre 2026 | v1.0.0 | ~5-6h |

**Total** : ~22-23h Karen sur 6 mois = ~4h/mois moyenne. Aligne avec les jours productifs reels de Peter (1-2 sessions productives par mois suffisent).

## Reversibilite

A tout moment, la roadmap peut etre figee. v0.2.0, v0.3.0, ... sont chacune des etats stables et utilisables. Pas d'obligation d'aller jusqu'a v1.0.0.

## Hors scope iris-mcp-server (briques separees)

Les elements suivants ne font PAS partie d'iris-mcp-server, ils sont dans des briques separees qui interagissent avec lui :
- **n8n / Nora** : orchestration (cron, webhooks, workflow). Appelle les outils iris-mcp-server.
- **Ollama** : LLMs locaux. Servi par iris-mcp-server via les outils ollama-*.
- **LiteLLM** : proxy OpenAI-compatible (chemin alternatif vers Ollama). Pas une dependance iris.
- **Cloudflare** : tunnel d'exposition distante. Configure separement, mais utilise par iris-mcp-server en v1.0.0.
- **Raspberry Pi 5** : hardware physique. Heberge potentiellement iris-mcp-server + Ollama (petits modeles) en mode fallback.

## References

- Specification MCP : https://modelcontextprotocol.io/llms-full.txt
- SDK TypeScript MCP : https://github.com/modelcontextprotocol/typescript-sdk
- SDK Python MCP : https://github.com/modelcontextprotocol/python-sdk
- APIs publiques gratuites : https://github.com/public-apis/public-apis
- ADR-0001 : alliee familiale Lyla
- ADR-0002 : abandon hub n8n -> serveur MCP custom
- ADR-0003 : pivot Python -> TypeScript

---

*Roadmap creee le 2026-05-03 par Sharon (Claude Code) pour Peter. Validee par Peter.*
