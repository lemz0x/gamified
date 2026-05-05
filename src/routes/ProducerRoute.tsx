import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { CARDS, type CardId } from "../cards";
import {
  TILES,
  loadCalibratedTiles,
  saveCalibratedTiles,
  type SeatId,
  type Tile,
  type TileMap,
} from "../coords";
import {
  buildOverlayDataOnlyUrl,
  useVdoNinja,
  type EventPayload,
} from "../lib/vdoninja";
import {
  PRODUCER_PASSWORD,
  isProducerAuthenticated,
  persistProducerAuth,
} from "../lib/auth";

// ── shared seat plumbing ────────────────────────────────────────────────

const SEAT_ORDER: readonly SeatId[] = ["L1", "L2", "L3", "R1", "R2", "R3"];

// Same key used by /play so both surfaces stay in sync via localStorage.
const ROSTER_STORAGE_KEY = "gamified.roster.v1";
/**
 * Producer-side persistence of the latest reset epoch. We re-announce
 * this on every wrapper getResetEpoch request so a wrapper that joined
 * after the most recent reset still picks it up and clears its counters.
 */
const RESET_EPOCH_STORAGE_KEY = "gamified.resetEpoch.v1";

function loadResetEpoch(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(RESET_EPOCH_STORAGE_KEY);
    const n = raw == null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function saveResetEpoch(epoch: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RESET_EPOCH_STORAGE_KEY, String(epoch));
  } catch {
    // ignore
  }
}

function defaultRoster(): Record<SeatId, string> {
  return {
    L1: "Guest 1",
    L2: "Guest 2",
    L3: "Guest 3",
    R1: "Guest 4",
    R2: "Guest 5",
    R3: "Guest 6",
  };
}

function loadRoster(): Record<SeatId, string> {
  if (typeof window === "undefined") return defaultRoster();
  try {
    const raw = window.localStorage.getItem(ROSTER_STORAGE_KEY);
    if (!raw) return defaultRoster();
    const parsed = JSON.parse(raw) as Partial<Record<SeatId, string>> | null;
    if (!parsed || typeof parsed !== "object") return defaultRoster();
    const merged = defaultRoster();
    for (const seat of SEAT_ORDER) {
      const v = parsed[seat];
      if (typeof v === "string" && v.trim()) merged[seat] = v.trim();
    }
    return merged;
  } catch {
    return defaultRoster();
  }
}

function persistRoster(roster: Record<SeatId, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ROSTER_STORAGE_KEY, JSON.stringify(roster));
  } catch {
    // ignore quota / disabled storage
  }
}

// ── activity-feed plumbing ──────────────────────────────────────────────

const FEED_CAP = 20;

interface FeedEntry {
  id: string;
  ts: number;
  text: string;
}

function cardLabel(id: CardId): string {
  return CARDS.find((c) => c.id === id)?.name ?? id.toUpperCase();
}

function formatEvent(
  msg: EventPayload,
  roster: Record<SeatId, string>,
): string | null {
  const nameOf = (kind: "guest" | "host", seat?: SeatId, label?: string) =>
    kind === "host" ? "HOST" : (seat && roster[seat]) || label || "?";
  switch (msg.type) {
    case "emoji":
      return `${nameOf(
        msg.from.kind,
        msg.from.kind === "guest" ? msg.from.seat : undefined,
        msg.from.label,
      )} fired ${msg.emoji}`;
    case "cardPlay":
      return `${nameOf(
        msg.from.kind,
        msg.from.kind === "guest" ? msg.from.seat : undefined,
        msg.from.label,
      )} played ${cardLabel(msg.cardId)} on ${roster[msg.targetSeat] || msg.targetLabel}`;
    case "rosterUpdate":
      return "Roster updated";
    case "cardReset":
      return `Cards reset (epoch ${msg.resetEpoch})`;
    case "getResetEpoch":
      return "Wrapper requested resetEpoch";
    case "calibration":
      return "Calibration updated";
    default:
      return null;
  }
}

// ── visual constants (gamified neon palette, dark theme) ─────────────────

const NEON = {
  bg: "#0a0a12",
  surface: "#11111c",
  surfaceAlt: "#161624",
  panelEdge: "#1f1f30",
  text: "#f0f0f8",
  textDim: "#8a8aa3",
  pink: "#ff2e9f",
  purple: "#a855ff",
  cyan: "#22e2ff",
  green: "#22ff8a",
  red: "#ff2e6b",
  amber: "#ffb000",
} as const;

// ── component ───────────────────────────────────────────────────────────

