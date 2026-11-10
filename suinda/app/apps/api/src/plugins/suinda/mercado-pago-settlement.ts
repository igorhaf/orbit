import { HttpException } from "@nestjs/common";
import { parseCsvRecords } from "./enrollment-csv";

const API = "https://api.mercadopago.com";
const MAX_REPORT_BYTES = 1_000_000;

function fail(message: string, status = 400): never { throw new HttpException(message, status); }

function validateToken(token: string) {
  if (!token || token.length > 2048) fail("Credencial Mercado Pago inválida.", 503);
}

async function requestJson(url: string, token: string, init: RequestInit = {}, fetcher: typeof fetch = fetch) {
  validateToken(token);
  let response: Response;
  try {
    response = await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(12_000),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...init.headers } });
  } catch { fail("Não foi possível consultar os relatórios do Mercado Pago.", 502); }
  let raw = "";
  try { raw = await response.text(); } catch { fail("Resposta inválida do Mercado Pago.", 502); }
  if (Buffer.byteLength(raw) > 64_000) fail("Resposta de relatório do Mercado Pago excede o limite permitido.", 502);
  let data: unknown;
  try { data = JSON.parse(raw); } catch { fail("Resposta inválida do Mercado Pago.", 502); }
  if (!response.ok) fail("O Mercado Pago não aceitou a operação de relatório.", 502);
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("Resposta incompleta do Mercado Pago.", 502);
  return data as Record<string, unknown>;
}

export async function createMercadoPagoSettlementReport(accessToken: string, from: string, to: string, fetcher: typeof fetch = fetch) {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!validDate(from) || !validDate(to) || from > to)
    fail("Informe um intervalo de datas válido para o relatório.");
  const data = await requestJson(`${API}/v1/account/settlement_report`, accessToken, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ begin_date: `${from}T00:00:00Z`, end_date: `${to}T23:59:59Z` }),
  }, fetcher);
  if (!/^\d{1,30}$/.test(String(data.id)) || typeof data.status !== "string") fail("O Mercado Pago retornou uma tarefa de relatório inválida.", 502);
  return { task_id: String(data.id), status: data.status, format: typeof data.format === "string" ? data.format : null };
}

export async function getMercadoPagoSettlementReport(accessToken: string, taskId: string, fetcher: typeof fetch = fetch) {
  if (!/^\d{1,30}$/.test(taskId)) fail("Identificador da tarefa Mercado Pago inválido.");
  const data = await requestJson(`${API}/v1/account/settlement_report/task/${encodeURIComponent(taskId)}`, accessToken, {}, fetcher);
  if (String(data.id) !== taskId || typeof data.status !== "string") fail("O Mercado Pago retornou uma tarefa de relatório inválida.", 502);
  const format = typeof data.format === "string" ? data.format.toUpperCase() : null;
  const fileName = typeof data.file_name === "string" ? data.file_name : null;
  if (fileName && !/^settlement-report-[A-Za-z0-9._-]+\.csv$/i.test(fileName)) fail("O nome do arquivo de relatório é inválido.", 502);
  return { task_id: taskId, status: data.status, format, file_name: fileName };
}

export async function downloadMercadoPagoSettlementReport(accessToken: string, fileName: string, fetcher: typeof fetch = fetch) {
  validateToken(accessToken);
  if (!/^settlement-report-[A-Za-z0-9._-]+\.csv$/i.test(fileName)) fail("O nome do arquivo de relatório é inválido.");
  let response: Response;
  try { response = await fetcher(`${API}/v1/account/settlement_report/${encodeURIComponent(fileName)}`, {
    method: "GET", redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "text/csv" },
  }); } catch { fail("Não foi possível baixar o relatório Mercado Pago.", 502); }
  if (!response.ok) fail("O Mercado Pago não disponibilizou o relatório.", 502);
  const type = response.headers.get("content-type")?.toLowerCase() || "";
  if (type.includes("spreadsheet") || type.includes("application/vnd.openxmlformats-officedocument"))
    fail("O Mercado Pago gerou XLSX. Exporte o mesmo intervalo em CSV para importar com segurança.", 422);
  let csv: string;
  try { csv = await response.text(); } catch { fail("O arquivo de relatório está inválido.", 502); }
  if (!csv || Buffer.byteLength(csv, "utf8") > MAX_REPORT_BYTES) fail("O CSV de liquidação excede o limite de 1 MB.", 422);
  return csv;
}

function amountCents(value: string, line: number): bigint {
  const normalized = value.trim();
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) fail(`O valor da linha ${line} não é um decimal Mercado Pago válido.`, 422);
  const amount = BigInt(match[2]!) * 100n + BigInt((match[3] || "").padEnd(2, "0"));
  if (amount > 99_999_999_900n) fail(`O valor da linha ${line} excede o limite permitido.`, 422);
  return match[1] ? -amount : amount;
}

function decimal(cents: bigint) {
  const sign = cents < 0n ? "-" : "";
  const magnitude = cents < 0n ? -cents : cents;
  return `${sign}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, "0")}`;
}

