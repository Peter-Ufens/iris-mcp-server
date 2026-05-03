# ADR 0001 - uv vs pip comme gestionnaire Python

## Contexte

Choisir un gestionnaire de paquets Python pour le projet. Options : `pip` (standard, lent, gestion d'environnements via `venv` separes), `poetry` (mature mais lent), `uv` (Astral, ecrit en Rust, 10-100x plus rapide, gestion projet integree).

## Decision

`uv`. Le cours Udemy MCP suivi par Peter (Nikolai Schuller) utilise `uv` nativement, et Peter a deja installe la commande.

## Consequences positives

Install et resolution dependencies rapides. Lock file `uv.lock` reproductible. Workflow simple : `uv init`, `uv add`, `uv run`.

## Consequences negatives

Ecosysteme moins mature que pip (mais maturity progresse vite en 2025-2026). Necessite installation de `uv` sur la machine cible.
