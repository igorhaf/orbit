ALTER TABLE instance_branding
  ADD COLUMN IF NOT EXISTS login_tagline text NOT NULL DEFAULT 'Seu trabalho, com uma visão mais clara.',
  ADD COLUMN IF NOT EXISTS login_description text NOT NULL DEFAULT 'Acompanhe o que vem pela frente, veja as novidades e organize seus projetos em quadros.',
  ADD COLUMN IF NOT EXISTS login_benefits jsonb NOT NULL DEFAULT '["Tarefas e prazos em destaque","Quadros, listas e cartões","Atividade e notificações em um lugar"]'::jsonb;

ALTER TABLE instance_branding
  ADD CONSTRAINT instance_branding_login_benefits_array CHECK (jsonb_typeof(login_benefits) = 'array');
