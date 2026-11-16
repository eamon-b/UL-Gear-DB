-- When a snapshot share link was last opened (ms), recorded at most once a day. NULL: never
-- since it was made. Snapshots nobody owns are removed once this (or `created`) is 180 days old.
ALTER TABLE shares ADD COLUMN seen INTEGER;
