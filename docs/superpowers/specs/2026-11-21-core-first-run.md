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

## Conclusion et points à décider
- Le premier remplissage (backfill) de 7 jours consomme toute la fenêtre de 5 heures. Le régime
  quotidien (environ un septième) est beaucoup plus léger, mais le pipeline devrait plafonner le
  nombre de lots par exécution pour ne pas vider ta fenêtre d'usage interactif. À décider.
- Qualité des catégories et des hooks : plausible sur les exemples lus ; une relecture humaine d'un
  échantillon plus large reste à faire.
