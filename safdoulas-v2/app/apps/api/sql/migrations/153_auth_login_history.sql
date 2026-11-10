CREATE TABLE auth_login_history (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_label text NOT NULL CHECK (length(device_label) BETWEEN 1 AND 160),
  logged_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_login_history_user_logged_idx
  ON auth_login_history(user_id, logged_at DESC, id DESC);
