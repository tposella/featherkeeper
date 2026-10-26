-- Site-wide settings the admin changes in the app (registration mode, default storage quota,
-- taxonomy refresh results). One row per setting.
CREATE TABLE site_settings (
  key         text        PRIMARY KEY,
  value       jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Invitations to create an account when sign-ups are invite-only. Tokens are stored hashed;
-- the raw token only exists in the link the admin hands out. Each one works once.
CREATE TABLE invites (
  id          bigserial   PRIMARY KEY,
  token_hash  text        NOT NULL UNIQUE,
  note        text        NOT NULL DEFAULT '',
  created_by  bigint      REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_by     bigint      REFERENCES users (id) ON DELETE SET NULL,
  used_at     timestamptz
);

-- A per-user storage limit for uploaded photos, in MB. NULL = the site default (0 there = no limit).
ALTER TABLE users ADD COLUMN quota_mb integer CHECK (quota_mb IS NULL OR quota_mb >= 0);

-- A fingerprint of each original file, to warn about uploading the same photo twice.
ALTER TABLE photos ADD COLUMN sha256 text;
CREATE INDEX photos_sha256_idx ON photos (sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX photos_uploaded_by_idx ON photos (uploaded_by);
