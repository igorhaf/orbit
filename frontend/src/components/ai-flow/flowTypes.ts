/**
 * Flow Types — v3.5
 *
 * Shared types + helpers for the canvas type system. The backend snapshot
 * ships a `types_schema` per kind; this module exposes that as a singleton
 * + convenience helpers used by:
 *   - useConnectionValidator (type check on connect)
 *   - ControlFlowNode (figure out which handles to render)
 *   - PipelineValidator (pre-save consistency check)
 *
 * Canonical type strings live in the backend (`ai_flow.py` TYPE_*).
 */

export interface PortSpec {
  name: string;          // handle id in ReactFlow
  type: string;          // canonical type string ('Any', 'Boolean', 'JSON', ...)
  required?: boolean;    // inputs only
}

export interface NodeSchema {
  inputs: PortSpec[];
  outputs: PortSpec[];
  dynamic_outputs?: boolean;
}

/** Compatibility check. Any always matches; otherwise exact string match. */
export function typesCompatible(sourceType: string, targetType: string): boolean {
  if (!sourceType || !targetType) return true;
  if (sourceType === 'Any' || targetType === 'Any') return true;
  return sourceType === targetType;
}

/**
 * Resolve the kind of a node. ModelNode / ioNode have `data.kind` only when
 * the backend marks them (e.g. utility templates); for legacy nodes we map
 * by `node.type`.
 */
export function kindOf(node: { type?: string | null; data?: any } | null | undefined): string | null {
  if (!node) return null;
  const dataKind = node.data?.kind;
  if (dataKind) return dataKind;
  // Map ReactFlow type → canonical kind in NODE_IO_SCHEMA
  switch (node.type) {
    case 'modelNode':
      return 'model';
    case 'ioNode':
      return (node.data?.io_kind === 'output') ? 'io_output' : 'io_input';
    case 'subflowNode':
      // Subflows são containers — type-check passa pelos ioNodes internos.
      return null;
    case 'pipelinePhaseNode':
      return 'model';  // legacy, treat like a model call
    default:
      return null;
  }
}

/** Resolve the schema for a node from a types_schema map. */
export function schemaFor(
  node: { type?: string | null; data?: any } | null | undefined,
  schemas: Record<string, NodeSchema> | undefined,
): NodeSchema | null {
  if (!node || !schemas) return null;
  const kind = kindOf(node);
  if (!kind) return null;
  return schemas[kind] || null;
}
