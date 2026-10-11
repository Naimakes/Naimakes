import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "../typography/typography.css";
import "../interaction/button-focus.css";
import "./styles/base.css";
import "./library/library.css";
import "./motion/motion.css";
import "./home/home-page.css";
import "./styles/glass-base.css";
import "./styles/glass-site.css";
import "./styles/community-layout.css";
import "./styles/navigation.css";
import "./motion/button-press.css";
import "./styles/control-spacing.css";
import "./styles/glass-material.css";
import "./home/home-composition.css";
import "./styles/misc-overrides.css";
import "./ui/form-fields.css";
import "./ui/loading-popup.css";
import "./governance/admin-console.css";
import "./governance/moderation-dialogs.css";
import "./styles/button-alignment.css";
import "./styles/glass-prominence.css";
import "./governance/governance-console.css";
import "./messages/message-center.css";
import "./posts/post-actions.css";
import "./library/collections.css";
import "./posts/quote-cards.css";
import "./styles/responsive-dialogs.css";
import "./boards/board-actions-menu.css";
import "./styles/control-sizes.css";
import "./styles/mobile-layout.css";
import { MotionProvider } from "./motion/motion-preferences";
import { OverlayHost } from "./motion/OverlayHost";
import { ValidationHintHost } from "./ui/ValidationHint";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MotionProvider>
      <App />
      <OverlayHost />
      <ValidationHintHost />
    </MotionProvider>
  </React.StrictMode>,
);
