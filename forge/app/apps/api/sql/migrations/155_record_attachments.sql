CREATE TABLE extension_record_attachments (
  id uuid NOT NULL,
  record_id uuid NOT NULL,
  revision integer NOT NULL,
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 240),
  mime_type text NOT NULL CHECK (length(mime_type) BETWEEN 1 AND 160),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 8388608),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  scan_status text NOT NULL CHECK (scan_status IN ('clean','not_configured')),
  data bytea NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(record_id,revision,id),
  FOREIGN KEY(record_id,revision) REFERENCES extension_record_versions(record_id,revision) ON DELETE RESTRICT
);

CREATE INDEX extension_record_attachments_parent_idx ON extension_record_attachments(record_id,revision,created_at,id);

CREATE FUNCTION extension_reject_attachment_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Record attachments are append-only'; END;
$$;

CREATE TRIGGER extension_record_attachments_immutable
BEFORE UPDATE OR DELETE ON extension_record_attachments
FOR EACH ROW EXECUTE FUNCTION extension_reject_attachment_mutation();
