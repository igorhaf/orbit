UPDATE suinda_payment_checkouts
SET provider_status = 'approved'
WHERE status = 'review_required'
  AND provider_status IN ('approved_after_cancellation', 'approved_overpayment');
