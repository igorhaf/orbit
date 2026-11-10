# Orbit plugin SDK

Plugins use the public helpers in `apps/api/src/plugins/sdk.ts`. A plugin declares
identity, capabilities, actions, triggers, its optional connection provider and UI
contributions without accessing Registry internals.

```ts
export const example = definePlugin({
  id: "example",
  name: "Example",
  version: "1.0.0",
  capabilities: [defineCapability({ id: "items.read", name: "Read items" })],
  actions: [defineAction({
    id: "items.get",
    name: "Get item",
    requiredCapabilities: ["items.read"],
    inputSchema: { type: "object", required: ["id"] },
    async execute(input, context) {
      return { type: "json", value: { input, cardId: context.cardId } };
    },
  })],
});
```

IDs are lowercase and stable. JSON schemas, duplicates and capability references
are validated when definitions are created and again when registered. Handlers
receive `PluginActionContext`; they do not receive the global Nest container.
