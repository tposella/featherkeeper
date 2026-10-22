import exifr from 'exifr';

/**
 * Read date and GPS from a photo in the browser so the form can be prefilled
 * before anything is uploaded. Returns { localDateTime, latitude, longitude, camera }.
 * localDateTime is the camera's wall-clock time as "YYYY-MM-DDTHH:mm".
 */
export async function readPhotoMetadata(file) {
  const result = { localDateTime: '', latitude: null, longitude: null, camera: '' };
  try {
    // tiff + exif cover cameras and phones; xmp covers editors (Lightroom, Photoshop) that write dates there.
    const tags = await exifr.parse(file, { tiff: true, exif: true, xmp: true, gps: false, reviveValues: false });
    const make = String(tags?.Make ?? '').trim();
    const model = String(tags?.Model ?? '').trim();
    const body = model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`.trim();
    result.camera = [body, String(tags?.LensModel ?? tags?.Lens ?? '').trim()].filter(Boolean).join(', ');
    result.localDateTime = localDateTimeFrom(tags);
  } catch (err) {
    console.warn('Could not read photo metadata:', err?.message);
  }
  try {
    const gps = await exifr.gps(file);
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude) && !(gps.latitude === 0 && gps.longitude === 0)) {
      result.latitude = Math.round(gps.latitude * 1e6) / 1e6;
      result.longitude = Math.round(gps.longitude * 1e6) / 1e6;
    }
  } catch {
    /* no GPS */
  }
  return result;
}

/**
 * The camera's wall-clock time as "YYYY-MM-DDTHH:mm", from the first date tag present.
 * EXIF writes "2024:05:18 07:42:10"; XMP writes "2024-05-18T07:42:10-06:00". ModifyDate is a last resort.
 */
export function localDateTimeFrom(tags) {
  for (const key of ['DateTimeOriginal', 'CreateDate', 'DateCreated', 'DateTimeDigitized', 'ModifyDate']) {
    const raw = tags?.[key];
    const value = raw instanceof Date ? raw.toISOString() : typeof raw === 'string' ? raw : null;
    const m = value?.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})/);
    if (m && m[1] !== '0000') return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  }
  return '';
}