function dateOnly(value: string, line: number) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  const midnight = parts ? new Date(`${parts[1]}-${parts[2]}-${parts[3]}T00:00:00.000Z`) : null;
  if (!parts || !midnight || Number.isNaN(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== `${parts[1]}-${parts[2]}-${parts[3]}`)
    fail(`A data de liquidação na linha ${line} é inválida.`, 422);
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) fail(`A data de liquidação na linha ${line} é inválida.`, 422);
  return date.toISOString().slice(0, 10);
}

/** Converts only monetary payment/fee/return/chargeback report rows; unrelated wallet movements are counted and skipped. */
export function normalizeMercadoPagoSettlementCsv(source: string, reportId: string) {
  if (!/^\d{1,30}$/.test(reportId)) fail("Identificador do relatório Mercado Pago inválido.");
  const records = parseCsvRecords(source);
  if (records.length < 2 || records.length > 1001) fail("O relatório deve conter entre 1 e 1.000 linhas de dados.", 422);
  const headers = records[0]!.values.map((value, index) => value.replace(index === 0 ? /^\uFEFF/ : /$^/, "").trim().toUpperCase());
  if (new Set(headers).size !== headers.length) fail("O relatório Mercado Pago tem cabeçalhos repetidos.", 422);
  const required = ["SOURCE_ID", "TRANSACTION_TYPE", "TRANSACTION_AMOUNT", "TRANSACTION_CURRENCY", "TRANSACTION_DATE", "SETTLEMENT_NET_AMOUNT", "SETTLEMENT_CURRENCY"];
  if (required.some((header) => !headers.includes(header))) fail("O CSV não contém as colunas necessárias do relatório Dinheiro em conta do Mercado Pago.", 422);
  const index = (name: string) => headers.indexOf(name);
  const output: string[][] = [["reference", "amount", "currency", "date", "nature", "settlement_reference"]];
  let skippedRows = 0;
  for (const record of records.slice(1)) {
    if (record.values.length !== headers.length) fail(`A linha ${record.line} tem quantidade de colunas inválida.`, 422);
    const row = record.values;
    const kind = row[index("TRANSACTION_TYPE")]!.trim().toUpperCase();
    if (!["SETTLEMENT", "REFUND", "CHARGEBACK"].includes(kind)) { skippedRows += 1; continue; }
    const sourceId = row[index("SOURCE_ID")]!.trim();
    const hasControlCharacter = [...sourceId].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    });
    if (!sourceId || sourceId.length > 100 || hasControlCharacter) fail(`A linha ${record.line} não tem SOURCE_ID válido.`, 422);
    const currency = row[index("SETTLEMENT_CURRENCY")]!.trim().toUpperCase();
    const transactionCurrency = row[index("TRANSACTION_CURRENCY")]!.trim().toUpperCase();
    if (currency !== "BRL" || transactionCurrency !== currency) fail(`A linha ${record.line} tem moeda incompatível com o checkout BRL do Suindá.`, 422);
    const grossCents = amountCents(row[index("TRANSACTION_AMOUNT")]!, record.line);
    const netCentsRaw = amountCents(row[index("SETTLEMENT_NET_AMOUNT")]!, record.line);
    if (grossCents === 0n || netCentsRaw === 0n) { skippedRows += 1; continue; }
    const negative = kind !== "SETTLEMENT";
    const gross = negative ? -((grossCents < 0n) ? -grossCents : grossCents) : (grossCents < 0n ? -grossCents : grossCents);
    const net = negative ? -((netCentsRaw < 0n) ? -netCentsRaw : netCentsRaw) : (netCentsRaw < 0n ? -netCentsRaw : netCentsRaw);
    const fee = net - gross;
    const settlementDateIndex = index("SETTLEMENT_DATE");
    const date = dateOnly(settlementDateIndex >= 0 && row[settlementDateIndex] ? row[settlementDateIndex]! : row[index("TRANSACTION_DATE")]!, record.line);
    const reference = kind === "SETTLEMENT" ? `Mercado Pago ${sourceId}` : `Mercado Pago ${kind.toLowerCase()} ${sourceId}`;
    const settlement = `mp:${reportId}:${record.line}`;
    output.push([reference, decimal(gross), "BRL", date, kind === "SETTLEMENT" ? "payment" : kind === "REFUND" ? "refund" : "chargeback", settlement]);
    if (fee !== 0n) output.push([reference, decimal(fee), "BRL", date, "fee", settlement]);
    output.push([reference, decimal(net), "BRL", date, "net_settlement", settlement]);
  }
  if (output.length === 1) fail("O relatório não contém operações compatíveis com pagamentos do Suindá.", 422);
  if (output.length - 1 > 1000) fail("O relatório normalizado excede 1.000 linhas de conciliação; divida o período em intervalos menores.", 422);
  return { csv: output.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n"),
    supported_rows: output.length - 1, skipped_rows: skippedRows };
}
