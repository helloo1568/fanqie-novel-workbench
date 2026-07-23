export function isPrimaryShortcut(event: KeyboardEvent, key: string) {
  return !event.isComposing && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === key.toLowerCase();
}

export function isSaveShortcut(event: KeyboardEvent) {
  return isPrimaryShortcut(event, "s");
}

export function isSearchShortcut(event: KeyboardEvent) {
  return isPrimaryShortcut(event, "k");
}

export function isEscapeKey(event: KeyboardEvent) {
  return event.key === "Escape";
}

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}
