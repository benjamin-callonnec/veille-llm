import { useState } from "react";
import { Icon, IconButton } from "../../components/Icon";
import { type QuizContent, type QuizResult, scoreLine, toQuiz } from "../lib/quiz";
import { httpQuizApi, type QuizApi } from "./quizApi";

interface Props {
  itemId: string;
  /** The stored message content: only a well-formed quiz is shown. */
  content: unknown;
  api?: QuizApi;
  /** A citation chip: go to the page and flash the quote. */
  onCite?(page: number, quote?: string): void;
}

const LETTERS = "ABCD";

/** One understanding check: the answer and its explanation only appear once the user has replied. */
export function QuizCard({ content, ...rest }: Props) {
  const quiz = toQuiz(content);
  return quiz ? <Card quiz={quiz} {...rest} /> : null;
}

function Card({
  itemId,
  quiz,
  api = httpQuizApi,
  onCite,
}: Omit<Props, "content"> & { quiz: QuizContent }) {
  const [result, setResult] = useState<QuizResult | undefined>(quiz.result);
  const [picked, setPicked] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const ready = quiz.kind === "choice" ? picked !== null : text.trim().length > 0;

  async function submit() {
    if (!ready || busy || result) return;
    setBusy(true);
    setFailed(false);
    try {
      const body = quiz.kind === "choice" ? { choice: picked ?? 0 } : { text: text.trim() };
      setResult(await api.answer(itemId, quiz.quiz_id, body));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="turn turn-assistant">
      <section className="quiz" aria-label="Quiz">
        <p className="quiz-question">{quiz.question}</p>
        {quiz.kind === "choice" ? (
          <ul className="quiz-options">
            {quiz.options.map((option, i) => {
              const right = result?.correct_choice === i;
              const wrong = result !== undefined && result.choice === i && !result.correct;
              const state = right ? " quiz-right" : wrong ? " quiz-wrong" : "";
              return (
                <li key={option}>
                  <button
                    type="button"
                    className={`quiz-option${picked === i && !result ? " quiz-picked" : ""}${state}`}
                    aria-pressed={picked === i}
                    disabled={result !== undefined || busy}
                    onClick={() => setPicked(i)}
                  >
                    <span className="quiz-letter">{LETTERS[i]}</span>
                    <span>{option}</span>
                    {right && <Icon name="check" size={16} />}
                    {right && <span className="sr-only">Correct answer</span>}
                    {wrong && <span className="sr-only">Your answer, not correct</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : result ? (
          <p className="quiz-given">{result.answer}</p>
        ) : (
          <textarea
            className="quiz-free"
            aria-label="Your answer"
            rows={3}
            maxLength={1500}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
          />
        )}
        {!result && (
          <div className="quiz-actions">
            <IconButton
              icon="send"
              label="Check answer"
              disabled={!ready || busy}
              onClick={submit}
            />
          </div>
        )}
        {failed && (
          <p role="alert" className="chat-error">
            Could not check your answer. Try again.
          </p>
        )}
        {result && (
          <div className="quiz-feedback" aria-live="polite">
            <p className={result.correct ? "quiz-verdict quiz-yes" : "quiz-verdict quiz-no"}>
              {result.correct ? "Correct" : "Not quite"}
            </p>
            {result.reasoning && <p>{result.reasoning}</p>}
            <p>{result.explanation}</p>
            {quiz.kind === "free" && result.reference && (
              <p className="muted">Model answer: {result.reference}</p>
            )}
            <p className="quiz-source">
              <button
                type="button"
                className="cite"
                title={`p.${result.page}${result.section ? ` · ${result.section}` : ""} · “${result.quote}”`}
                onClick={() => onCite?.(result.page, result.quote)}
              >
                p.{result.page}
              </button>
              {result.section && <span className="muted">{result.section}</span>}
            </p>
            <p className="quiz-score muted">{scoreLine(result.score)}</p>
          </div>
        )}
      </section>
    </div>
  );
}
