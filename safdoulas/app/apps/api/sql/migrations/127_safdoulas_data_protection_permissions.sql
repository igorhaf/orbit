-- Data-protection policies and incident records are restricted to designated SafDoulas staff.
UPDATE access_roles
SET permissions = ARRAY(
  SELECT DISTINCT permission
  FROM unnest(permissions || ARRAY[
    'plugin.safdoulas-data-protection.read',
    'plugin.safdoulas-data-protection.manage'
  ]::text[]) AS expanded(permission)
  ORDER BY permission
)
WHERE id = 'safdoulas_federation_governance';

UPDATE access_roles
SET permissions = ARRAY(
  SELECT DISTINCT permission
  FROM unnest(permissions || ARRAY[
    'plugin.safdoulas-data-protection.read'
  ]::text[]) AS expanded(permission)
  ORDER BY permission
)
WHERE id = 'safdoulas_directorate';
