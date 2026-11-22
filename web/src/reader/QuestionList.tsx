import type { Quote } from "./lib/quote";

export interface AskedQuestion {
  quote: Quote;
  question: string;
}

/** Placeholder for the chat pane (#22): lists the questions asked about passages. */
export function QuestionList({
  questions,
  onGo,
}: {
  questions: AskedQuestion[];
  onGo(page: number): void;
}) {
  if (!questions.length) {
    return <p className="muted chat-empty">Select a passage in the PDF to ask about it.</p>;
  }
  return (
    <ol className="questions">
      {questions.map((q, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the list only grows
        <li key={i}>
          <blockquote>
            <span>{q.quote.text}</span>
            <button
              type="button"
              aria-label={`Go to page ${q.quote.page}`}
              onClick={() => onGo(q.quote.page)}
            >
              p.{q.quote.page} ↗
            </button>
          </blockquote>
          <p>{q.question}</p>
        </li>
      ))}
    </ol>
  );
}
