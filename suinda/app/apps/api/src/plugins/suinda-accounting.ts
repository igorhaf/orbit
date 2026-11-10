import { Body, Controller, Delete, Get, HttpException, Inject, Injectable, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { Response } from "express";
import type { AccessRequest } from "../access/access";
import { AccessService, id } from "../access/access";
import { Db } from "../db";
import { SecretVault } from "../secrets";
import { PluginRegistry } from "../execution/registries";
import type { PluginDefinition } from "./contract";
import { parseFinancialAccountCatalogCsv, type ImportedAccount } from "./financial-account-catalog-csv";
import { parseFinancialStatementCsv, type ImportedStatementLine } from "./financial-reconciliation-csv";
import { SuindaLearningService } from "./suinda/suinda.service";
import { createMercadoPagoSettlementReport, downloadMercadoPagoSettlementReport, getMercadoPagoSettlementReport, normalizeMercadoPagoSettlementCsv } from "./suinda/mercado-pago-settlement";
import { postSecureHttpsJson, validatePublicHttpsTarget } from "./webhooks";

const PLUGIN_ID = "suinda-accounting";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type MatchStatus = "matched" | "ambiguous" | "unmatched" | "recorded";
export const FINANCIAL_NATURES = ["cash_receipt", "cash_refund", "scholarship_credit", "waiver_credit"] as const;
export type FinancialNature = typeof FINANCIAL_NATURES[number];
export const SETTLEMENT_NATURES = ["provider_fee", "provider_chargeback"] as const;
export type SettlementNature = typeof SETTLEMENT_NATURES[number];
export type AccountPair = { debit_account: string; credit_account: string };
export type AccountMapping = Record<FinancialNature, AccountPair> & Partial<Record<SettlementNature, AccountPair>>;
const ACCOUNT_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
type PaymentCandidate = { id: string; reference: string; amount: string; currency: string; method: string };
type PaymentCandidateOption = { id: string; amount: string; currency: string; method: string; recorded_at: string; course_title: string; cohort_title: string | null };
type ReconciliationResult = {
  import_id: string; created_at: string; row_count: number; matched_count: number; ambiguous_count: number; unmatched_count: number; recorded_count: number;
  rows: Array<{ line: number; nature: ImportedStatementLine["nature"]; match_status: MatchStatus; candidate_count: number; payment_entry_id: string | null;
    candidate_payment_entry_ids: string[]; candidate_options: PaymentCandidateOption[];
    decision: { selected_payment_entry_id: string; reason_code: string; decided_at: string; decided_by: string } | null }>;
};
type ErpBatchDelivery = {
  id: string; from: string; to: string; unit_record_id: string | null; entry_count: number; payload: string;
  payload_sha256: string; status: string; attempt_count: number; remote_status: number | null; created_at: Date | string;
  last_attempt_at: Date | string | null;
};
type ErpBatchSummary = Omit<ErpBatchDelivery, "payload">;
type ErpBatchCursor = { created_at: string; id: string };

function parseErpBatchPage(cursorInput?: string, requestedLimit?: string | number) {
  const limit = requestedLimit === undefined ? 50 : Number(requestedLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail("O limite deve estar entre 1 e 100.");
  let cursor: ErpBatchCursor | null = null;
  if (cursorInput) {
    try {
      const decoded = JSON.parse(Buffer.from(cursorInput, "base64url").toString("utf8")) as Record<string, unknown>;
      const timestamp = typeof decoded.created_at === "string" ? new Date(decoded.created_at) : null;
      if (typeof decoded.created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(decoded.created_at)
        || !timestamp || !Number.isFinite(timestamp.getTime())
        || `${timestamp.toISOString().slice(0, 23)}Z` !== `${decoded.created_at.slice(0, 23)}Z`
        || typeof decoded.id !== "string" || !UUID.test(decoded.id)) throw new Error("invalid cursor");
      cursor = { created_at: decoded.created_at, id: decoded.id };
    } catch { fail("Cursor do histórico ERP inválido."); }
  }
  return { cursor, limit };
}

function erpBatchCursor(row: { _cursor_created_at: string; id: string }) {
  return Buffer.from(JSON.stringify({ created_at: row._cursor_created_at, id: row.id }), "utf8").toString("base64url");
}

function fail(message: string, status = 400): never { throw new HttpException({ message }, status); }
function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function object(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Informe os dados da importação financeira.");
  return value as Record<string, unknown>;
}

export const suindaAccountingPlugin: PluginDefinition = {
  id: PLUGIN_ID,
  name: "Suindá · Conciliação financeira",
  version: "1.0.0",
  description: "Importa extratos financeiros em CSV e compara lançamentos sem alterar o ledger acadêmico.",
  scope: "workspace",
  parentPlugin: "suinda-learning",
  dependencies: ["suinda-learning"],
  capabilities: [
    { id: "read", name: "Consultar importações de conciliação", permissions: [`plugin.${PLUGIN_ID}.read`] },
    { id: "write", name: "Importar extratos financeiros", permissions: [`plugin.${PLUGIN_ID}.write`] },
  ],
  handlesRoute: (path) => /^\/extensions\/suinda-accounting\/workspaces\/[0-9a-f-]{36}\/(?:imports(?:\/[0-9a-f-]{36}(?:\/rows\/\d+\/resolutions)?)?|account-mappings|accounts(?:\/import)?|journal\.csv|erp\/config|erp\/batches(?:\/[0-9a-f-]{36}\/retry)?|mercado-pago\/reports(?:\/\d{1,30})?)$/.test(path),
  routePermission: () => null,
};

@Injectable()
export class SuindaAccountingService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(AccessService) private readonly access: AccessService,
    @Inject(PluginRegistry) private readonly registry: PluginRegistry,
    @Inject(SuindaLearningService) private readonly learning: SuindaLearningService,
    @Inject(SecretVault) private readonly secrets: SecretVault = new SecretVault()) {}

  private assertAvailable() {
    if (!this.registry.isEnabled(PLUGIN_ID)) fail("O plugin de conciliação financeira está desativado.", 503);
  }

  private async authorize(userId: string, workspaceId: string, unitId: string | null | undefined) {
    const workspace = await this.db.one<{ id: string }>("SELECT id FROM workspaces WHERE id=$1 AND archived_at IS NULL", [workspaceId]);
    if (!workspace) fail("Workspace não encontrado.", 404);
    const hasWorkspaceManage = await this.access.has(userId, "plugin.suinda-learning.manage", "workspace", workspaceId)
      || await this.access.has(userId, "plugin.suinda-learning.manage");
    if (unitId) {
      const unit = await this.db.one<{ id: string }>(
        `SELECT id FROM extension_records WHERE id=$1 AND workspace_id=$2 AND plugin_id='suinda-learning'
         AND kind='institution_unit' AND state=ANY(ARRAY['published','archived'])`, [unitId, workspaceId],
      );
      const hasUnitManage = await this.access.hasScoped(userId, "plugin.suinda-learning.manage", "extension_record", unitId);
      if (!unit || !hasWorkspaceManage && !hasUnitManage) fail("A unidade não existe neste workspace ou está fora do seu escopo financeiro.", 403);
    } else if (!hasWorkspaceManage) fail("Selecione uma unidade que você possa gerir.", 403);
    return;
  }

  private async authorizeWorkspaceManager(userId: string, workspaceIdInput: string) {
    const workspaceId = id(workspaceIdInput);
    const workspace = await this.db.one<{ id: string }>("SELECT id FROM workspaces WHERE id=$1 AND archived_at IS NULL", [workspaceId]);
    if (!workspace) fail("Workspace não encontrado.", 404);
    const canManage = await this.access.has(userId, "plugin.suinda-learning.manage", "workspace", workspaceId)
      || await this.access.has(userId, "plugin.suinda-learning.manage");
    if (!canManage) fail("Somente gestores do workspace podem administrar o plano de contas.", 403);
    return workspaceId;
  }

  private validateMappings(input: unknown): AccountMapping {
    const body = object(input);
    if (Object.keys(body).length !== 1 || !Object.hasOwn(body, "mappings")) fail("Envie somente o mapeamento de contas.");
    const candidate = body.mappings;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) fail("Informe as contas para cada natureza financeira.");
    const values = candidate as Record<string, unknown>;
    const allowedNatures = [...FINANCIAL_NATURES, ...SETTLEMENT_NATURES];
    if (FINANCIAL_NATURES.some((nature) => !Object.hasOwn(values, nature))
      || Object.keys(values).some((nature) => !allowedNatures.includes(nature as typeof allowedNatures[number]))
      || SETTLEMENT_NATURES.some((nature) => Object.hasOwn(values, nature) !== SETTLEMENT_NATURES.every((key) => Object.hasOwn(values, key))))
      fail("Configure exatamente as quatro naturezas financeiras e, opcionalmente, as duas naturezas de liquidação.");
    const result = {} as AccountMapping;
    for (const nature of FINANCIAL_NATURES) {
      const mapping = values[nature];
      if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) fail(`Configure débito e crédito para ${nature}.`);
      const account = mapping as Record<string, unknown>;
      if (Object.keys(account).length !== 2 || !Object.hasOwn(account, "debit_account") || !Object.hasOwn(account, "credit_account"))
        fail(`Informe somente as contas de débito e crédito para ${nature}.`);
      if (typeof account.debit_account !== "string" || !ACCOUNT_CODE.test(account.debit_account)
        || typeof account.credit_account !== "string" || !ACCOUNT_CODE.test(account.credit_account))
        fail(`Os códigos contábeis de ${nature} devem ter até 40 caracteres alfanuméricos, ponto, hífen ou sublinhado.`);
      result[nature] = { debit_account: account.debit_account, credit_account: account.credit_account };
    }
    for (const nature of SETTLEMENT_NATURES) {
      if (!Object.hasOwn(values, nature)) continue;
      const mapping = values[nature];
      if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) fail(`Configure débito e crédito para ${nature}.`);
      const account = mapping as Record<string, unknown>;
      if (Object.keys(account).length !== 2 || !Object.hasOwn(account, "debit_account") || !Object.hasOwn(account, "credit_account"))
        fail(`Informe somente as contas de débito e crédito para ${nature}.`);
      if (typeof account.debit_account !== "string" || !ACCOUNT_CODE.test(account.debit_account)
        || typeof account.credit_account !== "string" || !ACCOUNT_CODE.test(account.credit_account))
        fail(`Os códigos contábeis de ${nature} devem ter até 40 caracteres alfanuméricos, ponto, hífen ou sublinhado.`);
      result[nature] = { debit_account: account.debit_account, credit_account: account.credit_account };
    }
    return result;
  }

  private async requireCatalogAccounts(workspaceId: string, mappings: AccountMapping) {
    const catalog = await this.db.query<{ account_code: string }>(
      "SELECT account_code FROM suinda_financial_account_catalog WHERE workspace_id=$1 AND active=true", [workspaceId],
    );
    if (!catalog.length) return;
    const available = new Set(catalog.map((account) => account.account_code));
    const unknown = [...new Set([...FINANCIAL_NATURES, ...SETTLEMENT_NATURES].flatMap((nature) => {
      const mapping = mappings[nature];
      return mapping ? [mapping.debit_account.toUpperCase(), mapping.credit_account.toUpperCase()] : [];
    }))]
      .filter((code) => !available.has(code));
    if (unknown.length) fail(`Conta(s) fora do catálogo importado: ${unknown.join(", ")}. Atualize o plano de contas ou o mapeamento.`, 409);
  }

  async getAccountMappings(workspaceInput: string, userId: string) {
    this.assertAvailable();
    const workspaceId = await this.authorizeWorkspaceManager(userId, workspaceInput);
    const stored = await this.db.one<{ mappings: AccountMapping }>(
      "SELECT mappings FROM suinda_financial_account_mappings WHERE workspace_id=$1", [workspaceId],
    );
    if (!stored?.mappings) return { workspace_id: workspaceId, mappings: null };
    const mappings = this.validateMappings({ mappings: stored.mappings });
    return { workspace_id: workspaceId, mappings: {
      ...mappings,
      provider_fee: mappings.provider_fee || { debit_account: "", credit_account: "" },
      provider_chargeback: mappings.provider_chargeback || { debit_account: "", credit_account: "" },
    } };
  }

  async saveAccountMappings(workspaceInput: string, userId: string, input: unknown) {
    this.assertAvailable();
    const workspaceId = await this.authorizeWorkspaceManager(userId, workspaceInput);
    const mappings = this.validateMappings(input);
    if (!mappings.provider_fee || !mappings.provider_chargeback) {
      const previous = await this.db.one<{ mappings: AccountMapping }>(
        "SELECT mappings FROM suinda_financial_account_mappings WHERE workspace_id=$1", [workspaceId],
      );
      const previousMappings = previous?.mappings ? this.validateMappings({ mappings: previous.mappings }) : null;
      if (previousMappings?.provider_fee && previousMappings.provider_chargeback) {
        mappings.provider_fee = previousMappings.provider_fee;
        mappings.provider_chargeback = previousMappings.provider_chargeback;
      }
    }
    await this.requireCatalogAccounts(workspaceId, mappings);
    await this.db.query(
      `INSERT INTO suinda_financial_account_mappings(workspace_id,mappings,updated_by,updated_at)
       VALUES($1,$2::jsonb,$3,now()) ON CONFLICT(workspace_id) DO UPDATE
       SET mappings=EXCLUDED.mappings,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [workspaceId, JSON.stringify(mappings), userId],
    );
    await this.access.audit(userId, `${PLUGIN_ID}.account-mappings.updated`, workspaceId, { type: "workspace", id: workspaceId });
    return { workspace_id: workspaceId, mappings };
  }

  async getFinancialAccountCatalog(workspaceInput: string, userId: string) {
    this.assertAvailable();
    const workspaceId = await this.authorizeWorkspaceManager(userId, workspaceInput);
    const [latest, accounts] = await Promise.all([
      this.db.one<{ id: string; row_count: number; imported_at: Date }>(
        "SELECT id::text,row_count,imported_at FROM suinda_financial_account_catalog_imports WHERE workspace_id=$1 ORDER BY imported_at DESC,id DESC LIMIT 1", [workspaceId]),
      this.db.query<{ account_code: string; account_name: string; account_type: string; parent_code: string | null; imported_at: Date }>(
        `SELECT account_code,account_name,account_type,parent_code,imported_at FROM suinda_financial_account_catalog
         WHERE workspace_id=$1 AND active=true ORDER BY account_code LIMIT 5000`, [workspaceId]),
    ]);
    return { workspace_id: workspaceId, latest_import: latest ? { ...latest, imported_at: latest.imported_at.toISOString() } : null,
      accounts: accounts.map((account) => ({ ...account, imported_at: account.imported_at.toISOString() })) };
  }

  async importFinancialAccountCatalog(workspaceInput: string, userId: string, input: unknown) {
    this.assertAvailable();
    const workspaceId = await this.authorizeWorkspaceManager(userId, workspaceInput);
    const body = object(input);
    if (Object.keys(body).length !== 1 || !Object.hasOwn(body, "csv")) fail("Envie somente o CSV do plano de contas.");
    if (typeof body.csv !== "string" || Buffer.byteLength(body.csv, "utf8") > 2_000_000) fail("Envie um CSV de até 2 MB.");
    let accounts: ImportedAccount[];
    try { accounts = parseFinancialAccountCatalogCsv(body.csv); }
    catch (error) { fail(error instanceof Error ? error.message : "Não foi possível ler o plano de contas."); }
    const digest = createHash("sha256").update(body.csv, "utf8").digest("hex");
    const importId = randomUUID();
    const imported = await this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${workspaceId}:suinda-account-catalog`]);
      const previous = (await client.query<{ id: string }>(
        "SELECT id::text FROM suinda_financial_account_catalog_imports WHERE workspace_id=$1 AND csv_sha256=$2 FOR UPDATE", [workspaceId, digest],
      )).rows[0];
      if (previous) return { import_id: previous.id, idempotent_replay: true, row_count: accounts.length };

      const existing = (await client.query<{ account_code: string; parent_code: string | null }>(
        "SELECT account_code,parent_code FROM suinda_financial_account_catalog WHERE workspace_id=$1 AND active=true", [workspaceId],
      )).rows;
      const graph = new Map(existing.map((account) => [account.account_code, account.parent_code]));
      for (const account of accounts) graph.set(account.code, account.parent_code);
      for (const account of accounts) if (account.parent_code && !graph.has(account.parent_code))
        fail(`A conta-pai ${account.parent_code} da linha ${account.line} não existe no plano importado nem no catálogo atual.`);
      for (const [code, parent] of graph) {
        const visited = new Set<string>([code]); let cursor = parent;
        while (cursor) {
          if (visited.has(cursor)) fail(`A hierarquia do plano de contas contém um ciclo a partir de ${code}.`);
          visited.add(cursor); cursor = graph.get(cursor) || null;
        }
      }
      await client.query(
        `INSERT INTO suinda_financial_account_catalog_imports(id,workspace_id,csv_sha256,row_count,imported_by)
         VALUES($1,$2,$3,$4,$5)`, [importId, workspaceId, digest, accounts.length, userId],
      );
      await client.query("UPDATE suinda_financial_account_catalog SET active=false WHERE workspace_id=$1", [workspaceId]);
      const pending = new Map(accounts.map((account) => [account.code, account]));
      const inserted = new Set(existing.map((account) => account.account_code));
      while (pending.size) {
        const ready = [...pending.values()].filter((account) => !account.parent_code || inserted.has(account.parent_code));
        if (!ready.length) fail("A hierarquia do plano de contas não pode ser ordenada.");
        for (const account of ready) {
          await client.query(
            `INSERT INTO suinda_financial_account_catalog(workspace_id,account_code,account_name,account_type,parent_code,active,import_id,imported_at)
             VALUES($1,$2,$3,$4,$5,true,$6,now()) ON CONFLICT(workspace_id,account_code) DO UPDATE
             SET account_name=EXCLUDED.account_name,account_type=EXCLUDED.account_type,parent_code=EXCLUDED.parent_code,
               active=true,import_id=EXCLUDED.import_id,imported_at=EXCLUDED.imported_at`,
            [workspaceId, account.code, account.name, account.type, account.parent_code, importId],
          );
          inserted.add(account.code); pending.delete(account.code);
        }
      }
      await client.query("INSERT INTO access_audit(actor_id,action,target,scope_type,scope_id) VALUES($1,$2,$3,'workspace',$4)",
        [userId, `${PLUGIN_ID}.account-catalog.imported`, importId, workspaceId]);
      return { import_id: importId, idempotent_replay: false, row_count: accounts.length };
    });
    return { ...imported, ...(await this.getFinancialAccountCatalog(workspaceId, userId)) };
  }

  async financialJournalCsv(workspaceInput: string, userId: string, from?: string, to?: string, unitInput?: string) {
    this.assertAvailable();
    const workspaceId = id(workspaceInput);
    const unitId = unitInput ? id(unitInput) : undefined;
    const ledger = await this.learning.financialLedgerRows(userId, from, to, unitId, workspaceId);
    const settlementRows = await this.db.query<{
      id: string; nature: "fee" | "chargeback"; occurred_on: string; amount: string; currency: string;
    }>(
      `SELECT r.import_id::text || ':' || r.row_number::text AS id,r.nature,r.occurred_on::text,
         r.amount::text,r.currency
       FROM suinda_financial_statement_rows r JOIN suinda_financial_statement_imports i
         ON i.id=r.import_id AND i.workspace_id=r.workspace_id
       WHERE r.workspace_id=$1 AND r.match_status='recorded' AND r.nature=ANY(ARRAY['fee','chargeback'])
         AND r.occurred_on BETWEEN $2::date AND $3::date AND ($4::uuid IS NULL OR i.unit_record_id=$4::uuid)
       ORDER BY r.occurred_on,r.import_id,r.row_number LIMIT 50000`,
      [workspaceId, ledger.from, ledger.to, unitId || null],
    );
    const stored = await this.db.one<{ mappings: AccountMapping }>(
      "SELECT mappings FROM suinda_financial_account_mappings WHERE workspace_id=$1", [workspaceId],
    );
    const mappings = stored?.mappings ? this.validateMappings({ mappings: stored.mappings }) : null;
    if (!mappings) fail("Configure o plano de contas do workspace antes de exportar o diário contábil.", 409);
    await this.requireCatalogAccounts(workspaceId, mappings);
    const rows = ledger.rows.map((row) => {
      const nature = row.nature as FinancialNature;
      if (!FINANCIAL_NATURES.includes(nature) || !mappings[nature]) fail("O plano de contas não cobre uma natureza deste período.", 409);
      const mapping = mappings[nature];
      const descriptions: Record<FinancialNature, string> = {
        cash_receipt: "Recebimento acadêmico", cash_refund: "Estorno financeiro",
        scholarship_credit: "Crédito de bolsa", waiver_credit: "Isenção financeira",
      };
      const description = descriptions[nature];
      return [row.occurred_at.slice(0, 10), description, row.currency, mapping.debit_account, mapping.credit_account,
        String(row.amount), row.entry_type, row.entry_id];
    });
    const settlementJournalRows = settlementRows.map((row) => {
      const nature: SettlementNature = row.nature === "fee" ? "provider_fee" : "provider_chargeback";
      const mapping = mappings[nature];
      if (!mapping) fail(`Configure as contas para ${nature} antes de exportar a liquidação.`, 409);
      // In the source statement, a negative amount is the normal settlement deduction.
      // A positive amount reverses it, so reverse the configured ledger sides as well.
      const reversal = Number(row.amount) > 0;
      const description = `${nature === "provider_fee" ? "Tarifa do provedor" : "Contestação/chargeback do provedor"}${reversal ? " (reversão)" : ""}`;
      return [row.occurred_on, description, row.currency,
        reversal ? mapping.credit_account : mapping.debit_account,
        reversal ? mapping.debit_account : mapping.credit_account,
        Math.abs(Number(row.amount)).toFixed(2), "settlement_component", row.id];
    });
    const headers = ["Data", "Descrição", "Moeda", "Conta débito", "Conta crédito", "Valor", "Tipo do lançamento", "ID do lançamento"];
    const csv = `\uFEFF${[headers, ...rows, ...settlementJournalRows].map((line) => line.map(csvCell).join(";")).join("\r\n")}`;
    await this.access.audit(userId, `${PLUGIN_ID}.journal.exported`, `${workspaceId}:${ledger.from}:${ledger.to}; unit=${unitId || "all"}; rows=${rows.length}`,
      { type: "workspace", id: workspaceId });
    const entries = [...rows, ...settlementJournalRows].map((row) => ({
      date: String(row[0]), description: String(row[1]), currency: String(row[2]), debit_account: String(row[3]),
      credit_account: String(row[4]), amount: String(row[5]), entry_type: String(row[6]), entry_id: String(row[7]),
    }));
    return { csv, file_name: `suinda-diario-${ledger.from}-${ledger.to}.csv`, from: ledger.from, to: ledger.to, count: entries.length, entries };
  }

  async getErpConfig(workspaceInput: string, userId: string) {
    this.assertAvailable();
    const workspaceId = await this.authorizeWorkspaceManager(userId, workspaceInput);
    const config = await this.db.one<{ endpoint: string; active: boolean }>(
      "SELECT endpoint,active FROM suinda_erp_integrations WHERE workspace_id=$1", [workspaceId],
    );
    const endpoint = config?.endpoint ?? null;
    return { workspace_id: workspaceId, configured: Boolean(config), endpoint, active: config?.active ?? false };
  }

  async saveErpConfig(workspaceInput: string, userId: string, input: unknown) {
    this.assertAvailable();
    const workspaceId = await this.authorizeWorkspaceManager(userId, workspaceInput);
    const body = object(input);
    if (Object.keys(body).some((key) => !["endpoint", "bearer_token", "active"].includes(key))
      || typeof body.active !== "boolean") fail("Informe destino HTTPS e estado da integração ERP.");
    const previous = await this.db.one<{ endpoint: string; token_encrypted: string }>(
      "SELECT endpoint,token_encrypted FROM suinda_erp_integrations WHERE workspace_id=$1", [workspaceId],
    );
    const endpoint = body.endpoint === undefined ? previous?.endpoint : typeof body.endpoint === "string" ? body.endpoint.trim() : "";
    if (!endpoint) fail("Informe o destino HTTPS do ERP.");
    const parsed = await validatePublicHttpsTarget(endpoint);
    if (parsed.url.search || parsed.url.hash) fail("O destino ERP não pode conter parâmetros ou fragmentos na URL.");
    let tokenEncrypted = previous?.token_encrypted;
    if (body.bearer_token !== undefined) {
      if (typeof body.bearer_token !== "string" || body.bearer_token.length < 12 || body.bearer_token.length > 4096
        || /[\r\n]/.test(body.bearer_token)) fail("O token de acesso deve ter entre 12 e 4096 caracteres e não conter quebras de linha.");
      tokenEncrypted = this.secrets.seal({ token: body.bearer_token });
    }
    if (!tokenEncrypted) fail("Informe o token de acesso do ERP.");
    await this.db.query(
      `INSERT INTO suinda_erp_integrations(workspace_id,endpoint,token_encrypted,active,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$5) ON CONFLICT(workspace_id) DO UPDATE SET endpoint=EXCLUDED.endpoint,
       token_encrypted=EXCLUDED.token_encrypted,active=EXCLUDED.active,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [workspaceId, endpoint, tokenEncrypted, body.active, userId],
    );
    await this.access.audit(userId, `${PLUGIN_ID}.erp.configured`, workspaceId, { type: "workspace", id: workspaceId });
    return this.getErpConfig(workspaceId, userId);
  }

  async removeErpConfig(workspaceInput: string, userId: string) {
    this.assertAvailable();
    const workspaceId = await this.authorizeWorkspaceManager(userId, workspaceInput);
    await this.db.query("DELETE FROM suinda_erp_integrations WHERE workspace_id=$1", [workspaceId]);
    await this.access.audit(userId, `${PLUGIN_ID}.erp.removed`, workspaceId, { type: "workspace", id: workspaceId });
    return { ok: true };
  }

  async listErpBatches(workspaceInput: string, userId: string, cursorInput?: string, requestedLimit?: string | number, paginated = false) {
    this.assertAvailable();
    const workspaceId = await this.authorizeWorkspaceManager(userId, workspaceInput);
    const { cursor, limit } = paginated ? parseErpBatchPage(cursorInput, requestedLimit) : { cursor: null, limit: 0 };
    if (!paginated) {
      const batches = await this.db.query<ErpBatchSummary>(`SELECT id::text,period_from::text AS from,period_to::text AS to,unit_record_id::text,
        entry_count,payload_sha256,status,attempt_count,remote_status,created_at,last_attempt_at
        FROM suinda_erp_batches WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC`, [workspaceId]);
      return { batches };
    }
    const total = await this.db.one<{ total: number | string }>(
      "SELECT count(*)::int AS total FROM suinda_erp_batches WHERE workspace_id=$1", [workspaceId]);
    const rows = await this.db.query<ErpBatchSummary & { _cursor_created_at: string }>(`SELECT id::text,period_from::text AS from,period_to::text AS to,unit_record_id::text,
      entry_count,payload_sha256,status,attempt_count,remote_status,created_at,last_attempt_at,
      to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS _cursor_created_at
      FROM suinda_erp_batches WHERE workspace_id=$1
        AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid))
      ORDER BY created_at DESC,id DESC LIMIT $4`, [workspaceId, cursor?.created_at ?? null, cursor?.id ?? null, limit + 1]);
    const hasMore = rows.length > limit;
    const batches = hasMore ? rows.slice(0, limit) : rows;
    return { batches, total: Number(total?.total || 0), has_more: hasMore,
      next_cursor: hasMore && batches.length ? erpBatchCursor(batches[batches.length - 1]) : null, limit };
  }

  async createErpBatch(workspaceInput: string, userId: string, input: unknown) {
    this.assertAvailable();
    const workspaceId = await this.authorizeWorkspaceManager(userId, workspaceInput);
    const body = object(input);
    if (Object.keys(body).some((key) => !["from", "to", "unit_record_id"].includes(key))
      || typeof body.from !== "string" || typeof body.to !== "string") fail("Informe um período contábil válido.");
    const unitId = body.unit_record_id === undefined ? undefined : id(String(body.unit_record_id));
    const journal = await this.financialJournalCsv(workspaceInput, userId, body.from, body.to, unitId);
    if (journal.count > 50000) fail("O lote excede o limite de 50.000 lançamentos.", 413);
    const batchId = randomUUID();
    const payload = { schema: "suinda.erp.journal-batch.v1", batch_id: batchId, workspace_id: workspaceId,
      period: { from: journal.from, to: journal.to }, unit_record_id: unitId || null, currency_basis: "per_entry",
      entries: journal.entries };
    const payloadText = JSON.stringify(payload);
    const payloadSha = createHash("sha256").update(payloadText).digest("hex");
    await this.db.query(
      `INSERT INTO suinda_erp_batches(id,workspace_id,unit_record_id,period_from,period_to,entry_count,payload,payload_sha256,created_by)
       VALUES($1,$2,$3,$4::date,$5::date,$6,$7::text,$8,$9)`,
      [batchId, workspaceId, unitId || null, journal.from, journal.to, journal.count, payloadText, payloadSha, userId],
    );
    await this.access.audit(userId, `${PLUGIN_ID}.erp.batch-created`, batchId, { type: "workspace", id: workspaceId });
    const delivery = await this.deliverErpBatch(workspaceId, batchId, userId);
    return { batch: delivery.batch, delivery: delivery.batch.status, ...(delivery.batch.status === "failed" ? { message: "O ERP não confirmou o lote; o mesmo lote pode ser reenviado com segurança." } : {}) };
  }

  async retryErpBatch(workspaceInput: string, batchInput: string, userId: string) {
    this.assertAvailable();
    const workspaceId = await this.authorizeWorkspaceManager(userId, workspaceInput);
    return this.deliverErpBatch(workspaceId, id(batchInput), userId);
  }

  private async deliverErpBatch(workspaceId: string, batchId: string, userId: string) {
    await this.authorizeWorkspaceManager(userId, workspaceId);
    const config = await this.db.one<{ endpoint: string; token_encrypted: string; active: boolean }>(
      "SELECT endpoint,token_encrypted,active FROM suinda_erp_integrations WHERE workspace_id=$1", [workspaceId],
    );
    if (!config?.active) fail("Configure e ative a integração ERP antes de enviar lotes.", 409);
    const batch = await this.db.one<ErpBatchDelivery>(`UPDATE suinda_erp_batches SET status='sending',attempt_count=attempt_count+1,last_attempt_at=now()
      WHERE id=$1 AND workspace_id=$2 AND (status IN ('pending','failed') OR status='sending' AND last_attempt_at<now()-interval '1 minute')
      RETURNING id::text,period_from::text AS from,period_to::text AS to,
      unit_record_id::text,entry_count,payload,payload_sha256,status,attempt_count,remote_status,created_at,last_attempt_at`, [batchId, workspaceId]);
    if (!batch) {
      const existing = await this.db.one<{ status: string }>("SELECT status FROM suinda_erp_batches WHERE id=$1 AND workspace_id=$2", [batchId, workspaceId]);
      if (!existing) fail("Lote ERP não encontrado.", 404);
      fail(existing.status === "delivered" ? "Este lote já foi confirmado pelo ERP e não pode ser reenviado." : "Este lote já está sendo processado.", 409);
    }
    const actualHash = createHash("sha256").update(batch.payload).digest("hex");
    if (actualHash !== batch.payload_sha256) {
      await this.db.query("UPDATE suinda_erp_batches SET status='failed' WHERE id=$1 AND workspace_id=$2", [batchId, workspaceId]);
      fail("A integridade do lote ERP não confere; nenhum dado foi enviado.", 409);
    }
    let remoteStatus: number | null = null;
    let delivered = false;
    try {
      const { token } = this.secrets.open<{ token: string }>(config.token_encrypted);
      await postSecureHttpsJson(config.endpoint, batch.payload, {
        authorization: `Bearer ${token}`, "idempotency-key": batch.id, "x-suinda-payload-sha256": batch.payload_sha256,
      });
      delivered = true;
    } catch (error) {
      const match = error instanceof Error ? /^HTTP_(\d{3})$/.exec(error.message) : null;
      remoteStatus = match ? Number(match[1]) : null;
    }
    await this.db.query("UPDATE suinda_erp_batches SET status=$3,remote_status=$4,delivered_at=CASE WHEN $3='delivered' THEN now() ELSE NULL END WHERE id=$1 AND workspace_id=$2",
      [batchId, workspaceId, delivered ? "delivered" : "failed", remoteStatus]);
    await this.access.audit(userId, `${PLUGIN_ID}.erp.batch-${delivered ? "delivered" : "failed"}`, batchId, { type: "workspace", id: workspaceId });
    const updated = await this.db.one<ErpBatchSummary>(`SELECT id::text,period_from::text AS from,period_to::text AS to,unit_record_id::text,
      entry_count,payload_sha256,status,attempt_count,remote_status,created_at,last_attempt_at FROM suinda_erp_batches WHERE id=$1`, [batchId]);
    if (!updated) fail("O estado do lote não pôde ser confirmado.", 500);
    return { batch: updated, delivery: delivered ? "delivered" : "failed" };
  }

  private async transaction<T>(run: (client: PoolClient) => Promise<T>) {
    const client = await this.db.pool.connect();
    try { await client.query("BEGIN"); const result = await run(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  private async result(client: PoolClient, importId: string): Promise<ReconciliationResult> {
    const batch = await client.query<{
      id: string; workspace_id: string; unit_record_id: string | null; created_at: Date; row_count: number;
      matched_count: number; ambiguous_count: number; unmatched_count: number; recorded_count: number;
    }>("SELECT id::text,workspace_id::text,unit_record_id::text,created_at,row_count,matched_count,ambiguous_count,unmatched_count,recorded_count FROM suinda_financial_statement_imports WHERE id=$1", [importId]);
    if (!batch.rows[0]) fail("Importação financeira não encontrada.", 404);
    const rows = await client.query<{ line: number; nature: ImportedStatementLine["nature"]; match_status: MatchStatus; candidate_count: number; payment_entry_id: string | null;
      candidate_payment_entry_ids: string[];
      selected_payment_entry_id: string | null; reason_code: string | null; decided_at: Date | null; decided_by: string | null }>(
      `SELECT r.row_number AS line,r.nature,r.match_status,cardinality(r.candidate_payment_entry_ids)::int AS candidate_count,
         r.matched_payment_entry_id::text AS payment_entry_id,r.candidate_payment_entry_ids::text[] AS candidate_payment_entry_ids,
         d.selected_payment_entry_id::text,d.reason_code,d.created_at AS decided_at
       FROM suinda_financial_statement_rows r
      LEFT JOIN LATERAL (SELECT ev.selected_payment_entry_id,ev.reason_code,ev.created_at,u.name AS decided_by
         FROM suinda_financial_statement_resolution_events ev JOIN users u ON u.id=ev.created_by
         WHERE ev.import_id=r.import_id AND ev.row_number=r.row_number
         ORDER BY ev.created_at DESC,ev.id DESC LIMIT 1) d ON true
       WHERE r.import_id=$1 ORDER BY r.row_number`, [importId],
    );
    const record = batch.rows[0];
    const candidateIds = [...new Set(rows.rows.flatMap((row) => row.candidate_payment_entry_ids))];
    const candidates = candidateIds.length ? await client.query<PaymentCandidateOption>(
      `SELECT p.id::text,CASE WHEN p.payload->>'payment_method'='refund' THEN (-ABS((p.payload->>'amount')::numeric))::text
           ELSE ABS((p.payload->>'amount')::numeric)::text END AS amount,p.payload->>'currency' AS currency,
         p.payload->>'payment_method' AS method,p.created_at::text AS recorded_at,c.title AS course_title,ch.title AS cohort_title
       FROM extension_records p
       JOIN extension_records e ON e.id::text=p.payload->>'enrollment_record_id' AND e.workspace_id=p.workspace_id
         AND e.plugin_id='suinda-learning' AND e.kind='enrollment'
       JOIN extension_records c ON c.id::text=p.payload->>'course_record_id' AND c.workspace_id=p.workspace_id
         AND c.plugin_id='suinda-learning' AND c.kind='course'
       LEFT JOIN extension_records ch ON ch.id::text=e.payload->>'cohort_record_id' AND ch.workspace_id=p.workspace_id
         AND ch.plugin_id='suinda-learning' AND ch.kind='cohort'
       WHERE p.id=ANY($1::uuid[]) AND p.workspace_id=$2 AND p.plugin_id='suinda-learning' AND p.kind='payment_entry'
         AND p.state='recorded' AND ($3::uuid IS NULL OR COALESCE(NULLIF(e.payload->>'institution_unit_record_id',''),
           NULLIF(ch.payload->>'institution_unit_record_id',''),NULLIF(c.payload->>'institution_unit_record_id',''))=$3::text)`,
      [candidateIds, record.workspace_id, record.unit_record_id],
    ) : { rows: [] as PaymentCandidateOption[] };
    const candidatesById = new Map(candidates.rows.map((candidate) => [candidate.id, { ...candidate, recorded_at: new Date(candidate.recorded_at).toISOString() }]));
    return { import_id: record.id, created_at: record.created_at.toISOString(), row_count: record.row_count,
      matched_count: record.matched_count, ambiguous_count: record.ambiguous_count, unmatched_count: record.unmatched_count,
      recorded_count: record.recorded_count,
      rows: rows.rows.map((row) => ({ line: row.line, nature: row.nature, match_status: row.match_status, candidate_count: row.candidate_count,
        candidate_payment_entry_ids: row.candidate_payment_entry_ids,
        candidate_options: row.candidate_payment_entry_ids.flatMap((candidateId) => candidatesById.get(candidateId) || []),
        payment_entry_id: row.payment_entry_id, decision: row.selected_payment_entry_id ? {
          selected_payment_entry_id: row.selected_payment_entry_id, reason_code: row.reason_code!, decided_at: row.decided_at!.toISOString(), decided_by: row.decided_by!,
        } : null })) };
  }

  async listImports(workspaceInput: string, userId: string, unitInput?: string) {
    this.assertAvailable();
    const workspaceId = id(workspaceInput);
    const unitId = unitInput ? id(unitInput) : null;
    await this.authorize(userId, workspaceId, unitId);
    const imports = await this.db.query<{
      id: string; unit_record_id: string | null; created_at: Date; row_count: number;
      matched_count: number; ambiguous_count: number; unmatched_count: number; recorded_count: number;
    }>(
      `SELECT id::text,unit_record_id::text,created_at,row_count,matched_count,ambiguous_count,unmatched_count,recorded_count
       FROM suinda_financial_statement_imports WHERE workspace_id=$1
         AND ($2::uuid IS NULL OR unit_record_id=$2::uuid)
       ORDER BY created_at DESC,id DESC LIMIT 100`, [workspaceId, unitId],
    );
    await this.access.audit(userId, `${PLUGIN_ID}.statement.history.read`, workspaceId, { type: "workspace", id: workspaceId });
    return imports.map((item) => ({
      import_id: item.id, unit_record_id: item.unit_record_id, created_at: item.created_at.toISOString(),
      row_count: item.row_count, matched_count: item.matched_count,
      ambiguous_count: item.ambiguous_count, unmatched_count: item.unmatched_count, recorded_count: item.recorded_count,
    }));
  }

  async getImport(workspaceInput: string, importInput: string, userId: string) {
    this.assertAvailable();
    const workspaceId = id(workspaceInput);
    const importId = id(importInput);
    const header = await this.db.one<{ id: string; unit_record_id: string | null }>(
      `SELECT id::text,unit_record_id::text FROM suinda_financial_statement_imports
       WHERE workspace_id=$1 AND id=$2`, [workspaceId, importId],
    );
    if (!header) fail("Importação financeira não encontrada.", 404);
    await this.authorize(userId, workspaceId, header.unit_record_id || undefined);
    const record = await this.db.one<{
      id: string; created_at: Date; row_count: number; matched_count: number; ambiguous_count: number; unmatched_count: number; recorded_count: number;
    }>(
      `SELECT id::text,created_at,row_count,matched_count,ambiguous_count,unmatched_count,recorded_count
       FROM suinda_financial_statement_imports WHERE workspace_id=$1 AND id=$2`, [workspaceId, importId],
    );
    if (!record) fail("Importação financeira não encontrada.", 404);
    const rows = await this.db.query<{ line: number; nature: ImportedStatementLine["nature"]; match_status: MatchStatus; candidate_count: number; payment_entry_id: string | null;
      candidate_payment_entry_ids: string[];
      selected_payment_entry_id: string | null; reason_code: string | null; decided_at: Date | null; decided_by: string | null }>(
      `SELECT r.row_number AS line,r.nature,r.match_status,cardinality(r.candidate_payment_entry_ids)::int AS candidate_count,
         r.matched_payment_entry_id::text AS payment_entry_id,r.candidate_payment_entry_ids::text[] AS candidate_payment_entry_ids,
         d.selected_payment_entry_id::text,d.reason_code,d.created_at AS decided_at
       FROM suinda_financial_statement_rows r
       LEFT JOIN LATERAL (SELECT ev.selected_payment_entry_id,ev.reason_code,ev.created_at,u.name AS decided_by
         FROM suinda_financial_statement_resolution_events ev JOIN users u ON u.id=ev.created_by
         WHERE ev.import_id=r.import_id AND ev.row_number=r.row_number
         ORDER BY ev.created_at DESC,ev.id DESC LIMIT 1) d ON true
       WHERE r.workspace_id=$1 AND r.import_id=$2 ORDER BY r.row_number`, [workspaceId, importId],
    );
    const candidateIds = [...new Set(rows.flatMap((row) => row.candidate_payment_entry_ids))];
    const candidates = candidateIds.length ? await this.db.query<PaymentCandidateOption>(
      `SELECT p.id::text,CASE WHEN p.payload->>'payment_method'='refund' THEN (-ABS((p.payload->>'amount')::numeric))::text
           ELSE ABS((p.payload->>'amount')::numeric)::text END AS amount,p.payload->>'currency' AS currency,
         p.payload->>'payment_method' AS method,p.created_at::text AS recorded_at,c.title AS course_title,ch.title AS cohort_title
       FROM extension_records p
       JOIN extension_records e ON e.id::text=p.payload->>'enrollment_record_id' AND e.workspace_id=p.workspace_id
         AND e.plugin_id='suinda-learning' AND e.kind='enrollment'
       JOIN extension_records c ON c.id::text=p.payload->>'course_record_id' AND c.workspace_id=p.workspace_id
         AND c.plugin_id='suinda-learning' AND c.kind='course'
       LEFT JOIN extension_records ch ON ch.id::text=e.payload->>'cohort_record_id' AND ch.workspace_id=p.workspace_id
         AND ch.plugin_id='suinda-learning' AND ch.kind='cohort'
       WHERE p.id=ANY($1::uuid[]) AND p.workspace_id=$2 AND p.plugin_id='suinda-learning' AND p.kind='payment_entry'
         AND p.state='recorded' AND ($3::uuid IS NULL OR COALESCE(NULLIF(e.payload->>'institution_unit_record_id',''),
           NULLIF(ch.payload->>'institution_unit_record_id',''),NULLIF(c.payload->>'institution_unit_record_id',''))=$3::text)`,
      [candidateIds, workspaceId, header.unit_record_id],
    ) : [];
    const candidatesById = new Map(candidates.map((candidate) => [candidate.id, { ...candidate, recorded_at: new Date(candidate.recorded_at).toISOString() }]));
    await this.access.audit(userId, `${PLUGIN_ID}.statement.detail.read`, importId, { type: "workspace", id: workspaceId });
    return {
      import_id: record.id, created_at: record.created_at.toISOString(), row_count: record.row_count,
      matched_count: record.matched_count, ambiguous_count: record.ambiguous_count, unmatched_count: record.unmatched_count,
      recorded_count: record.recorded_count,
      rows: rows.map((row) => ({ line: row.line, nature: row.nature, match_status: row.match_status, candidate_count: row.candidate_count,
        candidate_payment_entry_ids: row.candidate_payment_entry_ids,
        candidate_options: row.candidate_payment_entry_ids.flatMap((candidateId) => candidatesById.get(candidateId) || []),
        payment_entry_id: row.payment_entry_id, decision: row.selected_payment_entry_id ? {
          selected_payment_entry_id: row.selected_payment_entry_id, reason_code: row.reason_code!, decided_at: row.decided_at!.toISOString(), decided_by: row.decided_by!,
        } : null })),
    } satisfies ReconciliationResult;
  }

  async resolveAmbiguousRow(workspaceInput: string, importInput: string, lineInput: string, userId: string, bodyInput: unknown) {
    this.assertAvailable();
    const workspaceId = id(workspaceInput);
    const importId = id(importInput);
    const line = Number(lineInput);
    if (!Number.isSafeInteger(line) || line < 2) fail("A linha do extrato não é válida.");
    const body = object(bodyInput);
    if (Object.keys(body).some((key) => !["operation_key", "payment_entry_id", "reason_code"].includes(key))) fail("A decisão contém campos desconhecidos.");
    if (typeof body.operation_key !== "string" || !UUID.test(body.operation_key)) fail("A chave de operação deve ser um UUID.");
    if (typeof body.payment_entry_id !== "string" || !UUID.test(body.payment_entry_id)) fail("Selecione um lançamento candidato válido.");
    const reasonCodes = new Set(["reference_confirmed", "provider_receipt_reviewed", "institutional_review"]);
    if (typeof body.reason_code !== "string" || !reasonCodes.has(body.reason_code)) fail("Selecione o fundamento da revisão.");
    const header = await this.db.one<{ unit_record_id: string | null }>(
      `SELECT unit_record_id::text FROM suinda_financial_statement_imports WHERE workspace_id=$1 AND id=$2`, [workspaceId, importId],
    );
    if (!header) fail("Importação financeira não encontrada.", 404);
    await this.authorize(userId, workspaceId, header.unit_record_id || undefined);
    const client = await this.db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${workspaceId}:suinda-accounting-resolution:${importId}`]);
      const previous = (await client.query<{ import_id: string; row_number: number; selected_payment_entry_id: string; reason_code: string }>(
        `SELECT import_id::text,row_number,selected_payment_entry_id::text,reason_code
         FROM suinda_financial_statement_resolution_events WHERE workspace_id=$1 AND operation_key=$2 FOR UPDATE`,
        [workspaceId, body.operation_key],
      )).rows[0];
      if (previous) {
        if (previous.import_id !== importId || previous.row_number !== line
          || previous.selected_payment_entry_id !== body.payment_entry_id || previous.reason_code !== body.reason_code)
          fail("A chave de operação já foi usada com outra decisão.", 409);
      } else {
        const importedRow = (await client.query<{ match_status: MatchStatus; candidate_payment_entry_ids: string[] }>(
          `SELECT match_status,candidate_payment_entry_ids::text[] FROM suinda_financial_statement_rows
           WHERE workspace_id=$1 AND import_id=$2 AND row_number=$3 FOR UPDATE`, [workspaceId, importId, line],
        )).rows[0];
        if (!importedRow) fail("Linha do extrato não encontrada.", 404);
        if (importedRow.match_status !== "ambiguous") fail("Somente linhas ambíguas podem receber decisão manual.", 409);
        if (!importedRow.candidate_payment_entry_ids.includes(body.payment_entry_id)) fail("O lançamento escolhido não está entre os candidatos originais desta linha.", 409);
        const payment = await client.query(
          `SELECT p.id FROM extension_records p
           JOIN extension_records e ON e.id::text=p.payload->>'enrollment_record_id' AND e.workspace_id=p.workspace_id
             AND e.plugin_id='suinda-learning' AND e.kind='enrollment'
           JOIN extension_records c ON c.id::text=p.payload->>'course_record_id' AND c.workspace_id=p.workspace_id
             AND c.plugin_id='suinda-learning' AND c.kind='course'
           LEFT JOIN extension_records ch ON ch.id::text=e.payload->>'cohort_record_id' AND ch.workspace_id=e.workspace_id
             AND ch.plugin_id='suinda-learning' AND ch.kind='cohort'
           WHERE p.id=$1 AND p.workspace_id=$2 AND p.plugin_id='suinda-learning' AND p.kind='payment_entry' AND p.state='recorded'
             AND ($3::uuid IS NULL OR COALESCE(NULLIF(e.payload->>'institution_unit_record_id',''),
               NULLIF(ch.payload->>'institution_unit_record_id',''),NULLIF(c.payload->>'institution_unit_record_id',''))=$3::text)`,
          [body.payment_entry_id, workspaceId, header.unit_record_id],
        );
        if (!payment.rowCount) fail("O lançamento saiu do estado conciliável ou não pertence ao escopo desta importação.", 409);
        const duplicate = await client.query(
          `SELECT 1 FROM suinda_financial_statement_rows r
           LEFT JOIN LATERAL (SELECT selected_payment_entry_id FROM suinda_financial_statement_resolution_events
             WHERE workspace_id=r.workspace_id AND import_id=r.import_id AND row_number=r.row_number
             ORDER BY created_at DESC,id DESC LIMIT 1) latest ON true
           WHERE r.workspace_id=$1 AND r.import_id=$2 AND r.row_number<>$4
             AND COALESCE(latest.selected_payment_entry_id,r.matched_payment_entry_id)=$3 LIMIT 1`,
          [workspaceId, importId, body.payment_entry_id, line],
        );
        if (duplicate.rowCount) fail("Esse lançamento já foi escolhido para outra linha deste extrato.", 409);
        await client.query(
          `INSERT INTO suinda_financial_statement_resolution_events(workspace_id,import_id,row_number,selected_payment_entry_id,operation_key,reason_code,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [workspaceId, importId, line, body.payment_entry_id, body.operation_key, body.reason_code, userId],
        );
        await client.query(
          `INSERT INTO access_audit(actor_id,action,target,scope_type,scope_id)
           VALUES($1,$2,$3,'workspace',$4)`,
          [userId, `${PLUGIN_ID}.statement.row.resolved`, importId, workspaceId],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
    return this.getImport(workspaceId, importId, userId);
  }

  async importStatement(workspaceIdInput: string, userId: string, bodyInput: unknown): Promise<ReconciliationResult> {
    this.assertAvailable();
    const workspaceId = id(workspaceIdInput);
    const body = object(bodyInput);
    if (Object.keys(body).some((key) => !["operation_key", "csv", "unit_record_id"].includes(key))) fail("A importação contém campos desconhecidos.");
    if (typeof body.operation_key !== "string" || !UUID.test(body.operation_key)) fail("A chave de operação deve ser um UUID.");
    if (typeof body.csv !== "string" || Buffer.byteLength(body.csv, "utf8") > 1_000_000) fail("Envie um CSV de até 1 MB.");
    let statementLines: ImportedStatementLine[];
    try { statementLines = parseFinancialStatementCsv(body.csv); }
    catch (error) { fail(error instanceof Error ? error.message : "Não foi possível ler o CSV financeiro."); }
    if (statementLines.some((line) => line.nature !== "payment")) {
      const settlements = new Map<string, ImportedStatementLine[]>();
      for (const line of statementLines) {
        const key = line.settlement_reference!;
        settlements.set(key, [...(settlements.get(key) || []), line]);
      }
      for (const [reference, lines] of settlements) {
        const totals = lines.filter((line) => line.nature === "net_settlement");
        if (totals.length !== 1) fail(`A liquidação ${reference} precisa ter exatamente uma linha net_settlement.`);
        if (lines.some((line) => line.currency !== totals[0]!.currency)) fail(`A liquidação ${reference} contém moedas diferentes.`);
        const cents = (value: string) => {
          const negative = value.startsWith("-");
          const [whole, fraction = "00"] = value.replace(/^-/, "").split(".");
          const amount = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
          return negative ? -amount : amount;
        };
        const componentTotal = lines.filter((line) => line.nature !== "net_settlement")
          .reduce((sum, line) => sum + cents(line.amount), 0n);
        if (componentTotal !== cents(totals[0]!.amount))
          fail(`A liquidação ${reference} não fecha: pagamentos, tarifas, reembolsos e chargebacks devem somar o valor net_settlement.`);
      }
    }
    const unitId = body.unit_record_id == null || body.unit_record_id === "" ? null : id(body.unit_record_id);
    await this.authorize(userId, workspaceId, unitId);
    const digest = createHash("sha256").update(body.csv, "utf8").digest("hex");
    const references = [...new Set(statementLines.filter((line) => line.nature === "payment" || line.nature === "refund").map((line) => line.reference))];

    return this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${workspaceId}:suinda-accounting:${body.operation_key}`]);
      const previous = (await client.query<{ id: string; csv_sha256: string; unit_record_id: string | null }>(
        `SELECT id::text,csv_sha256,unit_record_id::text FROM suinda_financial_statement_imports
         WHERE workspace_id=$1 AND operation_key=$2 FOR UPDATE`, [workspaceId, body.operation_key],
      )).rows[0];
      if (previous) {
        if (previous.csv_sha256 !== digest || previous.unit_record_id !== unitId) fail("A chave de operação já foi usada com outro conteúdo ou unidade.", 409);
        return this.result(client, previous.id);
      }

      const candidates = references.length ? (await client.query<PaymentCandidate>(
        `SELECT p.id::text,p.payload->>'payment_reference' AS reference,
           CASE WHEN p.payload->>'payment_method'='refund' THEN (-ABS((p.payload->>'amount')::numeric))::text
             ELSE ABS((p.payload->>'amount')::numeric)::text END AS amount,
           p.payload->>'currency' AS currency,p.payload->>'payment_method' AS method
         FROM extension_records p
         JOIN extension_records e ON e.id::text=p.payload->>'enrollment_record_id' AND e.workspace_id=p.workspace_id
           AND e.plugin_id='suinda-learning' AND e.kind='enrollment'
         JOIN extension_records c ON c.id::text=p.payload->>'course_record_id' AND c.workspace_id=p.workspace_id
           AND c.plugin_id='suinda-learning' AND c.kind='course'
         LEFT JOIN extension_records ch ON ch.id::text=e.payload->>'cohort_record_id' AND ch.workspace_id=e.workspace_id
           AND ch.plugin_id='suinda-learning' AND ch.kind='cohort'
         WHERE p.workspace_id=$1 AND p.plugin_id='suinda-learning' AND p.kind='payment_entry' AND p.state='recorded'
           AND p.payload->>'payment_reference'=ANY($2::text[])
           AND p.payload->>'payment_method' NOT IN ('scholarship','waiver')
           AND ($3::uuid IS NULL OR COALESCE(NULLIF(e.payload->>'institution_unit_record_id',''),
             NULLIF(ch.payload->>'institution_unit_record_id',''),NULLIF(c.payload->>'institution_unit_record_id',''))=$3::text)
         ORDER BY p.created_at,p.id LIMIT 10000`, [workspaceId, references, unitId],
      )).rows : [];
      const candidateMap = new Map<string, PaymentCandidate[]>();
      for (const candidate of candidates) candidateMap.set(candidate.reference, [...(candidateMap.get(candidate.reference) || []), candidate]);
      const importId = randomUUID();
      const classified = statementLines.map((line) => {
        if (["fee", "chargeback", "net_settlement"].includes(line.nature))
          return { line, matches: [] as PaymentCandidate[], matchStatus: "recorded" as const };
        const sameReference = candidateMap.get(line.reference) || [];
        const matches = sameReference.filter((candidate) => (line.nature !== "refund" || candidate.method === "refund")
          && candidate.currency.toUpperCase() === line.currency
          && Math.round(Number(candidate.amount) * 100) === Math.round(Number(line.amount) * 100));
        const matchStatus: MatchStatus = matches.length === 1 ? "matched" : matches.length > 1 ? "ambiguous" : "unmatched";
        return { line, matches, matchStatus };
      });
      const uniquelyMatched = classified.flatMap((row) => row.matches.length === 1 ? [row.matches[0].id] : []);
      if (new Set(uniquelyMatched).size !== uniquelyMatched.length)
        fail("O mesmo lançamento Orbit corresponde a mais de uma linha deste extrato. Remova a linha duplicada ou corrija a referência na origem.", 409);
      const matchedCount = classified.filter((row) => row.matchStatus === "matched").length;
      const ambiguousCount = classified.filter((row) => row.matchStatus === "ambiguous").length;
      const unmatchedCount = classified.filter((row) => row.matchStatus === "unmatched").length;
      const recordedCount = classified.filter((row) => row.matchStatus === "recorded").length;
      await client.query(
        `INSERT INTO suinda_financial_statement_imports(id,workspace_id,unit_record_id,operation_key,csv_sha256,
          row_count,matched_count,ambiguous_count,unmatched_count,recorded_count,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [importId, workspaceId, unitId, body.operation_key, digest, statementLines.length, matchedCount, ambiguousCount, unmatchedCount, recordedCount, userId],
      );
      for (const row of classified) {
        await client.query(
        `INSERT INTO suinda_financial_statement_rows(import_id,workspace_id,row_number,match_status,
            matched_payment_entry_id,candidate_payment_entry_ids,nature,reference_sha256,settlement_reference_sha256,occurred_on,amount,currency)
           VALUES($1,$2,$3,$4,$5,$6::uuid[],$7,$8,$9,$10::date,$11::numeric,$12)`,
          [importId, workspaceId, row.line.line, row.matchStatus, row.matches.length === 1 ? row.matches[0].id : null,
            row.matches.map((candidate) => candidate.id), row.line.nature,
            createHash("sha256").update(row.line.reference, "utf8").digest("hex"),
            row.line.settlement_reference ? createHash("sha256").update(row.line.settlement_reference, "utf8").digest("hex") : null,
            row.line.occurred_on, row.line.amount, row.line.currency],
        );
      }
      await client.query(
        `INSERT INTO access_audit(actor_id,action,target,scope_type,scope_id)
         VALUES($1,$2,$3,'workspace',$4)`,
        [userId, `${PLUGIN_ID}.statement.imported`, importId, workspaceId],
      );
      return this.result(client, importId);
    });
  }

  async createMercadoPagoReport(workspaceIdInput: string, userId: string, bodyInput: unknown) {
    this.assertAvailable();
    const workspaceId = await this.authorizeWorkspaceManager(userId, workspaceIdInput);
    const body = object(bodyInput);
    if (Object.keys(body).some((key) => !["from", "to"].includes(key))
      || typeof body.from !== "string" || typeof body.to !== "string") fail("Informe somente as datas inicial e final do relatório.");
    const accessToken = await this.learning.mercadoPagoAccessTokenForAccounting(workspaceId, userId);
    const task = await createMercadoPagoSettlementReport(accessToken, body.from, body.to);
    await this.access.audit(userId, `${PLUGIN_ID}.mercado-pago.report.requested`, task.task_id, { type: "workspace", id: workspaceId });
    return task;
  }

  async importMercadoPagoReport(workspaceIdInput: string, taskId: string, userId: string) {
    this.assertAvailable();
    const workspaceId = await this.authorizeWorkspaceManager(userId, workspaceIdInput);
    const accessToken = await this.learning.mercadoPagoAccessTokenForAccounting(workspaceId, userId);
    const task = await getMercadoPagoSettlementReport(accessToken, taskId);
    if (task.status !== "processed") return { ...task, imported: false };
    if (task.format !== "CSV" || !task.file_name) fail("O relatório precisa estar disponível em CSV para importar.", 422);
    const downloaded = await downloadMercadoPagoSettlementReport(accessToken, task.file_name);
    const normalized = normalizeMercadoPagoSettlementCsv(downloaded, task.task_id);
    const digest = createHash("sha256").update(`${workspaceId}:mercado-pago:${task.task_id}`).digest("hex");
    const bytes = Buffer.from(digest.slice(0, 32), "hex");
    bytes[6] = (bytes[6]! & 0x0f) | 0x80;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    const operationKey = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const result = await this.importStatement(workspaceId, userId, { operation_key: operationKey, csv: normalized.csv });
    await this.access.audit(userId, `${PLUGIN_ID}.mercado-pago.report.imported`, result.import_id, { type: "workspace", id: workspaceId });
    return { ...result, provider: "mercado_pago", provider_task_id: task.task_id, imported: true, skipped_provider_rows: normalized.skipped_rows };
  }
}

@Controller("extensions/suinda-accounting")
export class SuindaAccountingController {
  constructor(@Inject(SuindaAccountingService) private readonly accounting: SuindaAccountingService) {}

  @Get("workspaces/:workspaceId/erp/config") erpConfig(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string) {
    return this.accounting.getErpConfig(workspaceId, String(req.orbitUser));
  }

  @Put("workspaces/:workspaceId/erp/config") saveErpConfig(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Body() body: unknown) {
    return this.accounting.saveErpConfig(workspaceId, String(req.orbitUser), body);
  }

  @Delete("workspaces/:workspaceId/erp/config") removeErpConfig(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string) {
    return this.accounting.removeErpConfig(workspaceId, String(req.orbitUser));
  }

  @Get("workspaces/:workspaceId/erp/batches") erpBatches(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string,
    @Query("cursor") cursor?: string, @Query("limit") limit?: string) {
    return this.accounting.listErpBatches(workspaceId, String(req.orbitUser), cursor, limit, cursor !== undefined || limit !== undefined);
  }

  @Post("workspaces/:workspaceId/erp/batches") createErpBatch(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Body() body: unknown) {
    return this.accounting.createErpBatch(workspaceId, String(req.orbitUser), body);
  }

  @Post("workspaces/:workspaceId/erp/batches/:batchId/retry") retryErpBatch(@Req() req: AccessRequest,
    @Param("workspaceId") workspaceId: string, @Param("batchId") batchId: string) {
    return this.accounting.retryErpBatch(workspaceId, batchId, String(req.orbitUser));
  }

  @Get("workspaces/:workspaceId/account-mappings") accountMappings(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string) {
    return this.accounting.getAccountMappings(workspaceId, String(req.orbitUser));
  }

  @Put("workspaces/:workspaceId/account-mappings") saveAccountMappings(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Body() body: unknown,
  ) {
    return this.accounting.saveAccountMappings(workspaceId, String(req.orbitUser), body);
  }

  @Get("workspaces/:workspaceId/accounts") accountCatalog(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string) {
    return this.accounting.getFinancialAccountCatalog(workspaceId, String(req.orbitUser));
  }

  @Post("workspaces/:workspaceId/accounts/import") importAccountCatalog(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Body() body: unknown,
  ) {
    return this.accounting.importFinancialAccountCatalog(workspaceId, String(req.orbitUser), body);
  }

  @Get("workspaces/:workspaceId/journal.csv") async financialJournalCsv(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Query("from") from: string | undefined,
    @Query("to") to: string | undefined, @Query("unit_record_id") unitId: string | undefined, @Res() res: Response,
  ) {
    const file = await this.accounting.financialJournalCsv(workspaceId, String(req.orbitUser), from, to, unitId);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(file.csv);
  }

  @Get("workspaces/:workspaceId/imports") listImports(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Query("unit_record_id") unitId?: string) {
    return this.accounting.listImports(workspaceId, String(req.orbitUser), unitId);
  }

  @Get("workspaces/:workspaceId/imports/:importId") getImport(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Param("importId") importId: string) {
    return this.accounting.getImport(workspaceId, importId, String(req.orbitUser));
  }

  @Post("workspaces/:workspaceId/imports/:importId/rows/:line/resolutions") resolveRow(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Param("importId") importId: string,
    @Param("line") line: string, @Body() body: unknown,
  ) {
    return this.accounting.resolveAmbiguousRow(workspaceId, importId, line, String(req.orbitUser), body);
  }

  @Post("workspaces/:workspaceId/imports") importStatement(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Body() body: unknown) {
    return this.accounting.importStatement(workspaceId, String(req.orbitUser), body);
  }

  @Post("workspaces/:workspaceId/mercado-pago/reports") createMercadoPagoReport(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Body() body: unknown,
  ) {
    return this.accounting.createMercadoPagoReport(workspaceId, String(req.orbitUser), body);
  }

  @Get("workspaces/:workspaceId/mercado-pago/reports/:taskId") importMercadoPagoReport(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Param("taskId") taskId: string,
  ) {
    return this.accounting.importMercadoPagoReport(workspaceId, taskId, String(req.orbitUser));
  }
}
