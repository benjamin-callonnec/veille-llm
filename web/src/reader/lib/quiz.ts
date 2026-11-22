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
  /** Choice and true/false: what was picked and what was right. */
  choice?: number;
  correct_choice?: number;
  /** Multiple answers: what was ticked and what was right. */
  choices?: number[];
  correct_choices?: number[];
  /** Fill in the blanks: the words given, the expected ones and which blanks were right. */
  words?: string[];
  answers?: string[];
  blank_ok?: boolean[];
  /** Ordering: the positions chosen (in the order shown) and the steps in the right order. */
  order?: number[];
  steps?: string[];
  /** Free quiz: the answer given, the model answer and the grader's reasoning. */
  answer?: string;
  reference?: string;
  reasoning?: string;
}

export type QuizKind = "choice" | "multi" | "truefalse" | "cloze" | "order" | "free";
const KINDS: readonly string[] = ["choice", "multi", "truefalse", "cloze", "order", "free"];

export interface QuizContent {
  quiz_id: number;
  kind: QuizKind;
  question: string;
  /** choice, multi, truefalse. */
  options: string[];
  /** cloze: how many blanks (___) the question has. */
  blanks: number;
  /** order: the steps, shuffled. */
  items: string[];
  result?: QuizResult;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const isNums = (v: unknown): v is number[] => Array.isArray(v) && v.every(isNum);
const isStrs = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

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
  if (isNums(raw.choices)) result.choices = raw.choices;
  if (isNums(raw.correct_choices)) result.correct_choices = raw.correct_choices;
  if (isStrs(raw.words)) result.words = raw.words;
  if (isStrs(raw.answers)) result.answers = raw.answers;
  if (Array.isArray(raw.blank_ok) && raw.blank_ok.every((b) => typeof b === "boolean"))
    result.blank_ok = raw.blank_ok;
  if (isNums(raw.order)) result.order = raw.order;
  if (isStrs(raw.steps)) result.steps = raw.steps;
  if (isStr(raw.answer)) result.answer = raw.answer;
  if (isStr(raw.reference)) result.reference = raw.reference;
  if (isStr(raw.reasoning)) result.reasoning = raw.reasoning;
  return result;
}

/** A quiz message of the server, or null when it is not well formed. */
export function toQuiz(raw: unknown): QuizContent | null {
  if (!isObj(raw) || !isNum(raw.quiz_id) || !isStr(raw.question)) return null;
  const kind = raw.kind;
  if (!isStr(kind) || !KINDS.includes(kind)) return null;
  const options = Array.isArray(raw.options) ? raw.options.filter(isStr) : [];
  const items = Array.isArray(raw.items) ? raw.items.filter(isStr) : [];
  const blanks = isNum(raw.blanks) ? raw.blanks : 0;
  if (kind === "choice" && options.length < 2) return null;
  if (kind === "multi" && options.length < 3) return null;
  if (kind === "truefalse" && options.length !== 2) return null;
  if (kind === "cloze" && (blanks < 1 || blanks > 2)) return null;
  if (kind === "order" && items.length < 3) return null;
  const quiz: QuizContent = {
    quiz_id: raw.quiz_id,
    kind: kind as QuizKind,
    question: raw.question,
    options: ["choice", "multi", "truefalse"].includes(kind) ? options : [],
    blanks: kind === "cloze" ? blanks : 0,
    items: kind === "order" ? items : [],
  };
  const result = toResult(raw.result);
  if (result) quiz.result = result;
  return quiz;
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
