# Résultat du spike LLM

Date : 2026-11-21. Plan : `docs/superpowers/plans/2026-11-21-plan-2-llm-spike.md`.

## Conclusion : GO

Le Claude Agent SDK, authentifié par le jeton d'abonnement (`CLAUDE_CODE_OAUTH_TOKEN`), tourne en
headless dans GitHub Actions, sans outil, avec une sortie JSON valide. Le plan 3 (pipeline `core`)
peut s'appuyer sur `src/veille_llm/llm.py`.

## Ce qui a été testé

| | Local | Actions (3 exécutions) |
|---|---|---|
| Authentification | session `claude` de la machine | secret `CLAUDE_CODE_OAUTH_TOKEN` |
| SDK | `claude-agent-sdk` 0.2.187 | `claude-agent-sdk` 0.2.187 |
| Modèle | `claude-sonnet-5-5` | `claude-sonnet-5-5` |
| Résultat | JSON valide, 3 items classés | 3 réussites sur 3 |
| Durée | non mesurée | 15 à 18 s par exécution |
| Jetons (sortie) | 184 | 180, 182, 184 |
| Jetons (entrée, hors cache) | 2 | 2 |
| Coût indicatif | 0,0064 USD | 0,0020 à 0,0043 USD |

Les items de test : un papier sur Mamba et une annonce de modèle sont jugés intéressants, une
recette de cuisine est écartée. Le résultat est identique en local et en Actions.

Le coût indicatif est celui que le SDK calcule, pas une facture : avec l'abonnement, rien n'est
facturé au token. Les jetons d'entrée ne comptent pas le cache.

## Vérifications de sécurité

- `ANTHROPIC_API_KEY` n'est défini nulle part (workflow et code). Le code refuse chaque appel si
  cette clé, ou `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK` ou
  `CLAUDE_CODE_USE_VERTEX`, est défini.
- Aucun jeton dans les logs des 3 exécutions (runs GitHub Actions 44951619359, 44951660020 et
  44951686082) : aucune occurrence de `sk-ant`, la variable d'environnement est masquée par GitHub.
- L'agent tourne sans outil (`tools=[]`), en un tour, avec `setting_sources=[]` (aucun réglage,
  hook ou `CLAUDE.md` n'est chargé) et `strict_mcp_config=True` (aucun serveur MCP, même ceux
  configurés sur la machine). Ces options sont vérifiées par un test avec un faux `query`.
- « Extra usage » est désactivé dans le compte de l'auteur (confirmé par l'auteur).

## Ce qui n'est pas vérifié

- **Le comportement exact quand la limite d'abonnement est atteinte.** On ne peut pas la provoquer
  à volonté. Le code traite un message contenant `usage limit`, `rate limit`, `limit reached` ou
  `429` comme `LlmLimitError` (jamais réessayé), et toute erreur inconnue comme `LlmError` (le
  pipeline s'arrête sans bascule). À confirmer à la première occurrence réelle, en consignant le
  message exact (masqué) ici.
- **La stabilité du jeton dans la durée.** Des tickets publics rapportent des erreurs 401 avec les
  jetons de `claude setup-token`. Trois exécutions sur quelques minutes réussissent, mais il faudra
  surveiller les premiers jours. Une erreur d'authentification (401, « Invalid API key », « OAuth token has expired »,
  `/login`) devrait lever `LlmAuthError` (non réessayable, reconnue par ses marqueurs, non confirmée
  sur un vrai message) et faire échouer le workflow, ce qui prévient l'auteur par e-mail.
- **La consommation réelle sur l'abonnement** pour environ 60 à 100 items par jour : à mesurer sur
  les premiers jours du pipeline avant d'ajuster la taille des lots.

## Repli si le jeton cesse de fonctionner

Dans cet ordre, au choix de l'auteur : (a) exécution locale planifiée avec `launchd`, (b) clé
API Anthropic avec plafond de dépense, (c) Claude sur Vertex AI. Seul `claude_runner` change : le
reste du code appelle `complete_json`.

## À traiter dans le plan 3 (revue du spike)

- **Séparer instructions et données.** `complete_json(prompt, schema)` reçoit une seule chaîne :
  y coller des titres et résumés récupérés sur Internet permet à un texte d'influencer la sortie
  (par exemple le champ `hook`, publié ensuite dans la newsletter). Le plan 3 doit passer les
  instructions et les items séparément, les items sous forme de données JSON délimitées, borner les
  champs texte du schéma (`maxLength`) et traiter la sortie du modèle comme non fiable en aval
  (échappement HTML dans le template).
- **Comptage des jetons.** `input_tokens` ignore les jetons de cache : exposer aussi
  `cache_read_input_tokens` et `cache_creation_input_tokens` pour mesurer la consommation.
