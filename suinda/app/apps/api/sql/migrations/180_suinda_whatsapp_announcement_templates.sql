ALTER TABLE suinda_whatsapp_config
  ADD COLUMN IF NOT EXISTS announcement_template_name varchar(128),
  ADD COLUMN IF NOT EXISTS announcement_template_language varchar(8);

ALTER TABLE suinda_whatsapp_config
  ADD CONSTRAINT suinda_whatsapp_announcement_template_pair
  CHECK ((announcement_template_name IS NULL) = (announcement_template_language IS NULL));
