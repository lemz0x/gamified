/** Strip control chars, zero-width spaces, and collapse whitespace.
 *  Used by both PlayRoute and ChatRoute before sending chat to the overlay. */
export function sanitizeForOverlay(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\u200B-\u200F\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}