// Only complete, standalone reference blocks are hidden; ordinary text and incomplete tags remain visible.
export function cardDescriptionText(description: string): string {
  return description.replace(
    /^[\t ]*\[\[ORBIT_CONTEXTS\]\][\t ]*\r?\n[\s\S]*?^[\t ]*\[\[\/ORBIT_CONTEXTS\]\][\t ]*(?:\r?\n|$)/gmi,
    "",
  );
}
