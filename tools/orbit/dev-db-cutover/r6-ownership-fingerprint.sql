-- NÃO EXECUTAR SEM APROVAÇÃO OPERACIONAL. Inclusão interna em transação.
-- Digest of owner dependency identities, not of definitions or ACL contents.
WITH objects AS (
  SELECT d.classid::regclass::text object_class,
         CASE WHEN d.classid = 'pg_database'::regclass AND db.datname = current_database()
              THEN '<current database>' ELSE i.identity END AS identity
  FROM pg_shdepend d
  CROSS JOIN LATERAL pg_identify_object(d.classid, d.objid, d.objsubid) i
  LEFT JOIN pg_database db ON d.classid = 'pg_database'::regclass AND d.objid = db.oid
  WHERE d.dbid IN (0,(SELECT oid FROM pg_database WHERE datname = current_database()))
    AND d.refclassid = 'pg_authid'::regclass
    AND d.refobjid = current_setting('orbit_cutover.app')::regrole
    AND d.deptype = 'o'
), serialized AS (
  SELECT jsonb_build_array(object_class, identity)::text AS line FROM objects
)
SELECT encode(sha256(convert_to(coalesce(string_agg(line, E'\n' ORDER BY line COLLATE "C"), ''), 'UTF8')), 'hex')
  AS observed_ownership_sha256, count(*) AS observed_ownership_count
FROM serialized
\gset
