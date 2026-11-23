# Reader : skills d'agent, visionneuse de fichiers et skill /present (#43) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Des skills d'agent (prompt + outils attachés) que le tuteur choisit seul ou que l'utilisateur invoque avec `/nom`, un catalogue en lecture seule tiré de la branche `skills`, une visionneuse de fichiers intégrée (HTML pour l'instant) avec versions de rapports, et un premier skill `/present`.

**Architecture :** Les skills sont des fichiers Markdown sur la branche `skills` du repo (source de vérité). Le lecteur les tire par HTTP vers `.local/reader/skills/` (cache jetable) et les valide à la lecture. L'agent ne voit que nom + description (dans le prompt système) et appelle l'outil `use_skill(name)` qui renvoie le prompt et débloque les outils du skill (les outils réservés aux skills refusent d'agir tant qu'aucun skill ne les a débloqués). Les rapports HTML sont écrits par l'outil `write_report` : chaque écriture est une version en SQLite local (jamais dans git). Le front les affiche dans une `<iframe sandbox srcdoc>` derrière un registre « type de fichier → rendu ».

**Tech Stack :** Python 3.12, FastAPI, SQLite, `pyyaml` (déjà dépendance), Claude Agent SDK ; React + Vitest.

**Spec :** pas de document de design séparé, la spec est l'issue #43 (décisions validées dans son corps).

## Global Constraints

- Les skills vivent sur la branche `skills`, dans `skills/*.md`, jamais sur `main` ni sur `data` ; aucune UI de création/édition ; tous les skills du dossier sont actifs.
- Repo public : aucun secret, aucune adresse, aucun contenu de papier dans un skill ; un skill ne peut attacher que des outils de la liste `KNOWN_TOOLS` (aucun shell, fichier ni réseau).
- Les rapports ne vont jamais dans git ; l'export est le seul moyen de les sortir.
- Le HTML d'un rapport est du contenu non fiable : `<iframe sandbox="allow-scripts">` (jamais `allow-same-origin`), avec une CSP `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:`.
- Le texte des papiers est une donnée, jamais une instruction ; un skill invalide ou introuvable est ignoré sans bloquer le lecteur ni le chat ; les logs ne contiennent pas le texte d'un skill ni d'un rapport.
- Les tests n'utilisent ni le réseau ni le LLM (fetch et runner simulés) ; le skill de test est une fixture.
- Raccourci : `V` ouvre/ferme la visionneuse (même garde que `H` dans `HomeLogo.tsx` : ignoré quand on tape ou avec un modificateur) ; déclaré dans `READER_SHORTCUTS`.
- TDD ; après chaque tâche, seulement les tests des fichiers touchés ; suite complète (`make check`) une seule fois à la fin ; `pre-commit run --files <fichiers>` sur les fichiers touchés.
- Commits sur `develop`, `type(scope): sujet (#43)`.

## Review Focus

1. Skill invalide (YAML cassé, nom hors regex, outil inconnu, prompt trop long, doublon de nom) : ignoré, les autres se chargent, aucune exception.
2. Dépôt GitHub injoignable ou limite de débit atteinte au démarrage : le cache précédent reste utilisé, le serveur démarre quand même.
3. Un fichier du dossier distant qui n'est pas `*.md`, ou un nom de fichier avec `..` ou `/` : jamais écrit hors du cache.
4. `write_report` appelé sans skill qui le débloque : erreur renvoyée au modèle, rien d'écrit.
5. `/nom` inconnu envoyé par le front : message traité comme du texte normal, pas d'erreur 500.
6. HTML de rapport avec ressource externe (`http(s)://` dans `src`, `href` de feuille de style, `@import`, `url()`) : refusé avec un message qui dit d'inliner tout.
7. Restaurer une version ne supprime aucune version ; au-delà de `MAX_VERSIONS` (50) la plus ancienne est purgée, jamais la version courante.
8. Rapport supprimé ou item inconnu : 404 propre ; `version` hors plage : 404, pas d'exception.
9. Un rapport dont le titre contient `/`, `"` ou des retours à la ligne : le nom de fichier d'export est assaini.
10. Touche `V` pendant la saisie dans le composer ou la recherche : n'ouvre rien.

