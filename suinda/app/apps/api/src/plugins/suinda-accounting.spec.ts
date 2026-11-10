import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { PluginRegistry } from "../execution/registries";
import { workspacesPlugin } from "../workspaces/workspaces.plugin";
import { genericPlugins } from "./records/catalog";
import { parseFinancialAccountCatalogCsv } from "./financial-account-catalog-csv";
import { parseFinancialStatementCsv } from "./financial-reconciliation-csv";
import { FINANCIAL_NATURES, suindaAccountingPlugin, SuindaAccountingService } from "./suinda-accounting";
import { suindaPlugin } from "./suinda/suinda.plugin";

const workspaceId = "00000000-0000-4000-8000-000000000101";
const unitId = "00000000-0000-4000-8000-000000000102";
const operationId = "00000000-0000-4000-8000-000000000103";
const paymentId = "00000000-0000-4000-8000-000000000104";

test("migration 195 stores workspace account catalogs and immutable import receipts", () => {
  const migration = readFileSync(resolve(__dirname, "../../sql/migrations/195_suinda_financial_account_catalog.sql"), "utf8");
  const schema = readFileSync(resolve(__dirname, "../../sql/schema.sql"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS suinda_financial_account_catalog_imports/);
  assert.match(migration, /UNIQUE\(workspace_id,csv_sha256\)/);
  assert.match(migration, /PRIMARY KEY\(workspace_id,account_code\)/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON suinda_financial_account_catalog_imports/);
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS suinda_financial_account_catalog_imports/);
});

test("migration 196 records minimized immutable provider settlement components", () => {
  const migration = readFileSync(resolve(__dirname, "../../sql/migrations/196_suinda_settlement_components.sql"), "utf8");
  const schema = readFileSync(resolve(__dirname, "../../sql/schema.sql"), "utf8");
  {
    assert.match(migration, /recorded_count/);
    assert.match(migration, /nature IN \('payment','fee','refund','chargeback','net_settlement'\)/);
    assert.match(migration, /reference_sha256/);
    assert.match(migration, /settlement_reference_sha256/);
    assert.match(migration, /occurred_on/);
    assert.match(migration, /amount/);
    assert.match(migration, /match_status='recorded'/);
  }
  assert.doesNotMatch(schema, /suinda_settlement_components/);
});

test("migration 199 persists immutable, workspace-scoped ERP batches and the plugin owns their routes", () => {
  const migration = readFileSync(resolve(__dirname, "../../sql/migrations/199_suinda_erp_delivery.sql"), "utf8");
  const schema = readFileSync(resolve(__dirname, "../../sql/schema.sql"), "utf8");
  {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS suinda_erp_integrations/);
    assert.match(migration, /token_encrypted/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS suinda_erp_batches/);
    assert.match(migration, /payload_sha256/);
    assert.match(migration, /suinda_erp_batch_immutable/);
    assert.match(migration, /status IN \('pending','sending','delivered','failed'\)/);
  }
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS suinda_erp_integrations/);
  assert.equal(suindaAccountingPlugin.handlesRoute?.(`/extensions/suinda-accounting/workspaces/${workspaceId}/erp/config`), true);
  assert.equal(suindaAccountingPlugin.handlesRoute?.(`/extensions/suinda-accounting/workspaces/${workspaceId}/erp/batches`), true);
  assert.equal(suindaAccountingPlugin.handlesRoute?.(`/extensions/suinda-accounting/workspaces/${workspaceId}/erp/batches/${operationId}/retry`), true);
  assert.equal(suindaAccountingPlugin.handlesRoute?.(`/extensions/suinda-accounting/workspaces/${workspaceId}/erp/batches/${operationId}/delete`), false);
});

