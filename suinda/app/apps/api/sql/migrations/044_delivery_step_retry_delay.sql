ALTER TABLE delivery_steps ADD COLUMN IF NOT EXISTS retry_delay_ms integer NOT NULL DEFAULT 0 CHECK (retry_delay_ms BETWEEN 0 AND 60000);
