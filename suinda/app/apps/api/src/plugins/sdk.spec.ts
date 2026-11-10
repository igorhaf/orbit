import assert from "node:assert/strict";
import { test } from "node:test";
import { PluginRegistry } from "../execution/registries";
import {
  defineAction,
  defineCapability,
  defineConnectionProvider,
  definePlugin,
} from "./sdk";

test("plugin SDK creates a registry-ready plugin using only public helpers", () => {
  const plugin = definePlugin({
    id: "notion",
    name: "Notion",
    version: "1.0.0",
    capabilities: [defineCapability({ id: "pages.read", name: "Read pages" })],
    actions: [
      defineAction({
        id: "pages.get",
        name: "Get page",
        requiredCapabilities: ["pages.read"],
        inputSchema: { type: "object", required: ["pageId"] },
        async execute(input) {
          return { type: "json", value: input };
        },
      }),
    ],
    connectionProvider: defineConnectionProvider({
      id: "notion-oauth",
      name: "Notion OAuth",
      supportsMultiple: true,
      capabilities: ["pages.read"],
    }),
  });
  const registry = new PluginRegistry();
  registry.register(plugin);
  assert.equal(registry.getAction("notion", "pages.get").name, "Get page");
  assert.equal(Object.isFrozen(plugin), true);
});

test("plugin SDK rejects invalid ids, schemas, duplicates and missing capabilities", () => {
  assert.throws(() => defineCapability({ id: "Invalid ID", name: "Invalid" }));
  assert.throws(() =>
    defineAction({ id: "run", name: "Run", inputSchema: { type: "invalid" } }),
  );
  const capability = defineCapability({ id: "read", name: "Read" });
  assert.throws(() =>
    definePlugin({
      id: "duplicate",
      name: "Duplicate",
      version: "1.0.0",
      capabilities: [capability, capability],
    }),
  );
  assert.throws(() =>
    definePlugin({
      id: "missing-capability",
      name: "Missing capability",
      version: "1.0.0",
      actions: [
        defineAction({
          id: "run",
          name: "Run",
          requiredCapabilities: ["unknown"],
          inputSchema: { type: "object" },
        }),
      ],
    }),
  );
});

test("plugin SDK requires child plugins to depend on the declared parent", () => {
  assert.throws(() => definePlugin({ id: "child", name: "Child", version: "1.0.0", parentPlugin: "host" }), /declarar dependência do pai/);
  const child = definePlugin({ id: "child", name: "Child", version: "1.0.0", parentPlugin: "host", dependencies: ["host"] });
  assert.equal(child.parentPlugin, "host");
});
