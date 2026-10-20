-- Shared persistence for independently enabled workspace plugins.
CREATE TABLE extension_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  plugin_id text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 240),
  state text NOT NULL DEFAULT 'draft',
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,workspace_id)
);
CREATE INDEX extension_records_catalog ON extension_records(workspace_id,plugin_id,kind,updated_at DESC);

CREATE TABLE extension_record_versions (
  record_id uuid NOT NULL REFERENCES extension_records(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision>0),
  title text NOT NULL,
  state text NOT NULL,
  payload jsonb NOT NULL,
  reason text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(record_id,revision)
);
CREATE TABLE extension_operations (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  plugin_id text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation_key uuid NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,plugin_id,actor_id,operation_key)
);
CREATE TABLE extension_record_links (
  workspace_id uuid NOT NULL,
  record_id uuid NOT NULL REFERENCES extension_records(id) ON DELETE RESTRICT,
  target_record_id uuid NOT NULL,
  target_revision integer NOT NULL,
  relation text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(target_record_id,target_revision) REFERENCES extension_record_versions(record_id,revision) ON DELETE RESTRICT,
  FOREIGN KEY(record_id,workspace_id) REFERENCES extension_records(id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(target_record_id,workspace_id) REFERENCES extension_records(id,workspace_id) ON DELETE RESTRICT,
  PRIMARY KEY(record_id,target_record_id,target_revision,relation),
  CHECK (record_id<>target_record_id)
);
CREATE TABLE extension_term_acceptances (
  record_id uuid NOT NULL,
  revision integer NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(record_id,revision) REFERENCES extension_record_versions(record_id,revision) ON DELETE RESTRICT,
  PRIMARY KEY(record_id,revision,user_id)
);
CREATE TABLE extension_files (
  record_id uuid NOT NULL,
  revision integer NOT NULL,
  data bytea NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(record_id,revision) REFERENCES extension_record_versions(record_id,revision) ON DELETE RESTRICT,
  PRIMARY KEY(record_id,revision)
);
CREATE SEQUENCE extension_protocol_seq AS bigint;

CREATE FUNCTION extension_reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Extension history is append-only; create a new version'; END;
$$;
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['extension_record_versions','extension_record_links','extension_operations','extension_term_acceptances','extension_files'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION extension_reject_history_mutation()',name);
    EXECUTE format('CREATE TRIGGER immutable_table BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION extension_reject_history_mutation()',name);
  END LOOP;
END $$;
