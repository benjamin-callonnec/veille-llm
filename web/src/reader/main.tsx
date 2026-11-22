import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/styles.css";
import { ReaderPage } from "./ReaderPage";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

const itemId = new URLSearchParams(window.location.hash.slice(1)).get("item") ?? "";

createRoot(root).render(
  <StrictMode>
    <ReaderPage itemId={itemId} />
  </StrictMode>,
);
