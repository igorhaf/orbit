-- NÃO EXECUTAR SEM APROVAÇÃO OPERACIONAL. Leitura para revisão, psql -X.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
\ir identity.sql
WITH source AS (
  SELECT oid FROM pg_database WHERE datname = current_database()
)
SELECT d.classid::regclass AS object_class, i.identity, d.dbid = 0 AS shared
FROM pg_shdepend d
CROSS JOIN LATERAL pg_identify_object(d.classid, d.objid, d.objsubid) i
WHERE d.dbid IN (0,(SELECT oid FROM source))
  AND d.refclassid = 'pg_authid'::regclass
  AND d.refobjid = current_setting('orbit_cutover.app')::regrole
  AND d.deptype = 'o'
ORDER BY 1,2;
\ir r6-ownership-fingerprint.sql
\echo Reviewed candidate: :observed_ownership_sha256 (:observed_ownership_count objects)
ROLLBACK;
