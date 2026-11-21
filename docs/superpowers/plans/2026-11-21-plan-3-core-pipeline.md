# Plan 3 : pipeline core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Un pipeline exécutable en local (`veille-core run`) qui collecte, filtre, classe avec le LLM, catégorise, enregistre dans SQLite et exporte un catalogue JSON, en survivant aux pannes de sources et à l'arrêt brutal du LLM.

**Architecture :** Des étapes simples (fonctions pures ou avec dépendances injectées) assemblées par un orchestrateur. Chaque verdict LLM est enregistré dans SQLite dès qu'un lot est terminé : un arrêt laisse la base cohérente et le run suivant reprend sans reclasser. L'export ne contient que des items classés et catégorisés (option A : rien d'incomplet n'est publié).

**Tech Stack :** Python 3.11+, `sqlite3` standard, `feedparser`, `claude-agent-sdk` (via `veille_llm.llm`), pytest.

**Spec :** `docs/superpowers/specs/2026-11-21-veille-llm-design.md` (sections 5.1, 3) et `docs/superpowers/specs/2026-11-21-spike-llm-result.md` (« À traiter dans le plan 3 »).

Plans suivants : 4 automatisation (workflow quotidien, branche `data`, déploiement), 5 `web`, 6 `newsletter` et abonnés.

## Global Constraints

- Python `>=3.11`, `ruff` (`line-length = 100`), `make check` passe avant chaque commit. Gitflow : on commite sur `develop`.
- Tests : aucune requête réseau ni appel LLM réel dans pytest (tout est injecté ou simulé).
- Le code v0 (`arxiv.py`, `hf.py`, `topics.py`, `build.py`, `site/`) n'est **pas modifié** : le site déployé continue de fonctionner. Le nouveau code vit dans `src/veille_llm/` en sous-modules, et l'export écrit hors de `site/` (par défaut `build/catalogue.json`, ignoré par git).
- Le LLM passe uniquement par `veille_llm.llm.complete_json` (sans outil, JSON validé, abonnement). Une `LlmLimitError` ou `LlmAuthError` arrête les étapes LLM, jamais de réessai. Toute `LlmError` inconnue arrête aussi. Une `LlmOutputError` ne fait sauter que le lot concerné.
- Lots de 15 items. Un item non classé après 3 jours est abandonné (statut `abandoned`).
- Catégories : 12 au maximum, plus la catégorie de repli `Autres`. Hook : 200 caractères au maximum, sans `http`, `<` ni `>`.
- Aucune adresse d'abonné, aucun secret dans le code ni les tests.

## Review Focus

- Limite d'abonnement atteinte au milieu d'un run : les verdicts déjà enregistrés restent, rien de non classé n'est exporté, le code de sortie est non nul, et le run suivant ne reclasse pas ce qui l'est déjà.
- Une source qui répond en 5xx en boucle : le nombre d'essais est borné, les autres sources continuent, aucune exception ne sort.
- Un même item vu deux fois (même identifiant arXiv, même titre dans deux flux) : une seule ligne en base.
- Le modèle renvoie un identifiant qui n'est pas dans le lot, en oublie un, ou en duplique un : l'inconnu est ignoré, l'oublié reste non classé.
- Un résumé d'item hostile (instructions, `</data>`, balises, URL) : il ne sort pas du bloc de données et ne peut pas produire un hook avec `http` ou des chevrons.
- Première exécution sans aucun item, ou base vide : le run se termine proprement et ne détruit pas un export précédent valide.

## File Structure

| Fichier | Rôle |
|---|---|
| `pyproject.toml` (modifier) | dépendance `feedparser`, script `veille-core` |
| `src/veille_llm/llm.py` (modifier) | `complete_json(..., data=...)` : instructions et données séparées |
| `src/veille_llm/models.py` (créer) | `Item`, `Verdict`, `Enrichment` |
| `src/veille_llm/store.py` (créer) | base SQLite : items, verdicts, catégories, abandon |
| `src/veille_llm/retry.py` (créer) | `retry_call`, `is_transient` |
| `src/veille_llm/sources/__init__.py` (créer) | `collect_all`, `SourceReport` |
| `src/veille_llm/sources/arxiv_source.py`, `hf_source.py`, `rss_source.py` (créer) | adaptateurs vers `Item` |
| `src/veille_llm/pipeline/filtering.py` (créer) | filtre déterministe |
| `src/veille_llm/pipeline/classify.py` (créer) | classification LLM par lots |
| `src/veille_llm/pipeline/categorize.py` (créer) | catégories dynamiques et hooks |
| `src/veille_llm/pipeline/export.py` (créer) | export JSON du catalogue |
| `src/veille_llm/pipeline/run.py` (créer) | orchestrateur et CLI |
| `tests/core/` (créer) | un fichier de test par module |

