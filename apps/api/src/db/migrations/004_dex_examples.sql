-- How a catalogue's dex shows species you haven't photographed yet by default:
-- 'slots' (an empty frame) or 'examples' (a greyed-out example photo).
ALTER TABLE catalogues
  ADD COLUMN dex_style text NOT NULL DEFAULT 'slots' CHECK (dex_style IN ('slots', 'examples'));

-- One example photo per species, fetched once from iNaturalist (or Wikipedia) and stored here as a
-- small WebP, so viewers' browsers never contact those sites. image is NULL when none was found;
-- checked_at says when to try again.
CREATE TABLE species_examples (
  species_id  bigint      PRIMARY KEY REFERENCES species (id) ON DELETE CASCADE,
  image       bytea,
  meta        jsonb,
  checked_at  timestamptz NOT NULL DEFAULT now()
);
