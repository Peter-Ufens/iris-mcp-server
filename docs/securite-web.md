# Securite des outils web (categorie `web`)

> Decision de reference : **ADR-0005 "Outils web : securite (SSRF, plafonds)"**, hub local
> `D:\IA-CURSOR\Iris-MCP\ADR\ADR-0005-outils-web-securite.md` (hub = loi, cf. ADR-0004).
> Cette page ne resume que ce que le code applique, pour un lecteur du repo public.

Depuis la v0.5.0, `fetch-url-v1` accepte une **URL fournie par le client** (donc
potentiellement par un LLM). C'est la seule surface SSRF du serveur : les autres outils
construisent leurs URL eux-memes. La garde est dans `src/utils/url-guard.ts` et
`src/utils/http-fetch.ts`.

## Ce qui est refuse

| Regle | Detail |
|---|---|
| Schema | `https` uniquement (`http`, `file`, `data`, `ftp`... refuses) |
| Credentials | `https://user:pass@hote` refuse |
| Hotes locaux | `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.home.arpa`, `*.lan` |
| IPv4 | `0.0.0.0/8`, `10/8`, `127/8`, `169.254/16` (metadonnees cloud), `172.16/12`, `192.168/16`, `100.64/10`, `192.0.0/24`, `198.18/15`, multicast, reserve |
| IPv6 | `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`, formes IPv4 mappees |
| DNS | Le nom est resolu avant l'appel : un nom public qui pointe vers une IP privee est refuse |
| Redirections | Pas de suivi automatique. Max 3 sauts, chaque saut repasse la garde |
| Content-Type | `text/*`, `application/json` (et `*+json`), `application/xml` (et `*+xml`), `application/xhtml+xml`. En-tete absent = traite comme du texte. Tout autre type declare : erreur |

## Plafonds

| Plafond | Valeur |
|---|---|
| Timeout | 10 s |
| Texte retourne | 200 000 caracteres max (`max_chars` peut baisser ce plafond) |
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

## Limite connue

La verification DNS et l'appel HTTP ne sont pas atomiques (fenetre de DNS rebinding
theorique). Accepte en mode lab local ; a revoir avant toute exposition HTTP/SSE
distante (roadmap v1.0.0).
