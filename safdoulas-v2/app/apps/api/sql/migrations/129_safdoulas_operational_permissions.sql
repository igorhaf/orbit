-- Domain roles reuse Orbit capabilities; they never receive access.manage.
UPDATE access_roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['workspaces.read']::text[]))
WHERE id LIKE 'safdoulas_%' AND id NOT IN ('safdoulas_public_user','safdoulas_blinded_evaluator');

UPDATE access_roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY[
  'plugin.safdoulas-governance.read','plugin.safdoulas-governance.write','plugin.safdoulas-governance.publish',
  'plugin.forms.manage','plugin.forms.read','plugin.forms.write','plugin.forms.publish',
  'plugin.terms.read','plugin.terms.write','plugin.terms.publish',
  'plugin.assessments.read','plugin.assessments.write','plugin.assessments.publish',
  'plugin.safdoulas-reporting.read','plugin.safdoulas-reporting.export',
  'plugin.safdoulas-processes.transition.applicant','plugin.safdoulas-processes.transition.institution_representative',
  'plugin.safdoulas-processes.transition.screener','plugin.safdoulas-processes.transition.evaluator',
  'plugin.safdoulas-processes.transition.secretariat','plugin.safdoulas-processes.transition.deliberator',
  'plugin.safdoulas-processes.transition.appeal_reviewer'
]::text[])) WHERE id='safdoulas_federation_governance';

UPDATE access_roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY[
  'plugin.safdoulas-governance.read','plugin.documents.read','plugin.documents.write','plugin.forms.read'
]::text[])) WHERE id='safdoulas_workgroup';
