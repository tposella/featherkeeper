-- Featherkeeper initial schema

CREATE TYPE catalogue_visibility AS ENUM ('private', 'members', 'public');
CREATE TYPE member_role AS ENUM ('owner', 'editor');

CREATE TABLE users (
  id             bigserial PRIMARY KEY,
  email          text        NOT NULL CHECK (email = lower(email) AND position('@' IN email) > 1),
  display_name   text        NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  password_hash  text        NOT NULL,
  is_site_admin  boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (email);

-- Session tokens are stored hashed; the raw token only ever lives in the user's cookie.
CREATE TABLE sessions (
  id          text        PRIMARY KEY,
  user_id     bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE catalogues (
  id              bigserial PRIMARY KEY,
  slug            text        NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 64),
  name            text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description     text        NOT NULL DEFAULT '',
  region_code     text,
  visibility      catalogue_visibility NOT NULL DEFAULT 'private',
  -- When true, sighting coordinates and photo GPS are hidden from anyone who can't edit.
  hide_locations  boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX catalogues_slug_key ON catalogues (slug);

CREATE TABLE catalogue_members (
  catalogue_id  bigint      NOT NULL REFERENCES catalogues (id) ON DELETE CASCADE,
  user_id       bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role          member_role NOT NULL,
  added_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (catalogue_id, user_id)
);
CREATE INDEX catalogue_members_user_idx ON catalogue_members (user_id);
-- Exactly one owner per catalogue (the API always creates one).
CREATE UNIQUE INDEX catalogue_one_owner ON catalogue_members (catalogue_id) WHERE role = 'owner';

-- Shared species reference, filled by the eBird import or by hand.
CREATE TABLE species (
  id                 bigserial PRIMARY KEY,
  ebird_code         text,
  common_name        text        NOT NULL CHECK (length(common_name) BETWEEN 1 AND 200),
  scientific_name    text        NOT NULL CHECK (length(scientific_name) BETWEEN 1 AND 200),
  family_common      text,
  family_scientific  text,
  taxon_order        text,
  taxon_sort         double precision,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX species_ebird_code_key ON species (ebird_code) WHERE ebird_code IS NOT NULL;
CREATE UNIQUE INDEX species_scientific_key ON species (lower(scientific_name));
CREATE INDEX species_common_idx ON species (lower(common_name));

-- The "dex": which species belong in a catalogue's checklist.
CREATE TABLE catalogue_species (
  catalogue_id    bigint      NOT NULL REFERENCES catalogues (id) ON DELETE CASCADE,
  species_id      bigint      NOT NULL REFERENCES species (id) ON DELETE RESTRICT,
  notes           text        NOT NULL DEFAULT '',
  cover_photo_id  bigint,
  added_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (catalogue_id, species_id)
);
CREATE INDEX catalogue_species_species_idx ON catalogue_species (species_id);

CREATE TABLE sightings (
  id             bigserial PRIMARY KEY,
  catalogue_id   bigint      NOT NULL REFERENCES catalogues (id) ON DELETE CASCADE,
  species_id     bigint      NOT NULL,
  observed_at    timestamptz,
  latitude       double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude      double precision CHECK (longitude BETWEEN -180 AND 180),
  location_name  text        NOT NULL DEFAULT '',
  notes          text        NOT NULL DEFAULT '',
  created_by     bigint      REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- A sighting can only be logged for a species that is in the catalogue's dex.
  -- NO ACTION (checked at end of statement) lets a catalogue delete cascade through,
  -- while removing a single species that still has sightings is refused.
  FOREIGN KEY (catalogue_id, species_id)
    REFERENCES catalogue_species (catalogue_id, species_id) ON DELETE NO ACTION,
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE INDEX sightings_catalogue_species_idx ON sightings (catalogue_id, species_id);
CREATE INDEX sightings_observed_idx ON sightings (catalogue_id, observed_at DESC);

CREATE TABLE photos (
  id              bigserial PRIMARY KEY,
  sighting_id     bigint      NOT NULL REFERENCES sightings (id) ON DELETE CASCADE,
  storage_key     text        NOT NULL,
  original_name   text        NOT NULL DEFAULT '',
  mime_type       text        NOT NULL,
  size_bytes      bigint      NOT NULL,
  width           integer,
  height          integer,
  taken_at        timestamptz,
  camera          text,
  lens            text,
  latitude        double precision,
  longitude       double precision,
  exif            jsonb,
  ai_suggestions  jsonb,
  uploaded_by     bigint      REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX photos_storage_key ON photos (storage_key);
CREATE INDEX photos_sighting_idx ON photos (sighting_id);

ALTER TABLE catalogue_species
  ADD CONSTRAINT catalogue_species_cover_fk
  FOREIGN KEY (cover_photo_id) REFERENCES photos (id) ON DELETE SET NULL;
