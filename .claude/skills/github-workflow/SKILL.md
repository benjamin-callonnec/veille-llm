---
name: github-workflow
description: Utiliser la CLI gh pour les issues, le projet GitHub et les PR du repo veille-llm, avec le compte personnel (pas le compte pro actif par défaut).
---

# GitHub avec `gh` (veille-llm)

Le compte `gh` actif sur cette machine est le compte **pro**. Toute commande `gh` de ce repo doit
utiliser le compte personnel et cibler le repo explicitement :

```bash
export GH_TOKEN="$(gh auth token --user benjamin-callonnec)"
R="-R benjamin-callonnec/veille-llm"
```

Ne jamais lancer `gh auth switch` : cela change le compte actif pour tous les autres repos.

## Commandes

- Issues : `gh issue create $R --title ... --body ... --label core`, `gh issue list $R`,
  `gh issue edit $R <n> ...`, `gh issue close $R <n>`.
- Projet : `gh project list --owner benjamin-callonnec`, `gh project item-add <numero> --owner benjamin-callonnec --url <url-issue>`.
  Le scope `project` est déjà accordé au compte personnel.
- PR : `gh pr create $R --title ... --body ...` (le corps se termine par la ligne d'attribution Claude Code).
- Commits : autorisés dans ce repo. Jamais de `git push` sans accord de l'auteur.

## Conventions

- Une issue par plan d'implémentation, et une case à cocher par tâche du plan dans le corps.
- Étiquettes : `harness`, `core`, `web`, `newsletter`.
- Titre court à l'infinitif ou nominal, corps avec le chemin du plan (`docs/superpowers/plans/...`).
- Repo public : jamais d'adresse d'abonné, de secret, ni de valeur de `SUBSCRIBERS` dans une issue,
  un commentaire, une PR ou un log. Ne jamais lancer `gh secret list` (interdit dans `settings.json`).
