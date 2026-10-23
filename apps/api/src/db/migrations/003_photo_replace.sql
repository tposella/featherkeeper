-- Photos the keeper wants to replace with a better shot, with an optional note on why.
ALTER TABLE photos
  ADD COLUMN replace_wanted     boolean     NOT NULL DEFAULT false,
  ADD COLUMN replace_note       text        NOT NULL DEFAULT '',
  ADD COLUMN replace_marked_at  timestamptz;
CREATE INDEX photos_replace_idx ON photos (sighting_id) WHERE replace_wanted;
