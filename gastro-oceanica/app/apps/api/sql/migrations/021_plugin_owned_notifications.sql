ALTER TABLE notifications ADD COLUMN IF NOT EXISTS plugin_id varchar(80) NOT NULL DEFAULT 'cards';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_url text;
UPDATE notifications SET plugin_id=CASE kind WHEN 'due' THEN 'planner' WHEN 'automation' THEN 'automations' ELSE 'cards' END;
