import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { genericPlugins, recordPlugins } from "./catalog";
import {
  validate,
  validateDefinition,
  deadlineDueAt,
  deadlineTransition,
  nextWorkflowState,
} from "./rules";
import { decodeDocument, DocumentScanner } from "./documents";
import { PluginRegistry } from "../../execution/registries";
import { workspacesPlugin } from "../../workspaces/workspaces.plugin";
import { validCnpj } from "../common/identifiers";

test("generic sample contracts reject unknown fields and accept neutral examples", () => {
  for (const { plugin, kinds } of recordPlugins)
    for (const [kind, definition] of Object.entries(kinds)) {
      if (plugin.id === "documents" && kind === "document") continue;
      assert.doesNotThrow(() => {
        validate(definition.schema, definition.example);
        validateDefinition(plugin.id, kind, definition.example);
      }, `${plugin.id}.${kind}`);
      assert.throws(() =>
        validate(definition.schema, {
          ...definition.example,
          invented_field: "forbidden",
        }),
      );
    }
  assert.throws(() => validate({ type: "object" }, undefined));
  assert.throws(() =>
    validateDefinition("forms", "form", {
      schema: {
        type: "object",
        properties: { value: { $ref: "https://example.invalid/schema" } },
      },
    }),
  );
});

test("policy parameters, matrices and workflows enforce semantic consistency", () => {
  assert.throws(
    () =>
      validateDefinition("policy-parameters", "policy", {
        parameters: [{ code: "days", value: 0, minimum: 1 }],
      }),
    /fora dos limites/,
  );
  assert.throws(
    () =>
      validateDefinition("policy-parameters", "policy", {
        parameters: [
          { code: "days", value: 1 },
          { code: "days", value: 2 },
        ],
      }),
    /repetido/,
  );
  assert.throws(
    () =>
      validateDefinition("assessments", "matrix", {
        outcomes: ["ok"],
        dimensions: [
          { code: "d", criteria: [{ code: "c", outcomes: ["unknown"] }] },
        ],
      }),
    /não definido/,
  );
  assert.throws(
    () =>
      validateDefinition("workflows", "definition", {
        states: ["a"],
        initial_state: "b",
        transitions: [],
      }),
    /inicial/,
  );
  const definition = {
    states: ["open", "done"],
    initial_state: "open",
    transitions: [{ from: "open", to: "done" }],
  };
  assert.equal(nextWorkflowState(definition, "open", "done"), "done");
  assert.throws(
    () => nextWorkflowState(definition, "done", "open"),
    /não prevista/,
  );
});

test("deadlines preserve elapsed pause time and reject invalid or completed operations", () => {
  const start = new Date("2030-01-01T00:00:00Z");
  const payload = {
    duration_days: 5,
    started_at: start.toISOString(),
    due_at: deadlineDueAt(start, 5),
  };
  const paused = deadlineTransition(
    "running",
    payload,
    "pause",
    new Date("2030-01-02T00:00:00Z"),
  );
  const resumed = deadlineTransition(
    paused.state,
    paused.payload,
    "resume",
    new Date("2030-01-04T00:00:00Z"),
  );
  assert.equal(resumed.payload.due_at, "2030-01-08T00:00:00.000Z");
  const extended = deadlineTransition(
    resumed.state,
    resumed.payload,
    "extend",
    new Date("2030-01-04T00:00:00Z"),
    2,
  );
  assert.equal(extended.payload.due_at, "2030-01-10T00:00:00.000Z");
  assert.throws(
    () => deadlineTransition("completed", payload, "extend", start, 2),
    /concluído/,
  );
  assert.throws(
    () => deadlineTransition("running", payload, "resume", start),
    /incompatível/,
  );
  assert.throws(() => deadlineDueAt(start, 0));
});

test("document ingestion rejects traversal, forged formats and unavailable configured scanners", async () => {
  const content = Buffer.from("%PDF-1.7\nexample").toString("base64");
  assert.equal(
    decodeDocument(content, "application/pdf", "sample.pdf").size_bytes,
    16,
  );
  assert.throws(() => decodeDocument(content, "image/png", "sample.png"));
  assert.throws(() =>
    decodeDocument(content, "application/pdf", "../sample.pdf"),
  );
  assert.throws(() =>
    decodeDocument("malformed?", "application/pdf", "sample.pdf"),
  );
  const previous = process.env.ORBIT_DOCUMENT_SCANNER_BIN;
  try {
    delete process.env.ORBIT_DOCUMENT_SCANNER_BIN;
    assert.equal(
      await new DocumentScanner().scan(Buffer.from("test")),
      "not_configured",
    );
    process.env.ORBIT_DOCUMENT_SCANNER_BIN = "/missing/orbit-scanner";
    await assert.rejects(
      () => new DocumentScanner().scan(Buffer.from("test")),
      /indisponível/,
    );
  } finally {
    if (previous === undefined) delete process.env.ORBIT_DOCUMENT_SCANNER_BIN;
    else process.env.ORBIT_DOCUMENT_SCANNER_BIN = previous;
  }
});

test("generic plugins coexist and suspend transitively without losing their configured state", () => {
  const registry = new PluginRegistry();
  registry.register(workspacesPlugin);
  for (const plugin of genericPlugins) registry.register(plugin);
  registry.setEnabled("versioned-records", false);
  for (const { plugin } of recordPlugins)
    assert.equal(registry.isEnabled(plugin.id), false);
  registry.setEnabled("privacy", false);
  registry.setEnabled("versioned-records", true);
  assert.equal(registry.isEnabled("privacy"), false);
  assert.equal(registry.isEnabled("forms"), true);
  registry.setEnabled("workspaces", false);
  assert.equal(registry.isEnabled("forms"), false);
  registry.setEnabled("workspaces", true);
  assert.equal(registry.isEnabled("forms"), true);
});

test("the reusable organization identifier validator rejects invalid check digits", () => {
  assert.equal(validCnpj("11.222.333/0001-81"), true);
  assert.equal(validCnpj("11.222.333/0001-82"), false);
  assert.equal(validCnpj("00.000.000/0000-00"), false);
});
