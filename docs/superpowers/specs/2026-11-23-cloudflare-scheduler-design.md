# Planificateur Cloudflare à la place des crons GitHub Actions (#38)

## Intention

Les crons `schedule` de GitHub Actions démarrent avec des heures de retard et à un moment
imprévisible (mesuré sur le repo `foot-prediction` : 5 h 30 à 10 h de retard). Ici cela veut dire que
`daily.yml` (06:00 UTC) publie le catalogue à une heure aléatoire, que `weekly.yml` (lundi 08:00) n'est
pas sûr de passer après le `daily`, et que GitHub désactive les crons après 60 jours sans activité.

Les Cron Triggers de Cloudflare Workers partent à l'heure et sont gratuits. Décision : **Cloudflare
décide de l'heure, GitHub Actions ne fait que le travail.**

## Buts, non-buts, anti-buts

- **Buts** : un Worker qui, à chaque cron, déclenche `daily.yml` ou `weekly.yml` sur `main` par
  `workflow_dispatch` ; l'infrastructure Cloudflare décrite en Terraform ; un token GitHub et un token
  Cloudflare propres à ce repo, au moindre droit ; le départ des deux workflows vérifié à la minute.
- **Non-buts** : faire tourner le pipeline ou la newsletter dans un Worker (Python, Agent SDK, plusieurs
  minutes) ; un environnement de dev (un seul : prod) ; déplacer la CI ou le déploiement Pages ;
  changer ce que font `daily` et `weekly`.
- **Anti-buts** : un secret ou un identifiant de compte dans git, un log, une issue ou l'état Terraform
  (repo public) ; deux planificateurs actifs en même temps (un `daily` doublé coûte du LLM) ; un arrêt
  silencieux du Worker sans que personne le voie.

## Contraintes

- Repo public. Règles de sécurité du `CLAUDE.md` : déclencheurs `push`, `pull_request`, `schedule`,
  `workflow_dispatch` seulement ; permissions `contents: read` par défaut ; actions épinglées ;
  jamais de secret dans un job qui exécute du code tiers sans nécessité.
- Les workflows restent gardés par `if: github.ref == 'refs/heads/main'` et le groupe
  `concurrency: data-branch` : le `weekly` se met en file derrière un `daily` en cours.
- Modèle : le repo `foot-prediction` (`collector/`, `iac/`, `setup/`, cibles Make `collector-*` et `tf-*`).
- Limites du plan gratuit Cloudflare (nombre de Cron Triggers, CPU) : à confirmer dans la première
  tâche ; on en utilise 2.

## Approches considérées

- **Ordre `daily` puis `weekly`.** *A. Deux crons fixes* (06:00 tous les jours, 08:00 le lundi) : simple, le
  groupe `concurrency` sérialise déjà, deux heures de marge (le `daily` dure moins d'une heure). *B. Le Worker
  n'envoie le `weekly` que si le `daily` du jour est terminé* (interrogation de l'API GitHub à plusieurs
  ticks) : plus de code et d'état pour un gain faible. **Choix de l'auteur : A.**
- **Partage entre `wrangler` et Terraform.** *Terraform possède les crons, `wrangler` le code, le token GitHub
  est posé avec `wrangler secret put`* ; ou *Terraform déploie aussi le code* (compilation du TypeScript avant
  chaque `apply`). **Choix de l'auteur : `wrangler` déploie le code, Terraform gère le reste** (crons,
  sous-domaine désactivé, état sur R2) ; le token GitHub ne passe pas par Terraform pour rester hors de l'état.

## Conception

### 1. Le Worker (`scheduler/`, TypeScript, mêmes outils que le modèle : Biome, tsc, Vitest, wrangler)

- `wrangler.toml` : `name = "veille-llm-scheduler"`, `workers_dev = false`, **pas de `[triggers]`** (les
  crons sont à Terraform).
- `scheduled(controller, env, ctx)` : traduit `controller.cron` en fichier de workflow
  (`"0 6 * * *"` → `daily.yml`, `"0 8 * * 1"` → `weekly.yml`) ; un cron inconnu ou un secret
  `GITHUB_TOKEN` absent est une **erreur visible** (journaux du Worker), jamais un oubli silencieux.
- Appel : `POST https://api.github.com/repos/benjamin-callonnec/veille-llm/actions/workflows/<fichier>/dispatches`
  avec `{"ref": "main"}`, `Authorization: Bearer`, `Accept: application/vnd.github+json`,
  `X-GitHub-Api-Version: 2022-11-28`, un `User-Agent` générique. Succès = `204`.
- Résilience (reprise du `resilience.ts` du modèle) : 15 s de timeout par tentative, 3 tentatives, backoff
  exponentiel à jitter complet (1 s, 2 s… plafonné à 8 s) en respectant `Retry-After` ; on retente réseau,
  408, 425, 429, 500, 502, 503, 504 ; jamais 401, 403, 404, 422. Un échec final lève une erreur.
- Journal d'une ligne par déclenchement (workflow, statut HTTP, tentative), **sans** le token ni l'en-tête.
- Développement local : `wrangler dev --test-scheduled` et `curl "…/__scheduled?cron=…"` ; `.dev.vars`
  (ignoré par git) porte `GITHUB_TOKEN`.

### 2. Terraform (`iac/`)

- Fournisseur `cloudflare ~> 5`, version de Terraform >= 1.9, backend `s3` sur un bucket R2
  `veille-llm-tfstate` créé une fois à la main par `setup/bootstrap.sh` (Terraform ne crée pas son propre
  backend), clés R2 limitées à ce bucket, passées par `-backend-config` et variables d'environnement.
