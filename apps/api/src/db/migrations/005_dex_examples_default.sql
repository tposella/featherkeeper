-- Greyed example photos are the default dex view, for new and existing catalogues.
ALTER TABLE catalogues ALTER COLUMN dex_style SET DEFAULT 'examples';
UPDATE catalogues SET dex_style = 'examples' WHERE dex_style = 'slots';
