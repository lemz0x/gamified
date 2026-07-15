import { lazy, Suspense } from "react";
import { Route, Routes, useLocation } from "react-router-dom";

// Code-split routes so each browser source only parses its own code.
// The overlay (OBS browser source) drops from ~226KB to roughly a third.
const ChatRoute = lazy(() => import("./routes/ChatRoute").then((m) => ({ default: m.ChatRoute })));
const UnderlayRoute = lazy(() => import("./routes/UnderlayRoute").then((m) => ({ default: m.UnderlayRoute })));
const OverlayRoute = lazy(() => import("./routes/OverlayRoute").then((m) => ({ default: m.OverlayRoute })));
const PlayRoute = lazy(() => import("./routes/PlayRoute").then((m) => ({ default: m.PlayRoute })));
const ProducerRoute = lazy(() => import("./routes/ProducerRoute").then((m) => ({ default: m.ProducerRoute })));

// Overlay suspense fallback: empty transparent div so OBS never captures
// a loading flash. Panel fallback: minimal centered loading text.
function OverlayFallback() {
  return <div style={{ position: "fixed", inset: 0, background: "transparent" }} />;
}

function PanelFallback() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center text-gray-500">
      Loading…
    </div>
  );
}

// Routing model:
//   /play       guest/host wrapper around the VDO.Ninja iframe
//   /underlay   transparent OBS browser source — animations beneath camera layers
//   /overlay    transparent OBS browser source — top-layer elements (chat-to-screen)
//   /producer   dockable panel: roster, reset cards, calibration, activity feed
//
// Both /underlay and /overlay need the wrapper div dropped so nothing
// can reintroduce a paint-able surface above OBS's compositing layer.
// Tailwind v4 preflight + utilities like min-h-screen / w-full can plant
// background-color initial values that swallow the transparent body.
export default function App() {
  const { pathname } = useLocation();
  const isOverlay = pathname === "/overlay" || pathname === "/underlay";
  return (
    <div className={isOverlay ? undefined : "min-h-screen w-full"}>
      <Suspense fallback={isOverlay ? <OverlayFallback /> : <PanelFallback />}>
        <Routes>
          <Route path="/" element={<div>Gamified — pick a route: /play, /underlay, /overlay, /producer, /chat, /editorchat</div>} />
          <Route path="/play" element={<PlayRoute />} />
          <Route path="/underlay" element={<UnderlayRoute />} />
          <Route path="/overlay" element={<OverlayRoute />} />
          <Route path="/producer" element={<ProducerRoute />} />
          <Route path="/chat" element={<ChatRoute />} />
          <Route path="/editorchat" element={<ChatRoute defaultLabel="Phil" />} />
        </Routes>
      </Suspense>
    </div>
  );
}
