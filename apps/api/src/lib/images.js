import exifr from 'exifr';
import sharp from 'sharp';
import { HttpError } from './errors.js';

// sharp's prebuilt binaries can't decode HEIC, so iPhone photos need converting to JPEG first.
const FORMATS = {
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
  webp: { ext: 'webp', mime: 'image/webp' },
  tiff: { ext: 'tif', mime: 'image/tiff' },
  avif: { ext: 'avif', mime: 'image/avif' },
};

export const ACCEPTED_DESCRIPTION = 'JPEG, PNG, WebP, TIFF or AVIF';

function detectFormat(meta) {
  if (meta.format === 'heif') return meta.compression === 'av1' ? FORMATS.avif : null;
  return FORMATS[meta.format] ?? null;
}

/** "2024:05:18 07:42:10" (+ optional "-07:00") -> ISO string, or null. */
export function exifDateToIso(value, offset) {
  if (!value) return null;
  // EXIF: "2024:05:18 07:42:10"; XMP: "2024-05-18T07:42:10-06:00" (its own offset wins).
  const m = String(value).match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec = '00', own] = m;
  const s = sec;
  if (y === '0000') return null;
  const tz = own ?? (/^[+-]\d{2}:\d{2}$/.test(offset ?? '') ? offset : 'Z');
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${tz}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function round(n, places) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Pull the fields the app cares about out of a photo's EXIF. Accepts a file path or Buffer. Never throws. */
export async function readExif(input) {
  let raw;
  try {
    raw = await exifr.parse(input, {
      tiff: true,
      exif: true,
      gps: true,
      xmp: true,
      icc: false,
      iptc: false,
      reviveValues: false,
      translateValues: false,
    });
  } catch {
    raw = null;
  }
  if (!raw) return { takenAt: null, camera: null, lens: null, latitude: null, longitude: null, exif: null };

  let gps = null;
  try {
    gps = await exifr.gps(input);
  } catch {
    gps = null;
  }

  const make = raw.Make ? String(raw.Make).trim() : '';
  const model = raw.Model ? String(raw.Model).trim() : '';
  const camera = model ? (model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`.trim()) : make || null;
  const latitude = round(gps?.latitude, 6);
  const longitude = round(gps?.longitude, 6);
  const validGps = latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && !(latitude === 0 && longitude === 0);

  const exif = {
    make: make || null,
    model: model || null,
    lens: raw.LensModel ? String(raw.LensModel).trim() : null,
    fNumber: round(raw.FNumber, 1),
    exposureTime: round(raw.ExposureTime, 6),
    iso: typeof raw.ISO === 'number' ? raw.ISO : Array.isArray(raw.ISO) ? raw.ISO[0] : null,
    focalLength: round(raw.FocalLength, 1),
    focalLength35mm: typeof raw.FocalLengthIn35mmFormat === 'number' ? raw.FocalLengthIn35mmFormat : null,
  };

  return {
    takenAt: exifDateToIso(raw.DateTimeOriginal ?? raw.CreateDate ?? raw.DateCreated ?? raw.ModifyDate, raw.OffsetTimeOriginal),
    camera: camera || null,
    lens: exif.lens,
    latitude: validGps ? latitude : null,
    longitude: validGps ? longitude : null,
    exif,
  };
}

/**
 * Validate an upload (file path or Buffer) and produce the display and thumbnail versions.
 * Both derived images are re-encoded without metadata, so they never carry GPS.
 */
export async function processImage(input) {
  let meta;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new HttpError(415, `That file isn't an image we can read. Upload ${ACCEPTED_DESCRIPTION}.`);
  }
  const format = detectFormat(meta);
  if (!format) {
    const hint = meta.format === 'heif' ? ' HEIC photos need converting to JPEG first.' : '';
    throw new HttpError(415, `Unsupported image type.${hint} Upload ${ACCEPTED_DESCRIPTION}.`);
  }

  const base = sharp(input, { failOn: 'none' }).rotate();
  const [display, thumb, exifData] = await Promise.all([
    base
      .clone()
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer(),
    base
      .clone()
      .resize({ width: 480, height: 480, fit: 'cover', position: sharp.strategy.attention })
      .webp({ quality: 78 })
      .toBuffer(),
    readExif(input),
  ]);

  // Orientations 5-8 rotate by 90 degrees, so width and height swap.
  const swapped = (meta.orientation ?? 1) >= 5;
  return {
    ext: format.ext,
    mime: format.mime,
    width: swapped ? meta.height : meta.width,
    height: swapped ? meta.width : meta.height,
    display,
    thumb,
    ...exifData,
  };
}
