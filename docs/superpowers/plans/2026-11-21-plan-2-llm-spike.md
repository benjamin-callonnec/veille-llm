# Plan 2 : spike LLM (Claude Agent SDK + abonnement)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Prouver que le Claude Agent SDK, authentifié par l'abonnement, tourne en headless dans GitHub Actions, et livrer la brique `llm.py` réutilisée par le pipeline : appel sans outil, sortie JSON validée, erreurs typées, garde anti-facturation.

**Architecture :** Un module `src/veille_llm/llm.py` (logique testée avec un exécuteur simulé) et un petit script de spike qui l'appelle pour de vrai, d'abord en local, puis dans un workflow `workflow_dispatch`. Le résultat du spike est consigné dans un document go/no-go qui décide de la suite (plan 3, `core`).

**Tech Stack :** Python 3.11+, `claude-agent-sdk`, `jsonschema`, pytest, GitHub Actions.

**Spec :** `docs/superpowers/specs/2026-11-21-veille-llm-design.md` (sections 3, 5.1, 8 étape 2).

Plans suivants : 3 `core`, 4 `web`, 5 `newsletter` et abonnés. Le plan 3 n'est écrit qu'après le go du spike.

## Global Constraints

- Python `>=3.11`, `uv`, `ruff` (`line-length = 100`), `make check` doit passer avant chaque commit.
- Modèle : `claude-sonnet-5-5`.
- **Aucune clé API** : `ANTHROPIC_API_KEY` ne doit jamais être défini, ni dans le code, ni dans un workflow, ni dans l'environnement du spike (la facturation au token est un échec).
- L'agent tourne **sans aucun outil** (`tools=[]`), un seul tour, sortie JSON validée par schéma.
- Workflows : `workflow_dispatch` uniquement pour le spike, permissions `contents: read`, le jeton `CLAUDE_CODE_OAUTH_TOKEN` n'est lu que depuis GitHub Secrets et n'apparaît jamais dans un log.
- Commits autorisés dans ce repo ; `git push` demande l'accord de l'auteur.
- `gh` : `GH_TOKEN="$(gh auth token --user benjamin-callonnec)"` et `-R benjamin-callonnec/veille-llm`.
- Les tests simulent le SDK : aucun appel réseau dans la suite pytest.

## Actions de l'auteur (non automatisables)

