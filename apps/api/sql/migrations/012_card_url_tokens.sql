ALTER TABLE cards ADD COLUMN IF NOT EXISTS url_token uuid DEFAULT gen_random_uuid();
UPDATE cards SET url_token=gen_random_uuid() WHERE url_token IS NULL;
ALTER TABLE cards ALTER COLUMN url_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cards_url_token_unique_idx ON cards(url_token);
