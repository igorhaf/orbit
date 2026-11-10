import assert from "node:assert/strict";
import test from "node:test";
import { applyProductProfile, activeProductProfile, productProfileDisablesPlugin, productWebOrigin } from "./product-profile";

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { run(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("Suindá product profile isolates development plugins and preserves course integrations", () => {
  withEnv({ ORBIT_PRODUCT: " SuIndA ", WEB_ORIGIN: undefined, SUINDA_WEB_ORIGIN: undefined }, () => {
    assert.equal(activeProductProfile(), "suinda");
    assert.equal(productWebOrigin(), "http://localhost:3003");

    const disabled: string[] = [];
    applyProductProfile({
      isInstalled: () => true,
      setEnabled: (id: string, enabled: boolean) => { if (!enabled) disabled.push(id); },
    } as never);

    assert.deepEqual(disabled.sort(), [
      "alexa-orbit", "cloudflare-tunnel", "codex-ide", "delivery", "dropbox", "git", "github", "gmail",
      "google_drive", "outlook_mail", "planner", "ssh", "software-development", "trello",
    ].sort());
    for (const id of ["ai", "google-calendar", "outlook-calendar", "microsoft-teams", "zoom", "suinda-learning"])
      assert.equal(productProfileDisablesPlugin(id), false, `${id} deve permanecer disponível neste perfil.`);
  });
});

test("Orbit keeps its default profile and independent web origins", () => {
  withEnv({ ORBIT_PRODUCT: undefined, WEB_ORIGIN: undefined, SUINDA_WEB_ORIGIN: "https://suinda.example" }, () => {
    assert.equal(activeProductProfile(), "orbit");
    assert.equal(productWebOrigin(), "http://localhost:3000");
    assert.equal(productProfileDisablesPlugin("planner"), false);
  });

  withEnv({ ORBIT_PRODUCT: "suinda", WEB_ORIGIN: "https://orbit.example", SUINDA_WEB_ORIGIN: "https://suinda.example" }, () => {
    assert.equal(productWebOrigin(), "https://suinda.example");
  });
});
