# Catalogue des outils MCP - iris-mcp-server v0.8.0

28 outils operationnels avec auto-decouverte (`src/tools/_registry.ts`).  
Chaque outil a un ID unique versionne (`<nom>-v<version>`).

## iris (1)

| ID | Fichier | Description |
|---|---|---|
| `iris-ping-v1` | `iris-ping-v1.ts` | Healthcheck : version, uptime, liste des outils, timestamp |

## ollama (2)

| ID | Fichier | Description |
|---|---|---|
| `ollama-list-v1` | `ollama-list-v1.ts` | Liste les modeles Ollama (`GET /api/tags`) |
| `ollama-chat-v1` | `ollama-chat-v1.ts` | Chat avec un modele Ollama (`POST /api/chat`) |

## memory (4)

`rag-query-v1` ajoute en phase 2 RAG (2026-09-02), poids doux et dedoublonnage (2026-09-13).
`rag-search-v2` ajoute au lot D (2026-09-13), a cote de v1 qui reste inchange.
`rag-hybrid-v1` ajoute au lot E (2026-09-14) : vectoriel de v1 + lexical sur l'index.
`rag-journal-link-v1` et le journal opt-in des trois outils RAG ajoutes en v0.8.0 (2026-09-14) : voir [rag-journal.md](rag-journal.md).

| ID | Fichier | Description |
|---|---|---|
| `rag-query-v1` | `rag-query-v1.ts` | Interroge le RAG vault (Qdrant `:6334` + embeddings Ollama), rapide, mot-cle ou question simple |
| `rag-search-v2` | `rag-search-v2.ts` | Recherche qui comprend le vocabulaire de l'utilisateur (glossaire prive, dictee), plusieurs formulations fusionnees, demande un contexte si rien ne repond |
| `rag-hybrid-v1` | `rag-hybrid-v1.ts` | Recherche des termes exacts : identifiants, noms de fichier ou de variable, chemins partiels, noms propres rares, lettres voisines inversees |
| `rag-journal-link-v1` | `rag-journal-link-v1.ts` | Journal des recherches (opt-in) : relie une recherche ratee ou en clarification a la recherche qui a trouve la reponse |

| Outil | Entrees | Sorties |
|---|---|---|
| `rag-query-v1` | `query` (requis), `limit` (1-25, defaut 5), `project`, `sourceContains`, `includeZoneA` (defaut false) | `hits[]` (`score` pondere, `score_raw`, `sourceFile`, `source_filename`, `excerpt`), `meta` (`filterZoneA`, `intimeAlwaysFiltered`, `zonePatternsVersion`, `excludePatterns`, `sourcePriorityApplied`, `dedupByFilename`, `count`, `collection`, `error?`) |
| `rag-search-v2` | `query` (requis), `limit` (1-25, defaut 5), `project`, `sourceContains`, `includeZoneA` (defaut false), `reformulate` (defaut true) | `hits[]` (`score` fusionne, `score_raw`, `sourceFile`, `source_filename`, `excerpt`, `trouvePar`), `meta` (memes champs de zone que v1 + `glossary`, `glossaire`, `intentions`, `questionNettoyee`, `variantes`, `notesPointees`, `reformulations`, `reformulationCount`, `reformulationNote`, `fallback`, `fusion`, `confiance`, `needsClarification`, `clarification`, `timingsMs`) |

### Quel outil choisir

| Besoin | Outil | Pourquoi |
|---|---|---|
| Question simple, mot-cle, reponse rapide | `rag-query-v1` | un seul appel vectoriel, le plus rapide |
| Question dictee ou en langage naturel, vocabulaire de l'utilisateur | `rag-search-v2` | glossaire prive, reformulations, clarification si rien ne repond |
| Identifiant, nom de fichier, variable, chemin partiel, nom propre rare, faute de frappe sur ces termes | `rag-hybrid-v1` | cherche le terme exact dans l'index en plus du vectoriel |

`rag-hybrid-v1` ne traduit pas le vocabulaire : pour une dictee, `rag-search-v2` reste l'outil.

### rag-hybrid-v1 : fonctionnement

1. **Termes** : identifiants d'abord (chiffre, tiret, soulignement, point, majuscules), puis noms
   propres, puis mots longs ; mots vides retires ; 6 termes au plus.