1. `! claude setup-token` : génère le jeton long (connexion navigateur, compte de l'abonnement). Ne jamais coller le jeton dans la conversation.
2. Enregistrer le secret sans l'afficher : `! gh secret set CLAUDE_CODE_OAUTH_TOKEN -R benjamin-callonnec/veille-llm` (la commande demande la valeur).
3. Vérifier dans les réglages du compte Claude que « extra usage » est **désactivé**.

## Review Focus

- `ANTHROPIC_API_KEY` défini dans l'environnement : le code doit refuser de démarrer, avant tout appel.
- Une limite d'abonnement atteinte ne doit jamais être réessayée (relancer brûle des appels) : `LlmLimitError` n'est pas réessayable, une erreur 5xx l'est.
- Un 401 (jeton révoqué ou invalide) se distingue d'une limite : `LlmAuthError`.
- Le modèle répond avec du texte autour du JSON, des balises ```json, ou rien : seul le JSON valide passe, le reste lève `LlmError`.
- Un jeton (`sk-ant-oat…`) présent dans un message d'erreur : il est masqué avant d'être journalisé.

## File Structure

| Fichier | Rôle |
|---|---|
| `pyproject.toml` (modifier) | groupe de dépendances `llm` : `claude-agent-sdk`, `jsonschema` |
| `src/veille_llm/llm.py` (créer) | `complete_json`, erreurs typées, garde de facturation, masquage |
| `tests/test_llm.py` (créer) | tests de `llm.py` avec exécuteur simulé |
| `scripts/spike_llm.py` (créer) | spike : classe 3 items fictifs et affiche résultat et jetons |
| `.github/workflows/spike-llm.yml` (créer) | exécute le spike en Actions (`workflow_dispatch`) |
| `docs/superpowers/specs/2026-11-21-spike-llm-result.md` (créer) | résultat et go/no-go |

---

### Task 1 : garde de facturation, erreurs typées, masquage

**Files:**
- Modify: `pyproject.toml`
- Create: `src/veille_llm/llm.py`, `tests/test_llm.py`

**Interfaces:**
- Produces, dans `veille_llm.llm` :
  - `class LlmError(Exception)`, `class LlmAuthError(LlmError)`, `class LlmLimitError(LlmError)`
  - `def assert_subscription_auth(env: Mapping[str, str] = os.environ) -> None` : lève `LlmError` si `ANTHROPIC_API_KEY` est défini et non vide.
  - `def classify_error(message: str) -> type[LlmError]` : renvoie `LlmAuthError` pour 401, « invalid bearer token » ou « authentication » ; `LlmLimitError` pour « usage limit », « rate limit », « limit reached » ou 429 ; sinon `LlmError`. Insensible à la casse.
  - `def is_retryable(exc: Exception) -> bool` : `False` pour `LlmLimitError` et `LlmAuthError`, `True` pour une `LlmError` simple dont le message contient 500, 502, 503, 504 ou « overloaded ».
  - `def redact(text: str) -> str` : remplace tout motif `sk-ant-[A-Za-z0-9_-]+` par `[REDACTED]`.

- [ ] **Step 1 : ajouter la dépendance** : `uv add --group llm claude-agent-sdk jsonschema`, puis `uv sync --all-groups`.
- [ ] **Step 2 : écrire les tests** dans `tests/test_llm.py` : `test_refuses_when_api_key_is_set` (clé non vide, lève `LlmError`), `test_accepts_empty_or_missing_api_key`, `test_classify_error_maps_401_to_auth`, `test_classify_error_maps_usage_limit_to_limit`, `test_classify_error_defaults_to_llm_error`, `test_limit_and_auth_errors_are_not_retryable`, `test_server_errors_are_retryable`, `test_redact_masks_oauth_tokens`.
- [ ] **Step 3 : lancer** `uv run pytest tests/test_llm.py -v --no-cov`. Attendu : tous FAIL (module absent).
- [ ] **Step 4 : implémenter** ces fonctions dans `src/veille_llm/llm.py`, avec les signatures ci-dessus.
- [ ] **Step 5 : lancer** `uv run pytest tests/test_llm.py -v --no-cov`. Attendu : tous PASS.
- [ ] **Step 6 : commit** : `git add pyproject.toml uv.lock src/veille_llm/llm.py tests/test_llm.py` puis `feat(llm): add billing guard, typed errors and redaction`.

---

### Task 2 : `complete_json`

**Files:**
- Modify: `src/veille_llm/llm.py`, `tests/test_llm.py`

**Interfaces:**
- Consumes : les erreurs et fonctions de la tâche 1.
- Produces :
  - `@dataclass(frozen=True) class LlmResult: data: dict; input_tokens: int; output_tokens: int; cost_usd: float | None`
  - `Runner = Callable[[str, LlmOptions], Awaitable[RawReply]]` avec `@dataclass(frozen=True) class LlmOptions: model: str; tools: list[str]; max_turns: int; system_prompt: str` et `@dataclass(frozen=True) class RawReply: text: str; input_tokens: int; output_tokens: int; cost_usd: float | None`
  - `async def complete_json(prompt: str, schema: dict, *, model: str = "claude-sonnet-5-5", runner: Runner | None = None) -> LlmResult` : appelle `assert_subscription_auth()`, construit `LlmOptions(tools=[], max_turns=1, …)` avec un prompt système qui exige du JSON seul, appelle le `runner`, extrait le JSON (accepte un bloc ```json), le valide avec `jsonschema.validate`, sinon lève `LlmError`. Toute exception du runner est reclassée avec `classify_error(redact(str(exc)))` puis relevée avec le message masqué.

