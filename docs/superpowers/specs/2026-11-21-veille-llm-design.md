# veille-llm : document de conception

Date : 2026-11-21. Statut : brouillon à valider (révision 2 : tout sur GitHub, coût nul).

## 1. Intention et pourquoi

Une veille personnelle sur le domaine LLM, qui ne garde que ce qui vaut la peine d'être lu :
papiers scientifiques (arXiv, Hugging Face Papers), actualités et annonces publiques
(Anthropic, OpenAI, Hugging Face, Meta, etc.) et benchmarks.

Aujourd'hui (v0) un script filtre arXiv par mots-clés et un site statique affiche le résultat.
Les mots-clés sont trop larges et les thèmes sont figés. L'objectif est de passer à une veille
**curée par un LLM**, avec des catégories qui se créent dynamiquement, accessible via :

- une **webapp** : catalogue des derniers papiers et actualités ;
- une **newsletter hebdomadaire** : un e-mail identique pour tous les abonnés.

Public : l'auteur et 2 à 3 amis. Le projet ne coûte rien d'autre que l'abonnement Claude existant.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**
- Ne montrer que des items intéressants (papiers, actualités, benchmarks du domaine LLM).
- Catégories de filtre dynamiques, générées à partir du contenu récent.
- Pipeline robuste aux pannes distantes (5xx, 429, timeouts) et à l'arrêt brutal du LLM.
- Aucun secret dans le code. Tout est dans GitHub Secrets.
- Coût nul : GitHub gratuit, le LLM tourne sur l'abonnement Claude, e-mails via SMTP gratuit.

**Non-objectifs**
- Pas de compte utilisateur, pas de préférences par abonné : même newsletter pour tous.
- Pas de formulaire d'abonnement public ni de serveur hébergé (aucun budget d'hébergement).
- Pas de passage à l'échelle d'un public ouvert (voir « Évolution »).
- Pas de résumé complet des papiers : seulement un « hook » court.

**Anti-objectifs (un échec même si ça marche techniquement)**
- Publier des items non classés ou à moitié traités.
- Envoyer un e-mail vide ou en double.
- Exposer une adresse e-mail d'abonné dans le repo, les logs ou les données publiées.
- Une facturation au token non voulue.
- Faire fonctionner l'abonnement Claude par un contournement fragile.

## 3. Contraintes

