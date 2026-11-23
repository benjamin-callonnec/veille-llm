/** What the empty composer says: an invitation first, then examples, and now and then a tip. */
export const FIRST_HINT = "Ask about the paper…";
/** Every fourth hint is a tip, the others are examples. */
export const TIP_EVERY = 4;

export const EXAMPLES = [
  FIRST_HINT,
  "Explain the main idea in simple terms",
  "What are the limits of this approach?",
  "What would you check before trusting the results?",
  "Summarise the method step by step",
  "How does it compare with earlier work?",
  "Which figure should I read first?",
  "Quiz me on what I just read",
];

/** What the app has right now: a tip about a missing feature would be a lie. */
export interface Available {
  skills: boolean;
  reports: boolean;
}

export interface Tip {
  text: string;
  needs?: keyof Available;
}

export const TIPS: Tip[] = [
  { text: "Select a passage to ask about it" },
  { text: "Type / for commands", needs: "skills" },
  { text: "Paste an image to ask about it" },
  { text: "Press V to open the reports", needs: "reports" },
  { text: "Press H to go back to the catalogue" },
];

/** The nth hint: deterministic, so the sequence is the same for everyone and easy to test. */
export function hintAt(n: number, have: Available): string {
  if ((n + 1) % TIP_EVERY === 0) {
    const tips = TIPS.filter((t) => !t.needs || have[t.needs]);
    return tips[Math.floor(n / TIP_EVERY) % tips.length]?.text ?? FIRST_HINT;
  }
  const example = n - Math.floor((n + 1) / TIP_EVERY); // the examples before this one
  return EXAMPLES[example % EXAMPLES.length] ?? FIRST_HINT;
}