- [ ] **Step 1 : écrire les tests** (runner simulé, `pytest.mark.asyncio` ou `asyncio.run`) : `test_returns_validated_json_and_usage`, `test_accepts_fenced_json_block`, `test_rejects_prose_around_json`, `test_rejects_json_that_violates_schema`, `test_rejects_empty_reply`, `test_runs_with_no_tools_and_one_turn` (le runner capture `LlmOptions` et on vérifie `tools == []` et `max_turns == 1`), `test_runner_limit_error_becomes_llm_limit_error`, `test_token_in_runner_error_is_redacted`, `test_refuses_before_calling_runner_when_api_key_set`.
- [ ] **Step 2 : lancer** `uv run pytest tests/test_llm.py -v --no-cov`. Attendu : les nouveaux tests FAIL.
- [ ] **Step 3 : implémenter** `LlmResult`, `LlmOptions`, `RawReply`, `Runner` et `complete_json`.
- [ ] **Step 4 : lancer** les tests. Attendu : tous PASS.
- [ ] **Step 5 : commit** : `git add src/veille_llm/llm.py tests/test_llm.py` puis `feat(llm): add complete_json with validated structured output`.

---

### Task 3 : exécuteur réel et spike local

**Files:**
- Modify: `src/veille_llm/llm.py`
- Create: `scripts/spike_llm.py`

**Interfaces:**
- Consumes : `Runner`, `LlmOptions`, `RawReply` (tâche 2).
- Produces : `async def claude_runner(prompt: str, options: LlmOptions) -> RawReply` qui appelle `claude_agent_sdk.query` avec `ClaudeAgentOptions(model=options.model, tools=options.tools, max_turns=options.max_turns, system_prompt=options.system_prompt)`, concatène le texte des messages assistant et lit les jetons et le coût dans le message de résultat. `complete_json` l'utilise quand `runner` est `None`.
- `scripts/spike_llm.py` : classe 3 items fictifs (un papier sur Mamba, une annonce de modèle, une recette de cuisine) avec un schéma `{"items": [{"id": str, "interesting": bool, "category": str, "hook": str}]}`, affiche le JSON, les jetons et le coût, et sort en code 1 sur toute `LlmError`, avec le type de l'erreur sur stderr.

