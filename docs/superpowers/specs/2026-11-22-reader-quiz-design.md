# Paper reader: understanding checks, quizzes (#25)

Part of #17, after the harness (#23). Local only, zero cost beyond the Claude subscription. Written and
built without the author: every decision below is a **ruling** of mine, to review.

## Intent
Let the tutor check that the user understood: a short quiz on the paper or on the part just discussed,
with feedback that explains mistakes and cites the paper, and a local score and memory of weak points.

## Goals
- A quiz card in the chat: one question, four options (one right) or a free answer.
- The right answer, the explanation and the quote stay on the server until the user has answered.
- Questions are grounded (page and exact quote, checked against the paper) and validated.
- Free answers are graded by a second model call that shows its reasoning.
- Scores per paper and per session, a simple history, weak points written to the session memory.

## Out of scope
- Spaced repetition (later). Quiz generation by the agent through a tool (see rulings).
- Editing or deleting quizzes; exporting scores.

## Rulings
1. **Generation is a tool-free structured call**, not the chat agent. An injectable `QuizMaker`
   (`quiz_agent.sdk_quiz_maker`: no tool, one turn, JSON in the reply) receives the paper pages as `<data>`,
   the focus, the recent turns and the questions already asked. Tests use a fake.
2. **The reply is untrusted JSON** and is validated by `quiz.validate_quiz` before anything is stored or
   shown: kind, bounded text sizes, no control character, no markup (`<`, `>`, backtick, `[x](y)`,
   `**`), four distinct options and exactly one correct index for a choice quiz, a reference answer for a
   free quiz, no "the answer is" phrasing, and no correct option (or reference) repeated in the question.
   Two attempts, then a clear error; nothing is stored for a failed one.
3. **Grounding** reuses `citations.verify_citations`: the quote must be on the page named, or is moved to the
   page where it is found; otherwise the quiz is refused. The section comes from the same check.
4. **The key is server side.** Table `quizzes` keeps the full spec as JSON; the chat message (role `system`,
   kind `quiz`, so it never enters the tutor's prompt, regenerate or compaction) holds only
   `{quiz_id, kind, question, options}`. `GET .../messages` merges the result into the card only once
   the quiz is answered. Listing and history routes never carry the key.
5. **Routes**: `POST /api/items/<id>/conversations/<cid>/quizzes` {kind, focus} makes a card;
   `POST /api/items/<id>/quizzes/<qid>/answer` {choice | text} returns `{correct, explanation, quote, page,
   section, score, ...}`; `GET /api/items/<id>/quizzes[?conversation=]` gives the history and the scores;
   `GET .../quizzes/<qid>` the public view. Same loopback and cross-site guards; one answer per quiz (409).
6. **Starting a quiz**: the quiet "Quiz me" icon next to the compose icon, or the user asks. For a typed
   request or an offer the user accepts, the tutor ends its answer with `[[quiz: topic]]` (a line added
   to the prompt by the separate `QUIZ_PROMPT`); the server sees it after the answer is stored and adds the
   card, the web hides the marker. This keeps the tutor away from the answers (it never writes the key)
   and adds no SDK tool. A failed quiz leaves a plain assistant message, never a broken card.
7. **Free answers** go to an injectable `Grader` (no tool, one turn) that gets the question, the reference
   answer, the quote, the page text and the user's answer as `<data>` (the answer is escaped and may try to
   instruct it) and returns `{correct, reasoning}`, validated like a quiz. If grading fails the answer is
   not recorded and the user can try again.
8. **Storage**: migration adds `quizzes` and `quiz_answers` (timestamp, answer, correct flag, reasoning).
   Quizzes keep their conversation id without a foreign key: deleting a conversation keeps the paper's
   score. Session score = answers of the conversation.
9. **Weak points**: a wrong answer adds a tutor note `Quiz: got wrong on <topic> (p.N). <explanation>`
   (500 characters at most, once per topic, skipped when the 30 notes are full). The tutor already reads
   the notes, so it revisits them.
10. **Front**: `QuizCard` in the chat feed (options as quiet rows, check icon to answer, the right option
    marked, explanation with a citation chip using `onCite`, a score line such as "3/5 on this paper").
    Everything from the server is rendered as text, never as HTML.

## Formats
The author found the send-style icon on the card confusing and asked for faster answers and more formats.
Rulings (all validated on the server, the key hidden until the answer, closed kinds graded without the model):
11. **Kinds**: `choice` (4 options, one right: a click answers, no validate button), `multi` (4 to 5 options,
    one or more right, never all: tick boxes, a right-arrow icon appears once one is ticked, all-or-nothing,
    feedback marks each option right, wrong or missed), `truefalse` (a statement, options True and False, a click
    answers), `cloze` (a sentence of the paper with one or two `___`, the user types the words), `order` (3 to 5
    steps shown shuffled, never in the right order; up and down icons; exact order), `free` (graded by the model).
    `matching` is skipped.
12. **Answer bodies**: `{choice}`, `{choices: [..]}`, `{words: [..]}`, `{order: [..]}` (positions in the list
    shown), `{text}`. Exactly one field, matching the kind, otherwise 422 `bad_answer`.
13. **Cloze grading** folds case, accents, punctuation and spacing; each blank has the right word first and up to
    three accepted variants, all in the key. The question keeps `___` (the markup check hides them first).
14. **Order**: the shuffle is made once at validation and stored, so every fetch shows the same list; the result
    carries the steps in the right order.
15. **Kind on request**: `start_quiz` takes `kind` ("any" by default). On "any" the maker picks what suits the
    content; on a named kind a different kind made is refused (retried). The "Quiz me" icon and the tutor marker
    use "any".
16. **Errors on the card**: 409 refetches the quiz and shows its result (answered in another tab), 422, 502 and
    503 have their own short message, a network error a generic one. The card and `quizApi` refuse an empty
    paper id with a clear message, and a double click answers once.
17. **Icons**: new `arrow-right` (validate), `arrow-up`, `arrow-down`; `send` stays the composer's.
18. **Maker prompt**: explanations must avoid `<` and `>` (the model wrote "n < d"), and a quote copied across a
    line break has its whitespace collapsed before validation.

## Not verified / limits
- Real maker run (1706.03762, subscription): every kind was made and answered. Over 4 tries per kind, only
  multi failed validation (2 of 4, `<` in an explanation, fixed in the prompt; 1 later quote with a newline,
  fixed). Whether the tutor reliably writes the marker still needs a live try. Drag to reorder is not built.
- The score history has routes but no screen yet.
