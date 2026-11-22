import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/App";
import { AppShell } from "./components/AppShell";
import { CATALOGUE_SHORTCUTS } from "./lib/shortcuts";
import "./styles/styles.css";
import "./styles/chrome.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

createRoot(root).render(
  <StrictMode>
    <AppShell shortcuts={CATALOGUE_SHORTCUTS}>
      <App />
    </AppShell>
  </StrictMode>,
);
