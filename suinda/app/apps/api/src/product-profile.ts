import type { PluginRegistry } from "./execution/registries";

/** Product profiles constrain optional modules without changing stored desired plugin settings. */
const suindaDisabledPlugins = new Set([
  "codex-ide",
  "software-development",
  "alexa-orbit",
  "cloudflare-tunnel",
  "trello",
  "google_drive",
  "gmail",
  "outlook_mail",
  "github",
  "git",
  "ssh",
  "delivery",
  "dropbox",
  "planner",
]);

export function activeProductProfile(): string {
  return process.env.ORBIT_PRODUCT?.trim().toLowerCase() || "orbit";
}

export function productWebOrigin(): string {
  const configuredOrigin = activeProductProfile() === "suinda"
    ? process.env.SUINDA_WEB_ORIGIN?.trim() || process.env.WEB_ORIGIN?.trim()
    : process.env.WEB_ORIGIN?.trim();
  return configuredOrigin || (activeProductProfile() === "suinda" ? "http://localhost:3003" : "http://localhost:3000");
}

export function productProfileDisablesPlugin(pluginId: string): boolean {
  return activeProductProfile() === "suinda" && suindaDisabledPlugins.has(pluginId);
}

export function applyProductProfile(registry: PluginRegistry): void {
  if (activeProductProfile() !== "suinda") return;
  for (const id of suindaDisabledPlugins) {
    if (registry.isInstalled(id)) registry.setEnabled(id, false);
  }
}