- Hébergement : GitHub Pages (statique) et GitHub Actions comme scheduler. Repo **public**
  (GitHub Pages gratuit l'exige). Rien d'autre n'est hébergé.
- Base de données : SQLite. En CI, le fichier `veille.db` est persisté sur une branche `data`.
  Il ne contient **aucune donnée personnelle**.
- Abonnés : liste d'e-mails dans un GitHub Secret (`SUBSCRIBERS`), jamais dans le repo.
- Le LLM est utilisé via le Claude Agent SDK avec l'abonnement Claude
  (`CLAUDE_CODE_OAUTH_TOKEN`, GitHub Secret). Le réglage « extra usage » du compte doit rester
  désactivé. Quand la limite est atteinte, on suppose que l'agent s'arrête sans bascule payante.
  Ce comportement n'est pas documenté officiellement : **à vérifier avant la mise en production**.
- Usage limité à l'auteur et à quelques proches (conditions d'usage de l'abonnement).
- Modèle : Haiku 5.5 (`claude-haiku-5-5`) par défaut pour la classification et les hooks (issue #9 : 43/45 d'accord avec Sonnet, environ 3 fois moins cher) ; `--model` permet de revenir à Sonnet.
- Envoi des mails : SMTP (Gmail avec mot de passe d'application), identifiants en GitHub Secrets.
- **Sécurité (repo public)** :
  - Les workflows qui ont accès aux secrets ne se déclenchent que par `schedule` et `workflow_dispatch`.
    Seul le workflow de contrôle `ci.yml` (sans secret, permissions en lecture seule) se déclenche aussi,
    au `push` sur `main` uniquement (gitflow : on travaille sur `develop`, sans Action). Jamais
    `pull_request_target`, ni `issues` ou `issue_comment` sur un workflow qui a accès aux secrets.
  - Aucun collaborateur avec droit d'écriture (un workflow peut lire les secrets).
  - Approbation manuelle activée pour les workflows de contributeurs extérieurs
    (Settings > Actions > General).
  - Les logs sont publics : les secrets et chaque adresse d'abonné sont masqués, et rien de
    dérivé d'un secret (base64, morceaux) n'est affiché.
  - Les résumés de papiers et d'actualités viennent d'Internet (risque d'injection de prompt) :
    l'agent LLM tourne **sans outil** (pas de fichiers, pas de shell, pas de réseau) et ne
    renvoie que du JSON structuré, qui est validé avant d'être utilisé.
- Dans ce repo, l'auteur autorise l'assistant à commiter (exception à sa règle globale) ; le push
  demande toujours son accord. Les commits
  automatiques du pipeline sur la branche `data` sont faits par le workflow.

## 4. Approches envisagées

**Architecture générale**

| | A. Services tiers | B. FastAPI + React hébergés | C. Tout sur GitHub (choisie) |
|---|---|---|---|
| Pipeline | Actions | Actions ou scheduler | Actions |
| Abonnement | Buttondown ou Resend | API hébergée (Cloud Run) | Liste dans un secret, gérée par l'auteur |
| Coût | Faible mais non nul | Hébergement à payer | Nul |

Choisie : **C**, car l'auteur n'a pas de budget d'hébergement et le pipeline est un batch.
B et A ont été écartées pour le coût.

**Orchestration agentique**

- Google ADK avec un `BaseLlm` sur mesure : respecte l'idée de départ, mais il faut un adaptateur
  fragile pour utiliser l'abonnement (ADK n'accepte que des clés API ou Vertex).
- **Claude Agent SDK + orchestrateur Python maison (choisi)** : natif avec l'abonnement,
  plus léger, et le passage à une clé API ne change qu'un secret. Les étapes gardent le
  vocabulaire ADK (étapes déterministes sans LLM, étapes LLM), donc une migration vers ADK
  reste possible.

## 5. Architecture retenue

Monorepo (workspace `uv`) :

```
veille-llm/
 ├─ packages/core/          pipeline quotidien : sources → filtres → LLM → SQLite
 ├─ services/newsletter/    job hebdo : sélection → template Jinja2 → envoi SMTP
 ├─ web/                    React : catalogue (lecture seule)
 ├─ .github/workflows/      daily.yml, weekly.yml, pages (déploiement)
 ├─ .claude/                CLAUDE.md, skills, hooks (harnais de développement)
 └─ docs/superpowers/       specs et plans
```

Flux :

```
 daily.yml (cron) : restaure veille.db (branche data) → core → export catalogue.json
                    → pousse veille.db sur `data` → déploie web + catalogue.json sur Pages
 weekly.yml (cron): restaure veille.db → newsletter → SMTP → abonnés (secret SUBSCRIBERS)
                    → enregistre « semaine X envoyée » dans veille.db → pousse `data`
```

Les deux workflows modifient la branche `data` : ils partagent un groupe `concurrency` pour
ne jamais s'exécuter en même temps. La branche `data` est **réécrite en un seul commit** à
chaque exécution (orpheline, force-push) pour que le dépôt ne grossisse pas.

### 5.1 `core` : pipeline

Séquence d'étapes. Chaque étape a une interface commune (entrée, sortie, état partagé) :

1. **Collecte** (déterministe, en parallèle) : arXiv (cs.CL, cs.LG, cs.AI), Hugging Face Papers,
   flux RSS des blogs (Anthropic, OpenAI, Hugging Face, Meta AI, Google DeepMind quand ils existent).
   On préfère les RSS au scraping HTML. Une source sans flux est ignorée en v1
   (vérifié le 2026-11-21 : OpenAI, Hugging Face et DeepMind ont un flux ; Anthropic et Meta AI n'en ont
   pas d'officiel, voir l'issue « Étendre les sources de données »).
2. **Filtre déterministe** : fenêtre de dates, mots-clés larges, dédoublonnage, sources de confiance.
3. **Classification LLM** : par lots (environ 15 items par appel). Sortie structurée :
   intéressant ou non, score, type (papier, actualité, benchmark), catégorie proposée.
4. **Catégories dynamiques + hook LLM** : regroupe les propositions en un petit nombre de
   catégories stables d'un jour à l'autre, et écrit un hook d'une ou deux phrases par item retenu.
5. **Publication** : écrit en base les items curés et exporte le `catalogue.json` du catalogue.

**Résilience**
- Retry avec backoff exponentiel et jitter sur 429 et 5xx. Une source en panne est ignorée sans
  bloquer les autres. Repli arXiv : API puis flux RSS/OAI-PMH.
- Si tout échoue, on conserve le dernier `catalogue.json` valide.
- **Arrêt brutal du LLM** (limite d'abonnement atteinte) : chaque résultat de classification est
  enregistré dans `veille.db` tout de suite, et le workflow pousse la base **même en cas
  d'échec** (étape `if: always()`). Le job est reprenable et ne reclasse pas ce qui l'est déjà.
  Rien d'incomplet n'est publié : seuls les items classés apparaissent.

**Catégories dynamiques** : l'étape 4 voit une fenêtre glissante de 30 jours et la liste des
catégories existantes (stockée en base). Elle réutilise une catégorie existante et n'en crée
une que si aucune ne convient. Les items passés ne sont pas reclassés, sauf par une consolidation
manuelle occasionnelle. Liste de départ indicative, à ne pas figer : SSM / Mamba, MoE,
diffusion LM, raisonnement et test-time compute, agents et outils, mémoire et long contexte,
RAG et graphes de connaissances, benchmarks et évaluation. Les LSTM / RNN et les
encodeur-décodeur ne sont plus des catégories par défaut.

### 5.2 `web` : webapp

- React, hébergé sur GitHub Pages, lecture seule.
- Catalogue de 30 jours d'items, avec recherche, filtres par catégorie dynamique et par type,
  et tri (tendance Hugging Face pour les papiers, date pour les actualités). Tout est côté client.
- Lit `catalogue.json` sur la même origine Pages.
- **Thème** : Papier en mode clair, Nuit en mode sombre, selon `prefers-color-scheme` uniquement.
  Pas de sélecteur manuel. Maquettes de référence : `1-papier` et `4-nuit`.
- Aucun formulaire d'abonnement : l'auteur ajoute les abonnés lui-même (section 5.3).

### 5.3 Abonnés

- La liste utilisée par les workflows est dans le secret `SUBSCRIBERS` (adresses séparées par
  des virgules). Un secret GitHub est en écriture seule : il ne peut pas être relu.
- **Source de vérité locale** : un fichier `subscribers.txt` (une adresse par ligne), dans le
  `.gitignore`, jamais commité. L'auteur en garde aussi une copie dans son gestionnaire de mots
  de passe.
- **CLI dans le repo** (sans aucune adresse réelle) : `make subs-add EMAIL=...`,
  `make subs-remove EMAIL=...`, `make subs-list`, `make subs-push`
  (`gh secret set SUBSCRIBERS < subscribers.txt`, en vérifiant que `gh` est connecté au bon
  compte GitHub, le compte personnel).
- Inscription : l'ami demande à l'auteur, qui lance `subs-add` puis `subs-push`.
  Pas de double opt-in : seuls des amis consentants sont ajoutés à la main.
- Désinscription : chaque e-mail contient un lien `mailto:` vers l'auteur, qui lance
  `subs-remove` puis `subs-push`.
- La newsletter envoie **un e-mail par abonné** (jamais une liste dans le champ « À »).
- Dans les logs, chaque adresse est masquée (`::add-mask::`) et la liste n'est jamais affichée.

### 5.4 `services/newsletter` : e-mail hebdomadaire

Job hebdomadaire. Il prend les 8 meilleurs items de la semaine par score parmi les items déjà
classés, rend un template Jinja2 (HTML + version texte) et envoie via SMTP aux abonnés.
Pas d'appel LLM : les hooks viennent de `core`. S'il y a moins de 3 items, il n'envoie rien et
le workflow échoue pour que GitHub prévienne l'auteur par e-mail. L'envoi est idempotent : le
marqueur « semaine X envoyée » est dans `veille.db`, donc une relance ne renvoie rien.

### 5.5 Harnais de développement

À mettre en place **avant** le code produit :
- `.claude/CLAUDE.md` avec les règles du repo, plus quelques skills de développement
  (2 ou 3 skills publics populaires, choisis après recherche).
- `pre-commit` (ruff, formatage, vérifications de base), stop hook qui lance les tests et le
  lint avant la fin d'une session.
- Tests unitaires, avec simulation des sources distantes, du LLM et du SMTP.

## 6. Décisions déjà prises par l'auteur

- Remote : `git@github.com-personal:benjamin-callonnec/veille-llm.git` (alias SSH personnel).
- Thème : Papier et Nuit, selon le système.
- Newsletter identique pour tous, en Jinja2.
- LLM : l'abonnement Claude (option 3) ; passage futur à une clé API si le projet grandit.
- Orchestration : Claude Agent SDK + orchestrateur maison.
- Coût nul : GitHub Pages et GitHub Actions comme scheduler, SQLite, secrets dans GitHub Secrets.

## 7. Laissé au constructeur

- Choix du client RSS/HTTP et de la bibliothèque de retry.
- Format exact de `catalogue.json` et schéma SQLite.
- Choix du bundler React et des tests front.
- Détails du template d'e-mail.
- Nom et nombre des catégories dynamiques, sous réserve de la section 5.1.

## 8. Ordre de livraison

1. Harnais de développement (`.claude/`, pre-commit, stop hook, premier push).
2. Spike LLM (fait, GO : voir `docs/superpowers/specs/2026-11-21-spike-llm-result.md`) : vérifier que le Claude Agent SDK tourne en headless dans GitHub Actions avec
   `CLAUDE_CODE_OAUTH_TOKEN`. Condition d'arrêt : toute erreur de limite ou d'authentification
   fait sortir le job en erreur, résultats déjà enregistrés conservés, sans bascule payante.
   Budget visé : quelques dizaines d'appels par jour (environ 400 papiers filtrés en
   déterministe jusqu'à 60 à 100 candidats, lots de 15).
3. `core` (pipeline, résilience, reprise après arrêt, persistance sur la branche `data`).
4. `web` (catalogue et filtres sur les données de `core`, déploiement Pages).
5. `services/newsletter` (template, SMTP, idempotence).

## 9. Évolution

Si le projet prend de l'ampleur (plus d'utilisateurs que l'auteur et quelques proches) :
passer à une clé API Anthropic en changeant uniquement le secret d'authentification,
ajouter un vrai service d'abonnement (formulaire, double opt-in), puis réévaluer Google ADK
si les workflows se complexifient.

### Migration prévue : GitHub Pages vers un serveur nginx

L'auteur prévoit de prendre un serveur cloud peu cher plus tard. Ce n'est pas dans le périmètre
actuel, mais on prépare le terrain pour que la migration soit un changement d'adaptateurs et
pas une réécriture :

- Cible : webapp React servie par nginx, plus un service FastAPI (`services/api`) avec
  `POST /subscribe`, `GET /confirm`, `GET|POST /unsubscribe`, double opt-in et jetons signés,
  qui remplace la gestion à la main des abonnés (section 5.3). SQLite peut rester la base
  (table `subscribers` sur le serveur), donc pas de service de base de données à ajouter.
- Le pipeline et la newsletter pourraient alors tourner sur le serveur (cron) au lieu de
  GitHub Actions, ou rester sur Actions en écrivant sur le serveur. À trancher à ce moment-là.
- **Dès maintenant, dans le code :**
  - Les abonnés sont lus derrière une petite interface (`SubscriberStore`) : implémentation
    « secret GitHub » aujourd'hui, implémentation « SQLite » demain.
  - Le front lit `catalogue.json` depuis une URL de base configurable, pas codée en dur.
  - La persistance de `veille.db` est isolée derrière une interface (branche `data`
    aujourd'hui, disque du serveur demain).

## 10. Choix du rédacteur (à relire)

Ces points ont été tranchés par le rédacteur. Ce ne sont pas des décisions de l'auteur.

- Branche `data` orpheline réécrite à chaque exécution, pour éviter que le dépôt grossisse.
- Un groupe `concurrency` partagé entre les deux workflows.
- Le fichier `veille.db` est poussé même si l'exécution échoue.
- Liste des abonnés dans un secret plutôt que dans un fichier, car le repo est public.
- Le catalogue ne garde que 30 jours d'items.
- Seuils de la newsletter : 8 items maximum, 3 minimum.
- Le code v0 est repris dans `core` et `web`, puis remplacé.
