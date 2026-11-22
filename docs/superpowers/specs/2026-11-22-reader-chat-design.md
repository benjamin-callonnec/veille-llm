# Lecteur de papiers : cœur du chat (#22)

Partie de #17, après #20 (fondations) et #21 (visionneuse). Local uniquement, coût zéro hors abonnement.

## Intention
Un vrai chat dans le panneau de droite : réponses en streaming, composant « thinking », messages typés,
conversations par papier. L'agent est simple ici (pas d'outils : ils viennent avec #23).

## Validé par l'auteur (maquettes)
- Style **A** : tes messages en bulle, les réponses de l'agent en texte pleine largeur, sobre et léger.
- Liste des conversations : **menu déroulant** dans l'en-tête du chat (nouvelle, renommer, supprimer,
  exporter en Markdown).
- **Thinking** : sans contour, fond transparent, très discret : le mot « Thinking » (puis « Thought for
  Ns ») et une flèche qui montre qu'on peut plier. Ouvert pendant le travail (outils avec leurs entrées,
  tokens de raisonnement), il se plie tout seul quand la réponse finale commence et peut être rouvert à
  tout moment, y compris depuis l'historique.

## Objectifs
- Streaming token par token, arrêt et régénération.
- Messages typés : texte, `ask_agent` (citation, page, lien « ↗ » vers le PDF), `ask_user` (réservé : composant
  affiché, outil dans #23), activité d'outil (dans « thinking »), pastille de citation `[p.N]` qui fait défiler le PDF.
- Conversations par papier : liste, renommer, supprimer, exporter, historique local.
- Markdown et formules, boutons de copie, blocs de code. Rendu sûr : tout texte du modèle et du papier est
  échappé, liens http(s) seulement.
- Premier appel réel à l'Agent SDK (abonnement, sans clé d'API, sans outil).

## Hors périmètre et anti-objectifs
- Pas d'outils, de mémoire, de compaction ni de limiteurs (#23) ; pas d'images ni de prompts suggérés (#24) ;
  pas de quiz (#25) ; pas de voix (#26).
- Sans outils, l'agent ne voit pas le texte complet du papier : il reçoit le titre, l'accroche, le résumé du
  catalogue et la citation sélectionnée, et doit dire quand il ne peut pas répondre. Le texte intégral arrive
  avec #23.
- Aucune bascule payante : la clé `ANTHROPIC_API_KEY` est refusée comme dans le pipeline.

## Approches (transport du streaming)
- **A. Flux SSE sur une requête POST** (choisi) : `POST /api/conversations/{id}/messages` répond en
  `text/event-stream` ; l'arrêt est l'annulation de la requête côté navigateur, que le serveur transmet à
  l'Agent SDK. Simple, testable avec un faux exécuteur, sans état de connexion.
- B. WebSocket : plus riche (utile pour la voix, #26) mais plus d'états à gérer ; on l'ajoutera pour la voix.

## Conception (mes choix, à corriger)
- **Événements** (une ligne JSON par événement SSE) : `thinking_delta {text}`, `tool_use {id, name, input}`,
  `tool_result {id, summary, is_error}`, `text_delta {text}`, `done {duration_ms}`, `error {kind, message}` avec
  `kind` = `limit` (limite d'abonnement) ou `failed`.
- **Exécuteur** : interface `AgentRunner` (asynchrone, produit des événements). Réalisation sur l'Agent SDK
  (`query`, sans outil, messages partiels activés, raisonnement activé) et faux exécuteur pour les tests.
  Les erreurs de limite utilisent les types déjà définis dans `veille_llm.llm`.
- **Texte du papier = donnée** : titre, résumé et citation dans un bloc `<data>` échappé, jamais en
  instruction (même règle que le pipeline).
- **Stockage** : migration 3 : `conversations(id, item_id, title, created_at, updated_at)` et
  `messages(id, conversation_id, seq, role, kind, content JSON, created_at)`. Le message de l'agent est
  enregistré à la fin du flux (ou à l'arrêt, marqué `stopped`), avec ses blocs : raisonnement, outils, réponse,
  durée.
- **API** : liste, création, renommage, suppression et export Markdown des conversations d'un item ; lecture
  des messages ; envoi d'un message (SSE) ; régénération = renvoi du dernier message utilisateur en
  remplaçant la dernière réponse. Mêmes protections que l'existant (hôte local, même origine).
- **Front** : `ChatPane` remplace `QuestionList` ; `Thinking`, `AssistantMessage`, `UserMessage`, `Composer`
  (zone de saisie simple, multiligne ; images en #24), `ConversationMenu` ; machine d'états pure pour le
  repli automatique de « thinking » (ouvert tant qu'aucun `text_delta`, replié au premier, rouvrable).
  Une question posée depuis la boîte de sélection devient un message `ask_agent`.
- **Markdown** : `react-markdown` (HTML brut ignoré), `remark-gfm`, `remark-math` + `rehype-katex`, versions
  épinglées, chargées seulement dans le build du lecteur ; liens limités à http(s) ; `[p.N]` transformé en pastille.

## Tests
Machine d'états de « thinking », assemblage du flux et annulation, rendu de chaque type de message, échappement
(HTML, `javascript:`), historique conservé, export, migration 3, SSE avec faux exécuteur (ordre des événements,
erreur de limite, arrêt en cours de flux), construction du prompt (bloc `<data>`, tentative d'injection dans le
résumé ou la citation), garde contre la clé d'API. Agent SDK simulé dans les tests ; un essai réel est noté comme tel.

## Laissé au constructeur
Libellés, animations, raccourcis du composeur, forme exacte des erreurs.