test("ERP delivery history supports stable keyset pages without breaking legacy no-query shape", async () => {
  const rows = Array.from({ length: 4 }, (_, index) => ({ id: `00000000-0000-4000-8000-00000000020${index + 1}`,
    _cursor_created_at: `2026-10-2${4 - index}T12:00:00.000000Z`, created_at: new Date(`2026-10-2${4 - index}T12:00:00.000Z`) }));
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    async one(sql: string) {
      calls.push({ sql, args: [] });
      return sql.includes("count(*)") ? { total: rows.length } : { id: workspaceId };
    },
    async query(sql: string, args: unknown[] = []) {
      calls.push({ sql, args });
      if (!sql.includes("FROM suinda_erp_batches")) return [];
      if (!sql.includes("LIMIT")) return rows;
      const cursorAt = args[1] ? String(args[1]).slice(0, 19) : null;
      const cursorIndex = cursorAt ? rows.findIndex((row) => row._cursor_created_at.startsWith(cursorAt)) + 1 : 0;
      return rows.slice(cursorIndex, cursorIndex + Number(args.at(-1)));
    },
  };
  const access = { async has(_user: string, _permission: string, scopeType?: string, scopeId?: string) {
    return scopeType === "workspace" && scopeId === workspaceId;
  } };
  const service = new SuindaAccountingService(db as never, access as never, registry(), {} as never);
  const legacy = await service.listErpBatches(workspaceId, "manager");
  assert.deepEqual(legacy, { batches: rows });
  assert.doesNotMatch(calls.at(-1)!.sql, /LIMIT/);
  const first = await service.listErpBatches(workspaceId, "manager", undefined, 2, true) as {
    batches: Array<{ id: string }>; total: number; has_more: boolean; next_cursor: string | null;
  };
  assert.deepEqual(first.batches.map((row) => row.id), rows.slice(0, 2).map((row) => row.id));
  assert.equal(first.total, 4);
  assert.equal(first.has_more, true);
  assert.ok(first.next_cursor);
  const second = await service.listErpBatches(workspaceId, "manager", first.next_cursor!, 2, true) as {
    batches: Array<{ id: string }>; has_more: boolean; next_cursor: string | null;
  };
  assert.deepEqual(second.batches.map((row) => row.id), rows.slice(2).map((row) => row.id));
  assert.equal(second.has_more, false);
  assert.equal(second.next_cursor, null);
  await assert.rejects(() => service.listErpBatches(workspaceId, "manager", "invalid", 2, true), /Cursor do histórico ERP inválido/);
  await assert.rejects(() => service.listErpBatches(workspaceId, "manager", undefined, 101, true), /limite deve estar entre 1 e 100/);
});

test("imports a provider-neutral chart of accounts with hierarchy and Portuguese account types", () => {
  assert.deepEqual(parseFinancialAccountCatalogCsv("código_pai;descrição;tipo;código\n;Ativos;ativo;1\n1;Receitas;receita;4\n4;Receitas de cursos;receita;4.1"), [
    { line: 2, code: "1", name: "Ativos", type: "asset", parent_code: null },
    { line: 3, code: "4", name: "Receitas", type: "revenue", parent_code: "1" },
    { line: 4, code: "4.1", name: "Receitas de cursos", type: "revenue", parent_code: "4" },
  ]);
  assert.deepEqual(parseFinancialAccountCatalogCsv("code,name,type,parent_code\n1,Ativos,asset,\n1.1,Caixa,asset,1"), [
    { line: 2, code: "1", name: "Ativos", type: "asset", parent_code: null },
    { line: 3, code: "1.1", name: "Caixa", type: "asset", parent_code: "1" },
  ]);
});

test("rejects invalid account catalog headers, duplicates, cycles, parent references and control characters", () => {
  assert.throws(() => parseFinancialAccountCatalogCsv("code,name,unexpected\n1,Caixa,x"), /colunas reconhecidas/);
  assert.throws(() => parseFinancialAccountCatalogCsv("code,name\n1,Caixa\n1,Banco"), /aparece mais de uma vez/);
  assert.throws(() => parseFinancialAccountCatalogCsv("code,name,parent_code\n1,Raiz,2\n2,Filha,1"), /ciclo/);
  assert.throws(() => parseFinancialAccountCatalogCsv("code,name,parent_code\n1,Raiz,missing"), /não aparece neste plano/);
  assert.throws(() => parseFinancialAccountCatalogCsv(`code,name\n1,"Nome${String.fromCharCode(1)}inválido"`), /caracteres de controle/);
});