- Ressources : `cloudflare_workers_cron_trigger` (les deux crons), le sous-domaine `workers.dev` désactivé.
  L'identifiant de compte vient de `TF_VAR_cloudflare_account_id` (variable ou secret GitHub), **pas d'un
  fichier dans git**.
- Ordre : `wrangler deploy` crée le script, puis `terraform apply` pose les crons dessus.
- La première tâche du plan vérifie que `wrangler deploy` (sans `[triggers]`) laisse les crons de Terraform
  intacts et que `terraform apply` ne supprime pas le script. Si ce n'est pas le cas, les crons retournent dans
  `wrangler.toml` et Terraform ne gère plus que l'état et le sous-domaine.

### 3. Jetons et secrets (propres à ce repo, jamais partagés avec `foot-prediction`)

- **Token Cloudflare** `veille-llm` : *Workers Scripts : Edit*, *Workers R2 Storage : Edit* (état), *Account
  Settings : Read*, limité à ce compte. Stocké comme secret GitHub `CLOUDFLARE_API_TOKEN` pour la CI ; en
  local on utilise `wrangler login`.
- **Clés R2 du backend** : une paire limitée au bucket d'état, secrets GitHub `R2_STATE_ACCESS_KEY_ID` et
  `R2_STATE_SECRET_ACCESS_KEY`.
- **Token GitHub** : *fine-grained personal access token* limité au repo `veille-llm`, **seule** permission
  *Actions : Read and write*, expiration courte (90 jours) avec rotation décrite dans `setup/README.md`.
  Posé par l'auteur avec `make scheduler-secret` (`wrangler secret put GITHUB_TOKEN`) ; un déploiement ne
  le touche pas. Il n'est ni dans git, ni dans Terraform, ni dans les secrets GitHub du repo.
- Risque assumé : ce token peut déclencher n'importe quel workflow `workflow_dispatch` du repo, sur n'importe
  quelle branche existante. `daily` et `weekly` ont la garde `github.ref == 'refs/heads/main'` ; **`spike-llm`
  n'en a pas** et utilise `CLAUDE_CODE_OAUTH_TOKEN`. Le token ne permet pas de pousser du code, donc il ne
  peut lancer que du code déjà présent sur une branche du repo, mais on ajoute la même garde à `spike-llm`
  dans ce chantier. L'expiration courte limite la fenêtre.

### 4. CI et déploiement

- `ci.yml` (déjà `push` sur `main`) : un job de vérification sans secret (`scheduler-check` : Biome, tsc,
  Vitest) ; un job de déploiement, `needs` le premier, avec `CLOUDFLARE_API_TOKEN` : `npm ci --ignore-scripts`
  (aucun script d'installation tiers n'exécute avec le secret), `wrangler deploy`, puis `terraform apply`
  (`make tf-apply-ci`). Actions épinglées, `contents: read`.
- Cibles Make : `scheduler-install`, `scheduler-check`, `scheduler-deploy`, `scheduler-secret`, `tf-init`,
  `tf-plan`, `tf-apply`, `tf-apply-ci`, branchées sur `make check` pour la partie sans secret.

### 5. Bascule et garde-fou

- Les `schedule:` de `daily.yml` et `weekly.yml` sont retirés **après** un premier déclenchement réussi en
  prod par le Worker (vérifié à la main), dans un commit à part, avec mise à jour des commentaires et du
  `CLAUDE.md` (architecture et déclencheurs).
- Garde-fou contre l'arrêt silencieux : un petit workflow `freshness.yml` (`schedule` GitHub, retard sans
  importance ici) échoue, donc envoie un e-mail GitHub, si la dernière exécution réussie de `daily` date de
  plus de 30 h (lecture seule par `gh run list`, permission `actions: read`).
- Vérification finale : sur les deux prochains cycles, l'écart entre l'heure du cron et le `created_at`
  du run est inférieur à une minute.

## Tests

- TDD. Worker (Vitest, faux `fetch`, faux `sleep` et `random`) : cron connu → bon workflow et bon corps ;
  cron inconnu et secret absent → erreur ; 204 → succès ; 500 puis 204 → une reprise ; 401, 404 et 422 → pas de
  reprise ; épuisement des tentatives → erreur ; le token n'apparaît jamais dans un log.
- Terraform : `terraform validate` et `fmt -check` en CI ; le `plan` est lu à la main au premier `apply`.
- `freshness.yml` : le calcul d'âge est un petit script testé sans réseau.
- Non vérifiable en test : le départ à l'heure réel (vérification finale), la coexistence `wrangler`/Terraform
  (première tâche du plan), les limites du plan gratuit.

## Risques

- Un déclenchement en double (Cloudflare garantit « au moins une fois ») lancerait deux `daily`, donc deux
  passes de LLM. Le groupe `concurrency` les met en file, il ne les fusionne pas ; risque rare, coût borné.
- Expiration du token GitHub : le Worker échoue visiblement (journaux), `freshness.yml` prévient au bout de 30 h.

## Laissé au constructeur

- Noms exacts des variables Terraform et des sorties ; version exacte des outils (suivre celles de
  `foot-prediction`).
- Libellé du journal du Worker et format de l'erreur, tant que le token n'y figure pas.
- Découpage du `Makefile` (cibles listées ci-dessus, noms libres s'ils restent cohérents avec le modèle).
