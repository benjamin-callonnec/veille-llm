export interface Shortcut {
  keys: string[];
  label: string;
}

export interface ShortcutGroup {
  title: string;
  entries: Shortcut[];
}

const HELP: ShortcutGroup = {
  title: "General",
  entries: [
    { keys: ["H"], label: "Go to the home page (catalogue)" },
    { keys: ["?"], label: "Show or hide the settings" },
  ],
};

/** Every keyboard shortcut of the reader, in one place (the settings panel is built from it). */
export const READER_SHORTCUTS: ShortcutGroup[] = [
  {
    title: "Panes",
    entries: [
      { keys: ["Mod", "B"], label: "Toggle the PDF pane" },
      { keys: ["Mod", "J"], label: "Toggle the chat pane" },
      { keys: ["←", "→"], label: "Resize the panes (on the divider)" },
    ],
  },
  {
    title: "PDF",
    entries: [
      { keys: ["PageUp"], label: "Previous page" },
      { keys: ["PageDown"], label: "Next page" },
      { keys: ["+"], label: "Zoom in" },
      { keys: ["-"], label: "Zoom out" },
      { keys: ["/"], label: "Search in the paper" },
      { keys: ["Esc"], label: "Close the search" },
    ],
  },
  {
    title: "Selected passage",
    entries: [
      { keys: ["Enter"], label: "Send the question" },
      { keys: ["Esc"], label: "Close" },
    ],
  },
  {
    title: "Chat",
    entries: [
      { keys: ["Enter"], label: "Send the message" },
      { keys: ["Shift", "Enter"], label: "New line" },
    ],
  },
  HELP,
];

export const CATALOGUE_SHORTCUTS: ShortcutGroup[] = [
  { title: "Catalogue", entries: [{ keys: ["/"], label: "Search the catalogue" }] },
  HELP,
];