2. **Canal vectoriel** : `rag-query-v1` tel quel (zones, poids doux, dedoublonnage).
3. **Canal lexical** : filtre texte de Qdrant sur `text` et `sourceFile`, avec les **memes
   exclusions de zone** que le vectoriel, re-appliquees cote client. Le filtre est sensible a la
   casse : plusieurs casses sont essayees. Un terme introuvable tel quel est cherche avec ses
   inversions de lettres voisines (`meta.termesLexicaux[].typo`). Un terme present dans plus de
   60 documents est ignore (echantillon non representatif).
4. **Fusion** : RRF k = 60. Rang vectoriel de v1 (poids deja inclus) + rang lexical x poids de
   zone. Le lexical pese x1 si la question porte un identifiant, une faute rattrapee, ou tient en
   1 ou 2 termes ; sinon x0,5 et un document doit porter au moins 2 termes distinctifs.
5. **Limite** : le canal lexical ne voit que ce qui est indexe (un fichier tout neuf apparait apres
   la prochaine indexation).

| Outil | Entrees | Sorties |
|---|---|---|
| `rag-hybrid-v1` | `query` (requis), `limit` (1-25, defaut 5), `project`, `sourceContains`, `includeZoneA` (defaut false) | `hits[]` (`score`, `sourceFile`, `source_filename`, `excerpt` centre sur le terme, `trouvePar`, `rangVectoriel`, `rangLexical`, `termes`, `fauteDeFrappe`, `dansLeChemin`), `meta` (champs de zone de v1 + `termes`, `termesLexicaux`, `poidsLexical`, `fusion`, `conseil`, `timingsMs`) |
| `rag-journal-link-v1` | `echecId`, `succesId` (defaut : derniere recherche ratee et derniere reussie de la session), `note` (500 car.) | `ok`, `error?`, `paire` (`id`, `lien: manuel`, `echecId`, `succesId`, `ecartSecondes`) |

Avec `IRIS_RAG_JOURNAL_DIR`, les trois outils RAG ajoutent `meta.journal` (`actif`, `id`, `statut`, `pairesAuto?`, `conseil?`, `nonJournalise?`, `erreur?`). Sans la variable, leur sortie est inchangee.

### rag-search-v2 : fonctionnement

1. La question est nettoyee (tics de langage, smileys) puis comparee au **glossaire prive**.
2. Variantes cherchees : question nettoyee, question + termes du glossaire, jusqu'a 3 reformulations
   d'un modele local (`think: false`, temperature 0, sortie JSON), et une recherche ciblee dans
   les notes que le glossaire designe.
3. Fusion RRF (k = 60) puis poids doux de zone, dedoublonnage identique a v1.
4. **Confiance** : un extrait « repond » s'il porte les termes de la question (terme du glossaire,
   ou la moitie des termes dont le plus distinctif). Aucun seuil de score absolu. Sinon
   `needsClarification: true` et `clarification.message` propose de preciser le projet,
   la periode, ou de relancer avec `includeZoneA`. Le client ne doit pas inventer de reponse.
5. `reformulationCount = 0` est toujours explique dans `reformulationNote` (glossaire absent,
   reponse vide du modele, delai depasse). Un delai depasse est aussi signale dans `fallback`.

### rag-search-v2 : variables d'environnement

| Variable | Defaut | Role |
|---|---|---|
| `ZONE_A_PATTERNS_FILE` | aucun (fail-closed) | motifs de zone, comme v1 |
| `RAG_GLOSSARY_FILE` | `glossaire-recherche.md` voisin de `ZONE_A_PATTERNS_FILE` | glossaire prive (**jamais** dans ce depot) |
| `RAG_REFORMULATE_MODEL` | `qwen3.5:9b` | modele Ollama des reformulations |
| `RAG_REFORMULATE_TIMEOUT_MS` | `6000` | au-dela, repli sans reformulation (signale dans `meta.fallback`) |
| `RAG_PINNED_RANK` | `8` | poids d'une note designee par le glossaire (rang equivalent dans chaque variante) |
| `QDRANT_URL`, `OLLAMA_BASE_URL`, `QDRANT_COLLECTION`, `RAG_EMBED_MODEL` | comme v1 | services |

Format du glossaire : tableaux Markdown `Tu dis | Terme | Ou chercher | Preuve | Statut`,
tableau `Forme | Pourquoi` pour les pieges (jamais de reecriture automatique), section tics.
Les lignes « a valider » servent d'indice au modele mais ne reecrivent jamais la question.

