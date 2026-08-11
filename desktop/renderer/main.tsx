import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Editor from "../../app/page";
import "../../app/globals.css";

document.documentElement.style.setProperty(
  "--aruma-background",
  'url("./aruma-bg.webp")',
);
const root = document.getElementById("root");
if (!root) throw new Error("Desktop root element is missing");

createRoot(root).render(
  <StrictMode>
    <Editor />
  </StrictMode>,
);
