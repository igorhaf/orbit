-- Preserve the visible content of older card-backed vault items as text.
-- Their encrypted custom fields remain in secret_data and are rendered by the API.
CREATE TEMP TABLE vault_legacy_cards ON COMMIT DROP AS
SELECT v.id AS vault_id, v.card_id, c.title, c.description
FROM vault_items v JOIN cards c ON c.id = v.card_id
WHERE v.card_id IS NOT NULL;

UPDATE vault_items v
SET title = legacy.title,
    notes = COALESCE(legacy.description, ''),
    card_id = NULL,
    updated_at = now()
FROM vault_legacy_cards legacy
WHERE v.id = legacy.vault_id;

DELETE FROM cards c USING vault_legacy_cards legacy WHERE c.id = legacy.card_id;
