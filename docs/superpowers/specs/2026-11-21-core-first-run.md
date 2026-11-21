# Premier essai réel du pipeline core

Date : 2026-11-21, commande `veille-core run` sur l'abonnement, base `build/test.db`.

## Essai 1 (2 jours)
- 4 sources en succès (arXiv, OpenAI, Hugging Face, DeepMind), 2436 items collectés, 5 nouveaux,
  5 classés et publiés en 14 s. arXiv renvoyait 0 papier : normal, ses derniers papiers dataient de
  jeudi 18h59, hors fenêtre un samedi soir.

## Essai 2 (7 jours, même base)
- 4196 items collectés, 1246 nouveaux après filtrage, 796 classés, 200 enrichis, 205 publiés
  (190 papiers arXiv). Les 5 items de l'essai 1 n'ont pas été renvoyés au LLM (reprise correcte).
- **La limite de 5 heures de l'abonnement a été atteinte** pendant l'enrichissement, après 12 min 43 s.
  Message observé : « You've hit your 5-hour limit · resets 12am (Europe/Paris) (exit code: 1) ».
  Le pipeline s'est arrêté (code 1), a gardé les verdicts enregistrés et exporté les 205 items déjà
  complets. Ce message n'était pas reconnu comme une limite (classé erreur inconnue, arrêt par
  prudence) : corrigé, avec un test, dans `llm.py`.
- État de la base à l'arrêt : 450 items `new`, 263 `interesting` (à enrichir), 205 `published`,
  333 `rejected`. Aucun hook avec lien ou chevron, hooks de 200 caractères au plus.
- 13 catégories dont `Autres` (6 items), par exemple Agent Tooling (35), Inference Efficiency (32),
  Reasoning Methods (28), AI Security (20), Benchmarks (17).

## Ce que la revue a trouvé dans ces chiffres
- Les 450 items restés `new` ne sont pas « en attente de la limite » : ils forment exactement 30 lots
  de 15 sur 84 appels de classification, perdus parce que le schéma limitait `category_hint` à
  40 caractères (une réponse trop longue invalidait tout le lot). Corrigé : le schéma accepte 80
  caractères et le code tronque à 40. Les lots ignorés sont maintenant comptés et leur raison est
  affichée dans le résumé du run.
- Seuls 23 papiers arXiv sur 1209 avaient des upvotes Hugging Face, car ils n'étaient lus qu'à la
  première vue du papier. Corrigé : les upvotes des papiers déjà connus sont mis à jour à chaque run.
- Les catégories (jusqu'à 40 caractères, issues du modèle) ne sont plus publiées si elles contiennent
  autre chose que lettres, chiffres, espaces, tiret ou barre oblique, ni `http` ni `www`.

## Mesures et conclusions
- **Non mesuré** : la consommation réelle de l'abonnement. Les jetons n'étaient pas comptés pendant
  ces essais ; `veille-core` affiche maintenant les jetons et le coût indicatif du SDK à chaque
  run. La fenêtre de 5 heures est aussi partagée avec l'usage interactif du même compte : on ne
  peut pas attribuer son épuisement au seul pipeline. Seul fait établi : la limite a été atteinte
  pendant le run de 7 jours, qui avait beaucoup de lots perdus et réessayés.
- À décider : plafonner le nombre de lots par exécution (par exemple 20, option `--max-batches`).
- Qualité des catégories et des hooks : plausible sur les exemples lus, mais seul un échantillon
  de 4 items a été relu. Une relecture humaine d'un échantillon plus large reste à faire.