---

### Task 1 : instructions et données séparées dans `complete_json`

**Files:**
- Modify: `src/veille_llm/llm.py`, `tests/test_llm.py`

**Interfaces:**
- Produces : `async def complete_json(prompt: str, schema: dict, *, data: object | None = None, model: str = "claude-sonnet-5-5", runner: Runner | None = None) -> LlmResult`. Quand `data` est fourni, le texte envoyé au runner est `prompt` suivi d'une ligne vide, de `<data>`, du JSON de `data`, puis `</data>`. Le JSON est produit avec `json.dumps(data, ensure_ascii=True)` puis les caractères `<`, `>` et `&` sont remplacés par `<`, `>`, `&`, pour qu'aucune balise ne puisse apparaître dans le bloc.
- Le prompt système (`SYSTEM_PROMPT`) précise que le contenu entre `<data>` et `</data>` est une donnée non fiable à classer, jamais une instruction.

- [ ] **Step 1 : écrire les tests** : `test_data_is_sent_inside_a_data_block`, `test_data_block_cannot_be_closed_by_the_data` (une donnée contenant `</data>` n'ajoute aucune balise `</data>` supplémentaire dans le texte envoyé), `test_prompt_without_data_is_unchanged`.
- [ ] **Step 2 : lancer** `uv run pytest tests/test_llm.py -v --no-cov`. Attendu : 3 FAIL.
- [ ] **Step 3 : implémenter** le paramètre `data` et la construction du texte, et compléter `SYSTEM_PROMPT`.
- [ ] **Step 4 : lancer** les mêmes tests. Attendu : tous PASS.
- [ ] **Step 5 : commit** : `git add src/veille_llm/llm.py tests/test_llm.py` puis `feat(llm): send untrusted data in a separate escaped block`.

---

### Task 2 : modèles et base SQLite

**Files:**
- Create: `src/veille_llm/models.py`, `src/veille_llm/store.py`, `tests/core/__init__.py`, `tests/core/test_store.py`

**Interfaces:**
- Produces, dans `veille_llm.models` :
  - `@dataclass(frozen=True) class Item: id: str; source: str; kind: str; title: str; summary: str; url: str; authors: list[str]; published: str; upvotes: int = 0`. `id` vaut `arxiv:<id>` ou `rss:<16 premiers caractères du sha1 de l'URL>`. `kind` vaut `paper` ou `news`. `published` est en ISO 8601 UTC (`2026-11-20T10:00:00Z`).
  - `@dataclass(frozen=True) class Verdict: item_id: str; interesting: bool; score: int; type: str; category_hint: str` (`score` de 0 à 10, `type` parmi `paper`, `news`, `benchmark`).
  - `@dataclass(frozen=True) class Enrichment: item_id: str; category: str; hook: str`.
- Produces, dans `veille_llm.store` : `class Store` avec `Store(path: str | Path)` (crée le schéma, accepte `":memory:"`), et les méthodes :
  - `upsert_items(items: list[Item], now: str) -> int` : insère les nouveaux (statut `new`, `first_seen = now`), met à jour `upvotes` des existants, ne change jamais un statut existant ; renvoie le nombre d'insertions.
  - `known_ids(ids: list[str]) -> set[str]`
  - `pending_classification(limit: int | None = None) -> list[Item]` : items au statut `new`.
  - `save_verdicts(verdicts: list[Verdict]) -> None` : une transaction ; `interesting` donne le statut `interesting`, sinon `rejected`.
  - `pending_enrichment(limit: int | None = None) -> list[tuple[Item, Verdict]]` : items au statut `interesting`.
  - `save_enrichments(enrichments: list[Enrichment]) -> None` : une transaction ; statut `published`, crée les catégories absentes.
  - `category_names() -> list[str]`
  - `abandon_stale(now: str, max_age_days: int = 3) -> int` : passe en `abandoned` les items `new` ou `interesting` dont `first_seen` dépasse `max_age_days`.
  - `published_items(since: str) -> list[dict]` : items `published` dont `published >= since`, avec `score`, `type`, `category`, `hook`, du plus récent au plus ancien.

- [ ] **Step 1 : écrire les tests** (`:memory:`) : `test_upsert_inserts_new_items_once`, `test_upsert_keeps_status_and_refreshes_upvotes`, `test_pending_classification_excludes_already_classified`, `test_save_verdicts_sets_interesting_or_rejected`, `test_save_verdicts_is_atomic` (un verdict pour un identifiant inconnu fait échouer toute la transaction, aucun verdict n'est écrit), `test_save_enrichments_creates_categories_and_publishes`, `test_abandon_stale_only_touches_old_unfinished_items`, `test_published_items_excludes_unfinished_and_old_items`, `test_store_survives_reopen` (fichier temporaire).
- [ ] **Step 2 : lancer** `uv run pytest tests/core/test_store.py -v --no-cov`. Attendu : tous FAIL.
- [ ] **Step 3 : implémenter** `models.py` et `store.py` (`sqlite3`, `PRAGMA foreign_keys=ON`, tables `items`, `verdicts`, `categories`, `authors` stockés en JSON).
- [ ] **Step 4 : lancer** les tests. Attendu : tous PASS.
- [ ] **Step 5 : commit** : `git add src/veille_llm/models.py src/veille_llm/store.py tests/core` puis `feat(core): add models and SQLite store with resumable states`.

---

### Task 3 : retry

**Files:**
- Create: `src/veille_llm/retry.py`, `tests/core/test_retry.py`

**Interfaces:**
- Produces : `def is_transient(exc: Exception) -> bool` (vrai pour `urllib.error.HTTPError` de code 429, 500, 502, 503, 504, pour `urllib.error.URLError` et `TimeoutError`, faux pour 400, 401, 403, 404 et le reste) ; `def retry_call(fn: Callable[[], T], *, attempts: int = 3, base_delay: float = 1.0, sleep: Callable[[float], None] = time.sleep, jitter: Callable[[], float] = random.random) -> T` : appelle `fn`, réessaie seulement si `is_transient`, attend `base_delay * 2**n * (0.5 + jitter())`, relève la dernière exception après `attempts` essais.

- [ ] **Step 1 : écrire les tests** : `test_returns_value_without_retry`, `test_retries_transient_errors_then_succeeds` (503, 503, puis succès : 3 appels, 2 attentes croissantes), `test_gives_up_after_attempts`, `test_does_not_retry_404`, `test_wait_grows_exponentially` (jitter fixé à 0.5).
- [ ] **Step 2 : lancer** `uv run pytest tests/core/test_retry.py -v --no-cov`. Attendu : FAIL.
- [ ] **Step 3 : implémenter** les deux fonctions.
- [ ] **Step 4 : lancer**. Attendu : PASS.
- [ ] **Step 5 : commit** : `git add src/veille_llm/retry.py tests/core/test_retry.py` puis `feat(core): add bounded retry with exponential backoff`.

---

### Task 4 : sources et collecte résiliente

**Files:**
- Modify: `pyproject.toml`
- Create: `src/veille_llm/sources/__init__.py`, `arxiv_source.py`, `hf_source.py`, `rss_source.py`, `tests/core/test_sources.py`

**Interfaces:**
- Consumes : `Item` (tâche 2), `retry_call` (tâche 3), `veille_llm.arxiv.parse_feed` et `_fetch_page` du v0, `veille_llm.hf.parse_upvotes`.
- Produces :
  - `Source = Callable[[int], list[Item]]` (argument : nombre de jours). `@dataclass(frozen=True) class SourceReport: name: str; ok: bool; count: int; error: str | None`.
  - `def collect_all(sources: dict[str, Source], days: int) -> tuple[list[Item], list[SourceReport]]` : appelle chaque source, capture toute exception en `SourceReport(ok=False, error=<type et message>)`, ne propage rien, renvoie les items de toutes les sources qui ont réussi.
  - `def arxiv_source(days: int, fetch: Callable[[int, int], str] = ..., sleep=...) -> list[Item]` : pagine l'API, chaque page via `retry_call`, convertit en `Item(kind="paper", source="arxiv", id="arxiv:<id>")`.
  - `def hf_upvotes(fetch: Callable[[], bytes] = ...) -> dict[str, int]` : `{}` en cas d'échec, jamais d'exception.
  - `def rss_source(name: str, url: str, fetch: Callable[[str], bytes] = ...) -> Source` : renvoie une fonction qui télécharge via `retry_call`, parse avec `feedparser`, produit des `Item(kind="news", source=name, id="rss:<sha1[:16]>")`, ignore les entrées sans titre ou sans lien, et normalise la date en UTC.

- [ ] **Step 1 : ajouter la dépendance** : `uv add feedparser`.
- [ ] **Step 2 : écrire les tests** (flux et réponses en chaînes de caractères fournies par des faux `fetch`) : `test_collect_all_isolates_a_failing_source`, `test_collect_all_reports_counts`, `test_arxiv_source_retries_a_503_then_converts_items`, `test_arxiv_source_gives_up_after_three_503_without_raising_to_collect_all`, `test_hf_upvotes_returns_empty_on_error`, `test_rss_source_parses_atom_and_rss`, `test_rss_source_skips_entries_without_title_or_link`, `test_rss_ids_are_stable_for_the_same_url`.
- [ ] **Step 3 : lancer** `uv run pytest tests/core/test_sources.py -v --no-cov`. Attendu : FAIL.
- [ ] **Step 4 : implémenter** les modules.
- [ ] **Step 5 : lancer** les tests. Attendu : PASS.
- [ ] **Step 6 : vérifier les flux réels** (réseau, hors pytest) : tester ces adresses candidates avec une requête simple et ne garder dans `RSS_FEEDS` (dans `sources/__init__.py`, dictionnaire nom → URL) que celles qui renvoient un flux RSS ou Atom valide : `https://openai.com/news/rss.xml`, `https://huggingface.co/blog/feed.xml`, `https://deepmind.google/blog/rss.xml`. Pour Anthropic et Meta AI, chercher un flux officiel ; s'il n'y en a pas, les laisser de côté et le noter dans `docs/superpowers/specs/2026-11-21-veille-llm-design.md` section 5.1 (« source sans flux ignorée en v1 »).
- [ ] **Step 7 : commit** : `git add pyproject.toml uv.lock src/veille_llm/sources tests/core/test_sources.py docs` puis `feat(core): add resilient sources (arXiv, Hugging Face, RSS)`.

---

### Task 5 : filtre déterministe

**Files:**
- Create: `src/veille_llm/pipeline/__init__.py`, `src/veille_llm/pipeline/filtering.py`, `tests/core/test_filtering.py`

**Interfaces:**
- Consumes : `Item`.
- Produces : `def deterministic_filter(items: list[Item], *, known_ids: set[str], now: datetime, days: int) -> list[Item]` : garde un item s'il est dans la fenêtre de `days` jours, absent de `known_ids`, non dupliqué (même `id` ou même titre normalisé : minuscules, espaces et ponctuation réduits ; on garde le premier), et si (`kind == "news"`) ou (`kind == "paper"` et son titre ou résumé correspond à `PREFILTER` ou `upvotes >= 5`). `PREFILTER` est une expression régulière insensible à la casse couvrant : `llm`, `language model`, `transformer`, `attention`, `state space`, `mamba`, `mixture of experts`, `agent`, `reasoning`, `benchmark`, `retrieval`, `knowledge graph`, `diffusion language`, avec des frontières de mots.

- [ ] **Step 1 : écrire les tests** : `test_drops_items_outside_the_window`, `test_drops_known_ids`, `test_dedupes_by_id_and_by_normalised_title`, `test_keeps_news_without_keywords`, `test_keeps_paper_matching_prefilter`, `test_drops_unrelated_paper`, `test_keeps_unrelated_paper_with_enough_upvotes`, `test_keyword_needs_word_boundaries` (« mamba » dans « mambalike » non retenu seul), `test_empty_input_returns_empty`.
- [ ] **Step 2 : lancer** `uv run pytest tests/core/test_filtering.py -v --no-cov`. Attendu : FAIL.
- [ ] **Step 3 : implémenter** `deterministic_filter` et `PREFILTER`.
- [ ] **Step 4 : lancer**. Attendu : PASS.
- [ ] **Step 5 : commit** : `git add src/veille_llm/pipeline tests/core/test_filtering.py` puis `feat(core): add deterministic filter`.

---

### Task 6 : classification LLM par lots

**Files:**
- Create: `src/veille_llm/pipeline/classify.py`, `tests/core/test_classify.py`

**Interfaces:**
- Consumes : `complete_json` (tâche 1), `Item`, `Verdict`, `LlmError` et sous-classes, `Store.pending_classification`, `Store.save_verdicts`.
- Produces :
  - `BATCH_SIZE = 15`, `CLASSIFY_SCHEMA` (objet `{"items": [{"id", "interesting", "score" (0-10), "type" (enum), "category_hint" (≤ 40 caractères)}]}`, aucun champ en plus).
  - `async def classify_batch(items: list[Item], *, runner=None) -> list[Verdict]` : envoie les instructions et, via `data=`, la liste `[{id, title, summary (tronqué à 1200 caractères), source, kind}]`. Ignore les identifiants hors lot et les doublons (garde le premier), laisse de côté les oubliés. Relève les erreurs de `complete_json` sans les attraper.
  - `async def classify_pending(store: Store, *, runner=None) -> ClassifyOutcome` avec `@dataclass class ClassifyOutcome: classified: int; skipped_batches: int; stopped: str | None` : traite les lots l'un après l'autre, enregistre chaque lot **immédiatement** (`save_verdicts`) ; `LlmOutputError` : lot ignoré, on continue ; `LlmLimitError`, `LlmAuthError` ou toute autre `LlmError` : on s'arrête, `stopped` contient le nom du type d'erreur et le message masqué.

- [ ] **Step 1 : écrire les tests** (runner simulé) : `test_classify_batch_returns_verdicts_for_known_ids`, `test_classify_batch_ignores_unknown_and_duplicate_ids`, `test_classify_batch_leaves_missing_ids_unclassified`, `test_summary_is_truncated_and_sent_as_data_not_instructions` (le texte reçu par le runner contient le titre dans le bloc `<data>`, jamais avant), `test_classify_pending_saves_each_batch_immediately` (avec 31 items, la limite arrive au 3e lot : 30 verdicts sont déjà en base), `test_classify_pending_stops_on_limit_and_reports_it`, `test_classify_pending_skips_a_batch_on_output_error_and_continues`, `test_classify_pending_stops_on_unknown_llm_error`, `test_classify_pending_does_nothing_when_nothing_pending`.
- [ ] **Step 2 : lancer** `uv run pytest tests/core/test_classify.py -v --no-cov`. Attendu : FAIL.
- [ ] **Step 3 : implémenter** les deux fonctions et le schéma.
- [ ] **Step 4 : lancer**. Attendu : PASS.
- [ ] **Step 5 : commit** : `git add src/veille_llm/pipeline/classify.py tests/core/test_classify.py` puis `feat(core): classify items in resumable LLM batches`.

---

### Task 7 : catégories dynamiques et hooks

**Files:**
- Create: `src/veille_llm/pipeline/categorize.py`, `tests/core/test_categorize.py`

**Interfaces:**
- Consumes : `complete_json`, `Store.pending_enrichment`, `Store.category_names`, `Store.save_enrichments`, `Enrichment`.
- Produces :
  - `MAX_CATEGORIES = 12`, `FALLBACK_CATEGORY = "Autres"`, `HOOK_MAX = 200`, `ENRICH_SCHEMA` (`{"items": [{"id", "category" (≤ 40), "hook" (≤ HOOK_MAX)}]}`).
  - `def normalise_category(name: str, existing: list[str]) -> str` : retire les espaces en trop, compare sans tenir compte de la casse et renvoie le nom existant s'il correspond ; sinon, si `len(existing) < MAX_CATEGORIES`, renvoie le nom proposé (première lettre en majuscule), sinon `FALLBACK_CATEGORY`.
  - `def hook_is_safe(hook: str) -> bool` : faux si le hook est vide, dépasse `HOOK_MAX`, ou contient `http`, `<` ou `>`.
  - `async def enrich_pending(store: Store, *, runner=None) -> EnrichOutcome` (`enriched: int`, `skipped_batches: int`, `stopped: str | None`) : lots de 15, `data=` contient les items et la liste des catégories existantes ; applique `normalise_category` ; un item dont le hook n'est pas sûr reste non enrichi ; enregistre chaque lot tout de suite ; mêmes règles d'arrêt que la tâche 6.

- [ ] **Step 1 : écrire les tests** : `test_normalise_reuses_existing_name_ignoring_case`, `test_normalise_creates_a_new_category_below_the_cap`, `test_normalise_falls_back_to_autres_at_the_cap`, `test_hook_is_safe_rejects_urls_angle_brackets_empty_and_long_hooks`, `test_enrich_pending_saves_category_and_hook`, `test_enrich_pending_leaves_item_with_unsafe_hook_unpublished`, `test_enrich_pending_sends_existing_categories_to_the_llm`, `test_enrich_pending_stops_on_limit_after_saving_previous_batches`.
- [ ] **Step 2 : lancer** `uv run pytest tests/core/test_categorize.py -v --no-cov`. Attendu : FAIL.
- [ ] **Step 3 : implémenter**.
- [ ] **Step 4 : lancer**. Attendu : PASS.
- [ ] **Step 5 : commit** : `git add src/veille_llm/pipeline/categorize.py tests/core/test_categorize.py` puis `feat(core): add dynamic categories and safe hooks`.

---

### Task 8 : export du catalogue

**Files:**
- Create: `src/veille_llm/pipeline/export.py`, `tests/core/test_export.py`

**Interfaces:**
- Consumes : `Store.published_items`, `Store.category_names`.
- Produces : `def export_catalogue(store: Store, path: Path, *, now: datetime, window_days: int = 30) -> bool` : écrit `{"generated_at", "window_days", "categories": [{"name", "count"}], "items": [...]}` (items triés du plus récent au plus ancien, uniquement les items `published` de la fenêtre) via un fichier temporaire puis `os.replace` (écriture atomique). Si la base ne contient aucun item publiable **et** qu'un export précédent existe, ne touche à rien et renvoie `False`. Renvoie `True` sinon.

- [ ] **Step 1 : écrire les tests** : `test_export_contains_only_published_items`, `test_export_counts_categories`, `test_export_is_sorted_newest_first`, `test_export_never_overwrites_a_previous_file_with_an_empty_catalogue`, `test_export_writes_an_empty_catalogue_when_no_previous_file`, `test_export_is_atomic` (aucun fichier `.tmp` ne reste).
- [ ] **Step 2 : lancer** `uv run pytest tests/core/test_export.py -v --no-cov`. Attendu : FAIL.
- [ ] **Step 3 : implémenter**.
- [ ] **Step 4 : lancer**. Attendu : PASS.
- [ ] **Step 5 : commit** : `git add src/veille_llm/pipeline/export.py tests/core/test_export.py` puis `feat(core): export the catalogue atomically`.

---

### Task 9 : orchestrateur et CLI

**Files:**
- Modify: `pyproject.toml`, `.gitignore`
- Create: `src/veille_llm/pipeline/run.py`, `tests/core/test_run.py`

**Interfaces:**
- Consumes : tout ce qui précède.
- Produces :
  - `@dataclass class RunReport: sources: list[SourceReport]; collected: int; new: int; classified: int; enriched: int; published: int; stopped: str | None`.
  - `async def run_pipeline(store: Store, *, sources: dict[str, Source], days: int, now: datetime, out: Path, runner=None) -> RunReport` : `abandon_stale`, `collect_all`, `deterministic_filter` (avec `store.known_ids`), `upsert_items` (les `upvotes` HF sont fusionnés avant), `classify_pending`, `enrich_pending`, puis **toujours** `export_catalogue`, même après un arrêt du LLM.
  - `def main(argv: list[str] | None = None) -> int` : commande `veille-core run [--db veille.db] [--out build/catalogue.json] [--days 7]` ; construit les sources réelles (arXiv, flux de `RSS_FEEDS`, upvotes HF) ; affiche un résumé sans aucune donnée sensible ; renvoie `1` si `stopped` n'est pas `None`, sinon `0`. Script `veille-core = "veille_llm.pipeline.run:main"` dans `pyproject.toml`. `build/` et `*.db` sont ajoutés à `.gitignore`.

- [ ] **Step 1 : écrire les tests** (sources, runner et `now` simulés) : `test_run_end_to_end_publishes_classified_items_only`, `test_run_resumes_after_a_limit_without_reclassifying` (premier run : limite au 2e lot, code `stopped` non nul, export présent avec les items déjà complets ; second run : seuls les items restants sont envoyés au LLM), `test_run_exports_even_when_the_llm_stops`, `test_run_with_all_sources_down_keeps_previous_export_and_does_not_raise`, `test_run_abandons_items_unclassified_for_more_than_three_days`, `test_run_with_no_items_ends_cleanly`, `test_main_returns_1_when_stopped_and_0_otherwise`.
- [ ] **Step 2 : lancer** `uv run pytest tests/core/test_run.py -v --no-cov`. Attendu : FAIL.
- [ ] **Step 3 : implémenter** `run_pipeline`, `main` et le script.
- [ ] **Step 4 : lancer** `uv run pytest tests/core -v --no-cov`. Attendu : PASS. Puis `make check`. Attendu : code 0.
- [ ] **Step 5 : commit** : `git add pyproject.toml uv.lock .gitignore src/veille_llm/pipeline/run.py tests/core/test_run.py` puis `feat(core): add pipeline orchestrator and veille-core CLI`.

---

### Task 10 : essai réel local et documentation

**Files:**
- Modify: `README.md`, `.claude/skills/veille-guidelines/SKILL.md`
- Create: `docs/superpowers/specs/2026-11-21-core-first-run.md`

- [ ] **Step 1 : essai réel** : `env -u ANTHROPIC_API_KEY uv run veille-core run --db build/test.db --out build/catalogue.json --days 2`. Attendu : code 0, un catalogue non vide, des catégories plausibles, aucun hook contenant `http`. Si la limite d'abonnement est atteinte, le code de sortie est 1 et le message exact (masqué) est noté.
- [ ] **Step 2 : relancer** la même commande. Attendu : presque aucun appel LLM (rien n'est reclassé), même catalogue.
- [ ] **Step 3 : écrire** `docs/superpowers/specs/2026-11-21-core-first-run.md` : nombre d'items collectés, filtrés, classés, publiés, durée, jetons, coût indicatif, sources en échec, qualité perçue des catégories et des hooks (3 exemples).
- [ ] **Step 4 : documenter** : section « Pipeline core » dans `README.md` (commande, fichiers produits, reprise après arrêt) et mise à jour de `veille-guidelines` si une convention a changé.
- [ ] **Step 5 : issues** : cocher les cases du plan 3 dans l'issue 2 et créer l'issue du plan 4 (automatisation) si elle n'existe pas.
- [ ] **Step 6 : commit** : `git add README.md .claude/skills/veille-guidelines docs` puis `docs: record the first real core run`.

---

## Auto-revue

- **Couverture de la spec** : 5.1 étapes 1 à 5 : tâches 4 à 9 ; résilience (retry, source en panne, arrêt LLM, rien d'incomplet publié, dernier export conservé) : tâches 3, 4, 6, 7, 8, 9 ; catégories dynamiques (fenêtre, réutilisation, plafond) : tâche 7 ; prérequis du spike (instructions et données séparées, champs bornés) : tâches 1, 6, 7. Hors de ce plan : persistance sur la branche `data`, workflow quotidien et déploiement Pages (plan 4), `web` (plan 5), newsletter (plan 6).
- **Écart avec la spec** : le code reste dans `src/veille_llm/` au lieu de `packages/core` (validé par l'auteur). La spec parle d'une fenêtre de 30 jours pour les catégories : cette fenêtre est ici celle de l'export ; les catégories existantes sont toutes transmises au LLM (au plus 13).
- **Cohérence des noms** : `Item`, `Verdict`, `Enrichment`, `Store`, `SourceReport`, `ClassifyOutcome`, `EnrichOutcome`, `RunReport`, `retry_call`, `collect_all`, `deterministic_filter`, `classify_pending`, `enrich_pending`, `export_catalogue`, `run_pipeline` sont utilisés partout avec la même orthographe.
- **À vérifier pendant l'exécution** : les adresses réelles des flux RSS (tâche 4, étape 6) et le format exact de l'API arXiv déjà utilisée par le v0.
