/**
 * Keyboard navigation arithmetic for the WAI-ARIA tabs pattern.
 *
 * Kept out of the component because the wrapping is the part that breaks
 * silently: `(current - 1 + count) % count` is correct, `(current - 1) % count`
 * returns -1 at the left edge in JavaScript, and nothing about the rendered UI
 * makes that visible until a keyboard user hits the first tab.
 */

/**
 * The index the selection should move to, or `null` when `key` isn't one of the
 * navigation keys (so the caller knows to leave the event alone rather than
 * calling preventDefault on every keystroke).
 *
 * Left/Right wrap around both ends; Home/End jump to the edges.
 */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  // A caller that can't find the active tab still gets sane movement.
  const from = current >= 0 && current < count ? current : 0;

  switch (key) {
    case "ArrowRight":
      return (from + 1) % count;
    case "ArrowLeft":
      return (from - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
