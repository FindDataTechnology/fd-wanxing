import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App.jsx";
import { handleConsoleCallback } from "./auth.js";

// /console-callback: finish the Logto PKCE flow (the SPA is served for any
// path via try_files) — state-checked exchange through the facade proxy
// (console or chat gate), token pair persisted by the auth module, land on
// the hash the login asked for (chat logins return to their conversation).
if (window.location.pathname === "/console-callback") {
  handleConsoleCallback()
    .catch((e) => console.error("[wanxing] login failed:", e))
    .finally(() => {
      window.location.replace(window.location.origin + (window.wxLoginReturnTo || "/#/console"));
    });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