test("imports and replays a validated account catalog without storing source CSV text", async () => {
  const importedRows = new Map<string, { account_code: string; account_name: string; account_type: string; parent_code: string | null; imported_at: Date }>();
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  let importRow: { id: string; row_count: number; imported_at: Date } | null = null;
  let accountInsertCount = 0;
  const db = {
    async one(sql: string) {
      if (sql.includes("FROM workspaces")) return { id: workspaceId };
      if (sql.includes("suinda_financial_account_catalog_imports")) return importRow;
      return null;
    },
    async query(sql: string) {
      if (sql.includes("FROM suinda_financial_account_catalog\n")) return [...importedRows.values()];
      return [];
    },
    pool: { async connect() {
      return {
        async query(sql: string, args: unknown[] = []) {
          statements.push({ sql, args });
          if (sql.includes("SELECT id::text FROM suinda_financial_account_catalog_imports"))
            return { rows: importRow ? [{ id: importRow.id }] : [] };
          if (sql.includes("SELECT account_code,parent_code FROM suinda_financial_account_catalog"))
            return { rows: [...importedRows.values()].map(({ account_code, parent_code }) => ({ account_code, parent_code })) };
          if (sql.includes("INSERT INTO suinda_financial_account_catalog_imports"))
            importRow = { id: String(args[0]), row_count: Number(args[3]), imported_at: new Date("2026-10-24T12:00:00Z") };
          if (sql.includes("INSERT INTO suinda_financial_account_catalog(")) {
            accountInsertCount++;
            importedRows.set(String(args[1]), { account_code: String(args[1]), account_name: String(args[2]),
              account_type: String(args[3]), parent_code: args[4] == null ? null : String(args[4]), imported_at: new Date("2026-10-24T12:00:00Z") });
          }
          return { rows: [] };
        }, release() {},
      };
    } },
  };
  const service = new SuindaAccountingService(db as never, { async has() { return true; }, async hasScoped() { return false; },
    async audit() {} } as never, registry(), {} as never);
  const csv = "code,name,type,parent_code\n1,Assets,asset,\n1.1,Cash,asset,1";
  const imported = await service.importFinancialAccountCatalog(workspaceId, "manager", { csv });
  assert.equal(imported.idempotent_replay, false);
  assert.equal(imported.row_count, 2);
  assert.deepEqual(imported.accounts.map((item) => item.account_code), ["1", "1.1"]);
  assert.equal(accountInsertCount, 2);
  assert.ok(statements.some((item) => item.sql.includes("SET active=false")), "accounts omitted by the new full snapshot are deactivated");
  assert.ok(statements.some((item) => item.sql.includes("active=true")), "current accounts are activated by the import");
  assert.equal(statements.some((item) => item.args.includes(csv)), false, "raw CSV is never persisted");
  const replay = await service.importFinancialAccountCatalog(workspaceId, "manager", { csv });
  assert.equal(replay.idempotent_replay, true);
  assert.equal(accountInsertCount, 2, "identical content is not applied twice");
});

function accountMappings() {
  return Object.fromEntries(FINANCIAL_NATURES.map((nature, index) => [nature, {
    debit_account: `1.1.${index + 1}`, credit_account: `4.${index + 1}`,
  }])) as Record<(typeof FINANCIAL_NATURES)[number], { debit_account: string; credit_account: string }>;
}

function registry() {
  const value = new PluginRegistry();
  value.register(workspacesPlugin);
  for (const plugin of genericPlugins) value.register(plugin);
  value.register(suindaPlugin);
  value.register(suindaAccountingPlugin);
  return value;
}

test("lê extrato CSV com cabeçalhos em qualquer ordem, moeda e valores negativos de estorno", () => {
  assert.deepEqual(parseFinancialStatementCsv("date;amount;reference;currency\n2026-10-20;120,50;TX-1;brl\n2026-10-21;-8.25;TX-2;BRL"), [
    { line: 2, reference: "TX-1", amount: "120.50", currency: "BRL", occurred_on: "2026-10-20", nature: "payment", settlement_reference: null },
    { line: 3, reference: "TX-2", amount: "-8.25", currency: "BRL", occurred_on: "2026-10-21", nature: "payment", settlement_reference: null },
  ]);
});

test("imports common Portuguese CSV headers, Brazilian number formatting and day-first dates exactly", () => {
  assert.deepEqual(parseFinancialStatementCsv("data;valor_liquido;referência;moeda\n24/10/2026;1.234,56;TX-BR;BRL\n25/10/2026;-8,25;TX-REFUND;BRL"), [
    { line: 2, reference: "TX-BR", amount: "1234.56", currency: "BRL", occurred_on: "2026-10-24", nature: "payment", settlement_reference: null },
    { line: 3, reference: "TX-REFUND", amount: "-8.25", currency: "BRL", occurred_on: "2026-10-25", nature: "payment", settlement_reference: null },
  ]);
  assert.deepEqual(parseFinancialStatementCsv('id_transacao,amount,currency,date\nTX-US,"1,234.56",USD,2026-10-24'), [
    { line: 2, reference: "TX-US", amount: "1234.56", currency: "USD", occurred_on: "2026-10-24", nature: "payment", settlement_reference: null },
  ]);
});

test("rejects ambiguous separators, unsafe amounts and impossible localized dates", () => {
  assert.throws(() => parseFinancialStatementCsv("reference;amount;currency;date\nTX-1;1,234;BRL;2026-10-24"), /valor da linha/);
  assert.throws(() => parseFinancialStatementCsv("reference;amount;currency;date\nTX-1;1.234,567;BRL;2026-10-24"), /valor da linha/);
  assert.throws(() => parseFinancialStatementCsv("reference;amount;currency;date\nTX-1;1000000000.00;BRL;2026-10-24"), /não ultrapassar/);
  assert.throws(() => parseFinancialStatementCsv("reference;amount;currency;date\nTX-1;10,00;BRL;31/02/2026"), /data da linha/);
});

