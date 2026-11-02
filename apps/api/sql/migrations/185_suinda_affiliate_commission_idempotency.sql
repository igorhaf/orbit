-- Idempotent commission ledger keys. All ledger values remain shared extension records.
CREATE UNIQUE INDEX IF NOT EXISTS suinda_affiliate_earned_payment_unique
  ON extension_records (workspace_id, (payload->>'association_record_id'), (payload->>'source_payment_entry_id'))
  WHERE plugin_id='suinda-affiliates' AND kind='commission_entry' AND payload->>'commission_type'='earned';

CREATE UNIQUE INDEX IF NOT EXISTS suinda_affiliate_refund_payment_unique
  ON extension_records (workspace_id, (payload->>'association_record_id'), (payload->>'refund_payment_entry_id'))
  WHERE plugin_id='suinda-affiliates' AND kind='commission_entry' AND payload->>'commission_type'='refund_adjustment';

CREATE OR REPLACE FUNCTION suinda_affiliate_commission_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Suindá affiliate commission ledger is append-only';
END;
$$;
DROP TRIGGER IF EXISTS suinda_affiliate_commission_immutable ON extension_records;
CREATE TRIGGER suinda_affiliate_commission_immutable BEFORE UPDATE OR DELETE ON extension_records
  FOR EACH ROW WHEN (OLD.plugin_id='suinda-affiliates' AND OLD.kind='commission_entry')
  EXECUTE FUNCTION suinda_affiliate_commission_immutable();
