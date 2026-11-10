DROP TRIGGER IF EXISTS orbit_cards_automation ON cards;
DROP TRIGGER IF EXISTS orbit_labels_automation ON card_labels;
DROP TRIGGER IF EXISTS orbit_members_automation ON card_assignees;
DROP TRIGGER IF EXISTS orbit_fields_automation ON card_custom_values;
DROP TRIGGER IF EXISTS orbit_comments_automation ON comments;
DROP TRIGGER IF EXISTS orbit_checklist_automation ON checklist_items;
DROP FUNCTION IF EXISTS orbit_automation_event();

DELETE FROM plugin_settings WHERE plugin_id='automations';
DELETE FROM notifications WHERE plugin_id='automations' OR kind='automation';

ALTER TABLE card_execution_configs DROP COLUMN IF EXISTS automation;
ALTER TABLE card_execution_configs DROP CONSTRAINT IF EXISTS card_execution_configs_mode_check;
UPDATE card_execution_configs SET mode='manual';
ALTER TABLE card_execution_configs ADD CONSTRAINT card_execution_configs_mode_check CHECK(mode='manual');
UPDATE card_execution_configs SET overrides=overrides-'automation' WHERE overrides ? 'automation';
ALTER TABLE card_runs DROP COLUMN IF EXISTS chain;

DROP TABLE IF EXISTS automation_mail CASCADE;
DROP TABLE IF EXISTS automation_runs CASCADE;
DROP TABLE IF EXISTS automation_events CASCADE;
DROP TABLE IF EXISTS automations CASCADE;
