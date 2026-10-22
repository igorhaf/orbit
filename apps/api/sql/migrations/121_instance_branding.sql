CREATE TABLE IF NOT EXISTS instance_branding (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  app_name text NOT NULL DEFAULT 'Orbit' CHECK (length(app_name) BETWEEN 1 AND 80),
  icon_kind text NOT NULL DEFAULT 'orbit' CHECK (icon_kind IN ('orbit','tree_of_life','custom')),
  custom_icon_data text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (icon_kind = 'custom' OR custom_icon_data IS NULL)
);

