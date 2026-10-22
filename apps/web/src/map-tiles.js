// Map tiles. OpenStreetMap's public tiles are fine for personal use; for heavier use,
// set VITE_TILE_URL / VITE_TILE_ATTRIBUTION at build time to a provider (or your own tile server).
export const TILE_URL = import.meta.env.VITE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION =
  import.meta.env.VITE_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