/**
 * Top-level route — gates the producer panel behind a password prompt.
 * `/play` and `/overlay` stay un-gated; only `/producer` flows through
 * here. Once the user enters the right password, the token persists in
 * `localStorage` so OBS Custom Browser Docks stay authenticated across
 * OBS restarts (per `src/lib/auth.ts`).
 */
export function ProducerRoute() {
  const [authed, setAuthed] = useState<boolean>(isProducerAuthenticated);
  if (!authed) {
    return <ProducerAuthGate onAuth={() => setAuthed(true)} />;
  }
  return <ProducerPanel />;
}

function ProducerPanel() {
  const [roster, setRoster] = useState<Record<SeatId, string>>(loadRoster);
  // Form state — separate from `roster` so the user can edit then Save.
  const [draftRoster, setDraftRoster] = useState<Record<SeatId, string>>(roster);
  const [calibrate, setCalibrate] = useState(false);
  const [tiles, setTiles] = useState<TileMap>(loadCalibratedTiles);
  const [feed, setFeed] = useState<readonly FeedEntry[]>([]);
  const feedIdRef = useRef(0);
  // Latest reset epoch we've fired (persisted) — re-announced on demand so
  // wrappers that join after a reset still catch up.
  const resetEpochRef = useRef<number>(loadResetEpoch());
  const rosterDirty =
    SEAT_ORDER.some((s) => draftRoster[s] !== roster[s]);

  // Forward-declared sender so the message handler can re-broadcast on
  // demand without depending on `send` (which would create a cycle).
  const sendRef = useRef<((p: EventPayload) => void) | null>(null);

  const onMessage = useCallback(
    (msg: EventPayload) => {
      const text = formatEvent(msg, roster);
      if (text) {
        setFeed((prev) =>
          [
            { id: `f${feedIdRef.current++}`, ts: msg.ts, text },
            ...prev,
          ].slice(0, FEED_CAP),
        );
      }
      // Mirror inbound state changes locally too — another producer tab
      // editing the roster shouldn't leave this tab stale.
      if (msg.type === "rosterUpdate") {
        setRoster(msg.names);
        setDraftRoster(msg.names);
      }
      if (msg.type === "calibration") {
        setTiles(msg.tiles);
      }
      // A wrapper just mounted; re-announce the latest reset epoch so it
      // can catch up on any reset that fired before it was open.
      if (msg.type === "getResetEpoch" && resetEpochRef.current > 0) {
        if (import.meta.env.DEV) {
          console.log(
            "[producer] wrapper requested resetEpoch; re-broadcasting",
            resetEpochRef.current,
          );
        }
        sendRef.current?.({
          type: "cardReset",
          resetEpoch: resetEpochRef.current,
          ts: Date.now(),
        });
      }
    },
    [roster],
  );

  const { iframeRef, send } = useVdoNinja({ onMessage });
  // Keep the ref in sync so the listener (which captures `send` via the ref
  // to avoid a re-subscribe loop) always calls the live sender.
  useEffect(() => {
    sendRef.current = send;
  }, [send]);
  const overlayUrl = useMemo(() => buildOverlayDataOnlyUrl(), []);

  const saveRoster = useCallback(() => {
    setRoster(draftRoster);
    persistRoster(draftRoster);
    send({ type: "rosterUpdate", names: draftRoster, ts: Date.now() });
  }, [draftRoster, send]);

  const resetRoster = useCallback(() => {
    const fresh = defaultRoster();
    setDraftRoster(fresh);
  }, []);

  const fireResetCards = useCallback(() => {
    if (!window.confirm("Reset all cards for all guests?")) return;
    const epoch = Date.now();
    resetEpochRef.current = epoch;
    saveResetEpoch(epoch);
    send({ type: "cardReset", resetEpoch: epoch, ts: epoch });
    setFeed((prev) =>
      [
        { id: `f${feedIdRef.current++}`, ts: epoch, text: "Cards reset for all guests" },
        ...prev,
      ].slice(0, FEED_CAP),
    );
  }, [send]);

  const updateTile = useCallback(
    (seat: SeatId, axis: keyof Tile, delta: number) => {
      setTiles((prev) => {
        const next: TileMap = {
          ...prev,
          [seat]: { ...prev[seat], [axis]: Math.max(0, prev[seat][axis] + delta) },
        };
        saveCalibratedTiles(next);
        send({ type: "calibration", tiles: next, ts: Date.now() });
        return next;
      });
    },
    [send],
  );

  const setTileValue = useCallback(
    (seat: SeatId, axis: keyof Tile, raw: string) => {
      const value = Number.parseInt(raw, 10);
      if (Number.isNaN(value) || value < 0) return;
      setTiles((prev) => {
        if (prev[seat][axis] === value) return prev;
        const next: TileMap = {
          ...prev,
          [seat]: { ...prev[seat], [axis]: value },
        };
        saveCalibratedTiles(next);
        send({ type: "calibration", tiles: next, ts: Date.now() });
        return next;
      });
    },
    [send],
  );

  const resetTiles = useCallback(() => {
    if (!window.confirm("Reset all tile coordinates to defaults?")) return;
    const fresh: TileMap = { ...TILES };
    setTiles(fresh);
    saveCalibratedTiles(fresh);
    send({ type: "calibration", tiles: fresh, ts: Date.now() });
  }, [send]);

  return (
    <div style={styles.shell}>
      <header style={styles.headerBar}>
        <span style={styles.brand}>GAMIFIED</span>
        <span style={styles.subBrand}>Producer panel</span>
      </header>

      <Section title="Roster names">
        <div style={styles.rosterGrid}>
          {SEAT_ORDER.map((seat, i) => (
            <label key={seat} style={styles.rosterField}>
              <span style={styles.rosterFieldLabel}>{`Guest ${i + 1} · ${seat}`}</span>
              <input
                type="text"
                value={draftRoster[seat]}
                onChange={(e) =>
                  setDraftRoster((prev) => ({ ...prev, [seat]: e.target.value }))
                }
                style={styles.input}
                spellCheck={false}
              />
            </label>
          ))}
        </div>
        <div style={styles.row}>
          <button
            type="button"
            onClick={saveRoster}
            disabled={!rosterDirty}
            style={{
              ...styles.primaryButton,
              opacity: rosterDirty ? 1 : 0.5,
              cursor: rosterDirty ? "pointer" : "default",
            }}
          >
            Save & broadcast
          </button>
          <button
            type="button"
            onClick={resetRoster}
            style={styles.secondaryButton}
          >
            Reset to defaults
          </button>
          {!rosterDirty && (
            <span style={styles.hint}>No unsaved changes.</span>
          )}
        </div>
      </Section>

      <Section title="Calibration">
        <label style={styles.toggle}>
          <input
            type="checkbox"
            checked={calibrate}
            onChange={(e) => setCalibrate(e.target.checked)}
          />
          <span>Show coordinate editors</span>
          <span style={styles.hint}>
            Open the overlay with <code>?calibrate=1</code> to see the grid.
          </span>
        </label>
        {calibrate && (
          <div style={styles.calibGrid}>
            {SEAT_ORDER.map((seat) => (
              <CalibCard
                key={seat}
                seat={seat}
                tile={tiles[seat]}
                onNudge={(axis, delta) => updateTile(seat, axis, delta)}
                onSet={(axis, raw) => setTileValue(seat, axis, raw)}
              />
            ))}
          </div>
        )}
        {calibrate && (
          <div style={styles.row}>
            <button
              type="button"
              onClick={resetTiles}
              style={styles.secondaryButton}
            >
              Reset to defaults
            </button>
          </div>
        )}
      </Section>

      <Section title="Reset cards">
        <div style={styles.row}>
          <button
            type="button"
            onClick={fireResetCards}
            style={{ ...styles.primaryButton, background: NEON.red, color: "#fff" }}
          >
            Reset all cards
          </button>
          <span style={styles.hint}>
            Zeroes per-guest counters and re-enables both card buttons in every wrapper.
          </span>
        </div>
      </Section>

      <Section title="Activity feed">
        {feed.length === 0 ? (
          <div style={styles.emptyFeed}>
            Listening for events… nothing yet.
          </div>
        ) : (
          <ul style={styles.feedList}>
            {feed.map((entry) => (
              <li key={entry.id} style={styles.feedRow}>
                <time style={styles.feedTime}>
                  {new Date(entry.ts).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </time>
                <span style={styles.feedText}>{entry.text}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Hidden data-channel iframe — same pattern as /overlay. */}
      <iframe
        ref={iframeRef}
        src={overlayUrl}
        title="VDO.Ninja data channel"
        style={styles.hiddenIframe}
        allow="microphone; camera"
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
}

// ── auth gate ───────────────────────────────────────────────────────────

interface ProducerAuthGateProps {
  onAuth: () => void;
}

/**
 * Centered password prompt shown when the local browser hasn't yet
 * persisted the producer auth token. On submit: compare against
 * PRODUCER_PASSWORD (constant-time-ish; the password lives in the
 * client bundle anyway so timing leaks aren't meaningful here),
 * persist on success, surface a brief error on failure.
 */
function ProducerAuthGate({ onAuth }: ProducerAuthGateProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (draft === PRODUCER_PASSWORD) {
      persistProducerAuth();
      onAuth();
    } else {
      setError(true);
      setDraft("");
      // Tiny delay then focus again so the user can retry immediately.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  return (
    <div style={styles.gateShell}>
      <form onSubmit={submit} style={styles.gateCard}>
        <span style={styles.brand}>GAMIFIED</span>
        <span style={styles.gateTitle}>Producer panel</span>
        <span style={styles.gateHint}>Enter password to continue.</span>
        <input
          ref={inputRef}
          type="password"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(false);
          }}
          placeholder="Password"
          autoComplete="current-password"
          spellCheck={false}
          style={{
            ...styles.gateInput,
            borderColor: error ? NEON.red : NEON.panelEdge,
          }}
        />
        <button
          type="submit"
          disabled={!draft}
          style={{
            ...styles.primaryButton,
            opacity: draft ? 1 : 0.5,
            cursor: draft ? "pointer" : "default",
          }}
        >
          Unlock
        </button>
        <span
          style={{
            ...styles.gateError,
            visibility: error ? "visible" : "hidden",
          }}
        >
          Wrong password — try again.
        </span>
      </form>
    </div>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>{title}</h2>
      <div style={styles.sectionBody}>{children}</div>
    </section>
  );
}

interface CalibCardProps {
  seat: SeatId;
  tile: Tile;
  onNudge: (axis: keyof Tile, delta: number) => void;
  onSet: (axis: keyof Tile, raw: string) => void;
}

function CalibCard({ seat, tile, onNudge, onSet }: CalibCardProps) {
  const dirty =
    tile.x !== TILES[seat].x ||
    tile.y !== TILES[seat].y ||
    tile.w !== TILES[seat].w ||
    tile.h !== TILES[seat].h;
  return (
    <div style={{ ...styles.calibCard, borderColor: dirty ? NEON.amber : NEON.panelEdge }}>
      <div style={styles.calibHeader}>
        <span style={styles.calibSeat}>{seat}</span>
        {dirty && <span style={styles.calibDirty}>edited</span>}
      </div>
      {(["x", "y", "w", "h"] as const).map((axis) => (
        <CalibAxisRow
          key={axis}
          label={axis.toUpperCase()}
          value={tile[axis]}
          onNudge={(delta) => onNudge(axis, delta)}
          onSet={(raw) => onSet(axis, raw)}
        />
      ))}
    </div>
  );
}

interface CalibAxisRowProps {
  label: string;
  value: number;
  onNudge: (delta: number) => void;
  onSet: (raw: string) => void;
}

function CalibAxisRow({ label, value, onNudge, onSet }: CalibAxisRowProps) {
  // Local input state so typing isn't fought by parent re-renders mid-edit.
  const [draft, setDraft] = useState(String(value));
  // Sync down whenever the parent value changes (e.g., nudge button click).
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  return (
    <div style={styles.calibAxis}>
      <span style={styles.calibAxisLabel}>{label}</span>
      <NudgeButton onClick={() => onNudge(-10)} label="−10" />
      <NudgeButton onClick={() => onNudge(-1)} label="−1" />
      <input
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onSet(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        style={styles.calibInput}
      />
      <NudgeButton onClick={() => onNudge(1)} label="+1" />
      <NudgeButton onClick={() => onNudge(10)} label="+10" />
    </div>
  );
}

function NudgeButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} style={styles.nudgeBtn}>
      {label}
    </button>
  );
}

// ── styles ──────────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  shell: {
    minHeight: "100vh",
    background: NEON.bg,
    color: NEON.text,
    fontFamily:
      '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
    padding: "14px 16px 32px",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  headerBar: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    paddingBottom: 4,
    borderBottom: `1px solid ${NEON.panelEdge}`,
  },
  brand: {
    fontSize: 14,
    letterSpacing: 4,
    fontWeight: 800,
    background: `linear-gradient(90deg, ${NEON.pink}, ${NEON.purple} 50%, ${NEON.cyan})`,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
  },
  subBrand: {
    fontSize: 11,
    letterSpacing: 2,
    color: NEON.textDim,
    textTransform: "uppercase",
  },
  section: {
    background: NEON.surface,
    border: `1px solid ${NEON.panelEdge}`,
    borderRadius: 10,
    padding: "10px 12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  sectionTitle: {
    margin: 0,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 2,
    color: NEON.cyan,
    textTransform: "uppercase",
  },
  sectionBody: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  rosterGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 8,
  },
  rosterField: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  rosterFieldLabel: {
    fontSize: 10,
    letterSpacing: 1,
    color: NEON.textDim,
    textTransform: "uppercase",
  },
  input: {
    appearance: "none",
    background: NEON.surfaceAlt,
    border: `1px solid ${NEON.panelEdge}`,
    borderRadius: 6,
    padding: "7px 9px",
    color: NEON.text,
    fontFamily: "inherit",
    fontSize: 14,
    fontWeight: 700,
    outline: "none",
  },
  row: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
  },
  primaryButton: {
    appearance: "none",
    background: NEON.cyan,
    color: NEON.bg,
    border: 0,
    borderRadius: 6,
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 1.2,
    cursor: "pointer",
    fontFamily: "inherit",
    textTransform: "uppercase",
  },
  secondaryButton: {
    appearance: "none",
    background: "transparent",
    color: NEON.textDim,
    border: `1px solid ${NEON.panelEdge}`,
    borderRadius: 6,
    padding: "8px 12px",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1.2,
    cursor: "pointer",
    fontFamily: "inherit",
    textTransform: "uppercase",
  },
  hint: {
    fontSize: 11,
    color: NEON.textDim,
  },
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: NEON.text,
    cursor: "pointer",
  },
  calibGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 8,
  },
  calibCard: {
    background: NEON.surfaceAlt,
    border: "1px solid",
    borderRadius: 8,
    padding: "8px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  calibHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 4,
    borderBottom: `1px solid ${NEON.panelEdge}`,
    marginBottom: 4,
  },
  calibSeat: {
    fontSize: 13,
    fontWeight: 800,
    color: NEON.purple,
    letterSpacing: 1.5,
  },
  calibDirty: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 1.5,
    color: NEON.amber,
    textTransform: "uppercase",
  },
  calibAxis: {
    display: "grid",
    gridTemplateColumns: "20px 36px 32px 1fr 32px 36px",
    gap: 4,
    alignItems: "center",
  },
  calibAxisLabel: {
    fontSize: 11,
    color: NEON.textDim,
    fontWeight: 800,
  },
  calibInput: {
    appearance: "none",
    background: NEON.bg,
    border: `1px solid ${NEON.panelEdge}`,
    borderRadius: 4,
    padding: "4px 6px",
    color: NEON.text,
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 700,
    textAlign: "center",
    outline: "none",
    minWidth: 0,
  },
  nudgeBtn: {
    appearance: "none",
    background: NEON.surface,
    color: NEON.text,
    border: `1px solid ${NEON.panelEdge}`,
    borderRadius: 4,
    padding: "3px 0",
    fontSize: 10,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  feedList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    maxHeight: 260,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  feedRow: {
    display: "flex",
    gap: 10,
    alignItems: "baseline",
    padding: "5px 8px",
    background: NEON.surfaceAlt,
    border: `1px solid ${NEON.panelEdge}`,
    borderRadius: 5,
    fontSize: 12,
  },
  feedTime: {
    color: NEON.textDim,
    fontSize: 10,
    letterSpacing: 0.5,
    fontVariantNumeric: "tabular-nums",
    flex: "0 0 64px",
  },
  feedText: {
    color: NEON.text,
  },
  emptyFeed: {
    fontSize: 12,
    color: NEON.textDim,
    fontStyle: "italic",
  },
  hiddenIframe: {
    position: "absolute",
    left: -9999,
    top: -9999,
    width: 1,
    height: 1,
    border: 0,
    opacity: 0,
    pointerEvents: "none",
  },
  gateShell: {
    minHeight: "100vh",
    background: NEON.bg,
    color: NEON.text,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    fontFamily:
      '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  gateCard: {
    width: "min(360px, 100%)",
    background: NEON.surface,
    border: `1px solid ${NEON.panelEdge}`,
    borderRadius: 14,
    padding: "26px 24px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    alignItems: "stretch",
    boxShadow: `0 0 32px ${NEON.purple}33, 0 0 18px ${NEON.cyan}22`,
  },
  gateTitle: {
    fontSize: 13,
    letterSpacing: 2,
    color: NEON.textDim,
    textTransform: "uppercase",
    fontWeight: 800,
    textAlign: "center",
  },
  gateHint: {
    fontSize: 12,
    color: NEON.textDim,
    textAlign: "center",
  },
  gateInput: {
    appearance: "none",
    background: NEON.surfaceAlt,
    border: "1px solid",
    borderRadius: 8,
    padding: "10px 12px",
    color: NEON.text,
    fontFamily: "inherit",
    fontSize: 14,
    fontWeight: 700,
    outline: "none",
    letterSpacing: 1,
  },
  gateError: {
    fontSize: 11,
    color: NEON.red,
    textAlign: "center",
    minHeight: 14,
    letterSpacing: 0.5,
  },
};
