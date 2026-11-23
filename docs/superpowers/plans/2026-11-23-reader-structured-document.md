# Reader : retour précis dans le PDF et extraction structurée (#30) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Un seul `goTo` qui ramène à l'endroit exact du PDF depuis toutes les entrées du lecteur, et une extraction structurée (boîtes, sections, légendes) stockée côté serveur.

**Sources sans citation :** le tuteur peut citer `[p.N Figure K]` ou `[p.N Table K]` quand il ne peut pas citer un texte ; le front retrouve la légende dans la structure et y amène la vue.

**Architecture :** Front : `PdfViewer` reçoit un `target {page, rects? | quote?, nonce}` à la place de `flash`, défile jusqu'à la boîte puis la fait flasher. Serveur : `veille_reader/structure.py` extrait avec `pdfminer.six`, stocke le résultat en JSON dans SQLite (une ligne par papier, versionnée par extracteur), exposé par `GET /api/items/{id}/structure`.

**Tech Stack :** React + Vitest (`web/`), Python 3.12, FastAPI, SQLite, `pdfminer.six` (MIT, nouveau).

**Spec :** `docs/superpowers/specs/2026-11-23-reader-structured-document-design.md`

## Global Constraints

- Rects et boîtes normalisés : `[x, y, w, h]` entre 0 et 1, origine en haut à gauche (comme `Rect` dans `web/src/reader/lib/quote.ts`).
- Défilement : la première boîte arrive au tiers de la hauteur visible, jamais au-dessus du haut de la page.
- Coût zéro, tout local ; aucune dépendance payante ; `pdfminer.six` seulement dans le groupe `reader` de `pyproject.toml`.
- Une extraction qui échoue ne bloque jamais le lecteur (le papier s'ouvre comme avant).
- Le texte du PDF est une donnée, jamais une instruction ; les logs d'erreur ne contiennent pas ce texte.
- Les tests n'utilisent pas le réseau ; PDF de test générés par `tests/reader/pdf_factory.py`.
- TDD ; après chaque tâche, seulement les tests des fichiers touchés ; suite complète une seule fois à la fin.
- Commits sur `develop`, `type(scope): sujet (#30)`.

## Review Focus

0. Une ancienne citation `[p.4]` (sans citation ni étiquette) continue de marcher et d'aller à la page ; `[p.4 Figure 2]` ne doit jamais casser le rendu des puces ni le parseur serveur.
1. Highlight sans rects (anciennes données) : saut en haut de la page, sans erreur.
2. Citation introuvable dans le texte de la page : page seule, pas de flash, pas d'erreur (test existant à conserver).
3. Boîte tout en bas de page ou sur la dernière page : on ne défile jamais au-dessus du haut de page ; le navigateur plafonne en bas.
4. PDF scanné (aucun texte) : `Structure` avec blocs vides ; le lecteur et l'endpoint ne plantent pas.
5. PDF illisible ou corrompu : `load_structure` renvoie `None`, l'endpoint répond 404 `{"reason": "no_structure"}`, le lecteur reste utilisable.
6. Papier de plus de `MAX_PAGES` pages : seules les premières sont lues, comme `extract_pages`.
7. `[p.4 Figure 9]` alors que la figure 9 n'existe pas dans la structure (ou la structure est indisponible) : page seule, sans erreur.
8. `[p.4 Figure 2]` alors que la légende de la figure 2 est sur la page 5 : on va à la page 5 (comme `wrong_page` pour les citations).

---

### Task 1: Calcul de la position de défilement

**Files:**
- Create: `web/src/reader/lib/goto.ts`
- Test: `web/src/reader/lib/goto.test.ts`

**Interfaces:**
- Produces: `scrollTargetTop(pageTop: number, rectTop: number, viewportHeight: number): number` (pixels ; `rectTop` = distance du rect au haut de sa page) ; `firstRectTop(rects: Rect[]): number` (plus petit `y` normalisé, 0 si vide).

- [ ] **Step 1: Test.** `goto.test.ts` :
  - `scrollTargetTop(1000, 600, 900)` vaut `1300` (le rect au tiers) ;
  - `scrollTargetTop(1000, 100, 900)` vaut `1000` (jamais au-dessus du haut de la page) ;
  - `firstRectTop([[0.1, 0.5, 0.2, 0.02], [0.1, 0.3, 0.2, 0.02]])` vaut `0.3` ; `firstRectTop([])` vaut `0`.
- [ ] **Step 2:** Lancer `cd web && npx vitest run src/reader/lib/goto.test.ts` : échec attendu (module absent).
- [ ] **Step 3:** Implémenter les deux fonctions dans `goto.ts` : `Math.max(pageTop, pageTop + rectTop - viewportHeight / 3)`.
- [ ] **Step 4:** Relancer : PASS.
- [ ] **Step 5:** `pre-commit run --files web/src/reader/lib/goto.ts web/src/reader/lib/goto.test.ts` puis commit `feat(reader): scroll position of a precise jump (#30)`.

### Task 2: `PdfViewer` défile jusqu'à la cible

**Files:**
- Modify: `web/src/reader/PdfViewer.tsx` (interface `Flash`, props `flash`/`onFlashDone`, `PageView`, effet « The parent asks for another page »)
- Modify: `web/src/reader/PdfViewer.test.tsx` (tests de flash lignes ~261-320 : renommer la prop)

**Interfaces:**
- Consumes: `scrollTargetTop`, `firstRectTop` (Task 1) ; `locateQuote(boxes, quote, size)` de `lib/locate.ts`.
- Produces: `export interface Target { page: number; rects?: Rect[]; quote?: string; nonce: number }` (remplace `Flash`) ; props `target?: Target` et `onTargetDone?(): void` (remplacent `flash` et `onFlashDone`) ; `flashMs` inchangé.

- [ ] **Step 1: Tests** (dans `PdfViewer.test.tsx`, avec `FakeSource` et le helper `scroller()` existants) :
  - renommer les trois tests de flash existants vers `target={{ page, quote, nonce }}` : ils doivent passer tels quels ;
  - `a target with rects scrolls the page so the box sits a third from the top` : `FakeSource` taille 600×800, zoom 1, `target={{ page: 2, rects: [[0.1, 0.5, 0.3, 0.02]], nonce: 1 }}` ; attendre `scroller().scrollTop` = haut de la page 2 + 400 − 800/3 (viewport jsdom pris à `800`, comme `refreshWindow`) ;
  - `a target near the top of its page never scrolls above the page` : rect à `y = 0.01` → `scrollTop` = haut de la page ;
  - `a target with rects flashes them without needing the text layer` : `data-flash` présent avec `failTextOn: [2]`.
- [ ] **Step 2:** Lancer `cd web && npx vitest run src/reader/PdfViewer.test.tsx` : les nouveaux tests échouent.
- [ ] **Step 3:** Dans `PdfViewer.tsx` : remplacer `Flash` par `Target` ; `PageView` calcule `rects = target.rects ?? (target.quote !== undefined ? locateQuote(boxes, target.quote, size) : null)` (sans attendre `boxes` quand `target.rects` est fourni), garde le flash existant, puis appelle une nouvelle prop `onResolved(rects: Rect[])` ; `PdfViewer` ajoute, après l'effet `[page]`, un effet sur `target?.nonce` qui, pour des `target.rects`, et dans `onResolved` pour une citation, pose `el.scrollTop = scrollTargetTop(offsets[p - 1], firstRectTop(rects) * heights[p - 1], el.clientHeight || 800)`.
- [ ] **Step 4:** Relancer : PASS (tous les tests du fichier).
- [ ] **Step 5:** `cd web && npx tsc --noEmit` (les appelants de `flash` casseront : c'est la Task 3), pre-commit sur les deux fichiers, commit `feat(reader): the viewer scrolls to the target box (#30)`.

### Task 3: Brancher toutes les entrées sur `goTo`

**Files:**
- Modify: `web/src/reader/ReaderPage.tsx` (`flash`, `cite`, `changePage`, props de `PdfViewer`, `HighlightsStrip`, `ChatPane`)
- Modify: `web/src/reader/HighlightsStrip.tsx` (`onGo(page)` → `onGo(page, rects)`)
- Modify: `web/src/reader/chat/UserMessage.tsx:49` (`onGo(page)` → `onGo(page, quote?)`)
- Modify: `web/src/reader/chat/ChatPane.tsx` (passe `onCite` à `UserMessage` à la place de `onGo`)
- Test: `web/src/reader/HighlightsStrip.test.tsx`, `web/src/reader/chat/UserMessage.test.tsx` (ou le fichier de test existant du composant), `web/src/reader/ReaderPage.test.tsx`

**Interfaces:**
- Consumes: `Target` (Task 2).
- Produces: `ReaderPage` garde un état `target: Target | null` et une fonction `goTo(page: number, spec?: { rects?: Rect[]; quote?: string })` qui appelle `changePage(page)` puis `setTarget({page, ...spec, nonce: Date.now()})` quand `spec` est donné ; `cite(p, quote)` devient `goTo(p, quote ? { quote } : undefined)`.

- [ ] **Step 1: Tests** :
  - `HighlightsStrip` : cliquer une ligne appelle `onGo(h.page, h.rects)` (assertion sur les arguments exacts) ;
  - `UserMessage` : le bouton « Go to page N » appelle `onGo(N, "<texte de la citation>")` ;
  - `ReaderPage` (avec `FakeSource`, déjà utilisé) : cliquer une ligne de surlignage affiche un `[data-flash]` sur la page du surlignage ; cliquer la citation d'une question *ask the agent* en affiche un aussi ; un surlignage avec `rects: []` ne plante pas et ne flashe rien (Review Focus 1).
- [ ] **Step 2:** Lancer les trois fichiers de test : échecs attendus.
- [ ] **Step 3:** Implémenter les signatures ci-dessus ; `PdfViewer` reçoit `target={target ?? undefined}` et `onTargetDone={() => setTarget(null)}` ; `HighlightsStrip` reçoit `onGo={(p, rects) => goTo(p, { rects })}` ; `ChatPane` : `UserMessage onGo={onCite}`.
- [ ] **Step 4:** `cd web && npx vitest run src/reader` puis `npx tsc --noEmit` : PASS.
- [ ] **Step 5:** pre-commit sur les fichiers touchés, commit `feat(reader): every entry point returns to the exact spot (#30)`.

### Task 4: Dépendance, PDF de test à tailles de police, blocs de texte

**Files:**
- Modify: `pyproject.toml` (groupe `reader` : `"pdfminer.six>=20240706"`), puis `uv sync` pour le lock
- Modify: `tests/reader/pdf_factory.py` (`make_pdf(..., sizes: dict[str, int] | None = None)` : une ligne dont le texte est une clé de `sizes` s'écrit avec `/F1 {taille} Tf`, puis revient à 12)
- Create: `src/veille_reader/structure.py`
- Test: `tests/reader/test_structure.py`

**Interfaces:**
- Consumes: `PaperError`, `MAX_PAGES` de `veille_reader.paper`.
- Produces dans `structure.py` : `Rect = tuple[float, float, float, float]` ; dataclasses figées `Block(text: str, rect: Rect, size: float)` et `PageStructure(width: float, height: float, blocks: list[Block])` ; `EXTRACTOR = "pdfminer-1"` ; `extract_pages_structure(pdf_path: Path) -> list[PageStructure]` (une ligne de texte pdfminer = un `Block`, rect normalisé haut-gauche, `size` = taille de police médiane de la ligne ; lève `PaperError` si illisible).

- [ ] **Step 1: Tests** (`test_structure.py`, PDF via `make_pdf`) :
  - `test_blocks_have_normalised_top_left_rects` : `make_pdf(["Hello world"])` → 1 page, 1 bloc de texte `Hello world`, `rect[0]` ≈ `72/612` et `rect[1]` entre `0.05` et `0.12` (tolérance 0.02), toutes valeurs dans `0..1` ;
  - `test_font_size_is_read` : avec `sizes={"Big title": 18}` le bloc `Big title` a `size` ≈ 18 et un autre bloc ≈ 12 ;
  - `test_empty_page_gives_no_blocks` : `make_pdf([""])` → `blocks == []` (Review Focus 4) ;
  - `test_unreadable_pdf_raises_paper_error` : `pytest.raises(PaperError)` sur des octets non PDF écrits dans un fichier (Review Focus 5) ;
  - `test_page_cap` : `monkeypatch` `structure.MAX_PAGES` à 2 sur un PDF de 3 pages → 2 pages (Review Focus 6).
- [ ] **Step 2:** `uv run pytest tests/reader/test_structure.py -p no:cacheprovider --no-cov` : échec attendu.
- [ ] **Step 3:** Ajouter la dépendance et le paramètre `sizes` de `make_pdf` ; implémenter `extract_pages_structure` avec `pdfminer.high_level.extract_pages`, en parcourant `LTTextContainer` → `LTTextLine` ; conversion `y_haut = 1 - y1 / hauteur`. Attraper les erreurs de pdfminer et de `OSError` en `PaperError(f"cannot read the PDF: {type(exc).__name__}")`, sans le texte du PDF.
- [ ] **Step 4:** Relancer : PASS ; lancer aussi `tests/reader/test_paper.py` (le factory a changé).
- [ ] **Step 5:** `pre-commit run --files pyproject.toml src/veille_reader/structure.py tests/reader/pdf_factory.py tests/reader/test_structure.py`, commit `feat(reader): text blocks with positions from pdfminer (#30)`.

### Task 5: Sections et légendes

**Files:**
- Modify: `src/veille_reader/structure.py`
- Test: `tests/reader/test_structure.py`

**Interfaces:**
- Consumes: `PageStructure`, `Block`, `Rect` (Task 4) ; `extract_outline` de `veille_reader.paper`.
- Produces: dataclasses figées `Heading(title: str, page: int, rect: Rect | None, level: int)` et `Caption(kind: str, number: int, text: str, page: int, rect: Rect)` (`kind` vaut `"figure"` ou `"table"`) ; `Structure(extractor: str, pages: list[PageStructure], sections: list[Heading], captions: list[Caption])` ; `extract_structure(pdf_path: Path) -> Structure`.

- [ ] **Step 1: Tests** :
  - `test_sections_from_the_pdf_outline_get_a_box` : PDF avec `outline=[("Introduction", 1), ("Method", 2)]` et ces titres écrits dans les pages → deux `Heading` avec `page` 1 et 2 et `rect` non `None` ; un titre d'outline absent du texte → `rect is None` ;
  - `test_sections_without_outline_come_from_font_size_and_numbering` : lignes `"1 Introduction"` (taille 16), `"3.1 Setup"` (taille 14), corps en 12 → sections `["1 Introduction", "3.1 Setup"]` avec `level` 1 et 2 ; une phrase de corps qui finit par un point n'est jamais une section ;
  - `test_figure_and_table_captions` : lignes `"Figure 2: Overview of the model"` et `"Table 1. Results"` → deux `Caption` (`figure`/2, `table`/1) avec le texte de la ligne et un `rect` ; `"Figure 2 shows that…"` au milieu d'une phrase n'en fait pas une ;
  - `test_scanned_pdf_gives_empty_structure` : `make_pdf([""])` → `sections == []` et `captions == []`.
- [ ] **Step 2:** Lancer : échecs attendus.
- [ ] **Step 3:** Implémenter `extract_structure` : sections = entrées de `extract_outline` (rect = première ligne de la page dont le texte normalisé, lettres et chiffres seulement, contient le titre normalisé ; sinon `None`) ; à défaut de plan, lignes d'au plus 120 caractères, sans point final, dont la taille dépasse 1,15 × la taille de corps (taille la plus fréquente, pondérée par les caractères) ou qui commencent par `^\d+(\.\d+){0,2}\.?\s+[A-Z]` avec `size >= taille de corps` ; `level` = nombre de segments numérotés, 1 sans numéro. Légendes : lignes qui commencent par `^(Figure|Fig\.?|Table)\s*(\d+)\s*[:.]`, insensible à la casse.
- [ ] **Step 4:** Relancer : PASS.
- [ ] **Step 5:** pre-commit, commit `feat(reader): sections and captions of a paper (#30)`. Noter dans le message le seuil 1,15 comme point à recalibrer sur de vrais papiers (voir Task 10).

### Task 6: Stockage versionné

**Files:**
- Modify: `src/veille_reader/storage.py` (ajouter une entrée à `MIGRATIONS`, méthodes près de `paper_text`/`save_paper_text`)
- Modify: `src/veille_reader/structure.py` (`to_dict`/`from_dict`, `load_structure`)
- Test: `tests/reader/test_storage.py`, `tests/reader/test_structure.py`

**Interfaces:**
- Consumes: `Structure` (Task 5) ; `ReaderStore`.
- Produces: migration `CREATE TABLE paper_structure (item_id TEXT PRIMARY KEY, extractor TEXT NOT NULL, data TEXT NOT NULL, extracted_at TEXT NOT NULL);` ; `ReaderStore.paper_structure(item_id: str, extractor: str) -> dict | None` (`None` si absent **ou** si l'extracteur stocké est différent) ; `ReaderStore.save_paper_structure(item_id: str, extractor: str, data: dict) -> None` ; `Structure.to_dict() -> dict` (forme JSON fixée : `{"extractor": str, "pages": [{"width", "height", "blocks": [{"text", "rect": [x, y, w, h], "size"}]}], "sections": [{"title", "page", "rect": [x, y, w, h] | null, "level"}], "captions": [{"kind": "figure" | "table", "number", "text", "page", "rect": [x, y, w, h]}]}`) et `Structure.from_dict(d: dict) -> Structure` ; `load_structure(store: ReaderStore, item_id: str, pdf_path: Path) -> Structure | None` (cache puis extraction ; `None` si `PaperError`).

- [ ] **Step 1: Tests** :
  - `test_storage.py` : ajuster l'assertion de version de schéma qui compte les migrations si elle existe ; `save_paper_structure` puis `paper_structure(item, "x")` rend les mêmes données, `paper_structure(item, "y")` rend `None` ;
  - `test_structure.py` : `from_dict(to_dict(s)) == s` ; `load_structure` appelle l'extraction une seule fois pour deux appels (compteur via `monkeypatch` sur `extract_structure`) ; avec un PDF illisible `load_structure` rend `None` et ne stocke rien ; un extracteur de version différente est recalculé.
- [ ] **Step 2:** Lancer : échecs attendus.
- [ ] **Step 3:** Implémenter ; `data` est le JSON de `Structure.to_dict()`, la comparaison de version se fait sur `Structure.extractor == EXTRACTOR`. Deux requêtes concurrentes peuvent extraire deux fois : sans conséquence grâce à `INSERT OR REPLACE`.
- [ ] **Step 4:** `uv run pytest tests/reader/test_storage.py tests/reader/test_structure.py --no-cov -p no:cacheprovider` : PASS.
- [ ] **Step 5:** pre-commit, commit `feat(reader): the structure of a paper is stored once (#30)`.

### Task 7: Point d'accès `GET /api/items/{id}/structure`

**Files:**
- Modify: `src/veille_reader/server.py` (nouvelle route près de `item_pdf`, ligne ~252)
- Test: `tests/reader/test_server.py`

**Interfaces:**
- Consumes: `load_structure` (Task 6), `ensure_pdf`.
- Produces: `GET /api/items/{item_id}/structure` → `200` avec `Structure.to_dict()` ; `404` `{"reason": "unknown_item"}` si l'item est inconnu (même helper `unknown()`) ; `404` `{"reason": "no_structure"}` si le PDF est absent ou l'extraction impossible.

- [ ] **Step 1: Tests** (même fixtures que les tests de `/pdf`, fetcher simulé qui rend `make_pdf(["Figure 1: A figure"])`) :
  - 200 et `captions[0].number == 1` ;
  - item inconnu → 404 `unknown_item` ;
  - fetcher qui rend des octets non PDF → 404 `no_structure` (Review Focus 5) ;
  - le lecteur reste utilisable après cet échec : `GET /api/items/{id}` répond 200.
- [ ] **Step 2:** Lancer : échecs attendus.
- [ ] **Step 3:** Implémenter la route sur le modèle de `item_pdf` (`PdfError` → 404/502 comme là-bas).
- [ ] **Step 4:** `uv run pytest tests/reader/test_server.py --no-cov -p no:cacheprovider` : PASS.
- [ ] **Step 5:** pre-commit, commit `feat(reader): endpoint for the structure of a paper (#30)`.

### Task 8: Citation étiquetée `[p.N Figure K]` côté serveur

**Files:**
- Modify: `src/veille_reader/citations.py` (`_CITE`, `Citation`, `parse_citations`, clé de dédoublonnage et verdict dans `verify_citations`)
- Modify: `src/veille_reader/agent.py:56-58` (consigne de citation du tuteur)
- Test: `tests/reader/test_citations.py`, `tests/reader/test_agent.py` (si un test fige le texte de la consigne)

**Interfaces:**
- Produces: `Citation.label: str | None = None` (dernier champ, valeur par défaut), normalisé en minuscules : `"figure 2"` ou `"table 1"` (`fig.`/`fig` deviennent `figure`) ; le verdict d'une citation étiquetée garde `status == "page_only"` et ajoute `"label": "figure 2"` ; pas de clé `label` pour les autres.

- [ ] **Step 1: Tests** (`test_citations.py`) :
  - `parse_citations("see [p.4 Figure 2] and [p.5 table 1] and [p.6 fig. 3]")` → labels `"figure 2"`, `"table 1"`, `"figure 3"`, pages 4, 5, 6, `quote is None` ;
  - `parse_citations('[p.4 "some exact quote here"]')` et `[p.4]` : inchangés, `label is None` ;
  - `[p.4 Figure 2]` et `[p.4 Figure 3]` donnent deux verdicts distincts (la clé de dédoublonnage inclut l'étiquette) ; chacun a `status == "page_only"`, `quote is None` et `label` ;
  - `[p.4 Figure 2]` avec la page 4 inexistante → `status == "invalid_page"` (la page est vérifiée comme avant) ;
  - `[p.4 Figure 12345]` (plus de 3 chiffres) n'est pas une citation étiquetée (le texte reste tel quel).
  - `test_agent.py` : la consigne contient `Figure K` (assertion `in` sur la constante du prompt, comme les tests voisins).
- [ ] **Step 2:** `uv run pytest tests/reader/test_citations.py tests/reader/test_agent.py --no-cov -p no:cacheprovider` : échecs attendus.
- [ ] **Step 3:** Étendre `_CITE` avec l'alternative `(figure|fig\.?|table)\s*(\d{1,3})` (insensible à la casse) à côté de la citation entre guillemets ; calculer `label` dans `parse_citations`. Dans `agent.py`, après « If you cannot quote, cite [p.N] », ajouter que, pour une figure ou un tableau, il écrit `[p.N Figure K]` ou `[p.N Table K]` avec le numéro vu dans le papier, sans jamais inventer de numéro.
- [ ] **Step 4:** Relancer ces deux fichiers, puis `tests/reader/test_chat.py` (les verdicts y transitent) : PASS.
- [ ] **Step 5:** pre-commit sur les fichiers touchés, commit `feat(reader): the tutor can cite a figure or a table (#30)`.

### Task 9: Citation étiquetée côté front

**Files:**
- Create: `web/src/reader/structureApi.ts`
- Modify: `web/src/reader/chat/events.ts` (`Citation.label?: string`, copié par `toCitations`)
- Modify: `web/src/reader/chat/Markdown.tsx` (`CITE`, `Cite`, `verdictOf`, clic), puis le type de `onCite` dans `Markdown.tsx:14`, `AssistantMessage.tsx` (3 déclarations), `QuizCard.tsx:12`, `ChatPane.tsx:40`
- Modify: `web/src/reader/ReaderPage.tsx` (`cite`)
- Test: `web/src/reader/chat/Markdown.test.tsx`, `web/src/reader/chat/events.test.ts`, `web/src/reader/ReaderPage.test.tsx`

**Interfaces:**
- Consumes: `GET /api/items/{id}/structure` (Task 7), forme JSON de la Task 6 ; `goTo` de `ReaderPage` (Task 3).
- Produces: `export type Label = { kind: "figure" | "table"; number: number }` et `export type OnCite = (page: number, quote?: string, label?: Label) => void` dans `chat/events.ts` (tous les `onCite` ci-dessus prennent ce type) ; dans `structureApi.ts` : `interface Caption { kind: "figure" | "table"; number: number; page: number; rect: Rect }` et `fetchCaptions(item: string): Promise<Caption[]>` (liste vide sur 404 ou erreur réseau, jamais d'exception) ; `findCaption(captions: Caption[], label: Label, page: number): Caption | undefined` (même page d'abord, sinon n'importe quelle page).

- [ ] **Step 1: Tests** :
  - `events.test.ts` : `toCitations` conserve `label` quand c'est une chaîne ;
  - `Markdown.test.tsx` : `[p.4 Figure 2]` devient une puce `p.4` ; cliquer appelle `onCite(4, undefined, { kind: "figure", number: 2 })` ; `[p.4]` appelle toujours `onCite(4)` (pas d'argument en plus) ; `[p.4 "a short exact quote"]` inchangé ;
  - `structureApi.test.ts` : `findCaption` préfère la même page, retombe sur une autre page, rend `undefined` si absente (Review Focus 7 et 8) ; `fetchCaptions` rend `[]` quand `fetch` répond 404 ;
  - `ReaderPage.test.tsx` : cliquer une puce `[p.4 Figure 2]` change la page tout de suite, puis, la structure arrivée (faux `fetch` ou `structure` injecté en prop comme `api` et `chatApi`), affiche un `[data-flash]` à la légende, sur la page de la légende si elle diffère ; figure absente → page seule, aucun flash, aucune erreur.
- [ ] **Step 2:** Lancer ces fichiers de test : échecs attendus.
- [ ] **Step 3:** Implémenter. `CITE` du front reprend l'alternative de la Task 8 (le commentaire « same pattern as the server » reste vrai) ; `verdictOf` compare aussi `label` ; `ReaderPage.cite(p, quote, label)` : sans `label`, comportement de la Task 3 ; avec `label`, `changePage(p)` immédiatement, puis `fetchCaptions(itemId)` (une seule fois par papier, promesse gardée dans un `useRef`, jamais au chargement de la page) et, si `findCaption` trouve, `goTo(caption.page, { rects: [caption.rect] })`. `ReaderPage` accepte une prop `captionsApi = fetchCaptions` pour les tests.
- [ ] **Step 4:** `cd web && npx vitest run src/reader && npx tsc --noEmit` : PASS.
- [ ] **Step 5:** pre-commit sur les fichiers touchés, commit `feat(reader): a cited figure or table is shown in place (#30)`.

### Task 10: Vérification finale

- [ ] **Step 1:** `make check` (lint, format, suite complète avec couverture) : tout passe, aucune ligne nouvelle non couverte dans `structure.py`.
- [ ] **Step 2:** À la main, avec `make reader` sur 3 papiers arXiv réels de ton catalogue : un surlignage, une citation d'agent et la citation d'une question *ask the agent* amènent chacun la boîte au tiers de l'écran avec son flash ; `curl http://127.0.0.1:<port>/api/items/<id>/structure` rend des sections plausibles et des légendes. Noter ce qui diffère (seuil de taille de police) dans le message de commit et dans l'issue #30.
- [ ] **Step 3:** Cocher les cases de l'issue #30 (`gh issue edit` avec le compte personnel). La release (skill `release`) se fait au merge de `develop` dans `main`, pas ici.

## Hors de ce plan (décidé à l'écriture)

- **Sources de l'agent sans citation** : traitées par la forme `[p.N Figure K]` / `[p.N Table K]` (Tasks 8 et 9). Une source nue `[p.4]` reste à la page, et une source qui nomme une **section** n'a pas de forme dédiée (choix de portée : les figures et tableaux sont ce qu'un tuteur désigne sans pouvoir le citer).
- **Outil de l'agent pour les sections et figures** : `load_artifact(kind=section|figure|table)` existe déjà (`tools.py`) et lit le texte par expressions régulières. Le brancher sur `Structure` est repoussé à #36, qui consommera la structure.
- **`OutlineMenu` vers la boîte de la section** : repoussé, il faudrait charger la structure dans le front.
- **Re-ancrage après un zoom** : le zoom ramène en haut de la page courante (comportement actuel de `PdfViewer`), pas à la boîte.
