-- Native operations retain the original record access boundary, including for ROOT.
UPDATE access_roles SET permissions=ARRAY(SELECT DISTINCT unnest(permissions||ARRAY['plugin.record-cards.read','boards.read','calendar.read']))
 WHERE id LIKE 'safdoulas_%' AND id NOT IN ('safdoulas_public_user','safdoulas_blind_evaluator');
UPDATE access_roles SET permissions=ARRAY(SELECT DISTINCT unnest(permissions||ARRAY['plugin.record-cards.write','boards.write','calendar.write']))
 WHERE id IN ('safdoulas_federation_governance','safdoulas_directorate','safdoulas_working_group','safdoulas_institution_representative');
