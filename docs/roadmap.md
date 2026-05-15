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

### v0.3.0 - Outils Git (livre 2026-05-15)

**Outils ajoutes** : `git-status-v1`, `git-log-v1`, `git-diff-v1`, `git-commit-v1`

**Plus-value** : les agents IA (Sharon Code, Karen, Lyla) peuvent interagir directement avec les repos Git locaux. Lecture du status, des derniers commits, de la diff staged + unstaged. Un commit avec message peut etre declenche depuis le chat sans quitter l'agent.

**Cas d'usage concret** : Sharon Code revoit une PR -> demande au tool git-diff la liste exacte des changements -> peut commenter precisement.

**Effort estime** : ~2h.

### v0.4.0 - APIs publiques essentielles (livre 2026-05-15)

6 outils sans cle API requise, simples, utiles au quotidien. Source : https://github.com/public-apis/public-apis

| ID | API source | Plus-value |
|---|---|---|
| `weather-v1` | Open-Meteo (api.open-meteo.com) | Meteo mondiale sans cle, rate limit genereux. Lyla repond aux questions meteo. |
| `time-v1` | WorldTimeAPI (worldtimeapi.org) | Heure courante par fuseau horaire. Anti-hallucination dates pour les agents. |
| `ip-info-v1` | ip-api.com | Info geolocalisation IP. Validation tunnel Cloudflare quand Raspberry installe. |
| `exchange-rates-v1` | open.er-api.com | Taux de change EUR / USD / etc. |
| `holidays-v1` | Nager.Date (date.nager.at) | Jours feries par pays. Anti-hallucination calendrier. |
| `dictionary-v1` | DictionaryAPI.dev | Definitions et synonymes anglais. Enrichit les LLMs locaux moins puissants. |

**Plus-value globale** : Ollama et les autres LLMs obtiennent des donnees factuelles temps reel (meteo, heure, dates) qu'ils n'ont pas dans leurs poids d'entrainement.

**Effort estime** : ~2h.

### v0.4.5 - APIs etendues (cible : juin 2026)

6 outils supplementaires, sans cle ou avec cle gratuite simple :

| ID | API source | Plus-value |
|---|---|---|
| `geocoding-v1` | Nominatim / OpenStreetMap (nominatim.openstreetmap.org) | Adresse -> coordonnees GPS, gratuit sans cle. Combine a weather-v1 = meteo de l'adresse exacte. |
| `sunrise-sunset-v1` | sunrise-sunset.org | Heures lever / coucher du soleil. Demo Raspberry pour automatisations selon luminosite. |
| `news-v1` | NewsData.io (free tier 200 req/jour) | Actualites. Veille tech automatisee. |
| `translate-v1` | MyMemory (free tier 5000 mots/jour) | Traduction. Compense les LLMs locaux moins forts en multilingue. |
| `random-fact-v1` | uselessfacts.jsph.pl | Faits aleatoires. Demo et tests. |
| `nasa-apod-v1` | NASA APOD (api.nasa.gov, cle gratuite) | Image astronomique du jour. Demo VAE / portfolio. |

**Effort estime** : ~2h.

### v0.7.x - APIs cloud avancees (futur, post-Raspberry)

Quand le Raspberry sera installe et que les besoins de notification / persistence cloud emergeront :

| ID | API source | Pour quoi |
|---|---|---|
| `pushover-v1` | Pushover (pushover.net, ~5 USD one-time) | Notifications push smartphone. Alertes Raspberry vers Peter. |
| `email-v1` | Mailgun ou SendGrid (free tier) | Envoi email. Alertes critiques. |
| `mqtt-v1` | Mosquitto local sur Raspberry | IoT leger, sensors. |
| `cloud-storage-v1` | Dropbox ou Google Drive (OAuth requis) | Backup automatise. Necessite OAuth flow. |

**Effort estime** : ~3-4h (OAuth complexifie).

**Date cible** : selon arrivee Raspberry (juin-juillet 2026 selon paie Peter).

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

## Outils de developpement et test

Pour tester manuellement les outils MCP en local (sans avoir a passer par Cursor ou Claude Desktop) :

