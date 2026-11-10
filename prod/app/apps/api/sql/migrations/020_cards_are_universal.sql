DROP INDEX IF EXISTS cards_role_schedule_idx;
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_card_role_check;
ALTER TABLE cards DROP COLUMN IF EXISTS card_role;
