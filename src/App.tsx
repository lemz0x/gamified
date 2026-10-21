import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";
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

/** Route-level error boundary. If a malformed payload (or any render
 *  bug) throws inside a route, React would otherwise unmount the whole
 *  tree — for an OBS browser source that means a black/dead capture
 *  until someone notices and refreshes. This keeps the shell mounted
 *  and paints nothing on overlay surfaces (transparent = safe air),
 *  with a small note on panel surfaces so it's diagnosable.
 *  Validation hardening is the primary defence; this is containment. */
class RouteErrorBoundary extends Component<
  { isOverlay: boolean; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surfaced in OBS's browser-source console / devtools, not the show.
    console.error("[gamified] route render error (contained):", error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return this.props.isOverlay ? (
        <div style={{ position: "fixed", inset: 0, background: "transparent" }} />
      ) : (
        <div className="min-h-screen w-full flex items-center justify-center text-gray-500">
          Something broke — refresh this page.
        </div>
      );
    }
    return this.props.children;
  }
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
      <RouteErrorBoundary isOverlay={isOverlay}>
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
      </RouteErrorBoundary>
    </div>
  );
}
