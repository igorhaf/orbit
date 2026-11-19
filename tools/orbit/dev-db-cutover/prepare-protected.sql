-- NÃO EXECUTAR SEM APROVAÇÃO OPERACIONAL. Executar com psql -X.
SET LOCAL ROLE :"owner_role";
-- pg_catalog is implicitly searched first. Unqualified CREATE targets public.
SET LOCAL search_path = public;
\ir ../../../packages/orbit-core/sql/migrations/212_editorial_authorization_generation.sql
SET LOCAL search_path = pg_catalog, public;
INSERT INTO public.schema_migrations(version, checksum)
VALUES ('212_editorial_authorization_generation.sql',
        '2619740b0897181d8503f398bc37a16d054b581c83843c9ae4df2bc8dab9d8e9');

RESET ROLE;
\ir protected-acl.sql
