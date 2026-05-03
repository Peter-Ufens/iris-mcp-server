# ADR 0003 - Double exposition MCP + REST API

## Contexte

MCP est consomme par des agents IA via JSON-RPC, mais Peter veut aussi pouvoir tester et utiliser les capacites en direct (debug, scripts, smartphone via HTTP). Options : 2 serveurs separes (MCP + API REST) ou serveur unique exposant les deux protocoles.

## Decision

Serveur unique exposant a la fois MCP (JSON-RPC) et REST API. Une couche d'abstraction commune (`tools/`) est utilisee par les deux endpoints.

## Consequences positives

Factorisation de la logique metier, un seul deploiement, tests unifies.

## Consequences negatives

Leger surcout de complexite dans la couche transport. Acceptable.
