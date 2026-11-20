-- Preserve Orbit users, projects, boards, lists, cards and checklists.
-- 061 is retained unchanged because deployed migrations are checksum-verified.
DROP TABLE IF EXISTS alexa_previews;
DROP TABLE IF EXISTS alexa_card_bindings;
DROP TABLE IF EXISTS alexa_column_bindings;
DROP TABLE IF EXISTS alexa_exports;
DELETE FROM oauth_states WHERE plugin_id='alexa';
DELETE FROM integration_connections WHERE plugin_id='alexa';
DELETE FROM plugin_settings WHERE plugin_id='alexa';
