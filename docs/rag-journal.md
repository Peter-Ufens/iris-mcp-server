# Journal des recherches RAG (opt-in)

Depuis la v0.8.0, `rag-query-v1`, `rag-search-v2` et `rag-hybrid-v1` peuvent garder une trace de chaque recherche, pour reperer plus tard les **formulations qui ratent** et **celle qui trouve ensuite**. Ces paires servent a enrichir un vocabulaire (glossaire) **apres relecture humaine**. Le journal ne modifie rien lui-meme : ni glossaire, ni index, ni resultats.

## Activation

| Variable | Effet |
|---|---|
| `IRIS_RAG_JOURNAL_DIR` | dossier du journal. **Absente = aucune ecriture**, sortie des outils strictement inchangee |
| `IRIS_RAG_JOURNAL_FENETRE_MIN` | fenetre d'appariement automatique en minutes (defaut 15) |

Exemple de configuration MCP (chemin a adapter, **hors de tout depot git**) :

```json
{
  "mcpServers": {
    "iris": {
      "command": "node",
      "args": ["/chemin/vers/iris-mcp-server/dist/index.js"],
      "env": { "IRIS_RAG_JOURNAL_DIR": "/chemin/prive/journal-recherches" }
    }
  }
}
```

**Le texte des requetes est une donnee personnelle** : ne jamais pointer le journal vers un dossier versionne ou synchronise publiquement.

## Ce qui est ecrit

`evenements.jsonl` : une ligne par appel.

| Champ | Contenu |
|---|---|
| `v` | version du format (1) |
| `id` | `evt-...`, renvoye dans `meta.journal.id` |
| `ts` | horodatage ISO |
| `sessionId` | identifiant du processus MCP (une connexion client = une session) |
| `outil` | `rag-query-v1`, `rag-search-v2` ou `rag-hybrid-v1` |
| `requete` | texte de la question (2000 caracteres au plus) |
| `statut` | `succes`, `echec`, `clarification`, `erreur` |
| `needsClarification`, `confiance` | repris de l'outil quand ils existent (`rag-search-v2`) |
| `nbResultats`, `topSources` | nombre de resultats et 5 chemins au plus (**aucun extrait**) |
| `options` | `limit`, `project`, `sourceContains`, `reformulate` s'ils sont fournis |
| `dureeMs` | duree de l'appel |

Statut :

| Statut | Regle |
|---|---|
| `erreur` | `meta.error` present (Qdrant, Ollama, requete vide) : jamais apparie |
| `clarification` | `needsClarification: true` |
| `echec` | aucun resultat ; ou `rag-hybrid-v1` dont tous les termes distinctifs sont introuvables dans le texte |
| `succes` | sinon (l'outil a repondu ; cela ne prouve pas que la reponse etait la bonne) |

`paires.jsonl` : une ligne par paire « recherche ratee -> recherche reussie ».

| Lien | Quand |
|---|---|
| `auto-session` | dans le meme processus MCP, chaque `echec` ou `clarification` de la fenetre est apparie au **premier** `succes` qui suit. Signal faible : deux sujets differents peuvent se suivre |
| `manuel` | l'agent appelle `rag-journal-link-v1` apres avoir verifie que la reponse est la bonne. Signal fort |

## Garanties

- `includeZoneA: true` : la recherche **n'est pas journalisee**.
- Best-effort : si le dossier est inaccessible, l'outil repond normalement et `meta.journal.erreur` le signale.
- Fichiers en ajout seul (une ligne JSON par ecriture). Plusieurs clients MCP peuvent ecrire dans le meme dossier.
- Aucun nettoyage ni rotation automatique : a la charge de l'exploitant.
