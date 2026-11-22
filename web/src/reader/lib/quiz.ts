/** What the server may send about a quiz: the question and options, and the result once answered. */

export interface Score {
  total: number;
  correct: number;
}

export interface QuizScores {
  paper: Score;
  session: Score | null;
}

export interface QuizResult {
  correct: boolean;
  explanation: string;
  quote: string;
  page: number;
  section: string | null;
  score: QuizScores;
  /** Choice quiz: what was picked and what was right. */
  choice?: number;
  correct_choice?: number;
  /** Free quiz: the answer given, the model answer and the grader's reasoning. */
  answer?: string;
  reference?: string;
  reasoning?: string;
}

export interface QuizContent {
  quiz_id: number;
  kind: "choice" | "free";
  question: string;
  options: string[];
  result?: QuizResult;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function toScore(raw: unknown): Score | null {
  if (!isObj(raw) || !isNum(raw.total) || !isNum(raw.correct)) return null;
  return { total: raw.total, correct: raw.correct };
}

export function toResult(raw: unknown): QuizResult | undefined {
  if (!isObj(raw) || typeof raw.correct !== "boolean") return undefined;
  if (!isStr(raw.explanation) || !isStr(raw.quote) || !isNum(raw.page)) return undefined;
  const paper = isObj(raw.score) ? toScore(raw.score.paper) : null;
  if (!paper) return undefined;
  const result: QuizResult = {
    correct: raw.correct,
    explanation: raw.explanation,
    quote: raw.quote,
    page: raw.page,
    section: isStr(raw.section) ? raw.section : null,
    score: { paper, session: isObj(raw.score) ? toScore(raw.score.session) : null },
  };
  if (isNum(raw.choice)) result.choice = raw.choice;
  if (isNum(raw.correct_choice)) result.correct_choice = raw.correct_choice;
  if (isStr(raw.answer)) result.answer = raw.answer;
  if (isStr(raw.reference)) result.reference = raw.reference;
  if (isStr(raw.reasoning)) result.reasoning = raw.reasoning;
  return result;
}

/** A quiz message of the server, or null when it is not well formed. */
export function toQuiz(raw: unknown): QuizContent | null {
  if (!isObj(raw) || !isNum(raw.quiz_id) || !isStr(raw.question)) return null;
  if (raw.kind !== "choice" && raw.kind !== "free") return null;
  const options = Array.isArray(raw.options) ? raw.options.filter(isStr) : [];
  if (raw.kind === "choice" && options.length < 2) return null;
  return {
    quiz_id: raw.quiz_id,
    kind: raw.kind,
    question: raw.question,
    options: raw.kind === "choice" ? options : [],
    result: toResult(raw.result),
  };
}

// the tutor ends an answer with [[quiz: topic]] to start a quiz; it is not for the reader
const MARKER = /\s*\[\[quiz:[^\]\n]*\]\]/g;
const OPEN_MARKER = /\s*\[\[?(q(u(i(z(:[^\]\n]*)?)?)?)?)?\]?$/;

/** The answer without the quiz marker (also a marker still being written at the end). */
export function stripQuizMarker(text: string): string {
  return text.replace(MARKER, "").replace(OPEN_MARKER, "");
}

export function scoreLine(score: QuizScores): string {
  const paper = `${score.paper.correct}/${score.paper.total} on this paper`;
  const s = score.session;
  return s && s.total !== score.paper.total
    ? `${paper} · ${s.correct}/${s.total} this session`
    : paper;
}
