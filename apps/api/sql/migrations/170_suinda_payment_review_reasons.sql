ALTER TABLE suinda_payment_checkouts
  ADD COLUMN IF NOT EXISTS review_reason text;

UPDATE suinda_payment_checkouts
SET review_reason = CASE provider_status
  WHEN 'approved_after_cancellation' THEN 'approved_after_cancellation'
  WHEN 'approved_overpayment' THEN 'approved_overpayment'
  WHEN 'refunded' THEN 'provider_refund'
  WHEN 'charged_back' THEN 'provider_chargeback'
  ELSE review_reason
END
WHERE status = 'review_required' AND review_reason IS NULL;
