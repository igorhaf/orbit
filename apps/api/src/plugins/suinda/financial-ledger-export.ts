export type FinancialLedgerExportRow = {
  entry_type: string;
  entry_id: string;
  workspace_name: string;
  unit_name: string;
  course_title: string;
  cohort_code: string;
  enrollment_reference: string;
  occurred_at: string;
  currency: string;
  amount: string | number;
  nature: string;
  payment_method: string;
  external_reference: string | null;
  state: string;
};

function cell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function createFinancialLedgerCsv(rows: FinancialLedgerExportRow[]) {
  const headers = ["Tipo", "ID do lançamento", "Workspace", "Unidade", "Curso", "Turma", "Referência da matrícula",
    "Data do lançamento", "Moeda", "Valor", "Natureza", "Forma de pagamento", "Referência externa", "Estado"];
  const values = rows.map((row) => [row.entry_type, row.entry_id, row.workspace_name, row.unit_name, row.course_title,
    row.cohort_code, row.enrollment_reference, row.occurred_at, row.currency, row.amount, row.nature,
    row.payment_method, row.external_reference, row.state]);
  return `\uFEFF${[headers, ...values].map((line) => line.map(cell).join(";")).join("\r\n")}`;
}
