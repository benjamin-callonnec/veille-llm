# Reader : aperçu de la citation dans la visionneuse — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Un clic sur une citation `[p.N …]` d'une diapo ouvre une carte avec la page du papier recadrée autour du passage, surligné, sans quitter la présentation.

**Architecture :** Le pont injecté dans l'iframe (aujourd'hui seulement les touches `V` et Échap) enveloppe les citations du texte et signale clic ou Entrée au parent par `postMessage`. Le parent valide le message (source, forme, bornes), localise le passage (`locateQuote` pour un extrait, légendes de la structure pour une figure), calcule un recadrage pur (`cropFor`), dessine la page avec `PdfSource.render` dans un canvas hors écran puis recopie la bande et surligne les rectangles.

**Tech Stack :** React + Vitest (`web/`), pdf.js via `PdfSource`, `FakeSource` pour les tests ; une ligne de skill (`skills/present.md`).

**Spec :** `docs/superpowers/specs/2026-11-23-reader-citation-peek-design.md`

## Global Constraints

- Le bac à sable et la CSP de l'iframe ne changent pas : `sandbox="allow-scripts"` sans `allow-same-origin`, pas de réseau.
- Le message de l'iframe est non fiable : accepté seulement si `e.source` est l'iframe ; `page` entier de 1 à `numPages` (9999 quand il n'y a pas de PDF) ; `quote` chaîne de 3 à 300 caractères ; `kind` `figure` ou `table`, `number` selon `^\d+(\.\d+)?$`. Tout le reste est ignoré. Le pont n'envoie jamais de HTML.
- Format des citations d'un rapport : `[p.4]`, `[p.4 "extrait exact"]`, `[p.4 Figure 2]`, `[p.4 Table 1]` (le même que le chat).
- Pas d'aperçu dans l'export ; pas de rendu serveur ; les puces de citation du chat ne changent pas.
- Tests sans réseau ni vrai PDF : `FakeSource` (`web/src/reader/pdf/fakeSource.ts`), jsdom pour le pont, test pur pour `cropFor`. Le canvas de jsdom n'a pas de contexte 2D : le code teste `getContext("2d")` et ne dessine rien quand il est nul.
- TDD ; après chaque tâche, seulement les tests des fichiers touchés ; suite complète (`make check`) une fois à la fin ; `pre-commit run --files <fichiers>` sur les fichiers touchés ; commits sur `develop`, `type(scope): sujet (#43)`.
- Précision de la spec : la mention « Passage non localisé » n'apparaît que si un extrait ou une figure a été demandé et introuvable ; une citation `[p.N]` seule montre le haut de la page sans mention.

## Review Focus

1. Citation page seule `[p.4]` : le haut de la page, sans mention « non localisé ».
2. Extrait absent de la page ou à cheval sur deux pages : « Passage non localisé » et le haut de la page, jamais un autre passage surligné.
3. Message mal formé ou d'une autre source (page 0, page 99999, extrait de 301 caractères, `kind` inconnu, donnée non objet) : ignoré, aucune carte.
4. Deux clics rapprochés : seule la dernière carte se dessine ; un rendu annulé ne dessine rien.
5. Page de largeur nulle ou PDF absent : état d'erreur ou « Pas de PDF pour ce papier », jamais `NaN` ni exception.
6. Un clic sur une citation ne tourne pas la diapo ; un clic ailleurs dans la diapo ferme la carte (et tourne la diapo comme avant).
7. Visionneuse fermée avec une carte ouverte : la carte disparaît ; la rouvrir ne la ré-affiche pas.
8. Une citation dans un `<script>`, `<style>` ou `<textarea>` du rapport n'est jamais enveloppée ni cliquable.
9. Échap avec une carte ouverte ferme la carte d'abord, pas la visionneuse.

---

### Task 1: Validation du message et recadrage (fonctions pures)

**Files:**
- Create: `web/src/reader/viewer/peek.ts`
- Test: `web/src/reader/viewer/peek.test.ts`

**Interfaces:**
- Consumes: `Rect` de `web/src/reader/lib/quote.ts` (`[x, y, w, h]` entre 0 et 1), `Label` de `web/src/reader/chat/events.ts` (`{ kind: "figure" | "table"; number: string }`).
- Produces: `interface CiteRef { page: number; quote?: string; label?: Label }` ; `parseCite(data: unknown, maxPage: number): CiteRef | "close" | null` (`"close"` quand `data` est `{ veilleCite: null }`, `null` pour tout message invalide) ; `cropFor(rects: Rect[] | null): { y: number; h: number }` (bande verticale en fraction de la hauteur de page) ; constantes `MAX_QUOTE = 300`.

- [ ] **Step 1: Write the failing tests** : `parseCite` accepte `{veilleCite:{page:4}}`, `{page:4,quote:"x".repeat(10)}`, `{page:2,kind:"figure",number:"3.1"}` (donne `label: {kind:"figure", number:"3.1"}`), renvoie `"close"` pour `{veilleCite:null}`, et `null` pour : `null`, `"x"`, `{}`, page 0, page non entière, page > `maxPage`, extrait de 301 caractères ou de 2, `kind: "x"`, `number: "a"`, `veilleCite: 3`. `cropFor(null)` donne `{y: 0, h: 0.3}`. `cropFor([[0.1, 0.5, 0.8, 0.04]])` donne une bande qui contient le rectangle avec marge (`y <= 0.5 - 0.04`, `y + h >= 0.54 + 0.10`) et `h >= 0.25` ; un rectangle près du bas donne `y + h` égal à 1 ; près du haut donne `y` égal à 0 ; plusieurs lignes (rectangles à y = 0.2 et 0.4) donnent une bande qui couvre les deux ; une liste vide se comporte comme `null`.
- [ ] **Step 2: Run** `cd web && npx vitest run src/reader/viewer/peek.test.ts` → FAIL (module absent).
- [ ] **Step 3: Implement** `peek.ts` : marges du haut 0.04 et du bas 0.10, hauteur minimale 0.25 (bande centrée sur les rectangles puis recalée dans [0, 1]).
- [ ] **Step 4: Run** → PASS ; biome sur les fichiers touchés.
- [ ] **Step 5: Commit** `feat(web): citation peek validation and crop (#43)`.

---

### Task 2: Pont de citations dans l'iframe et relais par `HtmlFrame`

**Files:**
- Modify: `web/src/reader/viewer/csp.ts` (rename `KEY_BRIDGE` en `FRAME_BRIDGE`, ajoute le rôle citations), `web/src/reader/viewer/HtmlFrame.tsx`, `web/src/reader/viewer/registry.tsx`
- Test: `web/src/reader/viewer/csp.test.ts`, `web/src/reader/viewer/HtmlFrame.test.tsx`

**Interfaces:**
- Consumes: `parseCite`/`CiteRef` (Task 1 : le parent valide, le pont ne fait que relayer).
- Produces: `FRAME_BRIDGE: string` (un `<script>` qui, au chargement ou à `DOMContentLoaded`, enveloppe chaque citation reconnue des nœuds texte du `body` (hors `SCRIPT`, `STYLE`, `TEXTAREA`) dans `<span class="veille-cite" tabindex="0" role="button" data-p data-q data-k data-n>` avec un style injecté (soulignement pointillé, curseur main) ; un clic (phase de capture, `stopPropagation` et `preventDefault`) ou Entrée sur un tel span envoie `parent.postMessage({ veilleCite: { page, quote?, kind?, number? } }, "*")` ; un clic ailleurs envoie `{ veilleCite: null }` ; le rôle touches `V`/Échap reste tel quel) ; reconnaît `[p.N]`, `[p.N "extrait"]` (guillemets droits ou courbes, 3 à 300 caractères), `[p.N Figure K]`, `[p.N Table K]`, `[p.N Fig. K]` ; `HtmlFrame` prop `onCite?: (raw: unknown) => void` appelée avec le contenu brut d'un message de l'iframe (source vérifiée) dont la clé est `veilleCite` ; `ViewerProps.onCite?: (raw: unknown) => void` dans le registre.

- [ ] **Step 1: Write the failing tests** : pour le pont, installer `FRAME_BRIDGE` **une seule fois** dans un `beforeAll` de `csp.test.ts` sur un `body` de test contenant : `<p>A [p.4] B [p.5 "an exact quote here"] C [p.6 Figure 2] D [p.7 Table 1.2] E [p.8 Fig. 3]</p>`, un `<script>` et un `<style>` et un `<textarea>` contenant `[p.9]`, et du texte sans citation ; chaque test réinitialise un tableau de messages reçus (`window` « message » écouté une fois). Cas : cinq spans créés avec les bons `data-*` ; rien dans script, style et textarea ; clic sur un span envoie le bon message et un écouteur `click` posé sur `document` en phase de bulle ne reçoit rien ; Entrée sur un span envoie le même message ; clic sur un texte ordinaire envoie `{veilleCite: null}` ; le test des touches existant partage la même installation (messages `veilleKey` inchangés, ignorés dans un champ ou avec modificateur). Pour `HtmlFrame` : `srcdoc` contient `FRAME_BRIDGE` ; un message `{veilleCite: {page: 4}}` de `frame.contentWindow` appelle `onCite` avec cet objet brut ; un message de `window`, ou sans clé `veilleCite`, ne l'appelle pas ; les tests existants sur `veilleKey` passent avec le nouveau nom.
- [ ] **Step 2: Run** `cd web && npx vitest run src/reader/viewer/csp.test.ts src/reader/viewer/HtmlFrame.test.tsx` → FAIL.
- [ ] **Step 3: Implement** : le script du pont reste du JavaScript écrit à la main dans une chaîne (jamais `Function.toString`, que le build peut altérer) ; marqueur `window.__veilleBridge` pour ne s'installer qu'une fois par document ; `HtmlFrame` filtre sur `e.source === frame.contentWindow` puis relaie `veilleCite` à `onCite`.
- [ ] **Step 4: Run** les mêmes tests → PASS ; biome ; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(web): the report page signals clicks on its citations (#43)`.

---

### Task 3: La carte `CitationPeek`

**Files:**
- Create: `web/src/reader/viewer/CitationPeek.tsx`
- Modify: `web/src/styles/reader.css`
- Test: `web/src/reader/viewer/CitationPeek.test.tsx`

**Interfaces:**
- Consumes: `CiteRef`, `cropFor` (Task 1) ; `PdfSource` (`pageInfo`, `textLayer`, `render`) ; `locateQuote` (`web/src/reader/lib/locate.ts`) ; `Caption`, `findCaption` (`web/src/reader/structureApi.ts`) ; `Rect`.
- Produces: `CitationPeek({ cite, source, captions, onOpen, onClose })` avec `source: PdfSource | null`, `captions: () => Promise<Caption[]>`, `onOpen(cite: CiteRef): void`, `onClose(): void`. En-tête : « p.N » (la page trouvée pour une figure), bouton « Open in the PDF » (appelle `onOpen(cite)`), bouton de fermeture (`aria-label` « Close the preview »). Corps : un canvas, ou un message d'état (`role="status"`) : « Passage not located » seulement quand un extrait ou une figure était demandé et introuvable, « No PDF for this paper » sans source, « The preview could not be drawn » en cas d'erreur. Largeur de la carte 420 px au plus.

- [ ] **Step 1: Write the failing tests** (avec `FakeSource` ou un faux `PdfSource` qui enregistre les appels) : un extrait trouvé appelle `source.render` pour la bonne page, n'affiche aucun message d'état et a un canvas ; un extrait introuvable affiche « Passage not located » ; `[p.N]` seul n'affiche pas ce message ; une figure trouvée dans les légendes (même page ou une autre) affiche « p.<page trouvée> » ; une figure introuvable affiche le message ; sans `source` : « No PDF for this paper » ; un `render` qui rejette ou une page de largeur 0 : « The preview could not be drawn », sans exception ; une seconde `cite` annule le rendu précédent (signal `aborted`) et ne dessine que la dernière ; « Open in the PDF » appelle `onOpen` avec la citation ; la croix appelle `onClose` ; pas d'erreur quand `getContext("2d")` renvoie `null`.
- [ ] **Step 2: Run** `cd web && npx vitest run src/reader/viewer/CitationPeek.test.tsx` → FAIL.
- [ ] **Step 3: Implement** : localiser (`textLayer` + `pageInfo` puis `locateQuote`, sinon légendes), `cropFor`, rendre la page à l'échelle `largeur de carte / info.width` dans un canvas hors écran, recopier la bande dans le canvas visible, peindre les rectangles (jaune translucide) ; un `AbortController` par citation ; styles de la carte dans `reader.css` avec les variables de thème existantes (clair et sombre), posée à droite du panneau.
- [ ] **Step 4: Run** → PASS ; biome ; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(web): the citation preview card (#43)`.

---

### Task 4: Branchement dans la visionneuse et le lecteur

**Files:**
- Modify: `web/src/reader/viewer/FileViewer.tsx`, `web/src/reader/ReaderPage.tsx`
- Test: `web/src/reader/viewer/FileViewer.test.tsx`, `web/src/reader/ReaderPage.test.tsx`

**Interfaces:**
- Consumes: `parseCite`, `CitationPeek` (Tasks 1 et 3) ; `onCite` du rendu (Task 2) ; `cite`, `source`, `captionsApi`, `captions` (ref) de `ReaderPage`.
- Produces: props de `FileViewer` : `source?: PdfSource | null`, `captions?: () => Promise<Caption[]>`, `onOpenPdf?: (cite: CiteRef) => void`. État `peek: CiteRef | null` : un message valide l'ouvre, `"close"` ou un message invalide qui n'est pas une citation ne change rien sauf `"close"` qui le ferme ; Échap (touche ou pont) ferme d'abord la carte puis la visionneuse ; la carte est effacée quand `open` devient faux ou quand le rapport ou la version change ; `onOpen` de la carte appelle `onOpenPdf(cite)` puis efface la carte. Dans `ReaderPage` : `onOpenPdf={(c) => { cite(c.page, c.quote, c.label); setViewerOpen(false); }}`, `source={source}`, `captions` = fonction qui rend `captions.current ??= captionsApi(itemId)`.

- [ ] **Step 1: Write the failing tests** : un message `{veilleCite: {page: 4}}` de l'iframe affiche la carte ; `{veilleCite: null}` la ferme ; un message invalide (page 99999 avec une source de 5 pages) n'affiche rien ; Échap (touche de la fenêtre, puis message du pont) ferme la carte d'abord, la visionneuse au second Échap ; fermer la visionneuse (`open` faux) puis la rouvrir : pas de carte ; changer de version efface la carte ; « Open in the PDF » appelle `onOpenPdf` avec la citation. Dans `ReaderPage` : depuis une carte, « Open in the PDF » ferme la visionneuse et déclenche le saut du lecteur vers la page (même effet qu'une citation du chat : la page du PDF change).
- [ ] **Step 2: Run** `cd web && npx vitest run src/reader/viewer/FileViewer.test.tsx src/reader/ReaderPage.test.tsx` → FAIL.
- [ ] **Step 3: Implement** : `FileViewer` valide avec `parseCite(raw, source?.numPages ?? 9999)` ; rend `<CitationPeek>` dans `.viewer-body` quand `peek` est défini ; le gestionnaire d'Échap tient compte de `peek`.
- [ ] **Step 4: Run** → PASS ; biome ; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(web): citations of a report open a preview of the paper (#43)`.

---

### Task 5: Skill `present` et documentation

**Files:**
- Modify: `skills/present.md`, `.claude/skills/veille-guidelines/SKILL.md`, `docs/superpowers/plans/2026-11-23-reader-citation-peek.md` (cases cochées à la fin)
- Test: `tests/reader/test_skills.py`

**Interfaces:**
- Consumes: format des citations (Global Constraints).
- Produces: règle de citation dans `skills/present.md` : « cite every claim as [p.N "exact quote"] with 3 to 15 words copied word for word from the page as the tool returned it; for a figure or a table, [p.N Figure K] or [p.N Table K]; [p.N] alone only when neither fits; never invent a page or a quote ».

- [ ] **Step 1: Write the failing test** `test_present_skill_asks_for_quoted_citations` dans `tests/reader/test_skills.py` : le prompt de `skills/present.md` contient `[p.N "exact quote"]`, `Figure K` et `Table K`, et `check_directory(REPO_SKILLS) == []`.
- [ ] **Step 2: Run** `uv run pytest tests/reader/test_skills.py -q --no-cov` → FAIL.
- [ ] **Step 3: Implement** : remplacer, dans l'étape 2 de `present.md`, « carries its page as [p.N] on the slide » par la règle ci-dessus ; ajouter dans `veille-guidelines` (section « Lecteur : skills et rapports ») une phrase : le pont de l'iframe n'envoie que page, extrait et figure, et le parent valide chaque champ.
- [ ] **Step 4: Run** le test → PASS ; `uv run python -m veille_reader.skills skills` → `all skills are valid`.
- [ ] **Step 5: Commit** `feat(reader): present cites with exact quotes (#43)`.

---

## Fin de chantier

- [ ] `make check` une seule fois ; corriger les trous de couverture.
- [ ] Vérification à la main (non faite par les tests) : `make reader`, copier `skills/*.md` dans `.local/reader/skills/`, `/present`, cliquer une citation (la carte montre le bon passage), « Open in the PDF », fermer et rouvrir avec `V`.
- [ ] Release (skill `release`, bump minor) quand l'auteur le demande.
