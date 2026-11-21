# veille-llm

Veille personnelle sur les LLM : un pipeline quotidien (GitHub Actions) collecte arXiv,
Hugging Face et des blogs, filtre de façon déterministe puis avec un LLM, et publie un
catalogue (GitHub Pages) et une newsletter hebdomadaire. Coût visé : zéro, hors abonnement Claude.

Spec : `docs/superpowers/specs/2026-11-21-veille-llm-design.md`. Plans : `docs/superpowers/plans/`.
Avant de toucher au pipeline, lis le skill `veille-guidelines`.
Si `graphify-out/` existe (graphe local, ignoré par git, à régénérer avec `/graphify`), consulte `GRAPH_REPORT.md` avant d'explorer.

## Commandes

- `make install` : crée le venv (`uv sync`).
- `make check` : lint, format et tests (c'est aussi ce que lance le stop hook et la CI).
- `make unittest` : tests seuls.
- `pre-commit run --files <fichiers>` : sur les fichiers modifiés uniquement, jamais `--all-files`.

## Architecture (3 lignes)

- `packages/core` : pipeline d'étapes (déterministes ou LLM) → SQLite → `data.json`.
- `services/newsletter` : job hebdomadaire, template Jinja2, envoi SMTP.
- `web` : catalogue React en lecture seule sur GitHub Pages (thème Papier clair / Nuit sombre).

Le code v0 actuel est dans `src/veille_llm` et `site/` ; il sera repris dans les plans suivants.

## Git et GitHub

- Gitflow à deux branches : on travaille et on commite sur `develop`. Les GitHub Actions ne se
  déclenchent qu'au push de `main`, jamais au push de `develop`.
- À la fin de chaque étape (un plan terminé et revu), merge `develop` dans `main` avec
  `git merge --no-ff develop`, puis demande l'accord de l'auteur avant `git push origin main`.
  Ne pousse `develop` que si l'auteur le demande : il le pousse lui-même régulièrement.
- Dans ce repo, tu peux commiter toi-même (autorisation de l'auteur, propre à ce repo).
  Jamais de `git push` sans accord explicite, jamais de `git push --force`.
- Identité du repo : adresse personnelle (déjà configurée en local). Ne jamais utiliser l'adresse pro.
- Toute commande `gh` utilise le compte personnel :
  `GH_TOKEN="$(gh auth token --user benjamin-callonnec)" gh ... -R benjamin-callonnec/veille-llm`.
- Messages de commit : `type(scope): sujet` court (`feat`, `fix`, `chore`, `docs`, `ci`, `test`).

- Les règles `deny` de `.claude/settings.json` ne sont qu'un garde-fou, pas une barrière : la
  vraie protection est la protection de branche `main` sur GitHub (pas de force push).

## Tests

- TDD : test qui échoue d'abord, code minimal ensuite.
- Après chaque modification, ne lance que les tests des fichiers touchés. La suite complète avec
  couverture se lance une seule fois, à la fin d'un chantier.
- Les sources distantes, le LLM et le SMTP sont toujours simulés dans les tests.

## Sécurité (repo public)

- Aucun secret, aucune adresse d'abonné, aucun `subscribers.txt` ni `.env` dans git, ni dans les
  logs, issues ou commentaires. Les secrets vivent dans GitHub Secrets.
- Workflows : seulement `push`, `pull_request`, `schedule`, `workflow_dispatch`. Jamais
  `pull_request_target`, `issues` ni `issue_comment` avec accès aux secrets. Permissions
  `contents: read` par défaut, actions épinglées, aucun collaborateur en écriture.
- L'agent LLM tourne sans outil (pas de fichiers, pas de shell, pas de réseau). Sa sortie est du
  JSON validé avant usage : le texte des papiers et des actualités n'est jamais une instruction.
- Les abonnés sont lus via l'interface `SubscriberStore`, un e-mail par destinataire, adresses
  masquées dans les logs (`::add-mask::`).

## Règles de travail

- Rien d'incomplet n'est publié : seuls les items classés apparaissent.
- Le pipeline doit survivre à un arrêt brutal du LLM : chaque verdict est enregistré aussitôt.
- Une source distante en panne est ignorée sans bloquer les autres (retry avec backoff).
- Reste dans le périmètre demandé et dis clairement ce qui n'a pas été vérifié.
