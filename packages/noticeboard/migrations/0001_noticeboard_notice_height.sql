-- A notice carries its own height as well as its width, so the household can
-- size a notice freely and its contents are drawn to fit the box.
ALTER TABLE mod_noticeboard.notices
  ADD COLUMN IF NOT EXISTS height double precision NOT NULL DEFAULT 0.36;

-- Notices pinned before this change were drawn at whatever height their
-- contents needed. Give each one the height a new notice of its kind starts
-- at, kept inside the cork, and leave its top-left corner where it is unless
-- the notice would hang off the bottom of the board.
UPDATE mod_noticeboard.notices
SET height = GREATEST(0.22, LEAST(CASE WHEN image IS NULL THEN 0.36 ELSE 0.5 END, 1 - pos_y));

UPDATE mod_noticeboard.notices
SET pos_y = 1 - height
WHERE pos_y > 1 - height;

ALTER TABLE mod_noticeboard.notices
  DROP CONSTRAINT IF EXISTS ck_noticeboard_notices_height;

ALTER TABLE mod_noticeboard.notices
  ADD CONSTRAINT ck_noticeboard_notices_height
  CHECK (height >= 0.12 AND height <= 0.9);