test("rejeita colunas inesperadas, linhas incompletas, data impossível e valor ambíguo", () => {
  assert.throws(() => parseFinancialStatementCsv("reference;amount;currency;date;learner\nTX-1;10;BRL;2026-10-20;Pessoa"), /quatro colunas/);
  assert.throws(() => parseFinancialStatementCsv("reference;amount;currency;date\nTX-1;10;BRL;2026-02-30"), /data da linha/);
  assert.throws(() => parseFinancialStatementCsv("reference;amount;currency;date\nTX-1;1.234,567;BRL;2026-10-20"), /valor da linha/);
  assert.throws(() => parseFinancialStatementCsv("reference;amount;currency;date\nTX-1;10;BRL;2026-10-20\nTX-2;0;BRL;2026-10-21"), /diferente de zero/);
});

test("serviço classifica por referência, moeda e valor e persiste somente linhas minimizadas", async () => {
  const insertedRows: Array<{ sql: string; args: unknown[] }> = [];
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    async one(sql: string) { return sql.includes("FROM workspaces") ? { id: workspaceId } : null; },
    async query() { return []; },
    pool: { async connect() {
      return {
        async query(sql: string, args: unknown[] = []) {
          statements.push({ sql, args });
          if (sql === "SELECT pg_advisory_xact_lock(hashtextextended($1,0))") return { rows: [] };
          if (sql.includes("FROM suinda_financial_statement_imports") && sql.includes("FOR UPDATE")) return { rows: [] };
          if (sql.includes("AS course_title")) return { rows: [] };
          if (sql.includes("FROM extension_records p")) return { rows: [
            { id: paymentId, reference: "TX-OK", amount: "12.50", currency: "BRL", method: "pix" },
            { id: "00000000-0000-4000-8000-000000000105", reference: "TX-MULTI", amount: "9.00", currency: "BRL", method: "pix" },
            { id: "00000000-0000-4000-8000-000000000106", reference: "TX-MULTI", amount: "9.00", currency: "BRL", method: "pix" },
          ] };
          if (sql.includes("INSERT INTO suinda_financial_statement_imports")) return { rows: [] };
          if (sql.includes("INSERT INTO suinda_financial_statement_rows")) { insertedRows.push({ sql, args }); return { rows: [] }; }
          if (sql.includes("INSERT INTO access_audit")) return { rows: [] };
          if (sql.includes("SELECT id::text,workspace_id::text,unit_record_id::text,created_at,row_count")) return { rows: [{ id: args[0], workspace_id: workspaceId, unit_record_id: null, created_at: new Date("2026-10-24T12:00:00Z"), row_count: 3,
            matched_count: 1, ambiguous_count: 1, unmatched_count: 1 }] };
          if (sql.includes("FROM suinda_financial_statement_rows")) return { rows: [
            { line: 2, match_status: "matched", candidate_count: 1, payment_entry_id: paymentId, candidate_payment_entry_ids: [paymentId] },
            { line: 3, match_status: "ambiguous", candidate_count: 2, payment_entry_id: null, candidate_payment_entry_ids: [paymentId, "00000000-0000-4000-8000-000000000105"] },
            { line: 4, match_status: "unmatched", candidate_count: 0, payment_entry_id: null, candidate_payment_entry_ids: [] },
          ] };
          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
          throw new Error(`Unexpected SQL: ${sql}`);
        }, release() {},
      };
    } },
  };
  const service = new SuindaAccountingService(db as never, {
    async has(_user: string, _permission: string, scopeType?: string, scopeId?: string) { return scopeType === "workspace" && scopeId === workspaceId; },
    async hasScoped() { return false; },
  } as never, registry(), {} as never);
  const result = await service.importStatement(workspaceId, "manager", {
    operation_key: operationId,
    csv: "reference;amount;currency;date\nTX-OK;12.50;BRL;2026-10-20\nTX-MULTI;9.00;BRL;2026-10-21\nTX-MISS;2.00;BRL;2026-10-22",
  });

  assert.deepEqual([result.matched_count, result.ambiguous_count, result.unmatched_count], [1, 1, 1]);
  assert.deepEqual(result.rows.map((row) => row.match_status), ["matched", "ambiguous", "unmatched"]);
  assert.equal(result.rows[0].payment_entry_id, paymentId);
  assert.equal(insertedRows.length, 3);
  assert.ok(insertedRows.every(({ sql }) => /reference_sha256/.test(sql) && !/payment_reference|settlement_reference\s*,/i.test(sql)));
  assert.ok(insertedRows.every(({ args }) => !args.some((value) => typeof value === "string" && /TX-/.test(value))));
  assert.ok(statements.some(({ sql }) => sql.includes("candidate_payment_entry_ids")));
});

