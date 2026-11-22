# Lecteur de papiers : fondations (#20)

Partie de #17 (visionneuse de papiers avec tuteur IA). Cette conception ne couvre que #20 : la base
sur laquelle #21 à #26 se construisent. Elle tourne **uniquement en local**, coût zéro hors abonnement.

## Intention
Ouvrir un papier du catalogue dans un mode lecture. #20 livre les fondations : un serveur local, un
stockage local, un bouton « Read » dans le catalogue et la récupération du PDF. Ni visionneuse, ni chat.

## Objectifs
- Un module séparable (package, point d'entrée, dossier de données propres), déplaçable sur le serveur de la v2.
- Un stockage local versionné, ignoré par git.
- Un item arXiv du catalogue s'ouvre dans la page du lecteur avec son id dans l'URL.
- Le PDF est téléchargé depuis arxiv.org, mis en cache en local, jamais redistribué.

## Hors périmètre et anti-objectifs
- Pas de visionneuse PDF (#21), pas de chat (#22), pas d'agent (#23).
- Rien d'écrit hors du dossier de données. Rien de lecteur dans le dépôt, ni dans la branche `data`.
- Le bouton « Read » ne doit jamais apparaître sur le site public (Pages).
- Articles de blog (sans PDF) : réponse « pas de PDF » pour l'instant, vue texte plus tard.

## Approches
- **A. Second point d'entrée dans `web/`** (choisie par l'auteur) : `reader.html` partage thèmes, composants
  et outillage ; serveur Python séparé.
- B. Module entièrement séparé (front et serveur) : isolation totale, mais thèmes et outillage dupliqués.

## Conception (mes choix, à corriger)
- **Serveur** : package `src/veille_reader/`, FastAPI + uvicorn (groupe de dépendances `reader`, ajouté aux
  groupes par défaut). Commande `veille-reader serve` (`--data-dir`, `--catalogue`, `--port`, défaut 8765).
  Écoute `127.0.0.1` seulement ; refuse les requêtes dont l'en-tête `Host` n'est pas local (contre le
  DNS rebinding) ; pas de CORS. FastAPI plutôt que la bibliothèque standard, car #22 et #26 ont besoin de
  streaming et de WebSocket.
- **Données** : dossier `.local/reader/` par défaut (déjà ignoré par git), modifiable. Contient `reader.db`
  (SQLite) et `pdfs/`. Schéma versionné par `PRAGMA user_version` et une liste de migrations ; la
  migration 1 ne crée que ce que #20 utilise (table `papers` : id d'item, fichier PDF, date de récupération).
  Les issues suivantes ajoutent leurs migrations.
- **Catalogue** : le serveur lit `build/catalogue.json` pour retrouver un item par id (404 si inconnu).
- **PDF** : seuls les items dont l'URL est `arxiv.org/abs/<id>` ou `/pdf/<id>` (id validé par expression
  stricte) ont un PDF. Téléchargement depuis `arxiv.org` uniquement, délai maximal, taille maximale 50 Mo,
  contrôle de la signature `%PDF`. Le nom du fichier en cache vient de l'id validé, jamais de l'entrée brute.
- **API** : `GET /api/health`, `GET /api/items/{id}` (métadonnées et `has_pdf`), `GET /api/items/{id}/pdf`
  (fichier en cache, récupéré au premier appel).
- **Front** : `web/reader.html` + `web/src/reader/`. L'id vit dans `reader.html#item=<id>`. La page affiche
  titre, hook et état du PDF, et laisse l'emplacement de la visionneuse à #21. Les tokens des thèmes Papier
  et Nuit sont extraits de `styles.css` vers `styles/tokens.css`, importé par les deux pages.
- **Bouton « Read »** : sur les cartes de type papier, visible seulement si `VITE_READER_URL` est défini au
  build. Le build de Pages ne le définit pas et n'inclut pas `reader.html` (entrée ajoutée seulement avec
  `VITE_READER=1`). `make reader` construit le front avec ces variables et lance le serveur, qui sert aussi
  `web/dist` et `catalogue.json`.

## Tests
Migrations (base vide, base déjà migrée, version inconnue refusée), résolution id → URL PDF (arXiv valide,
id malformé, hôte non arXiv, traversée de chemin), téléchargement simulé (trop gros, pas un PDF, délai dépassé,
cache réutilisé sans second appel), rien écrit hors du dossier de données, refus d'un `Host` non local,
rendu du bouton « Read » (présent avec `VITE_READER_URL`, absent sinon, absent pour les non-papiers), page du
lecteur (item connu, inconnu, sans PDF). Réseau toujours simulé.

## Laissé au constructeur
Nommage interne des modules, forme exacte des erreurs JSON, présentation de la page temporaire.
