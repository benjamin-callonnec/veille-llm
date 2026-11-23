# Reader : retour précis dans le PDF et extraction structurée (#30)

## Intention

Revenir **à l'endroit exact** d'un PDF depuis toutes les entrées du lecteur, pas seulement en haut
de la page. Aujourd'hui seul le chip de citation de l'agent flashe la bonne zone, sans faire
défiler la vue. Une ligne de la liste des surlignages, la citation d'une question *ask the agent*
et une source sans citation ne vont qu'à la page.

Le second objectif prépare #36 (graphe ou vector store entre papiers, ingestion hebdomadaire) : un
papier doit avoir une structure stockée (sections, légendes de figures, boîtes de texte avec page)
pour que l'agent cite précisément et que #36 découpe des passages avec leur provenance.

## Buts, non-buts, anti-buts

- **Buts** : un seul `goTo({page, rects})` utilisé par toutes les entrées ; une extraction
  structurée côté serveur, stockée dans SQLite, calculée une fois par papier.
- **Non-buts** : OCR et modèle de parsing visuel (MinerU, Docling, Marker, olmOCR, dots.ocr) ;
  le graphe ou vector store (#36) ; la détection visuelle des figures et tableaux.
- **Anti-buts** : une dépendance lourde ou payante ; une extraction qui bloque l'ouverture d'un
  papier ; des positions fausses affichées comme exactes (mieux vaut revenir à la page).

## Contraintes

- Coût zéro, tout en local ; repo public, rien de personnel dans les fixtures de test.
- Les boîtes sont normalisées (`[x, y, w, h]` entre 0 et 1, origine en haut à gauche) comme les
  rects des surlignages, pour que zoom et taille de page ne comptent pas.
- Le texte du PDF n'est jamais une instruction (règle de sécurité du repo) : on stocke et on
  affiche, on n'exécute rien.
- Les tests ne touchent pas le réseau ; ils utilisent de petits PDF générés.

## Approches considérées

- **A. Extracteur simple derrière une interface, modèle en option plus tard (choisie).**
  `pdfminer.six` (MIT) donne texte et boîtes ; sections et légendes par heuristique ; stockage
  SQLite versionné par extracteur. Zéro coût, rien de lourd ; figures et tableaux détectés par leur
  légende seulement.
- **B. Modèle de parsing directement (MinerU ou Docling).** Résultat plus riche, mais grosse
  dépendance, lente sans GPU, choisie sans mesure. Écartée avant l'évaluation de l'OCR.
- **C. Boîtes calculées par pdf.js dans le navigateur puis envoyées au serveur.** Écartée :
  l'extraction dépendrait de l'ouverture du papier, donc inutilisable pour l'ingestion
  hebdomadaire de #36.

Choix de l'auteur : A, par étapes, avec l'évaluation de l'OCR dans une issue à part.

## Conception

### 1. Navigation précise (front)

- `PdfViewer` expose un `goTo({page, rects, nonce})` qui remplace `flash` et `page` pour les
  sauts : il fait défiler pour que la première boîte soit environ au tiers de la hauteur visible,
  sans jamais dépasser le haut de la page, puis fait flasher les rects.
- Les entrées :
  - ligne de surlignage (`HighlightsStrip`) : utilise les rects stockés ;
  - citation de l'agent et quiz (`ReaderPage.cite`) : `locateQuote` calcule les rects à la volée ;
  - citation d'une question *ask the agent* (`UserMessage`) : idem avec sa citation ;
  - source sans citation : rects de la section ou de la figure si l'extraction les a, sinon la
    page (comportement actuel).
- Si les rects manquent ou si la citation est introuvable, on tombe sur la page seule, sans erreur.

### 2. Extraction structurée (serveur)

- Nouveau module (par exemple `veille_reader/structure.py`) avec une interface
  `extract_structure(pdf_path) -> Structure`, où `Structure` contient, par page, ses dimensions,
  ses blocs de texte (texte, boîte normalisée) et, pour le papier, les sections (titre, page, boîte)
  et les figures et tableaux (légende, page, boîte).
- Sections : le plan du PDF quand il existe (déjà lu par `extract_outline`), sinon une heuristique
  sur la taille de police et la numérotation (« 3 », « 3.1 »). Légendes : blocs commençant par
  « Figure n » ou « Table n ».
- Stockage : une table `paper_structure(item_id, extractor, version, data, extracted_at)` ;
  recalculée si la version de l'extracteur change. Migration du schéma comme les précédentes.
- L'extraction tourne à la demande, une fois par papier, après `ensure_pdf`. En cas d'échec, le
  lecteur fonctionne comme avant (aucune structure) et l'erreur est journalisée sans le texte du PDF.
- Exposition : un point d'accès en lecture pour le front et un outil de l'agent pour récupérer les
  sections et figures (nom exact à fixer dans le plan).
- `retrieval.py` peut réutiliser les titres de sections de la structure plutôt que du seul plan
  PDF ; hors périmètre si cela change les résultats existants sans test.

### 3. Hors de cette conception

- L'issue d'évaluation OCR / parsing (3 ou 4 candidats sur ~10 papiers : qualité des boîtes,
  temps, mémoire) est créée à part. Le résultat de la mesure décide si un modèle remplace
  l'extracteur A derrière la même interface.
- #36 consomme `Structure` comme source de passages avec provenance.

## Tests

- TDD. Front : `goTo` (défilement, tiers de hauteur, plafond au haut de page, flash, repli sur la
  page), les trois entrées. Serveur : extraction sur des PDF générés (plan, sans plan, légendes),
  stockage et migration, échec d'extraction sans effet sur le lecteur.
- Ce qui n'est pas vérifiable en test (positions réelles sur de vrais papiers arXiv) est vérifié à
  la main sur 3 papiers et noté dans le plan.

## Laissé au constructeur

- Nom exact de l'outil de l'agent et du point d'accès.
- Seuils de l'heuristique de sections (à calibrer sur quelques papiers réels).
- Ajout de `pdfminer.six` au groupe `reader` de `pyproject.toml` (dépendance MIT, absente
  aujourd'hui du lock) ; confirmer qu'il lit bien les PDF de test avant de s'y engager.
- Si cette extraction touche les fichiers qui influencent les résultats du LLM
  (`RESULT_FILES`), décision de version de la pipeline requise (a priori non : le reader est
  séparé de la pipeline).
