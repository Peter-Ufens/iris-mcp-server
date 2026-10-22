# Securite des outils web (categorie `web`)

> Decision de reference : **ADR-0005 "Outils web : securite (SSRF, plafonds)"**
> (canon dans le hub docs local du projet, hors de ce depot public ; cf. ADR-0004).
> Cette page ne resume que ce que le code applique, pour un lecteur du repo public.

Depuis la v0.5.0, `fetch-url-v1` accepte une **URL fournie par le client** (donc
potentiellement par un LLM). La garde est dans `src/utils/url-guard.ts` et
`src/utils/http-fetch.ts`.

**Surfaces reseau (MAJ 22/10) :** `fetch-url-v1` (URL client, garde complete) ;
`ollama-list-v1` / chat (base **loopback seulement**, `OLLAMA_BASE_URL` hors loopback ignoree) ;
les flux `actu-rss-v1` utilisent des URL **fixes** ou construites serveur-side (pas d'URL client).

Depuis la v0.10.0, `actu-rss-v1` lit des **flux RSS fixes** (liste dans le code) et,
si demande, des URL Google / Bing Actualites construites serveur-side. **Aucune URL client.**
Regles ADR-0006 / ADR-0008 / ADR-0010 (hub Iris-MCP) : titres / liens / resume court, usage personnel,
pas de texte integral d'article. Bing : lien editeur decode depuis `apiclick` (https).
Depuis la v0.11.3 : zone `officiel` = flux `service-public.gouv.fr` (particuliers + pro), meme garde
https / liste fixe / pas d'URL client.

## Ce qui est refuse

| Regle | Detail |
|---|---|
| Schema | `https` uniquement (`http`, `file`, `data`, `ftp`... refuses) |
| Credentials | `https://user:pass@hote` refuse |
| Hotes locaux | `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.home.arpa`, `*.lan` |
| IPv4 | `0.0.0.0/8`, `10/8`, `127/8`, `169.254/16` (metadonnees cloud), `172.16/12`, `192.168/16`, `100.64/10`, `192.0.0/24`, `198.18/15`, multicast, reserve |
| IPv6 | `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`, formes IPv4 mappees / `::ffff:0:x`, NAT64 `64:ff9b::/96`, 6to4 `2002::/16`, site-local `fec0::/10`, discard `100::/64`, Teredo `2001:0::/32` |
| DNS | Le nom est resolu avant l'appel : un nom public qui pointe vers une IP privee est refuse |
| Redirections | Pas de suivi automatique. Max 3 sauts, chaque saut repasse la garde |
| Content-Type | `text/*`, `application/json` (et `*+json`), `application/xml` (et `*+xml`), `application/xhtml+xml`. En-tete absent = traite comme du texte. Tout autre type declare : erreur |

## Plafonds

| Plafond | Valeur |
|---|---|
| Timeout | 10 s |
| Texte retourne | 200 000 caracteres max (`max_chars` peut baisser ce plafond ; il s'applique au texte rendu, apres conversion HTML, pour garder le corps de la page) |
| Lecture reseau | Flux interrompu des le plafond atteint |
| Troncature | Signalee par `truncated: true` |
| User-Agent | `iris-mcp-server/<version>` (pas d'usurpation de navigateur) |

Aucune ecriture disque : le contenu recupere ne sort que dans la reponse MCP.

## Allowlist optionnelle

Variable d'environnement `WEB_ALLOWED_HOSTS` (liste separee par virgules). Vide ou
absente : tout hote public est autorise. Renseignee : seuls ces hotes et leurs
sous-domaines passent.

```bash
WEB_ALLOWED_HOSTS=wikipedia.org,duckduckgo.com,github.com
```

## Ce que ces outils ne sont pas

Pas de navigateur headless (Puppeteer / Playwright / Selenium), pas d'extension
navigateur, pas de contournement de captcha ou d'anti-bot, pas de telechargement de
binaires. Si un site exige un navigateur reel, `fetch-url-v1` retourne une erreur
propre : c'est le comportement attendu.

## DNS rebinding (corrige)

La resolution DNS est validee au moment de la connexion : `src/utils/pinned-fetch.ts`
fournit un Agent undici dont le `lookup` refuse toute adresse privee ou reservee, et la
socket se connecte uniquement aux adresses validees (pas de second lookup non controle).
L'en-tete Host et le SNI TLS restent ceux de l'URL. Chaque redirection ouvre une nouvelle
connexion et repasse donc par ce controle, en plus de `assertSafeUrl`.
Les clients JSON a hote fixe (`fetchJson`, URL construites par le code) ne sont pas
concernes (ADR-0005).