- [ ] **Step 1 : écrire le test** `test_complete_json_uses_claude_runner_by_default` : `monkeypatch` de `veille_llm.llm.claude_runner` par un faux ; appeler `complete_json` sans `runner` et vérifier que le faux est appelé.
- [ ] **Step 2 : lancer** le test. Attendu : FAIL.
- [ ] **Step 3 : implémenter** `claude_runner` (l'import de `claude_agent_sdk` est fait dans la fonction, pour que `llm.py` reste importable sans le SDK) et le choix par défaut dans `complete_json`.
- [ ] **Step 4 : lancer** `uv run pytest tests/test_llm.py -v --no-cov`. Attendu : tous PASS.
- [ ] **Step 5 : écrire** `scripts/spike_llm.py`, puis le lancer en local : `env -u ANTHROPIC_API_KEY uv run --group llm python scripts/spike_llm.py`. Attendu : JSON valide à 3 items, la recette classée `interesting: false`, jetons non nuls. Consigner le résultat (sans secret) dans les notes du document de résultat.
- [ ] **Step 6 : commit** : `git add src/veille_llm/llm.py scripts/spike_llm.py tests/test_llm.py` puis `feat(llm): add Claude Agent SDK runner and local spike script`.

---

### Task 4 : spike en GitHub Actions

**Files:**
- Create: `.github/workflows/spike-llm.yml`

**Interfaces:**
- Consumes : `scripts/spike_llm.py` et le secret `CLAUDE_CODE_OAUTH_TOKEN` (action de l'auteur 2).
- Produces : un workflow `workflow_dispatch`, `permissions: contents: read`, `timeout-minutes: 10`, qui installe `uv`, `uv sync --group llm`, puis lance le spike avec `env: CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}` et **sans** `ANTHROPIC_API_KEY`. Le résumé du run (`$GITHUB_STEP_SUMMARY`) contient les jetons et le coût, jamais le jeton.

- [ ] **Step 1 : écrire le test** `tests/harness/test_spike_workflow.py::test_spike_workflow_is_manual_and_has_no_api_key` : le fichier contient `workflow_dispatch`, `CLAUDE_CODE_OAUTH_TOKEN`, `timeout-minutes`, `contents: read` et ne contient ni `ANTHROPIC_API_KEY`, ni `pull_request`, ni `schedule`.
- [ ] **Step 2 : lancer** le test. Attendu : FAIL.
- [ ] **Step 3 : écrire** `.github/workflows/spike-llm.yml` avec ces propriétés, actions épinglées par version majeure comme `ci.yml`.
- [ ] **Step 4 : lancer** le test, puis `pre-commit run --files .github/workflows/spike-llm.yml tests/harness/test_spike_workflow.py`. Attendu : PASS.
- [ ] **Step 5 : commit** : `git add .github/workflows/spike-llm.yml tests/harness/test_spike_workflow.py` puis `ci: add manual LLM spike workflow`.
- [ ] **Step 6 : demander à l'auteur** d'exécuter ses actions 1 à 3, puis son accord pour `git push origin main`.
- [ ] **Step 7 : déclencher** le workflow trois fois : `gh workflow run spike-llm.yml -R benjamin-callonnec/veille-llm`, puis `gh run watch` et `gh run view --log` pour lire le résultat. Attendu : 3 exécutions réussies, JSON valide, aucun jeton dans les logs (vérifier avec `gh run view --log | rg "sk-ant"` : aucun résultat).

---

### Task 5 : résultat et go/no-go

**Files:**
- Create: `docs/superpowers/specs/2026-11-21-spike-llm-result.md`
- Modify: `docs/superpowers/specs/2026-11-21-veille-llm-design.md` (section 8, étape 2)

- [ ] **Step 1 : écrire le document de résultat** : date, versions (`claude-agent-sdk`, modèle), résultat local, résultat des 3 exécutions Actions (réussite, durée, jetons), comportement observé en cas d'erreur (message exact masqué), conclusion **GO** ou **NO-GO**.
- [ ] **Step 2 : si NO-GO**, y décrire les replis, dans l'ordre : (a) exécution locale planifiée avec `launchd`, (b) clé API Anthropic avec plafond de dépense, (c) Claude sur Vertex AI. L'auteur choisit, le plan 3 est alors réécrit.
- [ ] **Step 3 : si GO**, mettre à jour la section 8 de la spec (étape 2 marquée terminée avec un renvoi vers le document de résultat) et cocher la tâche dans l'issue 2.
- [ ] **Step 4 : commit** : `git add docs` puis `docs: record LLM spike result`.

---

## Auto-revue

- **Couverture de la spec** : section 3 (abonnement, pas de facturation au token, modèle) : tâches 1, 3, 4 ; section 5.1 (agent sans outil, sortie JSON validée, arrêt brutal) : tâches 1 et 2 ; section 8 étape 2 (spike et condition d'arrêt) : tâches 3 à 5. Hors de ce plan : la collecte, le filtrage, la persistance et la reprise (plan 3).
- **Cohérence des noms** : `LlmError`, `LlmAuthError`, `LlmLimitError`, `LlmOptions`, `RawReply`, `LlmResult`, `Runner`, `complete_json`, `claude_runner`, `assert_subscription_auth` sont utilisés partout avec la même orthographe.
- **Point à confirmer pendant l'exécution** : les noms exacts des champs du SDK (`tools`, `max_turns`, `system_prompt`, message de résultat avec `usage` et coût) sont à vérifier dans la documentation de la version installée avant la tâche 3.
