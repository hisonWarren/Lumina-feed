import React from "react";
import { createRoot } from "react-dom/client";
import LuminaFeedObservatory from "../src/ui/Observatory.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LuminaFeedObservatory />
  </React.StrictMode>,
);
