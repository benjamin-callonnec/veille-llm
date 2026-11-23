/**
 * The tips shown in the empty composer when the tutor has no next question to recommend.
 * A plain list: add a line to add a tip. A tip must stay true: give it `needs` when it talks about
 * something that is not always there (the composer only shows the tips whose feature exists).
 */
export interface Available {
  /** There is at least one skill (the `/` menu). */
  skills: boolean;
  /** The tutor wrote at least one report for this paper (the viewer, `V`). */
  reports: boolean;
  /** The browser can dictate (the microphone). */
  dictation: boolean;
}

export interface Tip {
  text: string;
  needs?: keyof Available;
}

export const TIPS: Tip[] = [
  { text: "Select a passage in the PDF to ask about it" },
  { text: "Type / for commands", needs: "skills" },
  { text: "Paste or drop an image to ask about it" },
  { text: "Press V to open the reports", needs: "reports" },
  { text: "Click a [p.N] citation to jump to the page" },
  { text: "Press / to search in the paper" },
  { text: "Highlight passages in colour: they stay listed under the PDF" },
  { text: "Click the microphone to dictate your question", needs: "dictation" },
  { text: "Press Cmd or Ctrl + B to hide the PDF, J to hide the chat" },
  { text: "Press ? for the settings and every shortcut" },
  { text: "Shift + Enter adds a new line" },
  { text: "Open the session memory to read the notes the tutor keeps about you" },
  { text: "Use the quiz icon to test what you understood" },
  { text: "Hover an answer to copy it" },
  { text: "Export a conversation as Markdown from the conversations menu" },
  { text: "Press H to go back to the catalogue" },
];
