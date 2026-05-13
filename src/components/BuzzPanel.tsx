import { useCallback, useState } from "react";
import type { SeatId } from "../coords";

// ── seat layout ──────────────────────────────────────────────────────────

const LEFT_SEATS: readonly SeatId[] = ["L1", "L2", "L3"];
const RIGHT_SEATS: readonly SeatId[] = ["R1", "R2", "R3"];

// ── props ────────────────────────────────────────────────────────────────

interface BuzzPanelProps {
  /** Roster names from producer. */
  roster: Record<SeatId, string>;
  /** Which seats are currently buzzing. */
  buzzingSeats: Set<SeatId>;
  /** Whether this guest's own buzzer is active (for toggle styling). */
  isBuzzing?: boolean;
  /** Called when the buzzer button is toggled. Only wired for guests. */
  onBuzzToggle?: () => void;
  /** "play" for the neon dark wrapper, "producer" for the producer panel. */
  variant: "play" | "producer";
}

// ── component ────────────────────────────────────────────────────────────

export function BuzzPanel({ roster, buzzingSeats, isBuzzing, onBuzzToggle, variant }: BuzzPanelProps) {
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

  const active = !!isBuzzing;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: onBuzzToggle ? "1fr 1fr 1fr auto" : "1fr 1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap: 6,
        ...(isPlay ? {} : { marginTop: 4 }),
      }}
    >
      {/* Row 1: left seats */}
      {LEFT_SEATS.map((seat) => nameBox(seat))}
      {/* Row 2: right seats */}
      {RIGHT_SEATS.map((seat) => nameBox(seat))}
      {/* Buzzer toggle button — spans both rows */}
      {onBuzzToggle && (
        <button
          type="button"
          onClick={onBuzzToggle}
          style={{
            gridRow: "1 / 3",
            gridColumn: 4,
            background: active
              ? "linear-gradient(135deg, #ffbe0b 0%, #e6a800 100%)"
              : "linear-gradient(135deg, #ff2e6b 0%, #cc1a4a 100%)",
            border: active
              ? "2px solid #ffd24d"
              : "2px solid #ff5482",
            borderRadius: 10,
            color: active ? "#1a1a2e" : "#fff",
            fontWeight: 900,
            fontSize: 14,
            letterSpacing: 1,
            cursor: "pointer",
            textShadow: active
              ? "none"
              : "0 0 10px rgba(255, 46, 107, 0.6)",
            boxShadow: active
              ? "0 0 16px rgba(255, 190, 11, 0.5), 0 0 32px rgba(255, 190, 11, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.2)"
              : "0 0 12px rgba(255, 46, 107, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
            transition: "background 150ms, border-color 150ms, color 150ms, box-shadow 150ms, transform 60ms ease-out",
            userSelect: "none",
          }}
        >
          {active ? "ON" : "BUZZ"}
        </button>
      )}
    </div>
  );
}

// ── hook: manages buzzing seat state (persistent toggle) ──────────────────

export function useBuzzState() {
  const [buzzingSeats, setBuzzingSeats] = useState<Set<SeatId>>(new Set());

  const buzzOn = useCallback((seat: SeatId) => {
    setBuzzingSeats((prev) => {
      if (prev.has(seat)) return prev;
      const next = new Set(prev);
      next.add(seat);
      return next;
    });
  }, []);

  const buzzOff = useCallback((seat: SeatId) => {
    setBuzzingSeats((prev) => {
      if (!prev.has(seat)) return prev;
      const next = new Set(prev);
      next.delete(seat);
      return next;
    });
  }, []);

  return { buzzingSeats, buzzOn, buzzOff };
}