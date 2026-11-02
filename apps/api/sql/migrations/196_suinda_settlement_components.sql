ALTER TABLE suinda_financial_statement_imports
  ADD COLUMN IF NOT EXISTS recorded_count integer NOT NULL DEFAULT 0 CHECK (recorded_count >= 0);
ALTER TABLE suinda_financial_statement_imports
  DROP CONSTRAINT IF EXISTS suinda_financial_statement_imports_check;
ALTER TABLE suinda_financial_statement_imports
  DROP CONSTRAINT IF EXISTS suinda_financial_statement_imports_counts_check;
ALTER TABLE suinda_financial_statement_imports
  ADD CONSTRAINT suinda_financial_statement_imports_counts_check
  CHECK (matched_count + ambiguous_count + unmatched_count + recorded_count = row_count);

ALTER TABLE suinda_financial_statement_rows
  ADD COLUMN IF NOT EXISTS nature text NOT NULL DEFAULT 'payment',
  ADD COLUMN IF NOT EXISTS reference_sha256 text,
  ADD COLUMN IF NOT EXISTS settlement_reference_sha256 text,
  ADD COLUMN IF NOT EXISTS occurred_on date,
  ADD COLUMN IF NOT EXISTS amount numeric(11,2),
  ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE suinda_financial_statement_rows
  DROP CONSTRAINT IF EXISTS suinda_financial_statement_rows_match_status_check,
  DROP CONSTRAINT IF EXISTS suinda_financial_statement_rows_check,
  DROP CONSTRAINT IF EXISTS suinda_financial_statement_rows_status_shape_check,
  DROP CONSTRAINT IF EXISTS suinda_financial_statement_rows_nature_check,
  DROP CONSTRAINT IF EXISTS suinda_financial_statement_rows_digest_check,
  DROP CONSTRAINT IF EXISTS suinda_financial_statement_rows_amount_check;
ALTER TABLE suinda_financial_statement_rows
  ADD CONSTRAINT suinda_financial_statement_rows_status_shape_check CHECK (
    (match_status='matched' AND nature IN ('payment','refund') AND matched_payment_entry_id IS NOT NULL AND cardinality(candidate_payment_entry_ids)=1)
    OR (match_status='ambiguous' AND nature IN ('payment','refund') AND matched_payment_entry_id IS NULL AND cardinality(candidate_payment_entry_ids)>1)
    OR (match_status='unmatched' AND nature IN ('payment','refund') AND matched_payment_entry_id IS NULL AND cardinality(candidate_payment_entry_ids)=0)
    OR (match_status='recorded' AND nature IN ('fee','chargeback','net_settlement') AND matched_payment_entry_id IS NULL AND cardinality(candidate_payment_entry_ids)=0)
  ),
  ADD CONSTRAINT suinda_financial_statement_rows_nature_check CHECK (nature IN ('payment','fee','refund','chargeback','net_settlement')),
  ADD CONSTRAINT suinda_financial_statement_rows_digest_check CHECK (
    (reference_sha256 IS NULL OR reference_sha256 ~ '^[a-f0-9]{64}$')
    AND (settlement_reference_sha256 IS NULL OR settlement_reference_sha256 ~ '^[a-f0-9]{64}$')
  ),
  ADD CONSTRAINT suinda_financial_statement_rows_amount_check CHECK (
    (amount IS NULL OR amount <> 0) AND (currency IS NULL OR currency ~ '^[A-Z]{3}$')
  );
CREATE INDEX IF NOT EXISTS suinda_financial_statement_rows_settlement_journal_idx
  ON suinda_financial_statement_rows(workspace_id,occurred_on,import_id,row_number)
  WHERE match_status='recorded' AND nature IN ('fee','chargeback');
