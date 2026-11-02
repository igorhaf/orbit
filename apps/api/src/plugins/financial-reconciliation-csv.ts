import { parseCsvRecords } from "./suinda/enrollment-csv";

export type ImportedStatementLine = {
  line: number;
  reference: string;
  amount: string;
  currency: string;
  occurred_on: string;
  nature: "payment" | "fee" | "refund" | "chargeback" | "net_settlement";
  settlement_reference: string | null;
};

function invalid(message: string): never { throw new Error(message); }
function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}

export function parseFinancialStatementCsv(source: string): ImportedStatementLine[] {
  const records = parseCsvRecords(source);
  if (records.length < 2) invalid("O CSV precisa ter cabeçalho e ao menos uma linha de extrato.");
  if (records.length > 1001) invalid("O arquivo pode conter no máximo 1.000 lançamentos.");
  const headers = records[0].values.map((value, index) => value.replace(index === 0 ? /^\uFEFF/ : /$^/, "").trim().toLocaleLowerCase("pt-BR"));
  const aliases: Record<string, string[]> = {
    reference: ["reference", "referencia", "referência", "id_transacao", "id_transação"],
    amount: ["amount", "valor", "valor_liquido", "valor_líquido"],
    currency: ["currency", "moeda"],
    date: ["date", "data", "data_transacao", "data_transação"],
    nature: ["nature", "type", "tipo", "natureza"],
    settlement_reference: ["settlement_reference", "settlement_id", "id_liquidacao", "referencia_liquidacao"],
  };
  const indexes = Object.fromEntries(Object.entries(aliases).map(([field, names]) => [field, headers.findIndex((header) => names.includes(header))])) as Record<string, number>;
  const hasNature = indexes.nature >= 0;
  const hasSettlementReference = indexes.settlement_reference >= 0;
  if (hasNature && !hasSettlementReference) invalid("A coluna de natureza exige referência de liquidação em todas as linhas.");
  if (![4, 5, 6].includes(headers.length) || new Set(headers).size !== headers.length || Object.entries(indexes).some(([field, index]) => ["reference", "amount", "currency", "date"].includes(field) && index < 0) || headers.some((header) => !Object.values(aliases).some((names) => names.includes(header))))
    invalid("Use quatro colunas obrigatórias de referência, valor, moeda e data, com natureza e referência de liquidação opcionais. Valores negativos representam estornos.");

  return records.slice(1).map(({ line, values }) => {
    if (values.length !== headers.length) invalid(`A linha ${line} tem quantidade de colunas diferente do cabeçalho.`);
    const reference = values[indexes.reference].trim();
    if (!reference || reference.length > 200 || hasControlCharacter(reference))
      invalid(`A referência da linha ${line} é obrigatória e deve ter até 200 caracteres sem controles.`);
    const amountInput = values[indexes.amount].trim();
    const amount = parseStatementAmount(amountInput, line);
    const occurredOn = normalizeStatementDate(values[indexes.date].trim(), line);
    const currency = values[indexes.currency].trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) invalid(`A moeda da linha ${line} deve ser um código ISO 4217 de três letras.`);
    const nature = (hasNature ? values[indexes.nature].trim() : "payment") as ImportedStatementLine["nature"];
    if (!( ["payment", "fee", "refund", "chargeback", "net_settlement"] as const).includes(nature as ImportedStatementLine["nature"]))
      invalid(`A natureza da linha ${line} deve ser payment, fee, refund, chargeback ou net_settlement.`);
    const settlementReference = hasSettlementReference ? values[indexes.settlement_reference].trim() : null;
    if (hasSettlementReference && (!settlementReference || settlementReference.length > 200 || hasControlCharacter(settlementReference)))
      invalid(`A referência de liquidação da linha ${line} é obrigatória e deve ter até 200 caracteres sem controles.`);
    return { line, reference, amount, currency, occurred_on: occurredOn, nature, settlement_reference: settlementReference };
  });
}

function parseStatementAmount(input: string, line: number): string {
  const invalidAmount = () => invalid(`O valor da linha ${line} deve ser decimal positivo/negativo com até duas casas e separadores de milhar inequívocos.`);
  const sign = input.startsWith("-") ? "-" : "";
  const unsigned = input.replace(/^[+-]/, "");
  if (!unsigned || input.startsWith("+")) invalidAmount();
  let integer: string;
  let fraction: string;
  if (/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(unsigned)) {
    [integer, fraction = ""] = unsigned.split(".");
  } else if (/^(?:0|[1-9]\d*)(?:,\d{1,2})?$/.test(unsigned)) {
    [integer, fraction = ""] = unsigned.split(",");
  } else if (/^[1-9]\d{0,2}(?:\.\d{3})+,\d{1,2}$/.test(unsigned)) {
    const [whole, cents] = unsigned.split(",");
    integer = whole!.replace(/\./g, ""); fraction = cents!;
  } else if (/^[1-9]\d{0,2}(?:,\d{3})+\.\d{1,2}$/.test(unsigned)) {
    const [whole, cents] = unsigned.split(".");
    integer = whole!.replace(/,/g, ""); fraction = cents!;
  } else invalidAmount();
  const cents = BigInt(integer!) * 100n + BigInt((fraction! + "00").slice(0, 2));
  if (cents === 0n || cents > 99_999_999_900n) invalid(`O valor da linha ${line} deve ser diferente de zero e não ultrapassar 999.999.999,00.`);
  return `${sign}${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

function normalizeStatementDate(input: string, line: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input) || /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input);
  if (!match) invalid(`A data da linha ${line} deve usar AAAA-MM-DD ou DD/MM/AAAA.`);
  const iso = match[0]!.includes("-") ? input : `${match[3]}-${match[2]}-${match[1]}`;
  if (new Date(`${iso}T00:00:00.000Z`).toISOString().slice(0, 10) !== iso)
    invalid(`A data da linha ${line} deve usar uma data real no formato AAAA-MM-DD ou DD/MM/AAAA.`);
  return iso;
}
