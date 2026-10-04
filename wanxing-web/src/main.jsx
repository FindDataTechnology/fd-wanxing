import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App.jsx";

// /console-callback: finish the Logto PKCE flow (the SPA is served for any
// path via try_files). Exchange through the facade proxy, keep the ID token,
// land on #/console.
if (window.location.pathname === "/console-callback") {
  const q = new URLSearchParams(window.location.search);
  const code = q.get("code");
  const verifier = sessionStorage.getItem("wx-pkce-verifier");
  sessionStorage.removeItem("wx-pkce-verifier");
  if (code && verifier) {
    fetch("/api/wanxing/v1/console/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, verifier, redirect_uri: window.location.origin + "/console-callback" }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        localStorage.setItem("wanxing-console-token", d.id_token);
        localStorage.setItem("wanxing-console-email", d.email);
      })
      .catch((e) => console.error("[wanxing] login failed:", e))
      .finally(() => {
        window.location.replace(window.location.origin + "/#/console");
      });
  } else {
    window.location.replace(window.location.origin + "/#/console");
  }
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
