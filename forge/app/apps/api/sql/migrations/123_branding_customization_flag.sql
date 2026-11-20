ALTER TABLE instance_branding
  ADD COLUMN IF NOT EXISTS login_content_customized boolean NOT NULL DEFAULT false;
