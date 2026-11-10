INSERT INTO access_roles(id, name, permissions)
VALUES
  ('suinda_unit_manager', 'Gestor de unidade Suindá', ARRAY['plugin.suinda-learning.manage', 'plugin.suinda-learning.read']::text[]),
  ('suinda_unit_reader', 'Leitor de relatórios da unidade Suindá', ARRAY['plugin.suinda-learning.read']::text[])
ON CONFLICT (id) DO NOTHING;
