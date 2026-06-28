import React from "react";
import { createRoot } from "react-dom/client";
import LuminaApp from "../src/ui/LuminaApp.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LuminaApp />
  </React.StrictMode>,
);