**Gouvernance Zone A - non negociable.** Par defaut les conversations brutes sont
exclues. `includeZoneA: true` ouvre les conversations brutes (Copilot, Ollama, Claude)
mais **jamais** la zone sensible A-2 (liste complete dans le depot prive
`iris-mcp-server-private`, fichier `zone-a-patterns.json`).
Les motifs sont charges via la variable d'environnement `ZONE_A_PATTERNS_FILE`.
Ouvrir la zone sensible reste un geste manuel de Peter via
`query-rag.ps1 -IncludeZoneA -AllowIntime`.

Details ops : depot prive `iris-mcp-server-private` · hub RAG local.

## filesystem (2)

| ID | Fichier | Description |
|---|---|---|
| `fs-read-v1` | `fs-read-v1.ts` | Lit un fichier (sandbox `ALLOWED_ROOTS`) |
| `fs-list-v1` | `fs-list-v1.ts` | Liste un repertoire (sandbox `ALLOWED_ROOTS`) |

## git (4)

| ID | Fichier | Description |
|---|---|---|
| `git-status-v1` | `git-status-v1.ts` | Statut Git (staged, unstaged, untracked) |
| `git-log-v1` | `git-log-v1.ts` | N derniers commits |
| `git-diff-v1` | `git-diff-v1.ts` | Diff staged / unstaged / head |
| `git-commit-v1` | `git-commit-v1.ts` | Commit (fichiers deja stages uniquement) |

## cloud / APIs publiques (12)

Sans cle API perso sauf NASA (DEMO_KEY integree).

| ID | Fichier | API / source |
|---|---|---|
| `weather-v1` | `weather-v1.ts` | Open-Meteo (lat/lon requis) |
| `time-v1` | `time-v1.ts` | WorldTimeAPI |
| `ip-info-v1` | `ip-info-v1.ts` | ip-api.com |
| `exchange-rates-v1` | `exchange-rates-v1.ts` | open.er-api.com |
| `holidays-v1` | `holidays-v1.ts` | date.nager.at |
| `dictionary-v1` | `dictionary-v1.ts` | dictionaryapi.dev |
| `geocoding-v1` | `geocoding-v1.ts` | Open-Meteo Geocoding |
| `sunrise-v1` | `sunrise-v1.ts` | sunrise-sunset.org |
| `news-v1` | `news-v1.ts` | Hacker News (Algolia) |
| `translate-v1` | `translate-v1.ts` | MyMemory |
| `random-fact-v1` | `random-fact-v1.ts` | uselessfacts.jsph.pl |
| `nasa-apod-v1` | `nasa-apod-v1.ts` | NASA APOD (DEMO_KEY) |

## web (3)

Ajoutes en v0.5.0. Sans cle API. Regles reseau : [securite-web.md](securite-web.md)
(https only, hotes locaux et IP privees refuses, plafonds, redirections limitees).

| ID | Fichier | API / source |
|---|---|---|
| `fetch-url-v1` | `fetch-url-v1.ts` | GET https direct, garde SSRF, texte plafonne (HTML converti en texte) |
| `web-search-ddg-v1` | `web-search-ddg-v1.ts` | DuckDuckGo Instant Answer (api.duckduckgo.com) |
| `wikipedia-search-v1` | `wikipedia-search-v1.ts` | API MediaWiki (`<lang>.wikipedia.org`) |

Entrees / sorties principales :

| Outil | Entrees | Sorties |
|---|---|---|
| `fetch-url-v1` | `url` (https), `max_chars` (200 a 200000) | `url`, `final_url`, `status`, `content_type`, `format`, `text`, `truncated`, `bytes_approx`, `redirects` |
| `web-search-ddg-v1` | `query` (1-200), `limit` (1-8, defaut 5) | `query`, `source`, `count`, `results[]` (`title`, `url`, `snippet`), `note` si vide |
| `wikipedia-search-v1` | `query` (1-200), `lang` (defaut `fr`), `limit` (1-8, defaut 5) | `query`, `lang`, `count`, `total_hits`, `results[]` (`title`, `pageid`, `url`, `snippet`) |

Limite connue : `web-search-ddg-v1` s'appuie sur l'API Instant Answer, qui n'est pas un
index web complet. Sur une requete pointue elle peut ne rien retourner : l'outil renvoie
alors `results: []` et une `note`, pas une erreur.

## Pattern d'ID

`<nom>-v<version>`. Nouvelle version = nouvel ID (cohabitation possible).

## Outils a venir

Voir [roadmap.md](roadmap.md) : memory, lyla-health, HTTP/SSE, etc.

## Ajouter un outil

Voir [GUIDE-AJOUTER-OUTIL.md](GUIDE-AJOUTER-OUTIL.md).
