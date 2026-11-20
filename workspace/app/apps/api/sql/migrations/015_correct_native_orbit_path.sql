UPDATE ai_projects
SET local_path='/home/meada/projetos/orbit-dev', updated_at=now()
WHERE is_native=true;
