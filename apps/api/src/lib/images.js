import { execFile } from 'node:child_process';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import exifr from 'exifr';
import sharp from 'sharp';
import { HttpError } from './errors.js';

const FORMATS = {
  heic: { ext: 'heic', mime: 'image/heic' },
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
  webp: { ext: 'webp', mime: 'image/webp' },
  tiff: { ext: 'tif', mime: 'image/tiff' },
  avif: { ext: 'avif', mime: 'image/avif' },
};

export const ACCEPTED_DESCRIPTION = 'JPEG, HEIC, PNG, WebP, TIFF or AVIF';

function detectFormat(meta) {
  if (meta.format === 'heif') return meta.compression === 'av1' ? FORMATS.avif : FORMATS.heic;
  return FORMATS[meta.format] ?? null;
}

// ---- HEIC (iPhone photos) ------------------------------------------------------
// sharp's prebuilt binaries can read the HEIF container but not decode HEVC pictures (a patent
// issue), so HEIC photos are decoded with libheif's command-line tool (the API image installs
// libheif-examples) into a temporary JPEG. That JPEG is already upright. The original HEIC is kept
// as the original file, and its EXIF is read directly.

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);

/** True if the file at `file` is a HEIC (HEVC) image, judged by its "ftyp" box. */
async function looksLikeHeic(file) {
  if (typeof file !== 'string') return false;
  const fh = await open(file, 'r');
  try {
    const { buffer } = await fh.read(Buffer.alloc(32), 0, 32, 0);
    if (buffer.toString('latin1', 4, 8) !== 'ftyp') return false;
    const brands = [buffer.toString('latin1', 8, 12)];
    for (let i = 16; i + 4 <= 32; i += 4) brands.push(buffer.toString('latin1', i, i + 4));
    return brands.some((b) => HEIC_BRANDS.has(b));
  } finally {
    await fh.close();
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
      } else resolve(stdout);
    });
  });
}

/** Decode a HEIC file to a temporary JPEG. Returns { path, cleanup }. */
export async function heicToJpeg(file) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fk-heic-'));
  const out = path.join(dir, 'decoded.jpg');
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    // heif-dec is the newer name (libheif 1.17+); heif-convert is the older one.
    for (const tool of ['heif-dec', 'heif-convert']) {
      try {
        await run(tool, ['-q', '92', file, out]);
        return { path: out, cleanup };
      } catch (err) {
        if (err.code !== 'ENOENT') throw new HttpError(415, "That HEIC photo couldn't be decoded. Try exporting it as JPEG.");
      }
    }
    throw new HttpError(415, "This server can't read HEIC photos yet (it needs libheif's heif-dec). Upload a JPEG instead.");
  } catch (err) {
    await cleanup();
    throw err;
  }
}

/**
 * Something sharp can read for a photo: the file itself, or for HEIC a decoded JPEG.
 * Returns { input, format, meta, upright, cleanup }. `upright` means rotation is already applied.
 */
export async function openImage(file) {
  let meta = null;
  try {
    meta = await sharp(file).metadata();
  } catch {
    meta = null;
  }
  const heic = (meta && meta.format === 'heif' && meta.compression !== 'av1') || (!meta && (await looksLikeHeic(file)));
  if (heic) {
    const decoded = await heicToJpeg(file);
    try {
      const decodedMeta = await sharp(decoded.path).metadata();
      return { input: decoded.path, format: FORMATS.heic, meta: decodedMeta, upright: true, cleanup: decoded.cleanup };
    } catch {
      await decoded.cleanup();
      throw new HttpError(415, "That HEIC photo couldn't be decoded. Try exporting it as JPEG.");
    }
  }
  if (!meta) throw new HttpError(415, `That file isn't an image we can read. Upload ${ACCEPTED_DESCRIPTION}.`);
  const format = detectFormat(meta);
  if (!format) throw new HttpError(415, `Unsupported image type. Upload ${ACCEPTED_DESCRIPTION}.`);
  return { input: file, format, meta, upright: false, cleanup: async () => {} };
}

/**
 * EXIF for an opened image. HEIC files are read whole (exifr can miss EXIF stored late in the file
 * when it reads a path in chunks), and if that still finds nothing, the decoded JPEG's copy is used.
 */
export async function readImageExif(original, img) {
  if (img.format.ext !== 'heic') return readExif(original);
  const fromHeic = await readExif(await readFile(original));
  const found = (r) => r.takenAt || r.camera || r.latitude !== null;
  if (found(fromHeic) || img.input === original) return fromHeic;
  const fromDecoded = await readExif(img.input);
  return found(fromDecoded) ? fromDecoded : fromHeic;
}

/** A sharp pipeline for an opened image, turned the right way up. */
export function uprightPipeline(img) {
  const s = sharp(img.input, { failOn: 'none' });
  return img.upright ? s : s.rotate();
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
  if (!raw) return { takenAt: null, localDateTime: '', camera: null, lens: null, latitude: null, longitude: null, exif: null };

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

  const dateValue = raw.DateTimeOriginal ?? raw.CreateDate ?? raw.DateCreated ?? raw.ModifyDate;
  const wall = String(dateValue ?? '').match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})/);
  return {
    takenAt: exifDateToIso(dateValue, raw.OffsetTimeOriginal),
    // The camera's own clock time, "YYYY-MM-DDTHH:mm", for prefilling forms.
    localDateTime: wall && wall[1] !== '0000' ? `${wall[1]}-${wall[2]}-${wall[3]}T${wall[4]}:${wall[5]}` : '',
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
  const img = await openImage(input);
  try {
    return await derive(input, img);
  } finally {
    await img.cleanup();
  }
}

async function derive(original, img) {
  const { meta, format } = img;
  const base = uprightPipeline(img);
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
    // EXIF comes from the original file (for HEIC, see readImageExif).
    readImageExif(original, img),
  ]);

  // Orientations 5-8 rotate by 90 degrees, so width and height swap (a decoded HEIC is already upright).
  const swapped = !img.upright && (meta.orientation ?? 1) >= 5;
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
