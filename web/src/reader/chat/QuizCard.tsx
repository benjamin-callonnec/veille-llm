import { type ReactNode, useRef, useState } from "react";
import { Icon, IconButton } from "../../components/Icon";
import { type QuizContent, type QuizResult, scoreLine, toQuiz } from "../lib/quiz";
import { type AnswerBody, httpQuizApi, type QuizApi, QuizApiError } from "./quizApi";

interface Props {
  itemId: string;
  /** The stored message content: only a well-formed quiz is shown. */
  content: unknown;
  api?: QuizApi;
  /** A citation chip: go to the page and flash the quote. */
  onCite?(page: number, quote?: string): void;
}

const LETTERS = "ABCDE";
const BLANK = "___";

/** What the user reads when an answer could not be checked, by what the server said. */
export function failureMessage(error: unknown): string {
  if (error instanceof QuizApiError) {
    if (error.status === 422) return "That answer was not accepted. Check it and try again.";
    if (error.status === 502) return "The grader could not check this answer. Try again.";
    if (error.status === 503) return "Grading is not available right now.";
    return "Could not check your answer. Try again.";
  }
  if (error instanceof Error && error.message.startsWith("a quiz needs")) {
    return "This quiz is not attached to a paper, so it cannot be checked.";
  }
  return "Could not check your answer. Try again.";
}

/** One understanding check: the answer and its explanation only appear once the user has replied. */
export function QuizCard({ content, ...rest }: Props) {
  const quiz = toQuiz(content);
  return quiz ? <Card quiz={quiz} {...rest} /> : null;
}

/** What each kind of quiz shows and asks: it calls `send` with the answer body. */
interface KindProps {
  quiz: QuizContent;
  result: QuizResult | undefined;
  busy: boolean;
  send(body: AnswerBody): void;
}

