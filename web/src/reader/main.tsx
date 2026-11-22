import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "../components/AppShell";
import { READER_SHORTCUTS } from "../lib/shortcuts";
import "../styles/styles.css";
import "../styles/chrome.css";
import "../styles/reader.css";
import "../styles/chat.css";
import { ReaderPage } from "./ReaderPage";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

const itemId = new URLSearchParams(window.location.hash.slice(1)).get("item") ?? "";

createRoot(root).render(
  <StrictMode>
    <AppShell shortcuts={READER_SHORTCUTS}>
      <ReaderPage itemId={itemId} />
    </AppShell>
  </StrictMode>,
);
