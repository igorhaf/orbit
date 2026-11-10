ALTER TABLE users ADD COLUMN is_root boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN disabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN session_version integer NOT NULL DEFAULT 0;
UPDATE users SET is_root=true WHERE email='igorhaf@gmail.com';
CREATE TABLE access_roles(id text PRIMARY KEY,name text NOT NULL,permissions text[] NOT NULL DEFAULT '{}');
CREATE TABLE access_grants(user_id uuid REFERENCES users(id) ON DELETE CASCADE,role_id text REFERENCES access_roles(id),scope_type text NOT NULL DEFAULT 'global',scope_id text NOT NULL DEFAULT '*',PRIMARY KEY(user_id,role_id,scope_type,scope_id));
CREATE TABLE access_audit(id bigserial PRIMARY KEY,actor_id uuid REFERENCES users(id),action text NOT NULL,target text,created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO access_roles VALUES
 ('platform_admin','Administração técnica',ARRAY['access.manage','plugins.manage','boards.read','boards.write','workspaces.read','workspaces.write','workspaces.manage']),
 ('workspace_admin','Administrador do workspace',ARRAY['boards.read','boards.write','workspaces.read','workspaces.write','workspaces.manage']),
 ('editor','Editor',ARRAY['boards.read','boards.write','workspaces.read']),
 ('reader','Leitor',ARRAY['boards.read','workspaces.read']),
 ('federation_governance','Direção da Federação',ARRAY['boards.read','workspaces.read']),
 ('formation_directorate','Diretoria de formação',ARRAY['boards.read','workspaces.read']),
 ('accreditation_workgroup','Grupo de trabalho de acreditação',ARRAY['boards.read','workspaces.read']),
 ('accreditor','Acreditadora',ARRAY['boards.read','workspaces.read']),
 ('accreditor_candidate','Candidata a acreditadora',ARRAY['boards.read','workspaces.read']),
 ('institution_representative','Representante da instituição',ARRAY['boards.read','workspaces.read']);