function Card({
  itemId,
  quiz,
  api = httpQuizApi,
  onCite,
}: Omit<Props, "content"> & { quiz: QuizContent }) {
  const [result, setResult] = useState<QuizResult | undefined>(quiz.result);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const sending = useRef(false);

  async function send(body: AnswerBody) {
    if (sending.current || result) return;
    sending.current = true; // a double click must not answer twice
    setBusy(true);
    setFailure("");
    try {
      if (!itemId) throw new Error("a quiz needs the id of its paper");
      setResult(await api.answer(itemId, quiz.quiz_id, body));
    } catch (error) {
      if (error instanceof QuizApiError && error.status === 409) {
        // already answered, maybe in another tab: show what the server has
        const known = await api.get(itemId, quiz.quiz_id).catch(() => null);
        if (known?.result) setResult(known.result);
        else setFailure(failureMessage(error));
      } else {
        setFailure(failureMessage(error));
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const props: KindProps = { quiz, result, busy, send };
  let body: ReactNode;
  if (quiz.kind === "choice" || quiz.kind === "truefalse") body = <ChoiceKind {...props} />;
  else if (quiz.kind === "multi") body = <MultiKind {...props} />;
  else if (quiz.kind === "cloze") body = <ClozeKind {...props} />;
  else if (quiz.kind === "order") body = <OrderKind {...props} />;
  else body = <FreeKind {...props} />;

  return (
    <div className="turn turn-assistant">
      <section className="quiz" aria-label="Quiz">
        {quiz.kind !== "cloze" && <p className="quiz-question">{quiz.question}</p>}
        {body}
        {failure && (
          <p role="alert" className="chat-error">
            {failure}
          </p>
        )}
        {result && <Feedback quiz={quiz} result={result} onCite={onCite} />}
      </section>
    </div>
  );
}

function Check({ onClick, disabled }: { onClick(): void; disabled?: boolean }) {
  return (
    <div className="quiz-actions">
      <IconButton icon="arrow-right" label="Check answer" disabled={disabled} onClick={onClick} />
    </div>
  );
}

/** One right option, a click answers: no button to validate. */
function ChoiceKind({ quiz, result, busy, send }: KindProps) {
  const [picked, setPicked] = useState<number | null>(null);
  const plain = quiz.kind === "truefalse";
  return (
    <ul className={plain ? "quiz-options quiz-tf" : "quiz-options"}>
      {quiz.options.map((option, i) => {
        const right = result?.correct_choice === i;
        const wrong = result !== undefined && result.choice === i && !result.correct;
        const state = right ? " quiz-right" : wrong ? " quiz-wrong" : "";
        const waiting = busy && picked === i ? " quiz-busy" : "";
        return (
          <li key={option}>
            <button
              type="button"
              className={`quiz-option${state}${waiting}`}
              aria-busy={busy && picked === i}
              disabled={result !== undefined || busy}
              onClick={() => {
                setPicked(i);
                send({ choice: i });
              }}
            >
              {!plain && <span className="quiz-letter">{LETTERS[i]}</span>}
              <span>{option}</span>
              {right && <Icon name="check" size={16} />}
              {right && <span className="sr-only">Correct answer</span>}
              {wrong && <span className="sr-only">Your answer, not correct</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Several right options: tick them, then validate with the arrow (it appears once one is ticked). */
function MultiKind({ quiz, result, busy, send }: KindProps) {
  const [ticked, setTicked] = useState<number[]>([]);
  const shown = result?.choices ?? ticked;
  const right = result?.correct_choices ?? [];
  function toggle(i: number) {
    setTicked((t) => (t.includes(i) ? t.filter((n) => n !== i) : [...t, i].sort()));
  }
  return (
    <>
      <p className="quiz-hint muted">Select all that apply.</p>
      <ul className="quiz-options">
        {quiz.options.map((option, i) => {
          const on = shown.includes(i);
          const should = right.includes(i);
          const mark = !result ? "" : on && should ? "ok" : on ? "wrong" : should ? "missed" : "";
          return (
            <li key={option}>
              <label className={`quiz-option quiz-check${mark ? ` quiz-${mark}` : ""}`}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  disabled={result !== undefined || busy}
                  onChange={() => toggle(i)}
                />
                <span className={on ? "quiz-box quiz-box-on" : "quiz-box"} aria-hidden="true">
                  {(on || mark === "missed") && <Icon name="check" size={12} />}
                </span>
                <span>{option}</span>
                {mark === "ok" && <span className="sr-only">Right, and you ticked it</span>}
                {mark === "wrong" && <span className="sr-only">Not right, you ticked it</span>}
                {mark === "missed" && <span className="sr-only">Right, you missed it</span>}
              </label>
            </li>
          );
        })}
      </ul>
      {!result && ticked.length > 0 && (
        <Check disabled={busy} onClick={() => send({ choices: ticked })} />
      )}
    </>
  );
}

/** A sentence of the paper with blanks to type in. */
function ClozeKind({ quiz, result, busy, send }: KindProps) {
  const [words, setWords] = useState<string[]>(() => Array(quiz.blanks).fill(""));
  const parts = quiz.question.split(BLANK);
  const ready = words.every((w) => w.trim().length > 0);
  const submit = () => {
    if (ready && !busy) send({ words: words.map((w) => w.trim()) });
  };
  return (
    <>
      <p className="quiz-question quiz-cloze">
        {parts.map((part, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a sentence have no id
          <span key={i}>
            {part}
            {i < parts.length - 1 &&
              (result ? (
                <span className={result.blank_ok?.[i] ? "quiz-word quiz-yes" : "quiz-word quiz-no"}>
                  {result.words?.[i]}
                </span>
              ) : (
                <input
                  className="quiz-blank"
                  aria-label={`Blank ${i + 1}`}
                  maxLength={100}
                  value={words[i]}
                  disabled={busy}
                  onChange={(e) => setWords(words.map((w, j) => (j === i ? e.target.value : w)))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                  }}
                />
              ))}
          </span>
        ))}
      </p>
      {!result && <Check disabled={!ready || busy} onClick={submit} />}
    </>
  );
}

/** Steps to put in order with the up and down icons. */
function OrderKind({ quiz, result, busy, send }: KindProps) {
  const [order, setOrder] = useState<number[]>(() => quiz.items.map((_, i) => i));
  const given = result?.order ?? order;
  const steps = result?.steps ?? [];
  function move(at: number, by: number) {
    const to = at + by;
    if (to < 0 || to >= order.length) return;
    const here = order[at];
    const there = order[to];
    if (here === undefined || there === undefined) return;
    setOrder(order.map((n, i) => (i === at ? there : i === to ? here : n)));
  }
  return (
    <>
      <ol className="quiz-steps">
        {given.map((index, at) => {
          const text = quiz.items[index];
          const ok = result !== undefined && steps[at] === text;
          const state = result ? (ok ? " quiz-right" : " quiz-wrong") : "";
          return (
            <li key={text} className={`quiz-step${state}`}>
              <span className="quiz-letter">{at + 1}</span>
              <span className="quiz-step-text">{text}</span>
              {!result && (
                <span className="quiz-move">
                  <IconButton
                    icon="arrow-up"
                    label={`Move up: ${text}`}
                    disabled={busy || at === 0}
                    size={14}
                    onClick={() => move(at, -1)}
                  />
                  <IconButton
                    icon="arrow-down"
                    label={`Move down: ${text}`}
                    disabled={busy || at === given.length - 1}
                    size={14}
                    onClick={() => move(at, 1)}
                  />
                </span>
              )}
              {ok && <Icon name="check" size={16} />}
              {result && <span className="sr-only">{ok ? "In place" : "Out of place"}</span>}
            </li>
          );
        })}
      </ol>
      {result && !result.correct && (
        <>
          <p className="muted">Right order:</p>
          <ol className="quiz-steps quiz-steps-key">
            {steps.map((text, at) => (
              <li key={text} className="quiz-step">
                <span className="quiz-letter">{at + 1}</span>
                <span className="quiz-step-text">{text}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      {!result && <Check disabled={busy} onClick={() => send({ order })} />}
    </>
  );
}

function FreeKind({ result, busy, send }: KindProps) {
  const [text, setText] = useState("");
  if (result) return <p className="quiz-given">{result.answer}</p>;
  return (
    <>
      <textarea
        className="quiz-free"
        aria-label="Your answer"
        rows={3}
        maxLength={1500}
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
      />
      <Check disabled={!text.trim() || busy} onClick={() => send({ text: text.trim() })} />
    </>
  );
}

function Feedback({
  quiz,
  result,
  onCite,
}: {
  quiz: QuizContent;
  result: QuizResult;
  onCite: Props["onCite"];
}) {
  return (
    <div className="quiz-feedback" aria-live="polite">
      <p className={result.correct ? "quiz-verdict quiz-yes" : "quiz-verdict quiz-no"}>
        {result.correct ? "Correct" : "Not quite"}
      </p>
      {result.reasoning && <p>{result.reasoning}</p>}
      <p>{result.explanation}</p>
      {quiz.kind === "free" && result.reference && (
        <p className="muted">Model answer: {result.reference}</p>
      )}
      {quiz.kind === "cloze" && !result.correct && result.answers && (
        <p className="muted">Expected: {result.answers.join(", ")}</p>
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
  );
}