test("registra tarifas e chargebacks append-only após fechar o total líquido de cada liquidação", async () => {
  const insertedRows: Array<{ sql: string; args: unknown[] }> = [];
  const candidates = [
    { id: paymentId, reference: "PAY-1", amount: "100.00", currency: "BRL", method: "pix" },
    { id: "00000000-0000-4000-8000-000000000105", reference: "REF-1", amount: "-10.00", currency: "BRL", method: "refund" },
  ];
  const db = {
    async one(sql: string) { return sql.includes("FROM workspaces") ? { id: workspaceId } : null; },
    async query() { return []; },
    pool: { async connect() {
      return { async query(sql: string, args: unknown[] = []) {
        if (sql === "SELECT pg_advisory_xact_lock(hashtextextended($1,0))") return { rows: [] };
        if (sql.includes("FROM suinda_financial_statement_imports") && sql.includes("FOR UPDATE")) return { rows: [] };
        if (sql.includes("FROM extension_records p") && sql.includes("payment_reference")) return { rows: candidates };
        if (sql.includes("INSERT INTO suinda_financial_statement_imports")) return { rows: [] };
        if (sql.includes("INSERT INTO suinda_financial_statement_rows")) { insertedRows.push({ sql, args }); return { rows: [] }; }
        if (sql.includes("FROM suinda_financial_statement_rows r") && sql.includes("LATERAL")) return { rows: insertedRows.map(({ args: row }) => ({
          line: row[2], match_status: row[3], candidate_count: (row[5] as string[]).length,
          payment_entry_id: row[4], candidate_payment_entry_ids: row[5], nature: row[6],
          selected_payment_entry_id: null, reason_code: null, decided_at: null, decided_by: null,
        })) };
        if (sql.includes("SELECT p.id::text") && sql.includes("AS course_title")) return { rows: candidates.map((candidate) => ({ ...candidate,
          recorded_at: "2026-10-20T12:00:00.000Z", course_title: "Curso privado", cohort_title: null })) };
        if (sql.includes("SELECT id::text,workspace_id::text,unit_record_id::text,created_at,row_count")) return { rows: [{
          id: args[0], workspace_id: workspaceId, unit_record_id: null, created_at: new Date("2026-10-24T12:00:00Z"), row_count: 5,
          matched_count: 2, ambiguous_count: 0, unmatched_count: 0, recorded_count: 3,
        }] };
        if (sql.includes("INSERT INTO access_audit")) return { rows: [] };
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
        throw new Error(`Unexpected SQL: ${sql}`);
      }, release() {} };
    } },
  };
  const service = new SuindaAccountingService(db as never, {
    async has(_user: string, _permission: string, scopeType?: string, scopeId?: string) { return scopeType === "workspace" && scopeId === workspaceId; },
    async hasScoped() { return false; }, async audit() {},
  } as never, registry(), {} as never);
  const csv = [
    "reference;amount;currency;date;nature;settlement_reference",
    "PAY-1;100.00;BRL;2026-10-20;payment;SET-1",
    "FEE-1;-5.00;BRL;2026-10-20;fee;SET-1",
    "REF-1;-10.00;BRL;2026-10-20;refund;SET-1",
    "CB-1;-5.00;BRL;2026-10-20;chargeback;SET-1",
    "NET-1;80.00;BRL;2026-10-20;net_settlement;SET-1",
  ].join("\n");
  const result = await service.importStatement(workspaceId, "manager", { operation_key: operationId, csv });

  assert.deepEqual([result.row_count, result.matched_count, result.unmatched_count, result.recorded_count], [5, 2, 0, 3]);
  assert.deepEqual(result.rows.map((row) => [row.nature, row.match_status]), [
    ["payment", "matched"], ["fee", "recorded"], ["refund", "matched"], ["chargeback", "recorded"], ["net_settlement", "recorded"],
  ]);
  assert.equal(insertedRows.length, 5);
  assert.ok(insertedRows.every(({ args }) => !args.includes("PAY-1") && !args.includes("SET-1") && !args.includes("FEE-1")));
  assert.equal(new Set(insertedRows.map(({ args }) => args[8])).size, 1, "liquidation references are stored only as stable hashes");
  assert.deepEqual(insertedRows.map(({ args }) => args[10]), ["100.00", "-5.00", "-10.00", "-5.00", "80.00"]);
  await assert.rejects(service.importStatement(workspaceId, "manager", { operation_key: "00000000-0000-4000-8000-000000000107",
    csv: csv.replace("NET-1;80.00", "NET-1;81.00") }), /não fecha/);
});

