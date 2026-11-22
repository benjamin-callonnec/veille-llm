# Lecteur de papiers : visionneuse PDF et panneaux (#21)

Partie de #17, après les fondations (#20, v0.10.0). Local uniquement, coût zéro.

## Intention
Lire le PDF d'un papier dans la page du lecteur, sélectionner un passage, le surligner ou poser une
question dessus. Le chat lui-même vient avec #22 : ici, le panneau de droite est un emplacement.

## Validé par l'auteur (maquettes)
- Disposition **A** : deux panneaux PDF | chat (environ 60/40), poignée de glissement, bouton de repli
  par panneau, liste des surlignages dans une bande repliable sous le PDF, thèmes Papier et Nuit.
- Boîte de sélection près du texte : **champ de question** (Entrée envoie), trois points de couleur
  (jaune, vert, rouge, sans sens fixe) qui surlignent sans poser de question, **Copy**, Échap ferme.
- Une question envoyée surligne le passage en jaune ; le message du chat porte la citation et sa page,
  avec un « ↗ » qui ramène le PDF à l'endroit.

## Objectifs
- Visionneuse : pages, zoom, recherche, plan (sommaire), navigation au clavier, fluide sur un long PDF.
- Surlignages persistants par papier, listés avec « aller à ».
- Panneaux redimensionnables et repliables, disposition mémorisée.
- Ancres : une fonction qui fait défiler le PDF jusqu'à une page et un passage (pour #22).

## Hors périmètre et anti-objectifs
- Pas de vrai chat, pas d'agent, pas de quiz (#22 à #25). Le panneau de droite affiche seulement les
  questions posées (citation, page, texte), sans les enregistrer.
- Aucun script ni lien dangereux dans le PDF ; aucune donnée hors du dossier local.

## Approches
- **A. pdf.js (`pdfjs-dist`) avec ma propre couche d'interface** (choisie) : canvas et couche de texte de
  pdf.js, boîte de sélection, surlignages et mise en page écrits dans le style du site. Contrôle total du
  style et des tests ; plus de code.
- B. Visionneuse intégrée de pdf.js : rapide, mais style imposé, sélection et surlignages difficiles à
  relier au chat.
- C. `<iframe>` du navigateur : aucune sélection exploitable. Écartée.

## Conception (mes choix, à corriger)
- **Bibliothèque** : `pdfjs-dist` en version épinglée, chargée dynamiquement (seulement dans le build du
  lecteur). Options de sécurité : exécution de scripts du PDF désactivée, `isEvalSupported: false`, liens
  du PDF filtrés (http et https seulement). Le worker est fourni par Vite.
- **Frontière testable** : pdf.js est derrière une petite interface (`PdfSource` : nombre de pages, taille
  d'une page, rendu, texte et positions des mots, plan). Les tests utilisent une fausse source, car jsdom ne
  dessine pas de canvas.
- **Fluidité** : seules les pages proches de la fenêtre visible sont rendues, les autres sont des
  emplacements de taille connue ; les canvas hors champ sont libérés. Test avec une fausse source de
  300 pages : le nombre de pages rendues reste borné.
- **Sélection** : fonction pure qui transforme une sélection en passage cité `{texte, page, rectangles}` avec
  des rectangles normalisés (0 à 1), indépendants du zoom, plus l'intervalle de mots dans la page.
- **Surlignages** : migration 2 de `reader.db`, table `highlights(id, item_id, page, color, text, rects,
  created_at)`. API : `GET`, `POST` et `DELETE /api/items/{id}/highlights`. Couleurs : `yellow`, `green`,
  `red`. Mêmes protections que l'existant (hôte local, requêtes de même origine). Les surlignages sont
  redessinés au zoom courant à partir des rectangles normalisés.
- **Panneaux** : composant de mise en page avec poignée (souris, tactile, et flèches du clavier), largeurs
  minimales, repli par panneau (lecture seule, chat seul), état mémorisé dans `localStorage` (avec
  repli si indisponible).
- **Ancres** : `scrollToAnchor({page, rects?})` ; l'ancre est conservée dans l'URL du lecteur
  (`#item=…&page=…`) pour pouvoir revenir au même endroit.
- **Plan et recherche** : plan lu depuis pdf.js (menu dans l'en-tête). La recherche parcourt le texte de
  chaque page, liste les résultats avec leur page et les met en évidence.
- **Clavier** : PageSuivante/Précédente, flèches, `+`/`-` pour le zoom, `/` pour chercher, `Échap`
  ferme la boîte ou la recherche.
- **Texte du papier** : toujours traité comme donnée ; affiché comme texte (jamais interprété comme HTML).

## Tests
Sélection vers passage cité (une page, plusieurs lignes, coordonnées indépendantes du zoom), persistance des
surlignages (API et chargement), fenêtre de pages rendues bornée pour 300 pages, repli et redimensionnement
des panneaux (limites, clavier, mémorisation et repli sans `localStorage`), recherche, ancres, filtrage des
liens du PDF, texte du papier échappé. pdf.js simulé dans les tests ; une vérification manuelle avec un vrai
PDF arXiv est notée comme telle.

## Laissé au constructeur
Dimensions exactes, animations, nom des composants, présentation de la recherche.
