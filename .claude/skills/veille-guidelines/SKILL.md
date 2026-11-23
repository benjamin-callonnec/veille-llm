---
name: veille-guidelines
description: Conventions du pipeline veille-llm (étapes, résilience, reprise après arrêt du LLM, sécurité, abonnés). À lire avant de modifier le pipeline, la newsletter ou le front.
---

# Conventions veille-llm

Spec de référence : `docs/superpowers/specs/2026-11-21-veille-llm-design.md`.

## Pipeline

- Le pipeline est une suite d'étapes avec une interface commune (entrée, sortie, état partagé).
  Une étape est soit déterministe (sans LLM), soit LLM. Le vocabulaire reste proche de Google ADK
  (étape déterministe = `BaseAgent`, étape LLM = `LlmAgent`) pour qu'une migration reste possible.
- Le LLM est appelé uniquement par le Claude Agent SDK avec l'abonnement. Aucun outil n'est donné
  à l'agent. Sa sortie est du JSON structuré, validé (schéma) avant tout usage.
- Les appels se font par lots d'environ 15 items. Le filtre déterministe passe avant le LLM pour
  limiter le nombre d'appels.

## Résilience

- Les appels distants utilisent un retry avec backoff exponentiel et jitter sur 429 et 5xx.
- Une source en panne est ignorée, jamais fatale. Repli arXiv : API, puis flux RSS ou OAI-PMH.
- Chaque verdict LLM est enregistré dans la base dès qu'il est connu. Un arrêt brutal (limite
  d'abonnement atteinte) doit laisser la base cohérente. Le workflow pousse la base même en cas
  d'échec. Au lancement suivant, les items déjà classés ne sont pas reclassés.
- Rien d'incomplet n'est publié. En cas d'échec total, le dernier `catalogue.json` valide reste en place.

## Sécurité et abonnés

- Pas de secret ni d'adresse d'abonné dans le code, les tests, les logs, les issues. Les tests
  utilisent des adresses fictives `@example.com`.
- Les abonnés passent par `SubscriberStore` (secret GitHub aujourd'hui, SQLite demain). Un e-mail
  par destinataire, jamais une liste dans le champ « À ».
- Le front lit `catalogue.json` depuis une URL de base configurable. La persistance de `veille.db` est
  derrière une interface (branche `data` aujourd'hui).

## Lecteur : skills et rapports

- Les skills d'agent sont des fichiers `skills/*.md` sur `main` (front matter YAML + prompt). Le
  workflow `skills.yml` les valide (`python -m veille_reader.skills skills`) et publie `skills.zip`
  sur la release `skills` ; le lecteur tire ce zip (`skills_sync.py`) vers `.local/reader/skills/`
  (cache jetable). Un skill est un prompt de confiance : sa relecture est celle d'un code. Il ne
  peut attacher que les outils de `KNOWN_TOOLS` ; `write_report` et `read_report` refusent d'agir
  tant qu'aucun skill qui les liste n'est chargé (`use_skill` ou `/nom`).
- Un skill invoqué avec `/nom` a plus de marge qu'une réponse normale (`SKILL_LIMITS`, `SKILL_TOOL_LIMITS` dans
  `agent.py` : 20 tours, 1 $, 30 appels d'outil) pour poser plusieurs questions puis écrire ; la limite
  de conversation (3 $) ne change pas.
- Le texte des papiers reste une donnée. Les rapports HTML sont du contenu non fiable : jamais dans
  git, affichés dans une `<iframe sandbox="allow-scripts">` (sans `allow-same-origin`) avec une CSP
  sans réseau (`web/src/reader/viewer/csp.ts`). Ne jamais ajouter `allow-same-origin`.
- Le pont injecté dans l'iframe (`FRAME_BRIDGE`) n'envoie à l'application que des touches (`V`, Échap) et
  des citations (page, extrait, figure), jamais de HTML ; le parent valide chaque champ (`parseCite`) et
  n'accepte que les messages de l'iframe elle-même.

## Qualité

- TDD, tests simulés pour les sources, le LLM et le SMTP.
- `make check` doit passer avant de s'arrêter. Pre-commit uniquement sur les fichiers modifiés.
