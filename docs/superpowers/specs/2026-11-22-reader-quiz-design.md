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

## Not verified / limits
- The real model has not been called: makers and graders are faked in tests. Quality of generated
  questions, and whether the tutor reliably writes the marker, need a live try.
- The score history has routes but no screen yet.
