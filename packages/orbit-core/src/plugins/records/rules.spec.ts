import test from "node:test";
import assert from "node:assert/strict";
import { validate } from "./rules";

test("textarea is a presentation annotation while JSON Schema still validates the value type", () => {
  const schema = { type: "string", maxLength: 40, format: "textarea" };
  assert.doesNotThrow(() => validate(schema, "synthetic multi-line\ntext"));
  assert.throws(() => validate(schema, 42), /Conteúdo inválido/);
  assert.throws(() => validate(schema, "x".repeat(41)), /Conteúdo inválido/);
});
