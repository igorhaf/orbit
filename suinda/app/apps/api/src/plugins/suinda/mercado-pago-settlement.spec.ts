import assert from "node:assert/strict";
import test from "node:test";
import { createMercadoPagoSettlementReport, downloadMercadoPagoSettlementReport, getMercadoPagoSettlementReport, normalizeMercadoPagoSettlementCsv } from "./mercado-pago-settlement";

function response(body: unknown, options: { status?: number; type?: string } = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: options.status || 200, headers: { "content-type": options.type || "application/json" },
  });
}

test("creates a dated Mercado Pago settlement report with a bearer token and returns only task metadata", async () => {
  let request: RequestInit | undefined;
  const result = await createMercadoPagoSettlementReport("APP_USR-private", "2026-10-01", "2026-10-03", async (url, init) => {
    assert.equal(url, "https://api.mercadopago.com/v1/account/settlement_report"); request = init;
    return response({ id: 123456, status: "pending", format: "CSV" }, { status: 202 });
  });
  assert.deepEqual(result, { task_id: "123456", status: "pending", format: "CSV" });
  assert.equal(new Headers(request?.headers).get("Authorization"), "Bearer APP_USR-private");
  assert.deepEqual(JSON.parse(String(request?.body)), { begin_date: "2026-10-01T00:00:00Z", end_date: "2026-10-03T23:59:59Z" });
});

test("rejects invalid report date ranges and malformed task IDs before requesting the provider", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; return response({ id: 1, status: "pending" }); };
  await assert.rejects(createMercadoPagoSettlementReport("token", "2026-02-30", "2026-03-01", fetcher), /intervalo de datas válido/);
  await assert.rejects(getMercadoPagoSettlementReport("token", "12?access_token=leak", fetcher), /Identificador da tarefa/);
  assert.equal(calls, 0);
});

test("reads task status and validates provider file names", async () => {
  const result = await getMercadoPagoSettlementReport("token", "2222", async (url) => {
    assert.equal(url, "https://api.mercadopago.com/v1/account/settlement_report/task/2222");
    return response({ id: 2222, status: "processed", format: "CSV", file_name: "settlement-report-123-2026-10-01-120000.csv" });
  });
  assert.deepEqual(result, { task_id: "2222", status: "processed", format: "CSV", file_name: "settlement-report-123-2026-10-01-120000.csv" });
  await assert.rejects(getMercadoPagoSettlementReport("token", "2222", async () => response({ id: 2222, status: "processed", file_name: "../secret.csv" })), /nome do arquivo/);
});

test("downloads a limited CSV report using bearer authentication, without placing credentials in URLs", async () => {
  const csv = "SOURCE_ID,TRANSACTION_TYPE,TRANSACTION_AMOUNT\n1,SETTLEMENT,1.00";
  const result = await downloadMercadoPagoSettlementReport("token", "settlement-report-1-2026-10-01.csv", async (url, init) => {
    assert.equal(url, "https://api.mercadopago.com/v1/account/settlement_report/settlement-report-1-2026-10-01.csv");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer token");
    return response(csv, { type: "text/csv" });
  });
  assert.equal(result, csv);
  await assert.rejects(downloadMercadoPagoSettlementReport("token", "settlement-report-1.csv", async () => response("xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })), /gerou XLSX/);
});

test("normalizes settlement fee, refund and chargeback rows and skips non-monetary account activity", () => {
  const raw = [
    "SOURCE_ID,TRANSACTION_TYPE,TRANSACTION_AMOUNT,TRANSACTION_CURRENCY,TRANSACTION_DATE,SETTLEMENT_NET_AMOUNT,SETTLEMENT_CURRENCY,SETTLEMENT_DATE",
    "991,SETTLEMENT,100.00,BRL,2026-10-01T10:00:00Z,95.00,BRL,2026-10-02T10:00:00Z",
    "992,REFUND,15.00,BRL,2026-10-01T10:00:00Z,15.00,BRL,2026-10-03T10:00:00Z",
    "993,CHARGEBACK,20.00,BRL,2026-10-01T10:00:00Z,20.00,BRL,2026-10-04T10:00:00Z",
    "withdrawal-1,WITHDRAWAL,10.00,BRL,2026-10-01T10:00:00Z,10.00,BRL,2026-10-05T10:00:00Z",
  ].join("\n");
  const result = normalizeMercadoPagoSettlementCsv(raw, "7821");
  assert.equal(result.supported_rows, 7);
  assert.equal(result.skipped_rows, 1);
  assert.match(result.csv, /"Mercado Pago 991","100\.00","BRL","2026-10-02","payment","mp:7821:2"/);
  assert.match(result.csv, /"Mercado Pago 991","-5\.00","BRL","2026-10-02","fee","mp:7821:2"/);
  assert.match(result.csv, /"Mercado Pago refund 992","-15\.00","BRL","2026-10-03","refund","mp:7821:3"/);
  assert.match(result.csv, /"Mercado Pago chargeback 993","-20\.00","BRL","2026-10-04","chargeback","mp:7821:4"/);
  assert.doesNotMatch(result.csv, /withdrawal-1/);
});

test("rejects settlement reports with missing columns, other currencies, bad amounts, or unsupported-only activity", () => {
  assert.throws(() => normalizeMercadoPagoSettlementCsv("id,type\n1,SETTLEMENT", "1"), /colunas necessárias/);
  const base = "SOURCE_ID,TRANSACTION_TYPE,TRANSACTION_AMOUNT,TRANSACTION_CURRENCY,TRANSACTION_DATE,SETTLEMENT_NET_AMOUNT,SETTLEMENT_CURRENCY\n";
  assert.throws(() => normalizeMercadoPagoSettlementCsv(`${base}1,SETTLEMENT,10,USD,2026-10-01T10:00:00Z,9,USD`, "1"), /moeda incompatível/);
  assert.throws(() => normalizeMercadoPagoSettlementCsv(`${base}1,SETTLEMENT,10.001,BRL,2026-10-01T10:00:00Z,9,BRL`, "1"), /decimal Mercado Pago válido/);
  assert.throws(() => normalizeMercadoPagoSettlementCsv(`${base}1,SETTLEMENT,10,BRL,2026-02-30T10:00:00Z,9,BRL`, "1"), /data de liquidação na linha .*inválida/);
  assert.throws(() => normalizeMercadoPagoSettlementCsv(`${base}1,WITHDRAWAL,10,BRL,2026-10-01T10:00:00Z,9,BRL`, "1"), /não contém operações compatíveis/);
});
