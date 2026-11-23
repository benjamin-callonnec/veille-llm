# Lecteur de papiers : harnais de l'agent (#23)

Partie de #17, après #20 à #22 (v0.11.0). Local uniquement, coût zéro hors abonnement. Cette conception a
été écrite et exécutée sans l'auteur (absent) : chaque décision ci-dessous est un **ruling** de ma part,
à relire.

## Intention
Donner au tuteur de quoi lire le papier en entier sans le coller dans le prompt : des outils locaux en
lecture seule, une mémoire de session, une compaction du contexte, des limiteurs et une trace. Le harnais
possède la boucle, les limites, le registre d'outils et le contexte ; l'agent reste simple et remplaçable.

## Objectifs
- Outils : `load_artifact` (pages, section, références, figure, tableau, surlignages), `search_paper`,
  `session_memory` (lire, écrire, effacer de courtes notes).
- Le texte du papier et les résultats d'outils sont toujours des **données** (bloc `<data>` échappé).
- Mémoire de session visible, modifiable et supprimable par l'utilisateur (API ; l'interface vient après).
- Compaction : résumer les vieux tours quand le contexte grossit, garder des faits épinglés (les notes de
  mémoire), afficher qu'elle a eu lieu.
- Limiteurs : outils (appels par tour et par outil, délai) et agent (tours, budget par message et par
  session), message clair à la limite, dépassement possible une fois sur demande.
- Trace locale de chaque tour (outils, jetons, durée, coût).
- Tests avec un faux exécuteur : fin de boucle, chaque limiteur, compaction qui garde les faits, erreurs
  d'outils affichées sans être fatales, injections dans le texte du PDF.

## Hors périmètre et anti-objectifs
- **`ask_user`** (l'agent pose une question et attend) : il demande une carte de message et un protocole de
  pause, donc de l'interface à valider par l'auteur. Reporté à une issue de suite.
- Pas d'interface pour la mémoire, le dépassement de limite ni la trace (API seulement) : l'auteur valide
  l'interface avant (comme #21, #22, #27).
- Aucun outil d'écriture, de shell, de réseau ni de fichier hors du papier. Pas de sous-agents.
- Aucune bascule payante : la garde contre les variables de facturation reste.

## Approches
- **A. Outils internes du SDK** (`tool` + `create_sdk_mcp_server`, outils natifs désactivés) (choisie) : le
  SDK possède la boucle, nos fonctions Python répondent ; limites de tours et de budget fournies par le SDK
  (`max_turns`, `max_budget_usd`), limiteurs d'outils chez nous.
- B. Boucle écrite à la main avec un modèle sans outils : contrôle total mais on réécrit ce que fait le SDK.
  Écartée.

## Décisions (rulings)
- **Texte du papier** : extrait du PDF déjà en cache avec `pypdf` (Python pur), mis en cache dans SQLite
  (migration 4 : `paper_pages(item_id, page, text)`), extrait à la première utilisation. PDF sans texte
  (scan) : l'outil le dit, il ne devine pas.
- **Sections** : plan du PDF lu par `pypdf` ; une section va de sa page à la page de la section suivante.
  Sans plan : l'outil le dit et propose les pages. Références : dernières pages à partir d'un titre
  « References ». Figures et tableaux : légende `Figure N` ou `Table N` et les lignes autour.
- **Plafonds de sortie** : au plus 6 pages et 12 000 caractères par appel, 8 résultats de recherche.
- **Mémoire** : au plus 30 notes de 500 caractères par papier ; table `memory_notes`
  (migration 4) ; les notes sont toujours rappelées au prompt (faits épinglés).
- **Limiteurs par défaut** : 12 appels d'outils par tour dont 6 au plus par outil, 15 s par appel, 8 tours du
  SDK, 0,50 USD par message, 3,00 USD par session. À la limite d'outils, l'outil répond « limite atteinte »
  (affiché, non fatal). À la limite de session, le tour est refusé avec `error {kind: "limit"}` ; la requête
  accepte `raise_limit: true` une fois par conversation (double la limite).
- **Compaction** : au-delà de 20 000 caractères d'historique, tout sauf les 4 derniers tours est résumé par
  le SDK sans outil (modèle Haiku) ; le résumé est enregistré comme message `compaction` (rôle `system`) et
  remplace les anciens tours dans le prompt ; un événement `compaction` prévient l'interface.
- **Trace** : table `traces` (migration 4) : conversation, durée, appels d'outils (nom, durée, erreur),
  jetons, coût, modèle, arrêt ; route de lecture par conversation.

## Tests
Extraction et cache du texte (PDF réel minimal généré dans le test), chaque forme de `load_artifact`, recherche
(casse, plafond), mémoire (plafonds, effacement, portée par papier), limiteurs (par tour, par outil, délai,
session, dépassement une fois), enveloppe de données échappée (injection `</data>` dans le texte du PDF), prompt
d'outils, boucle avec faux `query` (outil appelé puis réponse, erreur d'outil non fatale), compaction (garde
les notes, ne coupe pas au milieu d'un tour), trace (outils, usage), routes de mémoire et de trace.

## Laissé au constructeur
Noms internes, forme exacte des messages d'erreur d'outils, tailles de découpe fines.
