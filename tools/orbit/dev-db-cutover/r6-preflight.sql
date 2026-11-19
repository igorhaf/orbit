-- NÃO EXECUTAR SEM APROVAÇÃO OPERACIONAL. Executar com psql -X.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
\ir identity.sql
\ir operator.sql
\ir r6-before.sql
ROLLBACK;
