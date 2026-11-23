# Planificateur Cloudflare (#38) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Un Worker Cloudflare déclenche `daily.yml` et `weekly.yml` à l'heure par `workflow_dispatch` ; Terraform gère les crons et l'état ; les tokens sont propres à ce repo ; les `schedule:` GitHub disparaissent après une bascule vérifiée.

**Architecture :** `scheduler/` (TypeScript) : à chaque cron, `workflowFor(cron)` donne le fichier de workflow, `dispatchWorkflow` appelle l'API GitHub avec reprise. `iac/` (Terraform, état sur R2) possède les crons ; `wrangler` déploie le code (pas de `[triggers]`). Un `freshness.yml` prévient si aucun `daily` n'a réussi depuis 30 h.

**Tech Stack :** TypeScript, Vitest, Biome, wrangler (mêmes versions que `foot-prediction/collector`), Terraform >= 1.9 avec `cloudflare ~> 5`, Python (stdlib) pour la fraîcheur, GitHub Actions.

**Spec :** `docs/superpowers/specs/2026-11-23-cloudflare-scheduler-design.md`. Modèle à copier : le repo local `../foot-prediction` (`collector/`, `iac/`, `setup/`, cibles Make).

## Global Constraints

- Repo public : aucun secret, token, identifiant de compte Cloudflare ni valeur de `SUBSCRIBERS` dans git, un log, une issue ou l'état Terraform. L'identifiant de compte vient de `CLOUDFLARE_ACCOUNT_ID` (secret GitHub, variable d'environnement en local).
- Le token GitHub du Worker n'existe que comme secret du Worker (`wrangler secret put GITHUB_TOKEN`) : jamais dans git, Terraform ni les secrets du repo.
- Workflows : seulement `push`, `pull_request`, `schedule`, `workflow_dispatch` ; permissions `contents: read` par défaut ; actions au tag majeur comme les workflows existants ; jamais de secret dans un job qui exécute du code tiers sans nécessité.
- `daily`/`weekly` gardent `if: github.ref == 'refs/heads/main'` et le groupe `concurrency: data-branch`.
- Un seul planificateur actif à la fois : les `schedule:` ne sont retirés qu'à la Task 9, après un déclenchement réussi du Worker en prod.
- TDD ; après chaque tâche seulement les tests des fichiers touchés ; suite complète (`make check`) une fois à la fin. Commits sur `develop`, `type(scope): sujet (#38)`.
- Crons : `"0 6 * * *"` → `daily.yml`, `"0 8 * * 1"` → `weekly.yml` (UTC), identiques dans le Worker, Terraform et les workflows.

## Review Focus

1. Le token GitHub n'apparaît jamais dans un log ni dans un message d'erreur, y compris sur un échec réseau ou un 401.
2. Un cron inconnu ou un `GITHUB_TOKEN` absent donne une erreur visible, jamais un retour silencieux.
3. Un 404 (workflow absent) ou un 422 (workflow sans `workflow_dispatch`) n'est pas retenté et lève une erreur claire.
4. Les crons de Terraform, du Worker et les fichiers de workflow ne dérivent pas (un test les compare).
5. Un `daily` déjà en cours quand le Worker redéclenche : le groupe `concurrency` met en file, rien à tester ici ; un déclenchement en double (livraison « au moins une fois ») coûte une passe de LLM de plus, risque connu et accepté.

---

### Task 1: Worker, reprise des appels HTTP

**Files:**
- Create: `scheduler/package.json`, `scheduler/tsconfig.json`, `scheduler/biome.jsonc`, `scheduler/.gitignore`, `scheduler/src/resilience.ts`
- Test: `scheduler/src/resilience.test.ts`

**Interfaces:**
- Produces: `interface RetryPolicy { attempts: number; baseDelayMs: number; maxDelayMs: number; timeoutMs: number }`, `const DEFAULT_POLICY: RetryPolicy` (3, 1000, 8000, 15000), `type Sleep = (ms: number) => Promise<void>`, `fetchWithRetry(fetchFn: typeof fetch, url: string, init: RequestInit, opts: { policy: RetryPolicy; sleep: Sleep; random: () => number }): Promise<Response>` (rend la dernière réponse même en erreur ; lève la dernière erreur réseau une fois les tentatives épuisées).

- [ ] **Step 1:** Copier de `../foot-prediction/collector` : `package.json` (nom `veille-llm-scheduler`, mêmes versions de `@biomejs/biome`, `@cloudflare/workers-types`, `typescript`, `vitest`, `wrangler`), `tsconfig.json`, `biome.jsonc`, `.gitignore` (`node_modules`, `.wrangler`, `.dev.vars`) ; puis `cd scheduler && npm install` pour créer `package-lock.json`.
- [ ] **Step 2: Tests** (`resilience.test.ts`, sur le modèle de `collector/src/resilience.test.ts`, avec faux `fetch`, `sleep` et `random`) : une réponse 200 revient sans attente ; `500` puis `204` donne une reprise et un seul délai ; `408`, `425`, `429`, `502`, `503`, `504` sont retentés ; `401`, `403`, `404`, `422` ne le sont jamais et leur réponse est rendue ; `Retry-After: 3` impose au moins 3000 ms (plafonné à `maxDelayMs`) ; une erreur réseau puis un succès donne une reprise ; trois erreurs réseau lèvent la dernière ; l'`init` passé (méthode, en-têtes, corps) est transmis à chaque tentative avec un `signal` de timeout.
- [ ] **Step 3:** Lancer `cd scheduler && npx vitest run src/resilience.test.ts` : échec attendu (module absent).
- [ ] **Step 4:** Implémenter `resilience.ts` en reprenant `collector/src/resilience.ts`, avec le paramètre `init` fusionné à `{ signal: AbortSignal.timeout(policy.timeoutMs) }` ; mêmes statuts retentés (408, 425, 429, 500, 502, 503, 504).
- [ ] **Step 5:** Relancer : PASS. `cd scheduler && npx biome check . && npx tsc --noEmit`.
- [ ] **Step 6:** Commit `feat(scheduler): resilient HTTP calls for the Cloudflare scheduler (#38)`.

### Task 2: Worker, déclenchement des workflows

**Files:**
- Create: `scheduler/src/dispatch.ts`, `scheduler/src/index.ts`
- Test: `scheduler/src/dispatch.test.ts`, `scheduler/src/index.test.ts`

**Interfaces:**
- Consumes: `fetchWithRetry`, `RetryPolicy`, `Sleep`, `DEFAULT_POLICY` (Task 1).
- Produces dans `dispatch.ts` : `export const REPO = "benjamin-callonnec/veille-llm"` ; `export const WORKFLOWS: Record<string, string>` (`"0 6 * * *"` → `"daily.yml"`, `"0 8 * * 1"` → `"weekly.yml"`) ; `workflowFor(cron: string): string` (lève `Error("unknown cron: <cron>")`) ; `interface Deps { token: string; fetchFn: typeof fetch; log(line: string): void; policy: RetryPolicy; sleep: Sleep; random(): number }` ; `dispatchWorkflow(workflow: string, deps: Deps): Promise<void>` (POST `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, corps `{"ref":"main"}`, en-têtes `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: veille-llm-scheduler` ; `204` = succès, une ligne de journal `dispatched <workflow>: HTTP 204` ; tout autre statut lève `Error("dispatch of <workflow> failed: HTTP <statut>")`).
- Produces dans `index.ts` : l'export par défaut `{ async scheduled(controller, env) }` avec `interface Env { GITHUB_TOKEN: string }` ; lève `Error("GITHUB_TOKEN is not set: wrangler secret put GITHUB_TOKEN")` si le secret manque ; attend (`await`) le déclenchement pour que l'échec compte comme un échec du passage.

- [ ] **Step 1: Tests `dispatch.test.ts`** : `workflowFor` rend le bon fichier pour les deux crons et lève pour `"* * * * *"` (Review Focus 2) ; un 204 envoie exactement l'URL, la méthode `POST`, le corps `{"ref":"main"}` et les quatre en-têtes ci-dessus, journalise `dispatched daily.yml: HTTP 204` ; `500` puis `204` réussit après une reprise ; `404` lève `dispatch of daily.yml failed: HTTP 404` après un seul appel et `422` aussi (Review Focus 3) ; trois `500` lèvent ; **le token n'apparaît dans aucune ligne de journal ni dans aucun message d'erreur** pour les cas 204, 401, 404, 500 et erreur réseau (Review Focus 1).
- [ ] **Step 2: Tests `index.test.ts`** : `scheduled({ cron: "0 8 * * 1" }, { GITHUB_TOKEN: "t" })` appelle le `fetch` global simulé avec `weekly.yml` ; sans secret (`GITHUB_TOKEN: ""`) il lève l'erreur ci-dessus sans appeler `fetch` ; avec un cron inconnu il lève sans appeler `fetch`.
- [ ] **Step 3:** Lancer `cd scheduler && npx vitest run src/dispatch.test.ts src/index.test.ts` : échecs attendus.
- [ ] **Step 4:** Implémenter `dispatch.ts` puis `index.ts` (dépendances réelles : `fetch`, `console.log`, `setTimeout`, `Math.random`, `DEFAULT_POLICY` ; testables en injectant les faux par le paramètre de la fonction exportée).
- [ ] **Step 5:** Relancer : PASS ; `npx biome check . && npx tsc --noEmit`.
- [ ] **Step 6:** Commit `feat(scheduler): the Worker dispatches the daily and weekly workflows (#38)`.

### Task 3: Configuration Wrangler et cibles Make

**Files:**
- Create: `scheduler/wrangler.toml`
- Modify: `Makefile` (`install`, `check`, `.PHONY`, nouvelles cibles), `.gitignore`
- Test: `tests/harness/test_makefile.py`

**Interfaces:**
- Produces : cibles `scheduler-install` (`cd scheduler && npm ci --ignore-scripts`), `scheduler-check` (`cd scheduler && npm run check`), `scheduler-deploy` (`cd scheduler && npx wrangler deploy`), `scheduler-secret` (`cd scheduler && npx wrangler secret put GITHUB_TOKEN`) ; `install` appelle `scheduler-install` et `check` appelle `scheduler-check`.

- [ ] **Step 1: Tests** (`test_makefile.py`, avec le helper `_recipe`) : `_recipe("scheduler-install")` contient `npm ci` et `--ignore-scripts` ; `_recipe("scheduler-secret")` contient `wrangler secret put GITHUB_TOKEN` ; `_recipe("install")` contient `scheduler-install` et `_recipe("check")` contient `scheduler-check` ; `scheduler/wrangler.toml` contient `name = "veille-llm-scheduler"` et `workers_dev = false` et **ne contient pas** `[triggers]` ni `crons` (le partage avec Terraform) ; `.gitignore` contient `scheduler/node_modules/`, `.wrangler/`, `.dev.vars`, `iac/.terraform/` et `*.tfstate*`.
- [ ] **Step 2:** `uv run pytest tests/harness/test_makefile.py --no-cov -p no:cacheprovider -q` : échecs attendus.
- [ ] **Step 3:** Écrire `wrangler.toml` (`name`, `main = "src/index.ts"`, `compatibility_date = "2026-11-01"`, `workers_dev = false`, commentaire : les crons sont gérés par Terraform, `iac/main.tf`) ; ajouter les cibles et les lignes de `.gitignore` ; `make install` n'est pas relancé ici.
- [ ] **Step 4:** Relancer le test : PASS ; `make scheduler-check` : PASS.
- [ ] **Step 5:** Commit `chore(scheduler): wrangler config and make targets (#38)`.

### Task 4: Terraform, bootstrap et documentation de mise en route

**Files:**
- Create: `iac/providers.tf`, `iac/backend.tf`, `iac/variables.tf`, `iac/main.tf`, `iac/.terraform.lock.hcl` (généré), `setup/bootstrap.sh`, `setup/README.md`
- Modify: `Makefile` (cibles `tf-init`, `tf-validate`, `tf-plan`, `tf-apply`, `tf-apply-ci`)
- Test: `tests/harness/test_scheduler_crons.py`, `tests/harness/test_makefile.py`

**Interfaces:**
- Produces dans `iac/main.tf` : `locals { crons = ["0 6 * * *", "0 8 * * 1"] }`, `cloudflare_workers_cron_trigger.scheduler` (`script_name = "veille-llm-scheduler"`, une entrée `schedules` par cron), `cloudflare_workers_script_subdomain.scheduler` (`enabled = false`). Variables : `cloudflare_account_id` (string, sans valeur par défaut), `cloudflare_api_token` (string, `sensitive`). Backend `s3` : bucket `veille-llm-tfstate`, clé `scheduler/terraform.tfstate`, mêmes `skip_*` que `foot-prediction/iac/backend.tf`, endpoint R2 passé par `-backend-config`.
- Produces : `setup/bootstrap.sh` (idempotent, crée le bucket `veille-llm-tfstate`) ; cibles Make `tf-init` (`terraform init -backend-config="endpoints={s3=\"https://$$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com\"}"`), `tf-validate` (`terraform init -backend=false`, `validate`, `fmt -check`), `tf-plan`, `tf-apply`, `tf-apply-ci` (auto-approve) ; `TF_VAR_cloudflare_api_token` et `TF_VAR_cloudflare_account_id` exportés par le Makefile depuis `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID`.

- [ ] **Step 1: Tests** (`test_scheduler_crons.py`) : les crons extraits de `iac/main.tf` (regex sur les chaînes entre guillemets de `crons = [...]`) forment le même ensemble que les clés de `WORKFLOWS` dans `scheduler/src/dispatch.ts` (Review Focus 4) ; chaque fichier de workflow nommé dans `WORKFLOWS` existe dans `.github/workflows/` et contient `workflow_dispatch` ; aucun fichier sous `iac/` ni `setup/` ne contient un identifiant de compte (32 caractères hexadécimaux) ni la chaîne `ghp_` ou `github_pat_`. Dans `test_makefile.py` : `_recipe("tf-validate")` contient `-backend=false`, `validate` et `fmt -check` ; `_recipe("tf-apply-ci")` contient `-auto-approve`.
- [ ] **Step 2:** `uv run pytest tests/harness/test_scheduler_crons.py tests/harness/test_makefile.py --no-cov -p no:cacheprovider -q` : échecs attendus.
- [ ] **Step 3:** Écrire les fichiers `iac/` en copiant le style de `../foot-prediction/iac/` (`required_version = ">= 1.9"`, fournisseur `cloudflare ~> 5`, aucune variable GitHub) ; `bootstrap.sh` copié de `foot-prediction/setup/bootstrap.sh` avec le nom de bucket changé ; ajouter les cibles Make.
- [ ] **Step 4:** `make tf-validate` : PASS (adapter les noms d'attributs de `cloudflare_workers_cron_trigger` et `cloudflare_workers_script_subdomain` à ce que `terraform validate` accepte pour la version 5 installée). Relancer les tests : PASS.
- [ ] **Step 5:** Écrire `setup/README.md` (en français, comme celui du modèle) : compte Cloudflare ; création du **token Cloudflare `veille-llm`** (*Workers Scripts : Edit*, *Workers R2 Storage : Edit*, *Account Settings : Read*, limité à ce compte) ; bucket d'état via `setup/bootstrap.sh` ; **clés R2 limitées à ce bucket** ; secrets GitHub à créer (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `R2_STATE_ACCESS_KEY_ID`, `R2_STATE_SECRET_ACCESS_KEY`) ; **token GitHub fine-grained** (ce repo seul, *Actions : Read and write* uniquement, 90 jours), posé par `make scheduler-secret`, et sa rotation (créer le nouveau, `make scheduler-secret`, révoquer l'ancien) ; le risque assumé (ce token déclenche tout `workflow_dispatch` du repo) ; l'ordre `make scheduler-deploy` puis `make tf-apply`.
- [ ] **Step 6:** Commit `feat(iac): Terraform for the scheduler crons and its state bucket (#38)`.

### Task 5: Garde-fou sur `spike-llm` et jobs de CI

**Files:**
- Modify: `.github/workflows/spike-llm.yml` (garde de branche), `.github/workflows/ci.yml` (jobs `scheduler` et `scheduler-deploy`)
- Test: `tests/harness/test_spike_workflow.py`, `tests/harness/test_ci_scheduler.py`

**Interfaces:**
- Produces dans `ci.yml` : job `scheduler` (sans aucun secret : `actions/checkout`, `actions/setup-node` Node 22 avec cache npm de `scheduler/package-lock.json`, `make scheduler-install`, `make scheduler-check`, `hashicorp/setup-terraform@v3`, `make tf-validate`) ; job `scheduler-deploy` (`needs: scheduler`, `concurrency: { group: scheduler-deploy, cancel-in-progress: false }`, `permissions: contents: read`, `env` avec `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` pris dans les secrets, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` pris dans `R2_STATE_ACCESS_KEY_ID`/`R2_STATE_SECRET_ACCESS_KEY` ; étapes `make scheduler-install`, `make scheduler-deploy`, `make tf-init`, `make tf-apply-ci`).

- [ ] **Step 1: Tests** : dans `test_spike_workflow.py`, le workflow contient `github.ref == 'refs/heads/main'` dans un `if` du job `spike` (et les interdits existants restent interdits) ; dans `test_ci_scheduler.py` (YAML chargé avec `yaml.safe_load`, comme `test_daily_workflow.py`) : le job `scheduler` ne contient aucune occurrence de `secrets.` ; le job `scheduler-deploy` dépend de `scheduler`, a `cancel-in-progress: false`, n'exécute qu'avec `make scheduler-install` (qui porte `--ignore-scripts`) avant d'avoir le secret en environnement d'étape, et sa permission `contents` vaut `read` ; aucun job de `ci.yml` n'a `pull_request_target` dans ses déclencheurs ; `scheduler-deploy` ne tourne que sur `push` (le seul déclencheur de `ci.yml`).
- [ ] **Step 2:** `uv run pytest tests/harness/test_spike_workflow.py tests/harness/test_ci_scheduler.py --no-cov -p no:cacheprovider -q` : échecs attendus.
- [ ] **Step 3:** Ajouter le `if` au job `spike` et les deux jobs à `ci.yml` (sans toucher au job `check` existant) ; le secret n'est exposé qu'aux étapes qui le consomment, **après** `make scheduler-install` (placer `env:` au niveau de ces étapes, pas du job, si le test le demande).
- [ ] **Step 4:** Relancer : PASS ; `uvx pre-commit run --files .github/workflows/ci.yml .github/workflows/spike-llm.yml` : PASS.
- [ ] **Step 5:** Commit `ci(scheduler): check and deploy the Worker, guard the spike workflow (#38)`.

### Task 6: Alerte de fraîcheur

**Files:**
- Create: `src/veille_llm/freshness.py`, `.github/workflows/freshness.yml`
- Test: `tests/test_freshness.py`, `tests/harness/test_freshness_workflow.py`

**Interfaces:**
- Produces : `check(runs: list[dict], now: datetime, max_hours: float) -> tuple[bool, str]` (les `runs` sont la sortie de `gh run list --json createdAt`, triée du plus récent au plus ancien ; vrai si la dernière exécution réussie a au plus `max_hours` heures ; le message dit l'âge ou « no successful run found ») ; `main(argv: list[str] | None = None) -> int` (lit le JSON sur l'entrée standard, `--max-hours` par défaut 30, code de sortie 1 si périmé ou illisible, imprime le message).

- [ ] **Step 1: Tests** (`test_freshness.py`) : une exécution d'il y a 3 h → `(True, "…3.0 hours…")` ; d'il y a 31 h → `False` ; une liste vide → `(False, "no successful run found")` ; une date mal formée → `main` rend 1 sans exception ; `main` lit un JSON valide sur `stdin` simulé et rend 0 ou 1 selon l'âge, avec `--max-hours 2` qui rend 1 pour 3 h. Dans `test_freshness_workflow.py` : déclencheurs exactement `{"schedule", "workflow_dispatch"}` ; `permissions` vaut `{"actions": "read", "contents": "read"}` ; aucune occurrence de `secrets.` hors `github.token` ; la commande contient `--workflow daily.yml`, `--status success` et `PYTHONPATH=src python3 -m veille_llm.freshness`.
- [ ] **Step 2:** `uv run pytest tests/test_freshness.py tests/harness/test_freshness_workflow.py --no-cov -p no:cacheprovider -q` : échecs attendus.
- [ ] **Step 3:** Implémenter `freshness.py` (bibliothèque standard seulement) et `freshness.yml` (cron `17 9 * * *`, `GH_TOKEN: ${{ github.token }}`, `gh run list -R ${{ github.repository }} --workflow daily.yml --status success --limit 1 --json createdAt | PYTHONPATH=src python3 -m veille_llm.freshness --max-hours 30`).
- [ ] **Step 4:** Relancer : PASS ; pre-commit sur les fichiers touchés.
- [ ] **Step 5:** Commit `feat(harness): freshness alert when no daily run succeeded for 30 hours (#38)`.

### Task 7: Vérification locale de l'ensemble

- [ ] **Step 1:** `make check` : tout passe ; `make tf-validate` : PASS.
- [ ] **Step 2:** `cd scheduler && npx wrangler dev --test-scheduled --local` avec un `.dev.vars` factice (`GITHUB_TOKEN=dummy`) et `curl "http://localhost:8787/__scheduled?cron=0+6+*+*+*"` : le Worker répond et journalise une tentative de déclenchement (qui échoue en 401 avec un faux token) **sans afficher le token** ; noter le résultat dans le message de commit de la tâche ou dans l'issue.
- [ ] **Step 3:** Mettre à jour `README.md` et `.claude/CLAUDE.md` pour décrire le planificateur (architecture, commandes `scheduler-*`, `tf-*`) ; **ne pas** encore dire que les `schedule:` ont disparu. Commit `docs(harness): describe the Cloudflare scheduler (#38)`.

### Task 8: Mise en route en production (avec l'auteur)

Cette tâche ne se fait pas seul : elle crée des comptes, des tokens et des ressources chez Cloudflare et GitHub. S'arrêter ici et la dérouler avec l'auteur.

- [ ] **Step 1:** L'auteur crée le token Cloudflare, les clés R2 limitées au bucket d'état et les quatre secrets GitHub, comme décrit dans `setup/README.md`, puis lance `setup/bootstrap.sh`.
- [ ] **Step 2: Test de coexistence (le point non vérifié du design)** : `make scheduler-deploy`, puis `make tf-init` et `make tf-plan` (lire le plan), `make tf-apply`, puis **un second** `make scheduler-deploy` : vérifier dans le tableau de bord (*Workers > veille-llm-scheduler > Settings > Triggers*) que les deux crons sont toujours là. Si le second déploiement les efface : mettre les crons dans `scheduler/wrangler.toml`, retirer `cloudflare_workers_cron_trigger` de Terraform, adapter `tests/harness/test_makefile.py` (le test qui interdit `[triggers]`) et `test_scheduler_crons.py`, et le noter dans le ledger. Vérifier aussi les limites du plan gratuit (2 crons requis).
- [ ] **Step 3:** L'auteur crée le token GitHub fine-grained (ce repo seul, *Actions : Read and write*, 90 jours) et le pose avec `make scheduler-secret`.
- [ ] **Step 4:** Déclencher à la main le Worker (`wrangler` : exécution du cron de test, ou attendre le prochain cron) et vérifier qu'un run `daily` apparaît dans GitHub Actions, déclenché par `workflow_dispatch` sur `main`.

### Task 9: Bascule et vérification finale

**Files:**
- Modify: `.github/workflows/daily.yml`, `.github/workflows/weekly.yml`, `tests/harness/test_daily_workflow.py`, `tests/harness/test_weekly_workflow.py`, `.claude/CLAUDE.md`, `README.md`

À faire seulement quand la Task 8 a produit un déclenchement réussi en production.

- [ ] **Step 1: Tests** : dans les deux fichiers de test, `triggers(DOC) == {"workflow_dispatch"}` (les noms des tests passent à « runs only manually (the Cloudflare Worker dispatches it) ») ; le texte des workflows ne contient plus `schedule:` ni `cron:`.
- [ ] **Step 2:** `uv run pytest tests/harness/test_daily_workflow.py tests/harness/test_weekly_workflow.py --no-cov -p no:cacheprovider -q` : échecs attendus.
- [ ] **Step 3:** Retirer les entrées `schedule:` de `daily.yml` et `weekly.yml` ; remplacer leurs commentaires (« Triggers: schedule and manual only » → « Triggers: manual only; the Cloudflare Worker `veille-llm-scheduler` dispatches it at 06:00 UTC (daily) and Monday 08:00 UTC (weekly) ») ; mettre à jour `.claude/CLAUDE.md` (« Les GitHub Actions ne se déclenchent… » et la liste des déclencheurs) et `README.md`.
- [ ] **Step 4:** Relancer : PASS ; `make check` : PASS. Commit `ci: the Cloudflare Worker is the only scheduler of daily and weekly (#38)`.
- [ ] **Step 5 (après le push et les deux prochains cycles) :** comparer l'heure du cron et le `created_at` du run (`gh run list --workflow daily.yml --json createdAt,event`) : écart sous une minute et `event == workflow_dispatch` ; noter le résultat dans l'issue #38 avant de la fermer.

## Hors de ce plan (décidé à l'écriture)

- Environnement de dev du Worker : un seul environnement (prod), comme le design.
- Déclenchement en double : documenté comme risque, pas d'idempotence ajoutée.
- Surveillance du Worker lui-même (Workers Logs, alertes Cloudflare) : `freshness.yml` suffit pour la première version.
