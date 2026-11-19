-- NÃO EXECUTAR SEM APROVAÇÃO OPERACIONAL. Executar com psql -X.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
\ir context.sql
\ir after.sql
\ir r6-after.sql
ROLLBACK;
