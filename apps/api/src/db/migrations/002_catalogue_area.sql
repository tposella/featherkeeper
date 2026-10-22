-- The place a catalogue's species list was built from (city search or map click),
-- so the import can be refreshed later and maps can open there.
ALTER TABLE catalogues
  ADD COLUMN area_label      text,
  ADD COLUMN area_latitude   double precision CHECK (area_latitude BETWEEN -90 AND 90),
  ADD COLUMN area_longitude  double precision CHECK (area_longitude BETWEEN -180 AND 180),
  ADD COLUMN area_radius_km  integer CHECK (area_radius_km BETWEEN 1 AND 50),
  ADD CONSTRAINT catalogues_area_complete
    CHECK ((area_latitude IS NULL) = (area_longitude IS NULL));
