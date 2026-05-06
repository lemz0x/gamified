import { useCallback, useEffect, useRef, useState } from "react";
import type { SeatId } from "../coords";

// ── seat layout ──────────────────────────────────────────────────────────

const LEFT_SEATS: readonly SeatId[] = ["L1", "L2", "L3"];
const RIGHT_SEATS: readonly SeatId[] = ["R1", "R2", "R3"];

// ── props ────────────────────────────────────────────────────────────────

interface BuzzPanelProps {
  /** Roster names from producer. */
  roster: Record<SeatId, string>;
  /** Which seats are currently glowing. */
  buzzingSeats: Set<SeatId>;
  /** Called when the buzzer button is clicked. Only wired for guests. */
  onBuzz?: () => void;
  /** "play" for the neon dark wrapper, "producer" for the producer panel. */
  variant: "play" | "producer";
}

// ── component ────────────────────────────────────────────────────────────

export function BuzzPanel({ roster, buzzingSeats, onBuzz, variant }: BuzzPanelProps) {
  const isPlay = variant === "play";

  const nameBox = (seat: SeatId) => {
    const buzzing = buzzingSeats.has(seat);
    return (
      <div
        key={seat}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "6px 4px",
          borderRadius: 8,
          border: buzzing
            ? "2px solid #ffbe0b"
            : `2px solid ${isPlay ? "#1f1f30" : "#252538"}`,
          background: buzzing
            ? "rgba(255, 190, 11, 0.15)"
            : isPlay
              ? "#0e0e16"
              : "#11111c",
          color: buzzing ? "#ffbe0b" : isPlay ? "#8a8aa3" : "#f0f0f8",
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: 0.5,
          textOverflow: "ellipsis",
          overflow: "hidden",
          whiteSpace: "nowrap",
          textAlign: "center",
          boxShadow: buzzing
            ? "0 0 14px rgba(255, 190, 11, 0.5), 0 0 28px rgba(255, 190, 11, 0.25), inset 0 0 8px rgba(255, 190, 11, 0.1)"
            : "none",
          transition: "border-color 120ms, background 120ms, color 120ms, box-shadow 120ms",
          cursor: "default",
        }}
      >
        {roster[seat] || seat}
      </div>
    );
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: onBuzz ? "1fr 1fr 1fr auto" : "1fr 1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap: 6,
        ...(isPlay ? {} : { marginTop: 4 }),
      }}
    >
      {/* Row 1: left seats */}
      {LEFT_SEATS.map((seat) => nameBox(seat))}
      {/* Row 2: right seats */}
      {RIGHT_SEATS.map((seat) => nameBox(seat))}
      {/* Buzzer button — spans both rows */}
      {onBuzz && (
        <button
          type="button"
          onClick={onBuzz}
          style={{
            gridRow: "1 / 3",
            gridColumn: 4,
            background: "linear-gradient(135deg, #ff2e6b 0%, #cc1a4a 100%)",
            border: "2px solid #ff5482",
            borderRadius: 10,
            color: "#fff",
            fontWeight: 900,
            fontSize: 14,
            letterSpacing: 1,
            cursor: "pointer",
            textShadow: "0 0 10px rgba(255, 46, 107, 0.6)",
            boxShadow:
              "0 0 12px rgba(255, 46, 107, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
            transition: "transform 60ms ease-out, box-shadow 60ms ease-out",
            userSelect: "none",
          }}
          onPointerDown={(e) => {
            (e.currentTarget.style.transform = "scale(0.95)"),
              (e.currentTarget.style.boxShadow =
                "0 0 6px rgba(255, 46, 107, 0.2), inset 0 2px 4px rgba(0,0,0,0.3)");
          }}
          onPointerUp={(e) => {
            e.currentTarget.style.transform = "scale(1)";
            e.currentTarget.style.boxShadow =
              "0 0 12px rgba(255, 46, 107, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.15)";
          }}
          onPointerLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
            e.currentTarget.style.boxShadow =
              "0 0 12px rgba(255, 46, 107, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.15)";
          }}
        >
          BUZZ
        </button>
      )}
    </div>
  );
}

// ── hook: manages buzzing seat state with auto-expiry ─────────────────────

const BUZZ_GLOW_MS = 1000;

export function useBuzzState() {
  const [buzzingSeats, setBuzzingSeats] = useState<Set<SeatId>>(new Set());
  const timers = useRef<Map<SeatId, number>>(new Map());

  const buzz = useCallback((seat: SeatId) => {
    setBuzzingSeats((prev) => {
      const next = new Set(prev);
      next.add(seat);
      return next;
    });
    // Clear any existing timer for this seat and start a fresh one.
    const existing = timers.current.get(seat);
    if (existing !== undefined) window.clearTimeout(existing);
    timers.current.set(
      seat,
      window.setTimeout(() => {
        setBuzzingSeats((prev) => {
          const next = new Set(prev);
          next.delete(seat);
          return next;
        });
        timers.current.delete(seat);
      }, BUZZ_GLOW_MS),
    );
  }, []);

  // Clean up all timers on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const id of map.values()) window.clearTimeout(id);
      map.clear();
    };
  }, []);

  return { buzzingSeats, buzz };
}