---

### Task 1: Format de skill et chargement

**Files:**
- Create: `src/veille_reader/skills.py`
- Test: `tests/reader/test_skills.py`

**Interfaces:**
- Produces: `KNOWN_TOOLS: frozenset[str]` = `{"load_artifact","search_paper","session_memory","ask_user","write_report","read_report"}` ; `GATED_TOOLS: frozenset[str]` = `{"write_report","read_report"}` ; `@dataclass(frozen=True) Skill(name: str, description: str, prompt: str, tools: tuple[str, ...])` ; `parse_skill(text: str, filename: str) -> Skill` (lève `SkillError`) ; `load_skills(directory: Path) -> list[Skill]` (triée par nom, ignore les invalides) ; `class SkillError(ValueError)`.
- Format : fichier Markdown, front matter YAML (`name`, `description`, `tools` liste optionnelle) entre deux lignes `---`, le reste est le prompt. Le `name` doit égaler le nom de fichier sans `.md` et suivre `^[a-z][a-z0-9-]{0,39}$`. Limites : description 300 caractères, prompt 8 000.

- [ ] **Step 1: Write the failing tests** dans `tests/reader/test_skills.py` : `test_parse_valid_skill` (nom, description, tools, prompt sans espaces autour), `test_tools_default_to_empty`, `test_rejects_unknown_tool`, `test_rejects_name_not_matching_filename`, `test_rejects_bad_name_regex` (`"../x"`, `"Present"`), `test_rejects_too_long_description_and_prompt`, `test_rejects_missing_front_matter_and_bad_yaml`, `test_load_skills_skips_invalid_and_duplicates` (dossier `tmp_path` avec un bon, un cassé, un non-`.md` ; résultat = le bon seul), `test_load_skills_missing_directory_is_empty`.
- [ ] **Step 2: Run** `uv run pytest tests/reader/test_skills.py -v` → FAIL (module absent).
- [ ] **Step 3: Implement** `skills.py` : `yaml.safe_load` du front matter (jamais `yaml.load`), validation champ par champ avec `SkillError` à message court sans le texte du fichier ; `load_skills` attrape `SkillError`/`OSError`/`UnicodeDecodeError` par fichier.
- [ ] **Step 4: Run** le même test → PASS ; `pre-commit run --files src/veille_reader/skills.py tests/reader/test_skills.py`.
- [ ] **Step 5: Commit** `feat(reader): skill format and loader (#43)`.

---

### Task 2: Synchronisation depuis la branche `skills` et API de liste

**Files:**
- Create: `src/veille_reader/skills_sync.py`
- Modify: `src/veille_reader/server.py` (routes, état), `src/veille_reader/cli.py` (cache dir, sync au démarrage)
- Test: `tests/reader/test_skills_sync.py`, `tests/reader/test_server.py` (cas skills)