test("decisão de conciliação só aceita candidato original e persiste evento idempotente no escopo", async () => {
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  let inserted = false;
  const detailRow = { line: 3, match_status: "ambiguous", candidate_count: 2, payment_entry_id: null,
    candidate_payment_entry_ids: [paymentId, "00000000-0000-4000-8000-000000000105"], selected_payment_entry_id: paymentId,
    reason_code: "provider_receipt_reviewed", decided_at: new Date("2026-10-24T12:00:00Z"), decided_by: "Gestora" };
  const db = {
    async one(sql: string) {
      if (sql.includes("FROM workspaces")) return { id: workspaceId };
      if (sql.includes("FROM suinda_financial_statement_imports") && sql.includes("unit_record_id")) return { unit_record_id: null };
      if (sql.includes("FROM suinda_financial_statement_imports") && sql.includes("row_count")) return {
        id: operationId, created_at: new Date("2026-10-24T11:00:00Z"), row_count: 3, matched_count: 1, ambiguous_count: 1, unmatched_count: 1,
      };
      return null;
    },
    async query(sql: string) {
      if (sql.includes("FROM suinda_financial_statement_rows")) return [detailRow];
      return [];
    },
    pool: { async connect() {
      return {
        async query(sql: string, args: unknown[] = []) {
          statements.push({ sql, args });
          if (sql === "SELECT pg_advisory_xact_lock(hashtextextended($1,0))") return { rows: [] };
          if (sql.includes("FROM suinda_financial_statement_resolution_events WHERE workspace_id=$1 AND operation_key=$2")) return { rows: [] };
          if (sql.includes("FROM suinda_financial_statement_rows") && sql.includes("FOR UPDATE")) return { rows: [{
            match_status: "ambiguous", candidate_payment_entry_ids: [paymentId, "00000000-0000-4000-8000-000000000105"],
          }] };
          if (sql.includes("SELECT p.id FROM extension_records p")) return { rows: [{ id: paymentId }], rowCount: 1 };
          if (sql.includes("FROM suinda_financial_statement_rows r") && sql.includes("latest.selected_payment_entry_id")) return { rows: [], rowCount: 0 };
          if (sql.includes("INSERT INTO suinda_financial_statement_resolution_events")) { inserted = true; return { rows: [] }; }
          if (sql.includes("INSERT INTO access_audit")) return { rows: [] };
          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
          throw new Error(`Unexpected SQL: ${sql}`);
        }, release() {},
      };
    } },
  };
  const service = new SuindaAccountingService(db as never, {
    async has(_user: string, _permission: string, scopeType?: string, scopeId?: string) { return scopeType === "workspace" && scopeId === workspaceId; },
    async hasScoped() { return false; }, async audit() {},
  } as never, registry(), {} as never);
  const resolved = await service.resolveAmbiguousRow(workspaceId, operationId, "3", "manager", {
    operation_key: "00000000-0000-4000-8000-000000000107", payment_entry_id: paymentId, reason_code: "provider_receipt_reviewed",
  });
  assert.equal(inserted, true);
  assert.equal(resolved.rows[0].decision?.selected_payment_entry_id, paymentId);
  assert.equal(resolved.rows[0].match_status, "ambiguous", "decisão não reescreve o resultado imutável da importação");
  assert.ok(statements.some(({ sql }) => sql.includes("pg_advisory_xact_lock")));
  assert.ok(statements.some(({ sql }) => sql.includes("candidate_payment_entry_ids")));

  await assert.rejects(service.resolveAmbiguousRow(workspaceId, operationId, "3", "manager", {
    operation_key: "00000000-0000-4000-8000-000000000108", payment_entry_id: "00000000-0000-4000-8000-000000000109", reason_code: "institutional_review",
  }), /não está entre os candidatos/);
});

test("gestor de unidade só importa no escopo exato e o filho declara rota sob o aprendizado", async () => {
  const deniedQueries: string[] = [];
  const db = { async one(sql: string) {
    if (sql.includes("FROM workspaces")) return { id: workspaceId };
    if (sql.includes("kind='institution_unit'")) return { id: unitId };
    return null;
  }, async query() { return []; }, pool: { async connect() { deniedQueries.push("connect"); throw new Error("not expected"); } } };
  const service = new SuindaAccountingService(db as never, {
    async has() { return false; }, async hasScoped() { return false; },
  } as never, registry(), {} as never);
  await assert.rejects(service.importStatement(workspaceId, "intruder", {
    operation_key: operationId, unit_record_id: unitId, csv: "reference;amount;currency;date\nTX-1;1;BRL;2026-10-20",
  }), (error: unknown) => error instanceof Error && error.message.includes("escopo financeiro"));
  assert.deepEqual(deniedQueries, []);
  const route = `/extensions/suinda-accounting/workspaces/${workspaceId}/imports`;
  assert.equal(suindaAccountingPlugin.dependencies?.includes("suinda-learning"), true);
  assert.equal(suindaAccountingPlugin.handlesRoute?.(route), true);
  assert.equal(suindaAccountingPlugin.handlesRoute?.(`${route}/extra`), false);
  assert.equal(suindaAccountingPlugin.handlesRoute?.(`${route}/${operationId}/rows/2/resolutions`), true);
  assert.equal(suindaAccountingPlugin.handlesRoute?.(`/extensions/suinda-accounting/workspaces/${workspaceId}/account-mappings`), true);
  assert.equal(suindaAccountingPlugin.handlesRoute?.(`/extensions/suinda-accounting/workspaces/${workspaceId}/accounts`), true);
  assert.equal(suindaAccountingPlugin.handlesRoute?.(`/extensions/suinda-accounting/workspaces/${workspaceId}/accounts/import`), true);
  assert.equal(suindaAccountingPlugin.handlesRoute?.(`/extensions/suinda-accounting/workspaces/${workspaceId}/journal.csv`), true);
  assert.equal(suindaAccountingPlugin.handlesRoute?.(`/extensions/suinda-accounting/workspaces/${workspaceId}/mercado-pago/reports`), true);
  assert.equal(suindaAccountingPlugin.handlesRoute?.(`/extensions/suinda-accounting/workspaces/${workspaceId}/mercado-pago/reports/123456`), true);
  assert.equal(suindaAccountingPlugin.handlesRoute?.(`/extensions/suinda-accounting/workspaces/${workspaceId}/mercado-pago/reports/123?access_token=secret`), false);
  assert.equal(suindaAccountingPlugin.routePermission?.(route, "POST"), null);
});

