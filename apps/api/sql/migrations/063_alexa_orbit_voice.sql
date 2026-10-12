CREATE TABLE IF NOT EXISTS alexa_orbit_configuration (
  id integer PRIMARY KEY CHECK(id=1),
  owner_id uuid NOT NULL REFERENCES users(id),
  configuration jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS alexa_orbit_requests (
  skill_id text NOT NULL,
  request_id text NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id),
  request_hash text NOT NULL,
  state text NOT NULL CHECK(state IN ('processing','completed','failed')),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(skill_id,request_id)
);
CREATE INDEX IF NOT EXISTS alexa_orbit_requests_created_idx ON alexa_orbit_requests(created_at);
