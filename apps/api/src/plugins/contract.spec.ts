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

test('plugin configuration fields validate their declared control and option schema',()=>{
  const registry=new PluginRegistry();
  registry.register({...example(),configuration:[
    {key:'EXAMPLE_MODE',label:'Mode',secret:false,type:'select',options:[{value:'safe',label:'Safe'}]},
    {key:'EXAMPLE_SECRET',label:'Secret',secret:true,type:'textarea',allowVaultReference:true},
    {key:'EXAMPLE_LIMIT',label:'Limit',secret:false,type:'number',min:1,max:10},
  ]});
  assert.equal(registry.getById('example').configuration?.[0].type,'select');
  assert.throws(()=>new PluginRegistry().register({...example(),configuration:[{key:'EXAMPLE_MODE',label:'Mode',secret:false,type:'select',options:[]}]}),/Configuração inválida/);
  assert.throws(()=>new PluginRegistry().register({...example(),configuration:[{key:'EXAMPLE_LIMIT',label:'Limit',secret:false,type:'number',min:10,max:1}]}),/Configuração inválida/);
});

test("plugins can contribute versioned record kinds without editing the shared catalog", () => {
  const registry = new PluginRegistry();
  registry.register({
    id: "client-intake",
    name: "Client intake",
    version: "1.0.0",
    dependencies: ["versioned-records"],
    contributions: {
      recordKinds: {
        application: {
          label: "Application",
          schema: {
            type: "object",
            properties: { applicant: { type: "string", minLength: 1 } },
            required: ["applicant"],
            additionalProperties: false,
          },
          initial: "draft",
          transitions: { draft: ["submitted"], submitted: [] },
          immutable: ["submitted"],
          example: { applicant: "Sample applicant" },
          validate: (payload) => payload.applicant
            ? []
            : [{ severity: "warning", code: "missing_applicant", path: "applicant", message: "Review applicant details." }],
        },
      },
    },
  });
  assert.deepEqual(
    registry.getById("client-intake").contributions?.recordKinds?.application?.example,
    { applicant: "Sample applicant" },
  );
  assert.deepEqual(
    registry.getById("client-intake").contributions?.recordKinds?.application?.validate?.({}, { resolveRecord: async () => null }),
    [{ severity: "warning", code: "missing_applicant", path: "applicant", message: "Review applicant details." }],
  );
  assert.throws(() => new PluginRegistry().register({
    id: "invalid-records",
    name: "Invalid records",
    version: "1.0.0",
    contributions: { recordKinds: { application: {
      label: "Application",
      schema: { type: "unknown" },
      initial: "draft",
      transitions: { draft: [] },
      example: {},
    } } },
  }));
});

test("plugin routes may delegate permission checks to their resource-level policy", () => {
  const registry = new PluginRegistry();
  registry.register({
    id: "scoped-resource",
    name: "Scoped resource",
    version: "1.0.0",
    handlesRoute: (path) => path.startsWith("/scoped-resource/"),
    routePermission: () => null,
  });
  assert.equal(registry.routePlugin("/scoped-resource/records/123"), "scoped-resource");
  assert.equal(registry.getById("scoped-resource").routePermission?.("/scoped-resource/records/123", "GET"), null);
});

test("record kinds validate scoped authorization metadata", () => {
  const definition = {
    label: "Process",
    schema: { type: "object", additionalProperties: false, properties: {} },
    initial: "draft",
    transitions: { draft: [] },
    example: {},
  };
  assert.doesNotThrow(() => new PluginRegistry().register({
    id: "scoped-process",
    name: "Scoped process",
    version: "1.0.0",
    contributions: { recordKinds: { process: { ...definition, resourceScoped: true, managePermission: "plugin.sample-process.manage" } } },
  }));
  assert.throws(() => new PluginRegistry().register({
    id: "bad-scope",
    name: "Bad scope",
    version: "1.0.0",
    contributions: { recordKinds: { process: { ...definition, managePermission: "plugin.sample-process.manage" } } },
  }), /Permissão administrativa inválida/);
});

