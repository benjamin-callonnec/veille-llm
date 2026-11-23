# Setup du planificateur Cloudflare (#38)

Étapes manuelles, **une seule fois**. Le Worker `veille-llm-scheduler` déclenche `daily.yml` (tous les jours
06:00 UTC) et `weekly.yml` (lundi 08:00 UTC) par `workflow_dispatch` : les crons GitHub démarrent avec des
heures de retard. Design : `docs/superpowers/specs/2026-11-23-cloudflare-scheduler-design.md`.

Aucun identifiant de compte ni aucun token dans git (repo public) : tout passe par des variables
d'environnement locales et des secrets GitHub.

## 1. Compte Cloudflare et token propre à ce repo

1. Compte Cloudflare gratuit ; noter l'identifiant de compte (tableau de bord, barre latérale droite) :
   `export CLOUDFLARE_ACCOUNT_ID=...`.
2. Créer un **token API nommé `veille-llm`**, limité à ce compte, avec seulement : *Workers Scripts : Edit*,
   *Workers R2 Storage : Edit*, *Account Settings : Read*. Ne jamais réutiliser celui d'un autre repo.
   En local, `npx wrangler login` suffit pour wrangler ; Terraform lit les variables ci-dessous.

## Variables d'environnement locales : `.env.cloudflare`

Les mêmes quatre noms servent partout : ce fichier, les secrets GitHub (étape 3) et les cibles `make`.
Créer **`.env.cloudflare`** à la racine (ignoré par git ; ne pas le confondre avec `.env`, réservé au token
Claude du lecteur), en mode 600, avec ces lignes et vos valeurs :

```bash
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
R2_STATE_ACCESS_KEY_ID=...        # étape 2
R2_STATE_SECRET_ACCESS_KEY=...    # étape 2
```

```bash
chmod 600 .env.cloudflare
set -a; source .env.cloudflare; set +a     # dans chaque nouveau terminal, avant make tf-*
```

`make tf-*` s'arrête en nommant la variable manquante. Le Makefile range lui-même les clés R2 sous les noms
`AWS_*` que Terraform exige : n'exportez pas ceux-là.

## 2. Bucket R2 de l'état Terraform

```bash
./setup/bootstrap.sh        # crée veille-llm-tfstate (idempotent)
```

Puis dans *R2 > Manage R2 API tokens*, créer une paire de clés **limitée à ce bucket** et la mettre dans
`.env.cloudflare` sous `R2_STATE_ACCESS_KEY_ID` et `R2_STATE_SECRET_ACCESS_KEY`.

## 3. Secrets GitHub du repo (pour la CI)

À créer dans *Settings > Secrets and variables > Actions* : `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`R2_STATE_ACCESS_KEY_ID`, `R2_STATE_SECRET_ACCESS_KEY` (les clés du bucket d'état).

## 4. Token GitHub du Worker

Le Worker appelle `POST /repos/<repo>/actions/workflows/<fichier>/dispatches`. Créer un **fine-grained personal
access token** : repo `veille-llm` **seul**, permission **Actions : Read and write** et rien d'autre,
expiration **90 jours**. Le poser comme secret du Worker (la valeur n'entre ni dans git ni dans Terraform ni
dans les secrets du repo) :

```bash
make scheduler-secret       # demande la valeur
```

**Rotation** (avant l'expiration, `freshness.yml` prévient au bout de 30 h si un `daily` manque) : créer le
nouveau token, `make scheduler-secret`, puis révoquer l'ancien.

Risque assumé : ce token peut déclencher n'importe quel workflow `workflow_dispatch` du repo, sur n'importe
quelle branche existante. Il ne permet pas de pousser du code. `daily`, `weekly` et `spike-llm` ont la garde
`github.ref == 'refs/heads/main'`.

## 5. Premier déploiement (dans cet ordre)

```bash
make scheduler-install
make scheduler-deploy       # crée le script : il doit exister avant les crons
make tf-init
make tf-plan                # à lire
make tf-apply               # pose les deux crons et désactive le sous-domaine workers.dev
```

Les crons sont à Terraform, le code à `wrangler` (`scheduler/wrangler.toml` n'a pas de `[triggers]`). Vérifier
dans *Workers > veille-llm-scheduler > Settings > Triggers* qu'un second `make scheduler-deploy` ne les efface
pas.

Voir les journaux : `cd scheduler && npx wrangler tail`. Test local : `npx wrangler dev --test-scheduled` puis
`curl "http://localhost:8787/__scheduled?cron=0+6+*+*+*"` (avec un `scheduler/.dev.vars`, ignoré par git,
qui porte `GITHUB_TOKEN`).
