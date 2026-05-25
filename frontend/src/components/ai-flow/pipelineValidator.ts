/**
 * Pipeline Validator — v3.5
 *
 * Roda antes de salvar/executar pra rejeitar grafos inválidos:
 *   - subflow sem saída: nenhum caminho do Entrada do subflow chega no Saída
 *   - node órfão dentro de subflow: sem nenhuma edge entrando nem saindo
 *   - input obrigatório sem conexão: schema declara required mas handle vazio
 *   - subflow sem ioNode Entrada ou Saída
 *
 * Não bloqueia "edges fora do fluxo" como conexões soltas — o usuário pode
 * desconectar pontas de edges temporariamente; mas no momento do SAVE, o
 * grafo precisa estar consistente.
 */

import type { Node, Edge } from '@xyflow/react';
import type { Subflow } from '@/hooks/useCanvasState';
import { schemaFor, type NodeSchema } from './flowTypes';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  nodeId?: string;
  subflowId?: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

interface ValidatorContext {
  nodes: Node[];
  edges: Edge[];
  subflows: Record<string, Subflow>;
  typesSchema: Record<string, NodeSchema>;
}

/**
 * Build BFS adjacency from edges (source → [target]) and reverse (target → [source]).
 */
function buildAdjacency(edges: Edge[]) {
  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!e.source || !e.target) continue;
    if (!forward.has(e.source)) forward.set(e.source, new Set());
    forward.get(e.source)!.add(e.target);
    if (!reverse.has(e.target)) reverse.set(e.target, new Set());
    reverse.get(e.target)!.add(e.source);
  }
  return { forward, reverse };
}

function reachable(start: string, forward: Map<string, Set<string>>, allowedSet: Set<string>): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const nexts = forward.get(cur);
    if (!nexts) continue;
    for (const n of nexts) {
      if (allowedSet.has(n)) stack.push(n);
    }
  }
  return seen;
}

/**
 * Validate a single subflow: must have Entrada AND Saída, and a path
 * between them; no orphan nodes inside.
 */
function validateSubflow(
  subflowId: string,
  sf: Subflow,
  ctx: ValidatorContext,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const memberIds = new Set(sf.node_ids || []);
  if (memberIds.size === 0) return issues; // empty subflow is fine

  const members = ctx.nodes.filter((n) => memberIds.has(n.id));
  const ioInputs = members.filter((n) => n.type === 'ioNode' && (n.data as any)?.io_kind === 'input');
  const ioOutputs = members.filter((n) => n.type === 'ioNode' && (n.data as any)?.io_kind === 'output');

  // Subflows que são containers (têm child_subflow_ids) podem não ter
  // ioNodes próprios se a hierarquia delega aos children. Só exigimos
  // entrada/saída quando há nodes executáveis (utility/model) dentro.
  const hasExecutable = members.some((n) =>
    n.type === 'modelNode' || n.type === 'utilityNode' || n.type === 'controlFlowNode',
  );
  const hasChildSubflows = (sf.child_subflow_ids || []).length > 0;

  if (!hasExecutable && !hasChildSubflows) {
    // subflow vazio — skip silenciosamente
    return issues;
  }

  if (ioInputs.length === 0) {
    issues.push({
      severity: 'error',
      message: `Subflow "${sf.label}" não tem ioNode Entrada`,
      subflowId,
    });
  }
  if (ioOutputs.length === 0) {
    issues.push({
      severity: 'error',
      message: `Subflow "${sf.label}" não tem ioNode Saída`,
      subflowId,
    });
  }
  if (ioInputs.length > 1) {
    issues.push({
      severity: 'warning',
      message: `Subflow "${sf.label}" tem ${ioInputs.length} Entradas — esperado 1`,
      subflowId,
    });
  }
  if (ioOutputs.length > 1) {
    issues.push({
      severity: 'warning',
      message: `Subflow "${sf.label}" tem ${ioOutputs.length} Saídas — esperado 1`,
      subflowId,
    });
  }

  // BFS Entrada → Saída para garantir caminho
  if (ioInputs.length && ioOutputs.length) {
    const { forward, reverse } = buildAdjacency(ctx.edges);
    const startId = ioInputs[0].id;
    const endId = ioOutputs[0].id;
    const reachedFromStart = reachable(startId, forward, memberIds);
    if (!reachedFromStart.has(endId)) {
      issues.push({
        severity: 'error',
        message: `Subflow "${sf.label}" não tem caminho da Entrada até a Saída`,
        subflowId,
      });
    }

    // Nodes órfãos: dentro do subflow, sem nenhuma edge no membro
    for (const n of members) {
      // ioNodes são pontas; não precisam estar dentro do caminho de outro
      if (n.type === 'ioNode') continue;
      // subflowNodes representam children — checados separadamente
      if (n.type === 'subflowNode') continue;
      // v3.6.2: groupNodes são containers VISUAIS (parent de outros nodes
      // via parentId), nunca recebem/produzem edges por design. Não são
      // órfãos — pular o check de adjacência.
      if (n.type === 'groupNode') continue;
      const fwd = forward.get(n.id) || new Set();
      const rev = reverse.get(n.id) || new Set();
      const hasIncoming = Array.from(rev).some((src) => memberIds.has(src));
      const hasOutgoing = Array.from(fwd).some((tgt) => memberIds.has(tgt));
      if (!hasIncoming && !hasOutgoing) {
        issues.push({
          severity: 'error',
          message: `Node "${(n.data as any)?.label || n.id}" está órfão no subflow "${sf.label}"`,
          nodeId: n.id,
          subflowId,
        });
      } else if (!hasIncoming) {
        issues.push({
          severity: 'warning',
          message: `Node "${(n.data as any)?.label || n.id}" não tem entrada dentro do subflow`,
          nodeId: n.id,
          subflowId,
        });
      }
    }
  }

  // Required inputs sem conexão (check via schema)
  const { reverse } = buildAdjacency(ctx.edges);
  for (const n of members) {
    const schema = schemaFor(n, ctx.typesSchema);
    if (!schema) continue;
    const incoming = reverse.get(n.id) || new Set();
    // Não temos info de qual handle a edge conectou (lookup por edge.targetHandle)
    // então vamos rodar uma checagem mais simples: se há inputs required e
    // ZERO edges entrando, marca.
    const requiredInputs = schema.inputs.filter((i) => i.required);
    if (requiredInputs.length > 0 && incoming.size === 0) {
      issues.push({
        severity: 'warning',
        message: `"${(n.data as any)?.label || n.id}" tem input obrigatório (${requiredInputs.map(i => i.name).join(', ')}) sem conexão`,
        nodeId: n.id,
        subflowId,
      });
    }
  }

  return issues;
}

