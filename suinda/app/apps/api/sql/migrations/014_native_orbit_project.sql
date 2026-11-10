ALTER TABLE ai_projects ADD COLUMN IF NOT EXISTS is_native boolean NOT NULL DEFAULT false;

UPDATE ai_projects
SET is_native=true, name='Orbit (nativo)', local_path='/home/meada/orbit-dev', updated_at=now()
WHERE lower(name)='orbit' AND is_native=false;
