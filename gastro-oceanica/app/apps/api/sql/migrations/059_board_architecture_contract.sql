CREATE TABLE board_architecture_contracts (
  board_id uuid PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  reference_board_id uuid NOT NULL REFERENCES boards(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (board_id <> reference_board_id)
);

CREATE FUNCTION enforce_reference_custom_field() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reference_id uuid;
BEGIN
  SELECT reference_board_id INTO reference_id FROM board_architecture_contracts WHERE board_id = NEW.board_id;
  IF reference_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM custom_fields WHERE board_id = reference_id
      AND name = NEW.name AND type = NEW.type AND options = NEW.options
  ) THEN
    RAISE EXCEPTION 'Campo fora da arquitetura do quadro de referência' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reference_custom_field_guard BEFORE INSERT OR UPDATE ON custom_fields
  FOR EACH ROW EXECUTE FUNCTION enforce_reference_custom_field();
