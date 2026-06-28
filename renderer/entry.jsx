import React from "react";
import { createRoot } from "react-dom/client";
import LuminaApp from "../src/ui/LuminaApp.jsx";
import "../src/ui/styles/finish-all.css";
import "../src/ui/styles/open-sources.css";
import "../src/ui/styles/results-paging.css";
import "../src/ui/styles/subs-digest.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LuminaApp />
  </React.StrictMode>,
);
