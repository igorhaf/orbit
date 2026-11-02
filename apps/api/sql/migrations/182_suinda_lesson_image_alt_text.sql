ALTER TABLE extension_record_attachments
  ADD COLUMN alt_text text NOT NULL DEFAULT ''
  CHECK (length(alt_text) <= 500);