test("record kinds can prepare authorized transitions and enforce unique fields", () => {
  const registry = new PluginRegistry();
  registry.register({
    id: "workflow-record",
    name: "Workflow record",
    version: "1.0.0",
    contributions: { recordKinds: { case: {
      label: "Case",
      schema: { type: "object", properties: { protocol: { type: ["string", "null"] } }, required: ["protocol"], additionalProperties: false },
      initial: "draft",
      transitions: { draft: [] },
      uniqueFields: ["protocol"],
      availableTransitions: async () => ["submitted"],
      authorizeTransition: async () => true,
      prepareTransition: async (_from, _to, payload, context) => ({ ...payload, protocol: await context.nextSequence?.() || "1" }),
      example: { protocol: null },
    } } },
  });
  const definition = registry.getById("workflow-record").contributions?.recordKinds?.case;
  assert.equal(typeof definition?.prepareTransition, "function");
  assert.deepEqual(definition?.uniqueFields, ["protocol"]);
  assert.throws(() => new PluginRegistry().register({
    id: "bad-unique-record",
    name: "Bad unique record",
    version: "1.0.0",
    contributions: { recordKinds: { case: {
      label: "Case",
      schema: { type: "object", properties: { protocol: { type: "string" } }, additionalProperties: false },
      initial: "draft",
      transitions: { draft: [] },
      uniqueFields: ["missing"],
      example: {},
    } } },
  }), /Campos únicos inválidos/);
});

test("record kinds can hide plugin-generated records from generic creation forms", () => {
  const registry = new PluginRegistry();
  registry.register({
    id: "generated-records", name: "Generated records", version: "1.0.0",
    contributions: { recordKinds: { output: {
      label: "Output",
      schema: { type: "object", properties: { source: { type: "string" } }, required: ["source"], additionalProperties: false },
      initial: "generated", transitions: { generated: [] }, serverCreated: true, example: { source: "example" },
    } } },
  });
  assert.equal(registry.getById("generated-records").contributions?.recordKinds?.output.serverCreated, true);
  assert.throws(() => new PluginRegistry().register({
    id: "bad-generated-record", name: "Bad generated record", version: "1.0.0",
    contributions: { recordKinds: { output: {
      label: "Output", schema: { type: "object" }, initial: "generated", transitions: { generated: [] }, serverCreated: "yes" as never, example: {},
    } } },
  }), /Origem de criação inválida/);
});

test("record kinds expose validated plugin-owned detail actions to the shared records UI", () => {
  const registry = new PluginRegistry();
  registry.register({
    id: "record-actions", name: "Record actions", version: "1.0.0",
    contributions: { recordKinds: { item: {
      label: "Item", schema: { type: "object" }, initial: "draft", transitions: { draft: ["done"], done: [] },
      detailActions: [{ id: "publish-item", label: "Publish", retryLabel: "Retry", states: ["draft"], permission: "publish", path: "/plugins/item/{recordId}/publish", ownsTransitions: true, when: { "payload.channel": "email" } }],
      example: {},
    } } },
  });
  assert.equal(registry.getById("record-actions").contributions?.recordKinds?.item.detailActions?.[0].id, "publish-item");
  assert.throws(() => new PluginRegistry().register({
    id: "unsafe-record-action", name: "Unsafe record action", version: "1.0.0",
    contributions: { recordKinds: { item: {
      label: "Item", schema: { type: "object" }, initial: "draft", transitions: { draft: [] },
      detailActions: [{ id: "publish-item", label: "Publish", states: ["draft"], permission: "publish", path: "//evil.example/collect" }],
      example: {},
    } } },
  }), /Ação de registro inválida/);
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


test("navigation groups are declared by plugins and malformed sections are rejected",()=>{
 const grouped={id:"grouped-navigation",name:"Grouped",version:"1.0.0",contributions:{navigation:[{id:"sample-link",label:"Sample",href:"/sample",group:{id:"sample-group",label:"Sample"},section:{id:"workflow",label:"Workflow",order:1}}]}};
 const registry=new PluginRegistry();registry.register(grouped);assert.equal(registry.getById(grouped.id).contributions?.navigation?.[0].group?.id,"sample-group");
 assert.throws(()=>new PluginRegistry().register({...grouped,contributions:{navigation:[{...grouped.contributions.navigation[0],group:undefined}]}}),/exige um grupo/);
 assert.throws(()=>new PluginRegistry().register({...grouped,contributions:{navigation:[{...grouped.contributions.navigation[0],href:"//external.test"}]}}),/navegação inválido/);
});
