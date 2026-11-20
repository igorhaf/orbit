import test from "node:test";
import assert from "node:assert/strict";
import { PluginRegistry } from "./registries";

test("plugin registry accepts Orbit textarea presentation format in record schemas", () => {
  const registry = new PluginRegistry();
  assert.doesNotThrow(() => registry.register({
    id: "textarea-fixture",
    name: "Textarea fixture",
    version: "1.0.0",
    contributions: {
      recordKinds: {
        note: {
          label: "Note",
          schema: { type: "object", additionalProperties: false, properties: { body: { type: "string", format: "textarea" } }, required: ["body"] },
          initial: "draft",
          transitions: { draft: [] },
          example: { body: "Example" },
        },
      },
    },
  }));
});

test("record kinds separate hidden transitions from confirmed plugin-owned transition actions", () => {
  const registry = new PluginRegistry();
  const appointment = {
    label: "Appointment",
    schema: { type: "object", properties: {} },
    initial: "scheduled",
    transitions: { scheduled: ["confirmed", "cancelled"], confirmed: ["cancelled"], cancelled: [] },
    hiddenTransitions: ["cancelled"],
    detailActions: [{
      id: "cancel-appointment", label: "Cancel appointment", states: ["scheduled", "confirmed"], permission: "write" as const,
      transition: {
        state: "cancelled",
        reasonChoices: [{ value: "clinic", label: "Cancelled by clinic" }, { value: "keep", label: "Do not cancel" }],
        noOpValue: "keep", noOpLabel: "Do not cancel", confirmation: "Confirm cancellation?",
      },
    }],
    example: {},
  };
  assert.doesNotThrow(() => registry.register({
    id: "appointment-actions", name: "Appointment actions", version: "1.0.0",
    contributions: { recordKinds: { appointment } },
  }));
  assert.throws(() => new PluginRegistry().register({
    id: "invalid-hidden-transition", name: "Invalid hidden transition", version: "1.0.0",
    contributions: { recordKinds: { appointment: { ...appointment, hiddenTransitions: ["missing"] } } },
  }), /Transições ocultas inválidas/);
  assert.throws(() => new PluginRegistry().register({
    id: "invalid-transition-action", name: "Invalid transition action", version: "1.0.0",
    contributions: { recordKinds: { appointment: { ...appointment, detailActions: [{
      ...appointment.detailActions[0], transition: { ...appointment.detailActions[0].transition, state: "missing" },
    }] } } },
  }), /Ação de registro inválida/);
});