- **MCP Inspector** : https://modelcontextprotocol.io/docs/tools/inspector
  Outil officiel Anthropic, UI web pour tester un serveur MCP. Lance le serveur en stdio, expose une UI pour appeler les outils manuellement avec leurs arguments. Tres utile pour debug et validation.

Lancement type :

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Permet a Peter de tester `iris-ping-v1`, `ollama-list-v1`, etc. directement, sans intermediaire LLM.

## Securite

iris-mcp-server suit progressivement les **best practices MCP** documentees par Anthropic :
https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices

### Niveau actuel (v0.2.0)

- Validation Zod sur les inputs de chaque outil.
- Sandbox `ALLOWED_ROOTS` pour les operations filesystem (anti path-traversal).
- Aucune dependance reseau au runtime sauf Ollama localhost.
- Aucun secret en dur (tout via .env).

### Avant bascule public ou v1.0.0 (lot dedie futur)

Un **Lot Securite** sera planifie avant la bascule public ou a v1.0.0 (transport HTTP/SSE distant) :

- Auth obligatoire (token simple V1, eventuellement mTLS / JWT V2).
- Rate-limiting par client.
- Audit logs structures (JSON Lines).
- Validation stricte des inputs au niveau transport.
- Politique de versioning des outils.
- Audit des dependances NPM (npm audit + Snyk gratuit).

Ce lot sera redige par Sharon en se basant sur les guides officiels Anthropic.

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

## Hors scope iris-mcp-server (briques separees / lots futurs)

Les elements suivants ne font PAS partie d'iris-mcp-server. Ils sont planifies dans des projets / lots separes, mais documentes ici pour ne pas les oublier.

### Briques separees actuelles (en dehors de ce repo)

- **n8n / Nora** : orchestration (cron, webhooks, workflow). Appelle les outils iris-mcp-server.
- **Ollama** : LLMs locaux. Servi par iris-mcp-server via les outils ollama-*.
- **LiteLLM** : proxy OpenAI-compatible (chemin alternatif vers Ollama). Pas une dependance iris.
- **Cloudflare** : tunnel d'exposition distante. Configure separement, mais utilise par iris-mcp-server en v1.0.0.
- **Raspberry Pi 5** : hardware physique. Heberge potentiellement iris-mcp-server + Ollama (petits modeles) en mode fallback.

### Lots futurs (a planifier dans le backlog audits mensuels)

#### Lot Multi-agents orchestration (post v1.0.0)

Quand l'ecosysteme aura besoin de coordonner plusieurs agents qui collaborent (ex : un agent qui delegue a un autre selon la tache), 3 options techniques :

- **Anthropic Agent SDK** (recommande) : integration native Claude, support officiel.
- **LangGraph** (Python / Langchain) : graphes d'etats puissants, complexe.
- **CrewAI** (Python, deja explore dans Hybrid-Agentic-Studio/crewai/) : simple, communaute active, mais ajoute une stack Python.

Repo cible potentiel : `peter-agent-orchestrator` ou similaire. **Pas dans iris-mcp-server.**

#### Lot Audit MCP servers tiers

Avant de reinventer un outil dans iris-mcp-server, verifier ce que la communaute MCP a deja publie :

Sources a explorer :
- https://github.com/modelcontextprotocol/servers (serveurs officiels reference)
- https://mcp.so (annuaire communautaire centaines de serveurs)
- https://cursor.directory (annuaire Cursor + MCP, regles + serveurs)
- https://www.pulsemcp.com/servers
- https://mcpservers.org/

Resultat attendu :
- Tableau des serveurs MCP tiers utiles pour Peter (ex : github-mcp officiel pour outils Git tres complets).
- Decision pour chaque : a integrer dans iris-mcp-server (wrapper) OU a brancher en parallele dans Cursor / Claude Desktop.

Cursor et Claude Desktop supportent **plusieurs serveurs MCP en parallele**. iris-mcp-server n'a pas a tout reinventer.

#### Lot Securite durcissement (avant bascule public ou v1.0.0)

Voir section "Securite" plus haut.

#### Lot Self-hosted SearXNG (alternative gratuite a Brave Search)

Quand Raspberry installe : option d'auto-heberger SearXNG (meta-search engine open source) pour avoir une vraie web search puissante sans dependre d'une API payante.

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