test("Mercado Pago report endpoints require workspace management before accessing provider credentials", async () => {
  let credentialReads = 0;
  const db = { async one(sql: string) { return sql.includes("FROM workspaces") ? { id: workspaceId } : null; }, async query() { return []; } };
  const service = new SuindaAccountingService(db as never, {
    async has() { return false; }, async audit() { throw new Error("Unauthenticated provider operation must not be audited as accepted."); },
  } as never, registry(), { async mercadoPagoAccessTokenForAccounting() { credentialReads += 1; return "token"; } } as never);
  await assert.rejects(service.createMercadoPagoReport(workspaceId, "unit-only-manager", { from: "2026-10-01", to: "2026-10-02" }), /gestores do workspace/);
  await assert.rejects(service.importMercadoPagoReport(workspaceId, "12345", "unit-only-manager"), /gestores do workspace/);
  assert.equal(credentialReads, 0);
});

test("account mapping requires workspace management, validates the complete map and audits writes", async () => {
  const saved: unknown[][] = [];
  const audits: unknown[][] = [];
  const db = {
    async one(sql: string) { return sql.includes("FROM workspaces") ? { id: workspaceId } : null; },
    async query(sql: string, args: unknown[]) { if (sql.includes("INSERT INTO suinda_financial_account_mappings")) saved.push(args); return []; },
  };
  const access = {
    async has(_user: string, _permission: string, scopeType?: string, scopeId?: string) {
      return scopeType === "workspace" && scopeId === workspaceId;
    },
    async audit(...args: unknown[]) { audits.push(args); },
  };
  const service = new SuindaAccountingService(db as never, access as never, registry(), {} as never);
  const mappings = accountMappings();
  assert.deepEqual(await service.saveAccountMappings(workspaceId, "manager", { mappings }), { workspace_id: workspaceId, mappings });
  assert.equal(saved.length, 1);
  assert.deepEqual(JSON.parse(String(saved[0]?.[1])), mappings);
  assert.equal(audits.length, 1);
  await assert.rejects(service.saveAccountMappings(workspaceId, "manager", { mappings: { ...mappings, unexpected: {} } }), /exatamente as quatro/);
  const invalidCodes = { ...mappings, cash_receipt: { debit_account: "1.1;DROP", credit_account: "4.1" } };
  await assert.rejects(service.saveAccountMappings(workspaceId, "manager", { mappings: invalidCodes }), /códigos contábeis/);
  const catalogService = new SuindaAccountingService({
    async one(sql: string) { return sql.includes("FROM workspaces") ? { id: workspaceId } : null; },
    async query(sql: string) { return sql.includes("SELECT account_code FROM suinda_financial_account_catalog") ? [{ account_code: "1.1.1" }] : []; },
  } as never, access as never, registry(), {} as never);
  await assert.rejects(catalogService.saveAccountMappings(workspaceId, "manager", { mappings }), /fora do catálogo importado/);
  const denied = new SuindaAccountingService(db as never, { async has() { return false; } } as never, registry(), {} as never);
  await assert.rejects(denied.getAccountMappings(workspaceId, "unit-manager"), /Somente gestores do workspace/);
  const corrupt = new SuindaAccountingService({
    async one(sql: string) { return sql.includes("FROM workspaces") ? { id: workspaceId } : { mappings: { cash_receipt: { debit_account: "1;DROP" } } }; },
    async query() { return []; },
  } as never, access as never, registry(), {} as never);
  await assert.rejects(corrupt.getAccountMappings(workspaceId, "manager"), /exatamente as quatro naturezas/);
});

