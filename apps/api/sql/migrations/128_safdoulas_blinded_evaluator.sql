-- Internal role applied only to exact blinded-document and assignment scopes.
-- Keep already-applied migration 125 unchanged.
INSERT INTO access_roles(id,name,permissions) VALUES
  ('safdoulas_blinded_evaluator','SAFDOULAS — avaliação cegada por processo',ARRAY[
    'plugin.documents.read','plugin.safdoulas-blinding.read','plugin.safdoulas-assessments.read'
  ]) ON CONFLICT (id) DO NOTHING;

UPDATE access_roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY[
  'plugin.assessments.read','plugin.terms.read'
]::text[])) WHERE id IN ('safdoulas_accreditor','safdoulas_workgroup');
