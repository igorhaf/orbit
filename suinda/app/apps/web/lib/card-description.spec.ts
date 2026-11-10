import assert from "node:assert/strict";
import { test } from "node:test";
import { cardDescriptionText } from "./card-description";

test("description hides reference blocks while preserving the actual task", () => {
  const reference = '[[ORBIT_CONTEXTS]]\n[{"description":"Parent details"}]\n[[/ORBIT_CONTEXTS]]\n';
  assert.equal(cardDescriptionText(`Task requirements\n${reference}Acceptance criteria`), "Task requirements\nAcceptance criteria");
  assert.equal(cardDescriptionText(`${reference}Task\n${reference}`), "Task\n");
  assert.equal(cardDescriptionText(reference), "");
});

test("reference blocks support CRLF and remain distinct from other Orbit tags", () => {
  assert.equal(cardDescriptionText("Task\r\n[[orbit_contexts]]\r\nReference\r\n[[/orbit_contexts]]\r\nResult"), "Task\r\nResult");
  const text = "[[ORBIT_SUMMARY]]\nResult\n[[/ORBIT_SUMMARY]]";
  assert.equal(cardDescriptionText(text), text);
});

test("ordinary description text, inline examples and incomplete blocks remain intact", () => {
  for (const text of ["Task **requirements**", "Use [[ORBIT_CONTEXTS]] as a tag.", "Task\n[[ORBIT_CONTEXTS]]\nIncomplete reference", "[[/ORBIT_CONTEXTS]]\nTask"]) {
    assert.equal(cardDescriptionText(text), text);
  }
});
