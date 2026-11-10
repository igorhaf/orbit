/** Small WCAG contrast helpers shared by Suindá unit-level accessibility checks. */
export function relativeLuminance(hexColor: string): number {
  const normalized = hexColor.trim().replace(/^#/, "");
  if (!/^[\da-f]{6}$/i.test(normalized)) {
    throw new TypeError(`Expected a six-digit RGB color: ${hexColor}`);
  }
  const [red, green, blue] = normalized.match(/[\da-f]{2}/gi)!.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

export function contrastRatio(foreground: string, background: string): number {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}
