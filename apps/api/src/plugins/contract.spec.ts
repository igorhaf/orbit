import assert from "node:assert/strict";
import { test } from "node:test";
import { PluginRegistry } from "../execution/registries";
import { PluginDefinition } from "./contract";
import { trelloPluginDefinition } from "../trello-sync";

const example = (): PluginDefinition => ({
  id: "example",
  name: "Example",
  version: "1.2.0",
  scope: "account",
  capabilities: [
    { id: "calendar.events.read", name: "Read events" },
    { id: "calendar.events.write", name: "Write events" },
  ],
  actions: [
    {
      id: "events.list",
      name: "List events",
      requiredCapabilities: ["calendar.events.read"],
      permissions: [],
      inputSchema: {
        type: "object",
        properties: { sourceId: { type: "string" } },
        required: ["sourceId"],
        additionalProperties: false,
      },
      outputSchema: { type: "object" },
      async execute(input) {
        return { type: "json", value: { sourceId: input.sourceId } };
      },
    },
  ],
  connectionProvider: {
    id: "example-oauth",
    name: "Example OAuth",
    supportsMultiple: true,
    capabilities: ["calendar.events.read", "calendar.events.write"],
  },
  contributions: { settings: [{ id: "example-settings" }] },
});

test("plugin registry discovers definitions, actions, capabilities and connections", () => {
  const registry = new PluginRegistry();
  registry.register(example());
  assert.equal(registry.getById("example").version, "1.2.0");
  assert.equal(registry.getAction("example", "events.list").name, "List events");
  assert.equal(registry.getCapability("example", "calendar.events.read").name, "Read events");
  assert.equal(registry.connectionProviders()[0].supportsMultiple, true);
  assert.deepEqual(registry.catalog()[0].contributions.settings, [{ id: "example-settings" }]);
});

test("plugin registry rejects duplicates, missing plugins and malformed definitions", () => {
  const registry = new PluginRegistry();
  registry.register(example());
  assert.throws(() => registry.register(example()), /duplicado/i);
  assert.throws(() => registry.getById("missing"), /não registrado/i);
  assert.throws(() => registry.getAction("example", "missing"), /não registrada/i);
  assert.throws(() => new PluginRegistry().register({ ...example(), version: "latest" }));
  assert.throws(() =>
    new PluginRegistry().register({
      ...example(),
      actions: [{ ...example().actions![0], inputSchema: { type: "unknown" } }],
    }),
  );
  assert.throws(() =>
    new PluginRegistry().register({
      ...example(),
      actions: [example().actions![0], example().actions![0]],
    }),
  );
});

test("existing Trello integration exposes the stable plugin contract", () => {
  const registry = new PluginRegistry();
  registry.register(trelloPluginDefinition);
  assert.equal(registry.getById("trello").scope, "board");
  assert.deepEqual(registry.connectionProviders()[0].capabilities, [
    "cards.external.read",
    "cards.external.write",
  ]);
});
