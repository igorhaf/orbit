CREATE TABLE IF NOT EXISTS alexa_orbit_ai_jobs (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES users(id),
 skill_id text NOT NULL,
 request_id text NOT NULL,
 speaker_hash text NOT NULL,
 encrypted_input text NOT NULL,
 state text NOT NULL CHECK (state IN ('queued','interpreting','executing','completed','needs_input','failed')),
 encrypted_result text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(skill_id,request_id)
);
CREATE INDEX IF NOT EXISTS alexa_orbit_ai_jobs_queue_idx ON alexa_orbit_ai_jobs(created_at) WHERE state='queued';
CREATE INDEX IF NOT EXISTS alexa_orbit_ai_jobs_owner_idx ON alexa_orbit_ai_jobs(owner_id,speaker_hash,created_at DESC);
