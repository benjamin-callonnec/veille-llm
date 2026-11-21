# Plan 1 : harnais de développement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Mettre en place le harnais qui encadre tout le développement suivant : pre-commit (lint, formatage, détection de secrets), stop hook, `CLAUDE.md`, skills, permissions, CI de contrôle, premier push.

**Architecture :** Un seul point d'entrée qualité, `make check` (ruff + pytest), appelé par le stop hook, la CI et la doc. Pre-commit protège les commits. Les règles du projet vivent dans `CLAUDE.md` et dans un skill local. Le harnais lui-même est testé par pytest (le stop hook est un script shell piloté par des tests).

**Tech Stack :** Python 3.11+, uv, ruff, pytest, pre-commit, gitleaks (via pre-commit), bash, GitHub Actions.

**Spec :** `docs/superpowers/specs/2026-11-21-veille-llm-design.md` (sections 3, 5.5, 8 étape 1).

Les plans suivants (à écrire un par un après celui-ci) : 2 spike LLM + `core`, 3 `web`, 4 `services/newsletter` et abonnés.

## Global Constraints

- Python `>=3.11`, gestion des dépendances par `uv` (`uv.lock` commité).
- `ruff` : `line-length = 100`, règles `E, F, I, UP, B` (déjà dans `pyproject.toml`).
- **Commits autorisés dans ce repo** (accord explicite de l'auteur, valable uniquement ici, exception à la règle globale). Jamais de `git push` sans accord.
- **Identité personnelle** : e-mail de commit personnel défini en local dans ce repo (jamais l'adresse pro). Toute commande `gh` utilise le compte personnel : `GH_TOKEN="$(gh auth token --user benjamin-callonnec)"` et `-R benjamin-callonnec/veille-llm`.
- Issues et projet GitHub : créés avec la CLI `gh`, pas de serveur MCP.
- Lancer `pre-commit run --files <fichiers modifiés>`, jamais `--all-files`.
- Après chaque modification, ne lancer que les tests des fichiers touchés. La suite complète avec couverture se lance une seule fois, à la fin.
- Repo public : aucun secret, aucune adresse e-mail, aucun `subscribers.txt` ni `.env` commités.
- Workflows GitHub : uniquement `push`, `pull_request`, `schedule`, `workflow_dispatch`. Jamais `pull_request_target`, `issues` ni `issue_comment` avec accès aux secrets. Permissions `contents: read` par défaut.
- Le remote `origin` est `git@github.com-personal:benjamin-callonnec/veille-llm.git`.

## Review Focus

- Le stop hook boucle sans fin quand les tests échouent toujours : il doit laisser Claude s'arrêter quand `stop_hook_active` vaut `true`.
- Le stop hook est lent ou bruyant quand rien n'a changé : il doit sortir immédiatement avec le code 0 s'il n'y a aucun fichier `.py` modifié.
- Un `subscribers.txt` ou un `.env` est ajouté par erreur : pre-commit doit refuser le commit.
- Une fausse clé d'API dans un fichier indexé : gitleaks doit refuser le commit.
- `settings.json` contient du JSON invalide : le harnais entier est ignoré en silence. Un test doit le parser.

## File Structure

| Fichier | Rôle |
|---|---|
| `Makefile` (modifier) | cible `check` : lint sans correction + tests |
| `.gitignore` (modifier) | ajoute `subscribers.txt`, `.env` |
| `.pre-commit-config.yaml` (créer) | hooks de qualité et de sécurité |
| `.claude/hooks/stop-checks.sh` (créer) | stop hook : lance `make check` si du Python a changé |
| `.claude/settings.json` (créer) | enregistre le hook, définit les permissions |
| `.claude/CLAUDE.md` (créer) | règles du projet |
| `.claude/skills/veille-guidelines/SKILL.md` (créer) | conventions du pipeline et de sécurité |
| `.claude/skills/SOURCES.md` (créer) | origine et version des skills tiers installés |
| `.claude/skills/github-workflow/SKILL.md` (créer) | usage de `gh` (compte personnel, issues, projet) |
| `.github/workflows/ci.yml` (créer) | pre-commit + `make check` sur push et PR |
| `tests/harness/test_stop_hook.py` (créer) | tests du stop hook |
| `tests/harness/test_settings.py` (créer) | validité de `settings.json` |

---

### Task 0 : identité git et compte `gh`

**Files:** aucun fichier du dépôt (configuration locale).

L'identité git globale est l'adresse pro et le compte `gh` actif est le compte pro. Sur un repo public, chaque commit publie l'e-mail de l'auteur : il faut le fixer avant le premier commit.

- [ ] **Step 1 : obtenir de l'auteur l'e-mail de commit à rendre public** (adresse `noreply` GitHub recommandée), puis `git config --local user.name "Benjamin Callonnec"` et `git config --local user.email <adresse choisie>`.
- [ ] **Step 2 : vérifier** : `git config --local --get user.email` affiche l'adresse choisie, pas `@loreal.com`.
- [ ] **Step 3 : vérifier le compte `gh` personnel** : `GH_TOKEN="$(gh auth token --user benjamin-callonnec)" gh api user --jq .login`. Attendu : `benjamin-callonnec`.
- [ ] **Step 4 : ajouter le scope projet** (par l'auteur, interactif, via `! gh auth refresh -h github.com -u benjamin-callonnec -s project`), puis vérifier : `GH_TOKEN="$(gh auth token --user benjamin-callonnec)" gh project list --owner benjamin-callonnec`. Attendu : pas d'erreur de scope.

---

### Task 1 : `make check` et `.gitignore`

**Files:**
- Modify: `Makefile`, `.gitignore`
- Test: `tests/harness/test_makefile.py`

**Interfaces:**
- Produces : cible `make check` (code de sortie 0 si lint, format et tests passent). Les tâches 2 et 6 l'appellent.

- [ ] **Step 1 : écrire le test `test_check_target_runs_lint_format_and_tests`** : lit `Makefile` et vérifie que la recette de `check` contient `ruff check`, `ruff format --check` et `pytest`, et ne contient pas `--fix`. Écrire aussi `test_gitignore_blocks_private_files` : `.gitignore` contient `subscribers.txt` et `.env`.
- [ ] **Step 2 : lancer** `uv run pytest tests/harness/test_makefile.py -v`. Attendu : 2 FAIL.
- [ ] **Step 3 : implémenter** la cible `check` (`uv run ruff check src tests`, `uv run ruff format --check src tests`, `uv run pytest`), l'ajouter à `.PHONY`, et ajouter `subscribers.txt` et `.env` à `.gitignore`.
- [ ] **Step 4 : lancer** `uv run pytest tests/harness/test_makefile.py -v`. Attendu : 2 PASS. Puis `make check`. Attendu : code 0.
- [ ] **Step 5 : commit** : `git add Makefile .gitignore tests/harness` puis message `chore: add make check and ignore private files`.

---

### Task 2 : stop hook

**Files:**
- Create: `.claude/hooks/stop-checks.sh` (exécutable), `tests/harness/test_stop_hook.py`

**Interfaces:**
- Consumes : `make check` (tâche 1).
- Produces : le script lit un JSON sur stdin (champ `stop_hook_active`), lit `CLAUDE_PROJECT_DIR` (sinon le répertoire courant), et :
  - sort avec le code 0 si `stop_hook_active` est `true`, ou si aucun fichier `.py` n'est modifié ou non suivi ;
  - sinon lance `make check` ; si elle échoue, écrit la fin de la sortie sur stderr et sort avec le code 2 (le code 2 empêche Claude de s'arrêter et lui transmet stderr).

- [ ] **Step 1 : écrire les tests** dans `tests/harness/test_stop_hook.py`. Chaque test crée un dépôt git temporaire (`tmp_path`), y place un faux `make` dans un dossier ajouté au `PATH`, et lance le script avec `subprocess.run(..., input=json)`. Noms et assertions :
  - `test_exits_0_when_no_python_changed` : aucun fichier modifié, faux `make` qui écrit un marqueur ; code 0 et marqueur absent.
  - `test_exits_0_when_make_check_passes` : un `.py` modifié, faux `make` qui sort 0 ; code 0.
  - `test_exits_2_with_output_when_make_check_fails` : un `.py` modifié, faux `make` qui affiche `LINT ERROR` et sort 1 ; code 2 et `LINT ERROR` dans stderr.
  - `test_does_not_block_when_stop_hook_active` : même situation que le précédent avec `{"stop_hook_active": true}` ; code 0.
  - `test_untracked_python_file_triggers_check` : un `.py` neuf non suivi ; faux `make` échoue ; code 2.
- [ ] **Step 2 : lancer** `uv run pytest tests/harness/test_stop_hook.py -v --no-cov`. Attendu : 5 FAIL (script absent).
- [ ] **Step 3 : implémenter** `.claude/hooks/stop-checks.sh` en bash (`set -u`) : `git status --porcelain` pour détecter les `.py`, lecture de `stop_hook_active` sans dépendance externe (grep sur le JSON), `chmod +x`.
- [ ] **Step 4 : lancer** `uv run pytest tests/harness/test_stop_hook.py -v --no-cov`. Attendu : 5 PASS.
- [ ] **Step 5 : commit** : `git add .claude/hooks tests/harness` puis `feat(harness): add stop hook running make check`.

---

### Task 3 : `settings.json` (hook et permissions)

**Files:**
- Create: `.claude/settings.json`, `tests/harness/test_settings.py`

**Interfaces:**
- Consumes : `.claude/hooks/stop-checks.sh` (tâche 2).
- Produces : hook `Stop` appelant `"$CLAUDE_PROJECT_DIR"/.claude/hooks/stop-checks.sh`, et permissions `deny` pour `Bash(git push --force:*)`, `Read(./.env)`, `Read(./subscribers.txt)`, `Bash(gh secret list:*)`.

- [ ] **Step 1 : écrire les tests** : `test_settings_is_valid_json` (parse le fichier) ; `test_stop_hook_registered_and_executable` (la commande du hook `Stop` pointe vers un fichier existant et exécutable) ; `test_force_push_and_private_files_are_denied` (les quatre règles `deny` ci-dessus sont présentes).
- [ ] **Step 2 : lancer** `uv run pytest tests/harness/test_settings.py -v --no-cov`. Attendu : 3 FAIL.
- [ ] **Step 3 : écrire** `.claude/settings.json` avec ces règles.
- [ ] **Step 4 : lancer** les tests. Attendu : 3 PASS. Vérifier ensuite à la main dans une session Claude du repo que `/hooks` liste le hook `Stop`.
- [ ] **Step 5 : commit** : `git add .claude/settings.json tests/harness` puis `feat(harness): register stop hook and deny rules`.

---

### Task 4 : pre-commit

**Files:**
- Create: `.pre-commit-config.yaml`
- Test: vérification manuelle ci-dessous (pas de test pytest : l'outil est externe)

**Interfaces:**
- Produces : hooks `ruff` (avec `--fix`), `ruff-format`, `check-yaml`, `check-toml`, `end-of-file-fixer`, `trailing-whitespace`, `check-added-large-files` (`--maxkb=500`, `data.json` et `*.db` exclus), `detect-private-key`, `gitleaks`, et un hook local `forbid-private-files` (`language: fail`, `files: (^|/)(subscribers\.txt|\.env)$`).

- [ ] **Step 1 : écrire** `.pre-commit-config.yaml`, puis lancer `pre-commit autoupdate` pour épingler les versions courantes, puis `pre-commit install`.
- [ ] **Step 2 : vérifier le refus d'un fichier privé** : `echo test > subscribers.txt && git add -f subscribers.txt && pre-commit run --files subscribers.txt`. Attendu : `forbid-private-files` en échec. Nettoyer : `git rm --cached -f subscribers.txt && rm subscribers.txt`.
- [ ] **Step 3 : vérifier le refus d'un secret** : créer `tmp_secret.txt` contenant `aws_access_key_id = AKIA` suivi de `IOSFODNN7EXAMPLE`, `git add tmp_secret.txt`, lancer `pre-commit run --files tmp_secret.txt`. Attendu : `gitleaks` ou `detect-private-key` en échec (si seul gitleaks est attendu et ne réagit pas, changer l'exemple pour une clé de format valide). Nettoyer le fichier.
- [ ] **Step 4 : vérifier le cas normal** : `pre-commit run --files Makefile .gitignore .pre-commit-config.yaml`. Attendu : tout passe.
- [ ] **Step 5 : commit** : `git add .pre-commit-config.yaml` puis `chore: add pre-commit hooks with secret scanning`.

---

### Task 5 : `CLAUDE.md` et skill local

**Files:**
- Create: `.claude/CLAUDE.md`, `.claude/skills/veille-guidelines/SKILL.md`

**Interfaces:**
- Consumes : `make check` (tâche 1), règles de sécurité de la spec (section 3).

- [ ] **Step 1 : écrire `.claude/CLAUDE.md`** (moins de 120 lignes), avec les sections : commandes (`make install`, `make check`, `make unittest`, `pre-commit run --files ...`), architecture en trois lignes avec renvoi à la spec et aux plans, politique git (commits permis à l'assistant dans ce repo, push uniquement avec l'accord de l'auteur, identité et compte `gh` personnels), règles de test (tests des fichiers touchés, suite complète une fois à la fin, TDD), règles de sécurité de la spec section 3 (workflows, secrets, abonnés, LLM sans outil), et la mention de lire `veille-guidelines` avant de toucher au pipeline.
- [ ] **Step 2 : écrire `.claude/skills/veille-guidelines/SKILL.md`** avec un en-tête (`name`, `description`) et les conventions : étapes déterministes ou LLM avec la même interface, retry avec backoff sur 429 et 5xx, source en panne ignorée sans bloquer les autres, enregistrement de chaque verdict LLM immédiatement, rien d'incomplet publié, sortie LLM validée avant usage, aucune adresse d'abonné dans les logs, URL de base configurable pour le front, accès aux abonnés via `SubscriberStore`.
- [ ] **Step 3 : vérifier** : `wc -l .claude/CLAUDE.md` (moins de 120) et `rg -c "subscribers|workflow|commit" .claude/CLAUDE.md` (chaque mot présent au moins une fois).
- [ ] **Step 4 : commit** : `git add .claude/CLAUDE.md .claude/skills/veille-guidelines` puis `docs(harness): add CLAUDE.md and project guidelines skill`.

---

### Task 6 : skills publics tiers

**Files:**
- Create: `.claude/skills/<skills installés>/`, `.claude/skills/SOURCES.md`

Déjà disponibles sans installation : Superpowers (TDD, plans, debug, revue), `/simplify`, `/security-review`, `/code-review`. On ajoute deux skills qui comblent un manque : `frontend-design` (pour le plan 3, l'interface React) et un skill d'analyse statique de sécurité de Trail of Bits (Semgrep ou CodeQL).

- [ ] **Step 1 : vérifier les sources** : `gh repo view anthropics/skills` et `gh repo view trailofbits/skills`. Si l'un n'existe pas, s'arrêter et le signaler à l'auteur.
- [ ] **Step 2 : cloner chaque repo dans un dossier temporaire** hors du projet (le scratchpad), noter le SHA du commit (`git rev-parse HEAD`), lire en entier le `SKILL.md` de `frontend-design` et du skill de Trail of Bits dont la description mentionne l'analyse statique, et **vérifier qu'ils ne contiennent ni commande réseau suspecte, ni script obfusqué**.
- [ ] **Step 3 : copier** uniquement ces deux dossiers de skills dans `.claude/skills/` et écrire `.claude/skills/SOURCES.md` : une ligne par skill avec l'URL du repo, le chemin et le SHA épinglé.
- [ ] **Step 4 : vérifier** que les deux skills apparaissent dans la liste des skills d'une nouvelle session du repo.
- [ ] **Step 5 : commit**, après sa relecture des fichiers copiés : `git add .claude/skills` puis `chore(harness): vendor frontend-design and static analysis skills`.

---

### Task 7 : CI de contrôle

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes : `make check`, `.pre-commit-config.yaml`.
- Produces : un workflow déclenché sur `push` vers `main` et sur `pull_request`, avec `permissions: contents: read`, qui installe `uv`, lance `uv sync`, `uvx pre-commit run --all-files` puis `make check`.

- [ ] **Step 1 : écrire** `.github/workflows/ci.yml` avec ces propriétés. Les actions tierces sont épinglées par version majeure au minimum, `actions/checkout` avec `persist-credentials: false`.
- [ ] **Step 2 : vérifier** : `uvx check-jsonschema --builtin-schema vendor.github-workflows .github/workflows/ci.yml`. Attendu : ok. Puis `rg "pull_request_target|issue_comment|issues:" .github/workflows`. Attendu : aucun résultat.
- [ ] **Step 3 : commit** : `git add .github/workflows/ci.yml` puis `ci: add pre-commit and make check workflow`.

---

### Task 8 : premier push

**Files:** aucun.

- [ ] **Step 1 : relire l'état** : `git status` et `git log`. Attendu : tout est commité, branche `main`.
- [ ] **Step 2 : vérifier le remote** : `git remote -v`. Attendu : `git@github.com-personal:benjamin-callonnec/veille-llm.git`.
- [ ] **Step 3 : demander l'accord de l'auteur**, puis `git push -u origin main`. Attendu : push réussi.
- [ ] **Step 4 : régler le dépôt sur GitHub** (par l'auteur) : Settings > Actions > General, approbation manuelle pour les contributeurs extérieurs ; Settings > Pages, source GitHub Actions. Vérifier que le workflow `ci.yml` passe au vert.

---

### Task 9 : skill `github-workflow`, issues et projet

**Files:**
- Create: `.claude/skills/github-workflow/SKILL.md`

**Interfaces:**
- Consumes : compte `gh` personnel et scope `project` (tâche 0), remote poussé (tâche 8).
- Produces : le skill décrit les commandes `gh` à utiliser avec `GH_TOKEN` du compte personnel et `-R benjamin-callonnec/veille-llm` : `gh issue create|list|edit|close`, `gh project item-add`, `gh pr create`, et les conventions : une issue par tâche des plans, étiquettes `harness`, `core`, `web`, `newsletter`, titre court, corps avec lien vers le plan.

- [ ] **Step 1 : écrire** `.claude/skills/github-workflow/SKILL.md` (en-tête `name`, `description`, puis commandes et conventions ci-dessus, et l'interdiction d'écrire une adresse d'abonné dans une issue ou un commentaire).
- [ ] **Step 2 : créer les étiquettes** : `gh label create harness|core|web|newsletter -R benjamin-callonnec/veille-llm`.
- [ ] **Step 3 : créer le projet** `veille-llm` (`gh project create --owner benjamin-callonnec --title veille-llm`) et une issue par plan (4 issues, une par plan), toutes ajoutées au projet. Attendu : `gh issue list` en affiche 4.
- [ ] **Step 4 : commit** : `git add .claude/skills/github-workflow` puis `docs(harness): add github-workflow skill`.

---

## Auto-revue

- **Couverture de la spec** : section 3 (sécurité, politique de commit) : tâches 3, 4, 5, 7 ; section 5.5 (CLAUDE.md, skills, pre-commit, stop hook, tests) : tâches 1 à 6 ; section 8 étape 1 (premier push) : tâche 8. Hors de ce plan : tout le reste de la spec, traité par les plans 2 à 4.
- **Cohérence des noms** : `make check`, `stop-checks.sh`, `forbid-private-files`, `veille-guidelines` sont utilisés avec la même orthographe partout.
- **À noter** : le workflow existant `.github/workflows/pages.yml` (v0) reste inchangé dans ce plan. Il se déclenchera au premier push et peut échouer tant que Pages n'est pas configuré. C'est sans conséquence.
