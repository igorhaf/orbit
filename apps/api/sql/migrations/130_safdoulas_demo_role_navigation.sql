-- Customer-only navigation and document duties; no root or user-admin escalation.
UPDATE access_roles SET permissions=ARRAY(SELECT DISTINCT unnest(permissions || ARRAY[
 'account.read','account.write','boards.read','plugins.read'
]::text[])) WHERE id LIKE 'safdoulas_%' AND id NOT IN ('safdoulas_public_user','safdoulas_blinded_evaluator');
UPDATE access_roles SET permissions=ARRAY(SELECT DISTINCT unnest(permissions || ARRAY[
 'plugin.documents.publish'
]::text[])) WHERE id='safdoulas_federation_governance';
UPDATE access_roles SET permissions=ARRAY(SELECT DISTINCT unnest(permissions || ARRAY[
 'plugin.documents.publish','plugin.terms.read','plugin.safdoulas-assessments.write','plugin.safdoulas-assessments.publish'
]::text[])) WHERE id='safdoulas_workgroup';
UPDATE access_roles SET permissions=ARRAY(SELECT DISTINCT unnest(permissions || ARRAY[
 'plugin.assessments.read','plugin.terms.read','plugin.documents.read'
]::text[])) WHERE id='safdoulas_directorate';