export function validatePipeline(
  nodes: Node[],
  edges: Edge[],
  subflows: Record<string, Subflow>,
  typesSchema: Record<string, NodeSchema>,
): ValidationResult {
  const ctx: ValidatorContext = { nodes, edges, subflows, typesSchema };
  const allIssues: ValidationIssue[] = [];

  for (const [sfId, sf] of Object.entries(subflows)) {
    allIssues.push(...validateSubflow(sfId, sf, ctx));
  }

  const errors = allIssues.filter((i) => i.severity === 'error');
  return { ok: errors.length === 0, issues: allIssues };
}

/**
 * v3.5.1 — Pre-run validation. Mais estrita que validatePipeline:
 *   1. Tudo do validatePipeline (subflow sem saída, órfão, etc) — errors
 *   2. SubflowNodes que aparecem visualmente no pai (área) mas não estão
 *      conectados ao fluxo dele (Entrada/Saída ou outros sub-subflows)
 *   3. Áreas (root level) que não estão na cadeia root_start → root_end
 *
 * Resultado: rejeita execução quando há subflows ou nodes "soltos" que
 * o engine não saberia processar.
 */
export function validatePipelinePreRun(
  nodes: Node[],
  edges: Edge[],
  subflows: Record<string, Subflow>,
  typesSchema: Record<string, NodeSchema>,
): ValidationResult {
  const base = validatePipeline(nodes, edges, subflows, typesSchema);
  const issues: ValidationIssue[] = [...base.issues];

  const { forward, reverse } = buildAdjacency(edges);

  // (2) Verificar que cada subflowNode tem entrada+saída dentro do PAI.
  // Para isso, descobrimos qual subflow CONTÉM esse subflowNode:
  // procuramos qual subflow tem o subflowNode.id em seus node_ids.
  const containerOf = new Map<string, string>(); // subflowNode.id → parent subflow id
  for (const [parentId, sf] of Object.entries(subflows)) {
    for (const nid of sf.node_ids || []) {
      const n = nodes.find((x) => x.id === nid);
      if (n?.type === 'subflowNode') {
        containerOf.set(nid, parentId);
      }
    }
  }

  for (const n of nodes) {
    if (n.type !== 'subflowNode') continue;
    const parentSfId = containerOf.get(n.id);
    if (!parentSfId) {
      // Está no ROOT — checagem própria abaixo
      continue;
    }
    const parentSf = subflows[parentSfId];
    if (!parentSf) continue;
    const parentMembers = new Set(parentSf.node_ids || []);
    const incoming = reverse.get(n.id) || new Set();
    const outgoing = forward.get(n.id) || new Set();
    const incomingFromParent = Array.from(incoming).some((s) => parentMembers.has(s));
    const outgoingToParent = Array.from(outgoing).some((t) => parentMembers.has(t));
    if (!incomingFromParent || !outgoingToParent) {
      issues.push({
        severity: 'error',
        message: `Subflow "${(n.data as any)?.label || n.id}" está solto no pai "${parentSf.label}" (sem entrada ou saída ligada)`,
        nodeId: n.id,
        subflowId: parentSfId,
      });
    }
  }

  // (3) Áreas do root: precisam estar encadeadas (root_start → ... → root_end).
  // No nosso modelo, áreas têm parent_id="__root__". Os subflowNodes correspondentes
  // (`sf-discovery`, `sf-cards`, etc) ficam no ROOT (não em nenhum subflow).
  // Checamos se cada um tem incoming OU outgoing (primeiro/último permitidos).
  const rootSubflowNodes = nodes.filter(
    (n) => n.type === 'subflowNode' && !containerOf.has(n.id),
  );
  if (rootSubflowNodes.length > 1) {
    for (const n of rootSubflowNodes) {
      const incoming = (reverse.get(n.id) || new Set());
      const outgoing = (forward.get(n.id) || new Set());
      // Filtra incoming/outgoing pra apenas outras áreas do root
      const rootSiblings = new Set(rootSubflowNodes.map((s) => s.id));
      const incFromSibling = Array.from(incoming).some((s) => rootSiblings.has(s));
      const outToSibling = Array.from(outgoing).some((t) => rootSiblings.has(t));
      // Cada área deve ter ao menos uma conexão pra ou de outra área irmã;
      // a primeira não precisa ter incoming, a última não precisa ter outgoing.
      if (!incFromSibling && !outToSibling) {
        issues.push({
          severity: 'error',
          message: `Área "${(n.data as any)?.label || n.id}" está solta no Root (não conectada ao pipeline)`,
          nodeId: n.id,
        });
      }
    }
  }

  const errors = issues.filter((i) => i.severity === 'error');
  return { ok: errors.length === 0, issues };
}
