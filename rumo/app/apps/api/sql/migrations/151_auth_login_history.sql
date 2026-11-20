CREATE TABLE IF NOT EXISTS auth_login_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  logged_at timestamptz NOT NULL DEFAULT now(),
  device_label text NOT NULL DEFAULT 'Navegador desconhecido'
    CHECK (length(device_label) BETWEEN 1 AND 160)
);

CREATE INDEX IF NOT EXISTS auth_login_history_user_logged_idx
  ON auth_login_history(user_id, logged_at DESC, id DESC);
