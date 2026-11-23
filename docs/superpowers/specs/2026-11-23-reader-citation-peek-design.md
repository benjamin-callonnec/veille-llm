# Reader : aperçu de la citation dans la visionneuse — Design

Issue de suite de #43. Taille : petite à moyenne (un composant, un pont de clic, un changement de skill).

## Intention

Quand une diapo d'un rapport dit « cette information est à cet endroit du papier » (`[p.4 …]`), on veut un
coup d'œil rapide sur le passage, sans quitter la présentation. Aujourd'hui un clic sur `[p.N]` dans le chat
fait défiler le PDF ; dans un rapport, `[p.N]` est du texte mort, et la visionneuse recouvre le PDF.

## Objectifs

- Un clic sur une citation d'une diapo ouvre une petite carte avec la page du papier recadrée autour du
  passage, passage surligné.
- La carte se ferme avec Échap, un clic ailleurs ou sa croix ; un bouton « Ouvrir dans le PDF » ramène au
  PDF (même saut que les citations du chat) et masque la visionneuse (elle garde sa diapo).
- Tout se fait dans le navigateur : pdf.js dessine déjà les pages, `locateQuote` retrouve un extrait,
  les légendes de figures viennent de la structure déjà extraite.

## Non-objectifs

- Pas d'aperçu dans le fichier exporté (les citations y restent du texte).
- Pas de rendu PDF côté serveur, pas de capture incrustée dans le rapport.
- Pas de vérification serveur des extraits d'un rapport (le chat le fait déjà pour ses réponses).
- Les puces de citation du chat ne changent pas.

## Anti-objectifs

- Montrer un passage faux comme s'il était vérifié : si l'extrait n'est pas trouvé, la carte dit
  « Passage non localisé » et montre le haut de la page.
- Donner à une présentation un moyen d'agir sur l'application au-delà de demander un aperçu.

## Approches considérées

- **A. Aperçu recadré au clic (retenue).** Citations avec extrait ou figure, recadrage dans le navigateur.
- B. Miniature de page entière au survol : simple, mais illisible et ne montre pas le bon endroit.
- C. Captures incrustées dans le rapport à l'écriture : marcherait dans l'export, mais demande un moteur de
  rendu PDF serveur et alourdit le rapport (plafond 400 000 caractères).

## Conception

**Format des citations dans un rapport.** Le même que le chat : `[p.4]`, `[p.4 "extrait exact"]`,
`[p.4 Figure 2]`, `[p.4 Table 1]`. Le skill `present` est modifié pour citer ainsi (extrait de 3 à 15 mots
copié mot pour mot, sinon la figure, sinon la page seule).

**Pont de clic (dans l'iframe).** `KEY_BRIDGE` (csp.ts) gagne un deuxième rôle, ou un second script injecté
de la même façon : au chargement, il parcourt les nœuds texte du `body` (hors `script` et `style`) et
enveloppe chaque citation reconnue dans un `<span class="veille-cite" tabindex="0" role="button">`
(soulignement pointillé, curseur main). Un clic, ou Entrée au clavier, envoie au parent
`{ veilleCite: { page, quote?, kind?, number? } }`. Les clics sur ces spans ne tournent pas la diapo
(le squelette ignore déjà les `button` ; le span est exclu de la même façon).

**Validation côté parent (le message vient d'une page non fiable).** Seulement si `e.source` est l'iframe ;
`page` entier de 1 à `numPages` ; `quote` chaîne de 300 caractères au plus ; `kind` `figure` ou `table`,
`number` selon `^\d+(\.\d+)?$`. Tout le reste est ignoré. Un seul aperçu à la fois.

**Carte.** Nouveau composant `CitationPeek` dans `web/src/reader/viewer/`, rendu par `FileViewer`, posé à
droite du panneau (largeur 420 px au plus, hors de la zone de clic gauche des diapos). Il reçoit le
`PdfSource` du lecteur et l'API des légendes (`captionsApi`, déjà dans `ReaderPage`). Étapes : localiser
(extrait par `locateQuote` sur le texte de la page, figure ou tableau par la structure), calculer le
recadrage (`cropFor(rects, page)` : bande verticale autour des rectangles avec marges, au moins 25 % de la
hauteur de page, largeur de page entière), dessiner la page avec `source.render` dans un canvas hors écran
puis recopier la bande, surligner les rectangles. Sans localisation : haut de la page (30 %) et la mention
« Passage non localisé ». Sans PDF : message « Pas de PDF pour ce papier ». Un nouvel aperçu annule le
rendu en cours (`AbortSignal`).

**« Ouvrir dans le PDF ».** Appelle le `cite(page, quote, label)` existant de `ReaderPage` puis ferme la
visionneuse (elle reste montée, cachée).

**Skill `present`.** Règle de citation ci-dessus. Les skills `charts` et `diagrams` gardent « Source :
paper [p.N] » (page seule).

## Contraintes

- Le bac à sable et la CSP de l'iframe ne changent pas : pas de `allow-same-origin`, pas de réseau.
- Texte des papiers et des rapports = donnée ; le pont n'envoie que page, extrait et figure, jamais de HTML.
- Tests sans réseau : `FakeSource` pour le rendu, jsdom pour le pont, un test pur pour `cropFor`.

## Laissé au réalisateur

Marges exactes du recadrage, style de la carte et des spans (thèmes clair et sombre), nom accessible de la
carte, comportement exact de la mise en page sur écran étroit.
