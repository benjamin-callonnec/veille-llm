# Section « conférences » dans l'hebdo et priorité de classement (#49)

## Pourquoi

Les papiers sortent en grappes autour des grandes conférences. L'hebdo (8 items par semaine) les noie
ou les coupe, et le daily (items traités du plus récent au plus ancien, abandonnés après 3 jours) peut
en perdre sans les avoir classés.

## Objectifs

- Une section « Autour de <conférence> » dans l'hebdo quand une conférence est proche ou vient de finir.
- Les papiers liés à une conférence active sont classés en premier dans le daily.

## Hors périmètre

- Numéro séparé de la newsletter, nouveau cron, nouvel identifiant d'envoi.
- Détection par le LLM.
- Budget variable au fil de l'année : #50.

## Contraintes

- Coût zéro, sources distantes simulées dans les tests, pas d'adresse d'abonné dans les logs.
- Le commentaire arXiv n'entre pas dans les prompts, mais `filtering.py` et `classify.py` sont dans `RESULT_FILES` : `bump patch` de la pipeline (n'invalide aucun résultat stocké).
- Le sujet du mail reste un texte fixe.

## Approches

- Rattachement par la date seule : section vague, papiers sans lien. Écartée.
- Rattachement par le LLM : appels en plus, erreurs, touche aux fichiers versionnés. Écartée.
- **Retenue :** commentaire arXiv (`arxiv:comment`) rapproché d'une liste datée de conférences.
- Stockage : commentaire brut en base, rapprochement à l'envoi (une correction de motif ou de date
  s'applique aussi aux items déjà en base) plutôt que nom de conférence figé à l'ingestion.

## Conception

- **Collecte.** `Paper` et `Item` gagnent `comment: str = ""`. `parse_feed` lit `arxiv:comment`.
  `items` gagne une colonne `comment` (`ALTER`, comme `github_stars`).
- **Calendrier.** `src/veille_llm/conferences.py` (partagé par la pipeline et la newsletter) : liste datée (nom, motif regex, début, fin) et fonction
  pure `active(now)` ; fenêtre : 21 jours avant le début, 14 jours après la fin.
- **Daily.** `pending_classification` met en tête les items dont le commentaire correspond à une
  conférence active ; le préfiltre par mots-clés les laisse passer. Le budget ne change pas.
- **Hebdo.** `select_items` renvoie les 8 items habituels plus une section par conférence active
  (5 items maximum, sans doublon avec l'hebdo, absente si vide). Gabarits HTML et texte.

## À la charge du constructeur

- Dates et motifs de NeurIPS, ICML, ICLR, ACL, EMNLP, CVPR, COLM à vérifier sur les sites officiels ;
  marquer celles non confirmées.
- Part de papiers dont le commentaire est renseigné : à mesurer sur un échantillon.
- Limite connue : un vieux papier mis à jour avec « Accepted at X » ne revient pas dans la fenêtre.
