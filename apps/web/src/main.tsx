import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";
import "@homi/ui/styles.css";
import "./platform-shell.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Homi root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    const hadController = navigator.serviceWorker.controller !== null;
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    });
    void navigator.serviceWorker
      .register("/sw.js?v=13", {
        scope: "/",
        updateViaCache: "none",
      })
      .then((registration) => registration.update());
  });
}
