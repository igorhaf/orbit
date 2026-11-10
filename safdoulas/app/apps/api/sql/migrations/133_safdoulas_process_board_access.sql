-- Client configuration uses the generic structured process-board capability.
UPDATE access_roles SET permissions=ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['views.structured.use','plugin.process-board.read']))
WHERE id LIKE 'safdoulas_%' AND id NOT IN ('safdoulas_public_user','safdoulas_blinded_evaluator');