**Interfaces:**
- Consumes: `load_skills`, `Skill` (Task 1) ; `Fetcher = Callable[[str], bytes]` de `veille_reader/pdf.py`.
- Produces: `SKILLS_REPO = "benjamin-callonnec/veille-llm"`, `SKILLS_BRANCH = "skills"`, `MAX_SKILL_BYTES = 20_000`, `MAX_SKILL_FILES = 50` ; `sync_skills(cache: Path, fetch: Fetcher = default_fetcher, repo: str = SKILLS_REPO, branch: str = SKILLS_BRANCH) -> int` (nombre de fichiers écrits ; ne lève jamais : renvoie -1 si rien n'a pu être tiré) ; routes `GET /api/skills` → `[{"name","description","tools"}]` (sans le prompt) et `POST /api/skills/sync` → `{"count": int}` ; `create_app(..., skills_dir: Path | None = None, skills_fetch: Fetcher | None = None)` (défaut : `data_dir / "skills"`).

- [ ] **Step 1: Write the failing tests** : `test_sync_writes_valid_files` (fetch simulé : la liste `https://api.github.com/repos/{repo}/contents/skills?ref={branch}` renvoie du JSON `[{"name","type":"file","download_url"}]`, puis les contenus), `test_sync_ignores_non_md_and_unsafe_names` (`../evil.md`, `a/b.md`, `x.txt`), `test_sync_keeps_cache_when_fetch_fails` (le cache existant n'est pas touché, retour -1), `test_sync_removes_cached_skills_deleted_upstream`, `test_sync_skips_oversized_file`, `test_sync_writes_atomically` (écrit dans un dossier temporaire puis remplace) ; côté serveur : `test_get_skills_lists_without_prompt`, `test_post_sync_refreshes_list`, `test_skills_endpoints_work_with_empty_cache`.
- [ ] **Step 2: Run** `uv run pytest tests/reader/test_skills_sync.py tests/reader/test_server.py -k skills -v` → FAIL.
- [ ] **Step 3: Implement** `sync_skills` : lister via l'API contents, ne garder que `type == "file"` avec nom `^[a-z][a-z0-9-]{0,39}\.md$`, au plus `MAX_SKILL_FILES`, télécharger chaque `download_url` (hôte `raw.githubusercontent.com` seulement), valider chaque contenu avec `parse_skill` avant de l'écrire, puis remplacer le dossier cache d'un coup (dossier temporaire voisin + `os.replace`). Routes dans `create_app` : la liste se relit du disque à chaque appel (peu de fichiers). `cli.py` lance `sync_skills` dans un thread au démarrage (daemon, jamais bloquant).
- [ ] **Step 4: Run** les mêmes tests → PASS ; pre-commit sur les fichiers touchés.
- [ ] **Step 5: Commit** `feat(reader): pull the skills from the skills branch and list them (#43)`.

---

### Task 3: Skills dans l'agent (`use_skill`, outils réservés, invocation `/nom`)

**Files:**
- Modify: `src/veille_reader/events.py` (`RunRequest`), `src/veille_reader/agent.py`, `src/veille_reader/chat.py` (`stream_turn`), `src/veille_reader/server.py` (`MessageIn`, `run_turn`)
- Test: `tests/reader/test_agent.py`, `tests/reader/test_chat.py`, `tests/reader/test_server.py`

**Interfaces:**
- Consumes: `Skill`, `GATED_TOOLS`, `load_skills` (Task 1).
- Produces: `RunRequest.skills: list[Skill]` (catalogue vu par l'agent) et `RunRequest.skill: Skill | None` (skill imposé par `/nom`) ; `class SkillSession` dans `skills.py` : `SkillSession(catalogue: list[Skill], forced: Skill | None = None)` avec `.use(name: str) -> str` (renvoie le prompt, lève `ToolError` si le nom est inconnu, ajoute les outils du skill à `.unlocked`), `.allows(tool: str) -> bool` (vrai pour un outil non réservé, ou réservé et débloqué), `.catalogue_prompt() -> str` (lignes `- name: description`) ; l'outil SDK `use_skill` ; `MessageIn.skill: str | None` (regex du nom) ; `stream_turn(..., skills: list[Skill] = ..., skill: Skill | None = None)`.

- [ ] **Step 1: Write the failing tests** : `test_skill_session_use_unlocks_tools`, `test_skill_session_unknown_name_is_tool_error`, `test_gated_tool_refused_until_unlocked`, `test_forced_skill_is_unlocked_from_start`, `test_catalogue_prompt_lists_name_and_description_only` ; agent : `test_system_prompt_lists_skills_when_present` et `..._absent_without_skills` (le prompt reste identique sans skill), `test_use_skill_tool_returns_prompt`, `test_forced_skill_prompt_added_to_system_prompt` ; serveur : `test_message_with_known_skill_forces_it`, `test_message_with_unknown_skill_is_plain_text` (Review Focus 5).
- [ ] **Step 2: Run** `uv run pytest tests/reader/test_skills.py tests/reader/test_agent.py tests/reader/test_chat.py tests/reader/test_server.py -k skill -v` → FAIL.
- [ ] **Step 3: Implement** : `build_sdk_tools(tools, budget, ask, session)` ajoute `use_skill` (seulement si le catalogue n'est pas vide) ; le prompt d'un skill est ajouté au prompt système sous un en-tête `Skill <name>:` (il vient de la branche protégée : instruction de confiance, à la différence des données de papier). `sdk_runner` fabrique la `SkillSession` depuis `request.skills`/`request.skill`. Le serveur recharge `load_skills(skills_dir)` à chaque tour (peu coûteux) ; `skill` inconnu → `None`.
- [ ] **Step 4: Run** les mêmes tests → PASS ; pre-commit.
- [ ] **Step 5: Commit** `feat(reader): the tutor picks and loads skills (#43)`.

---

### Task 4: Stockage des rapports et versions

**Files:**
- Modify: `src/veille_reader/storage.py` (migration + méthodes)
- Test: `tests/reader/test_storage.py`

**Interfaces:**
- Produces (sur `ReaderStore`) : `MAX_VERSIONS = 50`, `MAX_HTML_CHARS = 400_000` ; `save_report(item_id: str, title: str, html: str, report_id: int | None = None) -> dict` (`{"id","version","title"}` ; sans `report_id` crée le rapport, sinon ajoute une version ; `KeyError` si le rapport n'existe pas pour cet item) ; `reports(item_id: str) -> list[dict]` (`id, title, version, updated_at`, plus récent d'abord) ; `report(item_id: str, report_id: int, version: int | None = None) -> dict | None` (`id, title, version, versions: list[{"version","created_at"}], html`) ; `restore_report(item_id, report_id, version) -> dict | None` (copie la version choisie comme nouvelle version) ; `delete_report(item_id, report_id) -> bool`. Tables `reports(id, item_id, title, created_at)` et `report_versions(report_id, version, title, html, created_at)` ; suppression en cascade.

- [ ] **Step 1: Write the failing tests** : `test_save_creates_report_v1`, `test_save_with_id_adds_version`, `test_report_returns_latest_by_default_and_a_given_version`, `test_unknown_version_returns_none`, `test_restore_adds_a_copy_and_keeps_all_versions`, `test_versions_purged_beyond_max_keeping_current` (Review Focus 7), `test_report_scoped_to_item` (un autre item ne voit ni ne modifie), `test_delete_report_cascades`, `test_save_rejects_oversized_html`.
- [ ] **Step 2: Run** `uv run pytest tests/reader/test_storage.py -k report -v` → FAIL.
- [ ] **Step 3: Implement** : ajouter une migration à `MIGRATIONS` (ne jamais modifier les existantes) ; purge dans la même transaction que l'insertion.
- [ ] **Step 4: Run** → PASS ; pre-commit.
- [ ] **Step 5: Commit** `feat(reader): report storage with versions (#43)`.

---

### Task 5: Outils `write_report`/`read_report`, validation du HTML, routes et export

**Files:**
- Create: `src/veille_reader/reports.py`
- Modify: `src/veille_reader/agent.py` (outils SDK), `src/veille_reader/server.py` (routes)
- Test: `tests/reader/test_reports.py`, `tests/reader/test_server.py`

**Interfaces:**
- Consumes: `ReaderStore` report API (Task 4), `SkillSession.allows` (Task 3), `ToolError`.
- Produces: `check_html(html: str) -> None` (lève `ToolError` : vide, trop long, ou ressource externe) ; `export_name(title: str) -> str` (nom de fichier `.html` assaini, jamais vide) ; outils SDK `write_report(title: str, html: str, report_id: int | None)` et `read_report(report_id: int)` (réservés : `if not session.allows(name)` → erreur au modèle) ; routes : `GET /api/items/{item_id}/reports`, `GET /api/items/{item_id}/reports/{rid}?version=N`, `POST /api/items/{item_id}/reports/{rid}/restore` (corps `{"version": N}`), `DELETE /api/items/{item_id}/reports/{rid}`, `GET /api/items/{item_id}/reports/{rid}/export?version=N` (`text/html`, `Content-Disposition: attachment; filename="..."`).

- [ ] **Step 1: Write the failing tests** : `check_html` refuse `<script src="https://x">`, `<link rel=stylesheet href="http://x">`, `<img src="https://x">`, `@import url(http://x)`, `url(https://x)` et accepte `src="data:image/png;base64,..."`, `href="#slide2"` ; `test_export_name_sanitised` (`'a/b"c\n'`, titre vide) ; `test_write_report_refused_without_skill` ; `test_write_report_with_skill_saves_version` ; `test_read_report_returns_html_as_data` ; routes : 404 item/rapport/version inconnus, `restore` crée une version, `export` pose `Content-Disposition` assaini et le HTML tel quel.
- [ ] **Step 2: Run** `uv run pytest tests/reader/test_reports.py tests/reader/test_server.py -k report -v` → FAIL.
- [ ] **Step 3: Implement** : `check_html` par expressions régulières (limite connue : un HTML qui construit une URL en JavaScript n'est pas détecté ; la CSP du front reste la vraie barrière, voir commentaire `shortcut:` dans le code). `read_report` renvoie le HTML dans un bloc `<data>` échappé comme les autres outils. Le résumé de `write_report` renvoyé au modèle : `Saved report <id>, version <n>.`
- [ ] **Step 4: Run** → PASS ; pre-commit.
- [ ] **Step 5: Commit** `feat(reader): write_report tool, report routes and export (#43)`.

---

### Task 6: Visionneuse de fichiers (registre, iframe sandbox, versions, export)

**Files:**
- Create: `web/src/reader/viewer/registry.tsx`, `web/src/reader/viewer/csp.ts`, `web/src/reader/viewer/HtmlFrame.tsx`, `web/src/reader/viewer/FileViewer.tsx`, `web/src/reader/viewer/reportsApi.ts`
- Modify: `web/src/styles/reader.css`
- Test: `web/src/reader/viewer/csp.test.ts`, `HtmlFrame.test.tsx`, `FileViewer.test.tsx`, `registry.test.tsx`, `reportsApi.test.ts`

**Interfaces:**
- Produces: `type ViewerKind = "html"` ; `RENDERERS: Record<ViewerKind, (props: { content: string; title: string }) => ReactNode>` et `rendererFor(kind: string): ViewerRenderer | null` (ajouter un type = une entrée) ; `withCsp(html: string): string` (insère la `<meta http-equiv="Content-Security-Policy">` de Global Constraints en tête du document, avec ou sans `<head>`) ; `HtmlFrame({content, title})` rend `<iframe sandbox="allow-scripts" srcDoc={withCsp(content)} title=...>` ; `ReportMeta {id, title, version, updated_at}`, `ReportView {id, title, version, versions: {version, created_at}[], html}` ; `listReports(itemId)`, `getReport(itemId, id, version?)`, `restoreReport(itemId, id, version)`, `deleteReport(itemId, id)`, `exportUrl(itemId, id, version?)` ; `FileViewer({itemId, reports, selectedId, onSelect, onClose, onChanged})` (en-tête : sélecteur de rapport, sélecteur de version, Restaurer, Exporter (lien `exportUrl`), Plein écran, Fermer).

- [ ] **Step 1: Write the failing tests** : `withCsp` (avec `<head>`, sans `<head>`, sans rien ; la meta est la première ressource) ; `HtmlFrame` a `sandbox="allow-scripts"` exactement, sans `allow-same-origin` ; `rendererFor("html")` non nul, `rendererFor("pdf")` nul ; `FileViewer` : affiche la dernière version, changer de version recharge, Restaurer appelle l'API puis `onChanged`, Exporter pointe vers `exportUrl`, Plein écran bascule une classe, `Esc` ferme ; état vide sans rapport.
- [ ] **Step 2: Run** `cd web && npx vitest run src/reader/viewer` → FAIL.
- [ ] **Step 3: Implement** les composants avec les `Icon`/`IconButton` existants (`web/src/components/Icon.tsx`) ; styles dans `reader.css` (tokens existants, thèmes sombres inclus).
- [ ] **Step 4: Run** → PASS ; `cd web && npx biome check` sur les fichiers touchés.
- [ ] **Step 5: Commit** `feat(web): file viewer with an HTML renderer and report versions (#43)`.

---

### Task 7: Intégration au lecteur (raccourci `V`, ouverture auto, liste à jour)

**Files:**
- Create: `web/src/reader/viewer/useReports.ts`
- Modify: `web/src/reader/ReaderPage.tsx`, `web/src/lib/shortcuts.ts`, `web/src/reader/chat/useChat.ts`
- Test: `web/src/reader/viewer/useReports.test.tsx`, `web/src/reader/ReaderPage.test.tsx`, `web/src/lib/shortcuts.test.ts`, `web/src/reader/chat/useChat.test.tsx`

**Interfaces:**
- Consumes: `FileViewer`, `listReports` (Task 6).
- Produces: `useReports(itemId): { reports: ReportMeta[]; reload(): Promise<void> }` ; `useChat(..., onReport?: () => void)` appelé à `done` quand un bloc outil `write_report` s'est terminé sans erreur ; `READER_SHORTCUTS` gagne un groupe `Viewer` : `{ keys: ["V"], label: "Open or close the viewer" }`, `{ keys: ["Esc"], label: "Close the viewer" }`.

- [ ] **Step 1: Write the failing tests** : `V` ouvre puis ferme la visionneuse ; `V` dans un champ de saisie ou avec Ctrl/Cmd ne fait rien (Review Focus 10) ; la visionneuse s'ouvre seule et la liste se recharge quand le tour a appelé `write_report` avec succès, pas s'il a échoué ; le groupe `Viewer` figure dans `READER_SHORTCUTS` (test de forme existant à étendre).
- [ ] **Step 2: Run** `cd web && npx vitest run src/reader src/lib/shortcuts.test.ts` → FAIL.
- [ ] **Step 3: Implement** : la visionneuse s'affiche comme un panneau par-dessus la zone PDF+chat (`PaneLayout` inchangé) ; garde clavier identique à `HomeLogo.tsx` (`isTyping`, modificateurs).
- [ ] **Step 4: Run** → PASS ; biome sur les fichiers touchés.
- [ ] **Step 5: Commit** `feat(web): open the viewer with V and when a report is written (#43)`.

---

### Task 8: Menu `/` du composer (catalogue en lecture seule) et envoi du skill

**Files:**
- Create: `web/src/reader/chat/skillsApi.ts`, `web/src/reader/chat/SkillMenu.tsx`
- Modify: `web/src/reader/chat/Composer.tsx`, `web/src/reader/chat/api.ts`, `web/src/reader/chat/ChatPane.tsx`, `web/src/reader/chat/useChat.ts`
- Test: `skillsApi.test.ts`, `SkillMenu.test.tsx`, `composer.test.tsx`, `useChat.test.tsx`

**Interfaces:**
- Produces: `SkillInfo {name, description, tools: string[]}` ; `fetchSkills(): Promise<SkillInfo[]>` (`[]` en cas d'échec) ; `SkillMenu({skills, query, onPick})` (nom, description, pastilles des outils) ; `Composer` prop `skills?: SkillInfo[]` ; `onSend(text, images?, voice?, skill?: string)` ; `api.ts` envoie `skill` dans le corps du message.

- [ ] **Step 1: Write the failing tests** : taper `/` seul ouvre le menu avec tous les skills ; `/pre` filtre ; flèches + Entrée ou Tab choisit et met `/present ` dans le champ (sans envoyer) ; Esc ferme le menu sans vider le champ ; envoyer `/present parle du modèle` appelle `onSend("parle du modèle", undefined, false, "present")` ; `/inconnu texte` est envoyé tel quel, sans skill ; aucun skill (API en échec) : `/` reste du texte normal, pas de menu ; le brouillon (`drafts`) n'est pas perturbé.
- [ ] **Step 2: Run** `cd web && npx vitest run src/reader/chat` → FAIL.
- [ ] **Step 3: Implement** : le menu s'ouvre seulement si le texte commence par `/` et ne contient pas encore d'espace ; il réutilise le style des menus existants (`ConversationMenu`) ; l'état d'ouverture ne touche pas aux raccourcis Entrée/Maj+Entrée existants hors menu.
- [ ] **Step 4: Run** → PASS ; biome sur les fichiers touchés.
- [ ] **Step 5: Commit** `feat(web): slash menu lists the skills and sends the chosen one (#43)`.

---

### Task 9: Skill `/present`, branche `skills`, protection et documentation

**Files:**
- Modify: `.claude/skills/veille-guidelines/SKILL.md` (section lecteur : skills, rapports, sandbox), `.claude/CLAUDE.md` (une ligne d'architecture), `CHANGELOG.md` via le skill `release` au merge
- Create (sur la branche `skills`, hors `develop`) : `skills/present.md`
- Test: `tests/reader/test_skills.py` (le fichier `present.md` copié en fixture de test passe `parse_skill`)

**Interfaces:**
- Consumes: format de la Task 1 ; outils `ask_user`, `load_artifact`, `search_paper`, `write_report`, `read_report`.

- [ ] **Step 1: Write the failing test** `test_present_skill_file_is_valid` : le contenu de `skills/present.md` ci-dessous (collé en constante dans le test) passe `parse_skill(text, "present.md")` avec `tools == ("ask_user","load_artifact","search_paper","write_report","read_report")`.
- [ ] **Step 2: Run** → FAIL puis écrire le test et la constante ; contenu exact du skill :

```markdown
---
name: present
description: Make an HTML presentation of the paper; asks audience, depth, length and focus.
tools: [ask_user, load_artifact, search_paper, write_report, read_report]
---
You build a presentation of the open paper as one self-contained HTML file.
First use ask_user (one question per call, with short options) for: the audience, the depth
(overview, technical, expert), the length (number of slides) and the focus. Skip a question the
user already answered. Then read what you need with load_artifact and search_paper, and call
write_report once with the full presentation. Rules for the HTML: everything inline (CSS and
JavaScript in the file, images only as data: URIs), no external URL of any kind, one section per
slide, keyboard navigation with the arrow keys, readable in light and dark mode. Cite the paper
pages on the slides as [p.N]. To change an existing presentation, call read_report, then
write_report with its report_id so the old version is kept.
```

- [ ] **Step 3: Documenter** dans `veille-guidelines` : les skills sont des prompts de confiance (branche protégée), le texte des papiers reste de la donnée, la CSP et le sandbox de la visionneuse ; ajouter une ligne dans l'architecture de `.claude/CLAUDE.md` (`skills_sync.py`, branche `skills`).
- [ ] **Step 4: Run** `uv run pytest tests/reader/test_skills.py -v` → PASS ; pre-commit sur les fichiers touchés.
- [ ] **Step 5: Commit** `docs(reader): skills, reports and viewer guidelines (#43)`.
- [ ] **Step 6 (avec l'accord de l'auteur, hors CI) : publier la branche `skills`.** Créer une branche orpheline `skills` dans un worktree jetable avec `skills/present.md`, puis demander l'accord avant `git push origin skills`. Puis, côté GitHub (l'auteur ou `gh api` après accord) : ruleset sur `refs/heads/skills` (push réservé à l'auteur, pas de force push, pas de suppression). Vérifier : `GET /api/skills` du lecteur local liste `present` après `POST /api/skills/sync`.

---

## Fin de chantier

- [ ] `make check` une seule fois (lint, format, tests Python et web) ; corriger les trous de couverture.
- [ ] Vérification à la main : `make reader`, ouvrir un papier, `/present`, répondre aux questions, voir la présentation s'ouvrir, naviguer au clavier, restaurer une version, exporter, `V` pour fermer/ouvrir. Non vérifié par les tests : le rendu réel dans le navigateur et le vrai appel LLM.
- [ ] Skill `release` au merge (bump minor + CHANGELOG), accord avant `git push origin main`.

## Hors périmètre (à décider plus tard)

- Édition manuelle d'un rapport dans l'UI (aujourd'hui, l'édition passe par le tuteur : `read_report` puis `write_report`, chaque écriture est une version, donc la sauvegarde automatique est celle de chaque écriture).
- Export PDF/impression, autres types de fichier (Markdown, images, PDF, CSV) : le registre est prêt, seul le rendu HTML est livré.
- Désactiver un skill sans le retirer de la branche.
