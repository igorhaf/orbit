import test from "node:test";
import assert from "node:assert/strict";
import { schemaFieldGroups, type Schema } from "./SchemaFields";

test("schema field groups preserve every visible field once and keep skipped fields hidden", () => {
  const schema: Schema = {
    properties: { name: {}, email: {}, address: {}, notes: {}, hidden: {} },
    "x-orbit-field-groups": [
      { id: "personal", label: "Dados pessoais", fields: ["name", "email", "email", "unknown"] },
      { id: "complementary", label: "Complementares", fields: ["address"] },
    ],
  };
  const groups = schemaFieldGroups(schema, ["hidden"]);
  assert.deepEqual(groups.map(({ id, fields }) => ({ id, fields })), [
    { id: "personal", fields: ["name", "email"] },
    { id: "complementary", fields: ["address"] },
    { id: "other", fields: ["notes"] },
  ]);
  const flattened = groups.flatMap((group) => group.fields);
  assert.equal(new Set(flattened).size, flattened.length);
  assert.ok(!flattened.includes("hidden"));
});

test("schemas without grouping retain their ordinary field order", () => {
  assert.deepEqual(schemaFieldGroups({ properties: { first: {}, second: {} } }), [
    { id: "all", label: "", fields: ["first", "second"] },
  ]);
});
