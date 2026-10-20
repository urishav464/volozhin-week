import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { Root } from "./Root";
import "./index.css";

// "/" is the week, "/settings/<tab>" the admins' settings; /e, /k and /s are a
// link's public pages (src/Root.tsx). Cloudflare Pages serves index.html for
// any path that is not a file (/privacy.html is one).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </StrictMode>,
);
