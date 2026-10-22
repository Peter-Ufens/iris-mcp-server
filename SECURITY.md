# Security Policy

## Supported versions

The current `main` branch of this repository (latest release line, presently **0.12.x**).

## Reporting a vulnerability

This is a personal lab / portfolio MCP server (stdio, local-first). Prefer a **private** report:

1. Open a GitHub Security advisory on this repository if available, **or**
2. Contact the maintainer via GitHub (@Peter-Ufens) without posting exploit details publicly.

Please include: Iris version (`package.json`), tip commit, and a minimal reproduction.

## Scope notes

- Dependencies are audited with `npm audit` (runtime **and** dev tooling, target: **0** known issues).
- Untrusted git repositories under `ALLOWED_ROOTS` are still a trust boundary: Iris neutralizes common local `.git/config` / attributes helpers (`hooksPath`, `gpg.program`, `gpg.ssh.program`, `gpg.x509.program`, `core.sshCommand`, `core.askPass`, `core.editor`, `credential.helper`, ...). Every `filter=NAME`, `diff=NAME` and `merge=NAME` found in `.gitattributes` (root, nested, `.git/info/attributes`) is neutralized (`filter.NAME.clean/smudge/process`, `diff.NAME.command/textconv`, `merge.NAME.driver`), names with dots included; a name that cannot be neutralized is refused. `diff`, `log` and `show` also run with `--no-ext-diff --no-textconv`. The attributes scan is bounded and **fail-closed** (too many or too deep `.gitattributes`: operation refused).
- Repo-level `[include]` / `[includeIf]` (in `.git/config`, `config.worktree`, linked worktrees) cannot be cleared with an empty `-c`, so Iris **refuses** any git operation on such a repo (fail-closed). Includes in the user's **global** config are allowed (global identity kept). Requires git >= 2.26 (`git config --show-scope`).
- Hostile git env vars (`GIT_SSH_COMMAND`, `GIT_ASKPASS`, `GIT_EXTERNAL_DIFF`, `GIT_CONFIG_COUNT`/`PARAMETERS`/`KEY_n`/`VALUE_n`, `GIT_DIR`, `GIT_WORK_TREE`, ...) are scrubbed from the environment passed to git, case-insensitively (Windows), rebuilt on every call. Treat unknown repos as hostile anyway.
- RAG tools require `ZONE_A_PATTERNS_FILE` (fail-closed if missing). Opening the reserved zone also needs `IRIS_ALLOW_RESERVED=1` plus the tool flag `includeReserved`.
- Web SSRF guard (`url-guard.ts`) blocks private IPv4/IPv6 including NAT64 / 6to4 / site-local / Teredo / discard. **DNS rebinding** is closed for client-supplied URLs (`fetch-url`, RSS): the DNS answer is validated at connect time and the socket connects only to those validated addresses (`pinned-fetch.ts`, undici `Agent` with a guarded `lookup`; Host and TLS SNI unchanged); every redirect is followed manually and re-validated.
- Paths: `ALLOWED_ROOTS` checks use `realpath` (symlinks, junctions, Windows 8.3 short names expanded natively). On Windows, root comparison is case-insensitive, and UNC (`\\server\share`), device paths (`\\?\`, `\\.\`), NTFS alternate data streams (`file:stream`), drive-relative paths (`C:file`), reserved device names (`CON`, `NUL`, `COM1`...) and segments ending with a dot or space are refused.
- Git tools are **status / log / diff / commit** only (no fetch/push/clone). Remaining config keys that matter mainly for network git ops are not a current Iris surface.
