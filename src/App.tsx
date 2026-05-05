import { Route, Routes, useLocation } from "react-router-dom";
import { ChatRoute } from "./routes/ChatRoute";
import { OverlayRoute } from "./routes/OverlayRoute";
import { PlayRoute } from "./routes/PlayRoute";
import { ProducerRoute } from "./routes/ProducerRoute";

// Routing model:
//   /play       guest/host wrapper around the VDO.Ninja iframe
//   /overlay    transparent OBS browser source that renders animations
//   /producer   dockable panel: roster, reset cards, calibration, activity feed
//
// The wrapper div drops every layout/utility class on /overlay so nothing
// can reintroduce a paint-able surface above OBS's compositing layer.
// Tailwind v4 preflight + utilities like min-h-screen / w-full can plant
// background-color initial values that swallow the transparent body.
export default function App() {
  const isOverlay = useLocation().pathname === "/overlay";
  return (
    <div className={isOverlay ? undefined : "min-h-screen w-full"}>
      <Routes>
        <Route path="/" element={<div>Gamified — pick a route: /play, /overlay, /producer, /chat</div>} />
        <Route path="/play" element={<PlayRoute />} />
        <Route path="/overlay" element={<OverlayRoute />} />
        <Route path="/producer" element={<ProducerRoute />} />
        <Route path="/chat" element={<ChatRoute />} />
      </Routes>
    </div>
  );
}
