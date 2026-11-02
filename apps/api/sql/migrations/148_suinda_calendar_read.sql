UPDATE access_roles
SET permissions=ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['calendar.read']))
WHERE id='suinda_student';
