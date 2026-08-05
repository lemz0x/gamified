/**
 * Splits a plain-text string into segments, detecting http/https URLs and
 * rendering them as clickable links. Does NOT auto-link bare domains
 * (e.g. "example.com") to avoid false positives.
 *
 * Usage:
 *   const segments = linkify("check https://example.com out");
 *   // [{ type: "text", value: "check " },
 *   //  { type: "link", value: "https://example.com" },
 *   //  { type: "text", value: " out" }]
 *
 * Returns an array of segments. The consumer renders <a> tags for "link"
 * segments with target="_blank" rel="noopener noreferrer".
 */

export type LinkSegment =
  | { type: "text"; value: string }
  | { type: "link"; value: string };

// Match http:// or https:// followed by non-whitespace characters.
// Stops at the last non-whitespace char before a space or end of string.
const URL_RE = /(https?:\/\/[^\s]+)/g;

export function linkify(text: string): LinkSegment[] {
  if (!text) return [{ type: "text", value: "" }];
  const segments: LinkSegment[] = [];
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  // Guard against an infinite loop from a malicious regex — but our
  // URL_RE is simple enough that it can't happen.
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > lastEnd) {
      segments.push({ type: "text", value: text.slice(lastEnd, match.index) });
    }
    segments.push({ type: "link", value: match[0] });
    lastEnd = match.index + match[0].length;
  }
  if (lastEnd < text.length) {
    segments.push({ type: "text", value: text.slice(lastEnd) });
  }
  return segments.length > 0
    ? segments
    : [{ type: "text", value: text }];
}

/**
 * Render helper for React consumers. Returns an array of React nodes
 * suitable for dropping inside a JSX element.
 *
 * <span>{renderLinks(msg)}</span>
 *
 * Uses `key` props for React reconciliation. Links open in a new tab
 * with `noopener noreferrer` to prevent tab-nabbing.
 */
import React from "react";

const DEFAULT_LINK_STYLE: React.CSSProperties = {
  color: "#22e2ff",
  textDecoration: "underline",
  textUnderlineOffset: 2,
};

export function renderLinks(
  text: string,
  linkStyle?: React.CSSProperties,
): React.ReactNode[] {
  return linkify(text).map((seg, i) => {
    if (seg.type === "link") {
      return (
        <a
          key={`link-${i}`}
          href={seg.value}
          target="_blank"
          rel="noopener noreferrer"
          style={linkStyle ?? DEFAULT_LINK_STYLE}
        >
          {seg.value}
        </a>
      );
    }
    return <React.Fragment key={`text-${i}`}>{seg.value}</React.Fragment>;
  });
}
