INSERT INTO access_roles(id,name,permissions)
VALUES('suinda_student','Aluno Suindá',ARRAY[]::text[])
ON CONFLICT(id) DO NOTHING;
UPDATE access_roles SET permissions=ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['plugin.suinda-learning.read']))
WHERE id='suinda_student';

CREATE TABLE account_terms_acceptances(
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terms_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,terms_version)
);
