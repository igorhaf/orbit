-- Published procedural rules are prerequisites for legitimate non-root journeys.
UPDATE access_roles SET permissions=ARRAY(SELECT DISTINCT unnest(permissions || ARRAY[
 'plugin.safdoulas-governance.read'
]::text[])) WHERE id IN ('safdoulas_institution','safdoulas_institution_representative','safdoulas_accreditor_candidate','safdoulas_accreditor','safdoulas_observer');
