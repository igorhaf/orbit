-- The federation governance role generates and retrieves unsigned concession drafts.
UPDATE access_roles
SET permissions = ARRAY(
  SELECT DISTINCT permission
  FROM unnest(permissions || ARRAY['plugin.documents.read','plugin.documents.write']::text[]) AS p(permission)
  ORDER BY permission
)
WHERE id = 'safdoulas_federation_governance';
