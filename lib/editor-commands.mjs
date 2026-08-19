const HEADING_CODES = new Map([
  ["Digit0", "paragraph"],
  ["Digit1", "h1"],
  ["Digit2", "h2"],
  ["Digit3", "h3"],
  ["Digit4", "h4"],
  ["Digit5", "h5"],
  ["Digit6", "h6"],
]);

export function resolveEditorShortcut(event) {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey) return null;

  if (event.shiftKey) {
    if (event.code === "Digit7") return "ordered-list";
    if (event.code === "Digit8") return "bullet-list";
    if (event.code === "KeyQ") return "quote";
    if (event.code === "KeyX") return "strike";
    return null;
  }

  const heading = HEADING_CODES.get(event.code);
  if (heading) return heading;

  switch (String(event.key).toLocaleLowerCase()) {
    case "b":
      return "bold";
    case "i":
      return "italic";
    case "k":
      return "link";
    case "z":
      return "undo";
    case "`":
      return "code";
    default:
      return null;
  }
}

export function appendTrailingEditorLine(content, limit = 2) {
  const value = String(content ?? "");
  const trailingLines = value.match(/\n+$/)?.[0].length ?? 0;
  return trailingLines >= limit ? null : `${value}\n`;
}
