CREATE TABLE gastro_inventory_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  code text,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  unit text NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 40),
  tracks_lots boolean NOT NULL DEFAULT false,
  current_balance integer NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
  archived_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gastro_inventory_products_code_unique UNIQUE (workspace_id, code)
);

CREATE INDEX gastro_inventory_products_workspace_active
  ON gastro_inventory_products(workspace_id, name) WHERE archived_at IS NULL;

CREATE TABLE gastro_inventory_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES gastro_inventory_products(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 80),
  expires_on date,
  current_balance integer NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gastro_inventory_lot_code_unique UNIQUE (product_id, code)
);

CREATE INDEX gastro_inventory_lots_expiry ON gastro_inventory_lots(expires_on, product_id);

CREATE TABLE gastro_inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES gastro_inventory_products(id) ON DELETE RESTRICT,
  lot_id uuid REFERENCES gastro_inventory_lots(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('entry', 'exit')),
  quantity integer NOT NULL CHECK (quantity > 0),
  product_name_snapshot text NOT NULL,
  product_code_snapshot text,
  unit_snapshot text NOT NULL,
  operation_key uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gastro_inventory_movement_operation_unique UNIQUE (workspace_id, operation_key)
);

CREATE INDEX gastro_inventory_movement_history
  ON gastro_inventory_movements(workspace_id, created_at DESC, id DESC);
CREATE INDEX gastro_inventory_movement_product_history
  ON gastro_inventory_movements(product_id, created_at DESC, id DESC);

CREATE FUNCTION gastro_inventory_movements_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'gastro inventory movement history is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER gastro_inventory_movements_no_update_delete
  BEFORE UPDATE OR DELETE ON gastro_inventory_movements
  FOR EACH ROW EXECUTE FUNCTION gastro_inventory_movements_immutable();
