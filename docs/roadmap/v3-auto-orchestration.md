# V3 - Auto-orchestration

## Objectif

Le serveur MCP devient capable de choisir dynamiquement quel LLM (cloud
ou local) utiliser selon la complexite de la requete, le cout, la
latence, ou la confidentialite des donnees.

## Critere de validation

- [ ] Routeur de requetes avec regles configurable (.yml).
- [ ] Metriques par LLM (latence, cout estime, qualite).
- [ ] Possibilite de fallback si le LLM principal est indisponible.
- [ ] Versioning explicite des tools (semver) et migrations.

## Cas d'usage cibles

- "Lecture de fichier" -> route vers TinyLlama Pi (rapide, gratuit).
- "Analyse complexe d'un document" -> route vers Claude Sonnet (qualite).
- "Recherche web" -> route via Perplexity MCP.