test("journal CSV delegates exact workspace and unit authorization and excludes private references", async () => {
  const calls: unknown[][] = [];
  const ledgerRows = [{ entry_type: "payment", entry_id: paymentId, workspace_name: "Escola", unit_name: "Campus Recife",
    course_title: "Curso de saúde", cohort_code: "A-2026", enrollment_reference: "PRIVATE-ENROLLMENT-ID", occurred_at: "2026-10-24T12:00:00Z",
    currency: "BRL", amount: "120.50", nature: "cash_receipt", payment_method: "pix", external_reference: "PRIVATE-TXN-REF",
    notes: "PRIVATE-NOTE", learner_email: "private@example.test" }];
  const db = {
    async one(sql: string) { return sql.includes("suinda_financial_account_mappings") ? { mappings: accountMappings() } : null; },
    async query() { return []; },
  };
  const learning = { async financialLedgerRows(...args: unknown[]) { calls.push(args); return { rows: ledgerRows, from: "2026-10-01", to: "2026-10-24", count: ledgerRows.length }; } };
  const audits: unknown[][] = [];
  const service = new SuindaAccountingService(db as never, { async audit(...args: unknown[]) { audits.push(args); } } as never,
    registry(), learning as never);
  const result = await service.financialJournalCsv(workspaceId, "manager", "2026-10-01", "2026-10-24", unitId);
  assert.deepEqual(calls, [["manager", "2026-10-01", "2026-10-24", unitId, workspaceId]]);
  assert.match(result.csv, /1\.1\.1/);
  assert.match(result.csv, /4\.1/);
  assert.match(result.csv, /120\.50/);
  assert.match(result.csv, new RegExp(paymentId));
  assert.equal(result.count, 1);
  for (const secret of ["PRIVATE-ENROLLMENT-ID", "PRIVATE-TXN-REF", "PRIVATE-NOTE", "private@example.test", "Curso de saúde", "Campus Recife"])
    assert.equal(result.csv.includes(secret), false);
  assert.equal(audits.length, 1);
});

test("journal CSV exports imported fees and chargebacks only with explicit settlement account mappings", async () => {
  const mappings = { ...accountMappings(),
    provider_fee: { debit_account: "5.1", credit_account: "1.2" },
    provider_chargeback: { debit_account: "5.2", credit_account: "1.2" },
  };
  const db = {
    async one() { return { mappings }; },
    async query(sql: string) { return sql.includes("FROM suinda_financial_statement_rows r JOIN suinda_financial_statement_imports") ? [
      { id: "import-1:3", nature: "fee", occurred_on: "2026-10-20", amount: "-4.25", currency: "BRL" },
      { id: "import-1:4", nature: "fee", occurred_on: "2026-10-21", amount: "2.00", currency: "BRL" },
      { id: "import-1:5", nature: "chargeback", occurred_on: "2026-10-22", amount: "-10.00", currency: "BRL" },
      { id: "import-1:6", nature: "chargeback", occurred_on: "2026-10-23", amount: "3.00", currency: "BRL" },
    ] : []; },
  };
  const learning = { async financialLedgerRows() { return { rows: [], from: "2026-10-01", to: "2026-10-31", count: 0 }; } };
  const service = new SuindaAccountingService(db as never, { async audit() {} } as never, registry(), learning as never);
  const result = await service.financialJournalCsv(workspaceId, "manager", "2026-10-01", "2026-10-31");
  assert.equal(result.count, 4);
  assert.match(result.csv, /Tarifa do provedor/);
  assert.match(result.csv, /Contestação\/chargeback do provedor/);
  assert.ok(result.csv.includes('"5.1";"1.2";"4.25";"settlement_component";"import-1:3"'));
  assert.ok(result.csv.includes('"Tarifa do provedor (reversão)";"BRL";"1.2";"5.1";"2.00";"settlement_component";"import-1:4"'));
  assert.ok(result.csv.includes('"5.2";"1.2";"10.00";"settlement_component";"import-1:5"'));
  assert.ok(result.csv.includes('"Contestação/chargeback do provedor (reversão)";"BRL";"1.2";"5.2";"3.00";"settlement_component";"import-1:6"'));
});

test("journal export fails closed when a ledger nature has no account mapping", async () => {
  const db = {
    async one() { return { mappings: accountMappings() }; },
    async query() { return []; },
  };
  const learning = { async financialLedgerRows() { return { rows: [{ entry_type: "payment", entry_id: paymentId, workspace_name: "Escola",
    unit_name: "Geral", course_title: "Curso", cohort_code: "A", occurred_at: "2026-10-24T12:00:00Z", currency: "BRL", amount: "2.00",
    nature: "platform_fee", payment_method: "pix" }], from: "2026-10-01", to: "2026-10-24", count: 1 }; } };
  const service = new SuindaAccountingService(db as never, { async audit() {} } as never, registry(), learning as never);
  await assert.rejects(service.financialJournalCsv(workspaceId, "manager"), /não cobre uma natureza/);
});
