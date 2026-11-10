CREATE TABLE IF NOT EXISTS orbit_knowledge_embeddings (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_plugin_id text NOT NULL CHECK(length(owner_plugin_id) BETWEEN 1 AND 120),
  collection_id text NOT NULL CHECK(length(collection_id) BETWEEN 1 AND 200),
  model text NOT NULL CHECK(model='text-embedding-3-small'),
  content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
  dimensions integer NOT NULL CHECK(dimensions=1536),
  embedding jsonb NOT NULL CHECK(jsonb_typeof(embedding)='array' AND jsonb_array_length(embedding)=1536),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,owner_plugin_id,collection_id,model,content_hash)
);
