-- Experimental coordination domain for participating writers in this database.
CREATE TABLE editorial_authorization_generation (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 domain_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision >= 0),
 authorization_state text NOT NULL DEFAULT 'unavailable' CHECK(authorization_state = 'unavailable')
);

INSERT INTO editorial_authorization_generation DEFAULT VALUES;

CREATE FUNCTION orbit_editorial_generation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'UPDATE' THEN
  IF NEW.singleton = OLD.singleton AND NEW.domain_id = OLD.domain_id
     AND NEW.authorization_state = OLD.authorization_state AND NEW.revision = OLD.revision + 1 THEN
   RETURN NEW;
  END IF;
 END IF;
 RAISE EXCEPTION 'invalid editorial generation mutation' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER editorial_generation_update_guard BEFORE UPDATE OR DELETE
 ON editorial_authorization_generation FOR EACH ROW EXECUTE FUNCTION orbit_editorial_generation_guard();
CREATE TRIGGER editorial_generation_no_truncate BEFORE TRUNCATE
 ON editorial_authorization_generation FOR EACH STATEMENT EXECUTE FUNCTION orbit_editorial_generation_guard();

COMMENT ON TABLE editorial_authorization_generation IS
 'Internal counter for cooperating PostgreSQL writers only. Neither configuration attestation nor editorial authority. Restored clones inherit the domain identifier.';
