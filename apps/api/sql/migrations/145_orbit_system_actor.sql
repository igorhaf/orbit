-- A non-authenticatable actor for core and product-owned scheduled record transitions.
INSERT INTO users(id,name,email,password_hash,is_root,disabled)
VALUES(gen_random_uuid(),'Orbit system actor','orbit-system-actor@orbit.invalid',crypt(gen_random_uuid()::text,gen_salt('bf')),false,true)
ON CONFLICT(email) DO UPDATE SET is_root=false,disabled=true;
