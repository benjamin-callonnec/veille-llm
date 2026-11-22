---
name: release
description: Préparer une release de veille-llm au moment de merger develop dans main — choisir le bump semver d'après les commits, mettre à jour CHANGELOG.md et la version de pyproject.toml. À utiliser à la fin de chaque étape, avant `git merge --no-ff develop`.
---

# Release (semver à chaque merge sur main)

La version vit dans `pyproject.toml` ; l'historique dans `CHANGELOG.md` (Keep a Changelog).
Le workflow `release.yml` crée le tag `vX.Y.Z` et la release GitHub au push de `main`, avec la
section du changelog en description. Il ne fait rien si la release de cette version existe déjà.

## Étapes (sur `develop`, avant le merge)

1. Dernier tag : `git describe --tags --abbrev=0` (sinon la version courante de `pyproject.toml`).
   Commits depuis : `git log <tag>..develop --oneline --no-merges`.
2. Niveau de bump, d'après les types de commit :
   - rupture (`!` après le type, ou `BREAKING CHANGE`) : **major** (tant que < 1.0, un major devient minor) ;
   - au moins un `feat` : **minor** ;
   - sinon (`fix`, `perf`, `docs`, `ci`, `chore`, `test`) : **patch**.
   Annonce le niveau proposé et pourquoi ; l'auteur peut le corriger.
3. `CHANGELOG.md` : sous `## [Unreleased]`, ajoute `## [X.Y.Z] - AAAA-MM-JJ` avec `### Added`
   (feat), `### Changed`, `### Fixed` (fix), en une ligne lisible par entrée (pas le message brut).
   Laisse `## [Unreleased]` vide au-dessus.
4. `pyproject.toml` : `version = "X.Y.Z"`. Puis `uv lock` si le lockfile référence la version.
5. `make check` (le test `tests/test_release.py` vérifie que version et changelog concordent).
6. Commit : `chore(release): vX.Y.Z`. Ensuite seulement : `git merge --no-ff develop` dans `main`,
   puis demande l'accord avant `git push origin main`.

## Version de la pipeline (distincte de la version du produit)

`src/veille_llm/pipeline/version.py` porte `PIPELINE_VERSION`, qui décide si les résultats LLM déjà
stockés sont périmés (issue #16). Elle ne bouge que si un fichier qui influence les résultats a
changé (filtres, classification, hooks, consolidation, réglages du LLM : liste `RESULT_FILES`).
Un test échoue tant que ce n'est pas décidé :

- `uv run python -m veille_llm.pipeline.version bump patch` : aucun effet sur les résultats
  (jamais de recalcul) ;
- `... bump minor` : les résultats changent un peu (règle, seuil, prompt) : recalcul progressif ;
- `... bump major` : les résultats changent beaucoup.
Un changement de modèle ou de prompt invalide de toute façon (hash enregistré avec chaque résultat).
Propose le niveau d'après les commits qui touchent `RESULT_FILES`, puis note-le dans le changelog.

Ne crée jamais le tag à la main : c'est le workflow qui le fait.
