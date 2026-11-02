/** True only when an accessible text value contains a visible code point. */
export function hasAccessibleText(value: unknown): value is string {
  return typeof value === "string" && value.replace(/[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]/gu, "").length > 0;
}
