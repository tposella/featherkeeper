import exifr from 'exifr';

/**
 * Read date and GPS from a photo in the browser so the form can be prefilled
 * before anything is uploaded. Returns { localDateTime, latitude, longitude, camera }.
 * localDateTime is the camera's wall-clock time as "YYYY-MM-DDTHH:mm".
 */
export async function readPhotoMetadata(file) {
  const result = { localDateTime: '', latitude: null, longitude: null, camera: '' };
  try {
    const tags = await exifr.parse(file, {
      pick: ['DateTimeOriginal', 'CreateDate', 'Make', 'Model', 'LensModel'],
      reviveValues: false,
    });
    const make = String(tags?.Make ?? '').trim();
    const model = String(tags?.Model ?? '').trim();
    const body = model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`.trim();
    result.camera = [body, String(tags?.LensModel ?? '').trim()].filter(Boolean).join(', ');
    const raw = tags?.DateTimeOriginal ?? tags?.CreateDate;
    const m = typeof raw === 'string' && raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/);
    if (m && m[1] !== '0000') result.localDateTime = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  } catch (err) {
    console.error('EXIF read failed:', err?.name, err?.message, err?.stack?.split('\n').slice(0, 3).join(' | '));
  }
  try {
    const gps = await exifr.gps(file);
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude) && !(gps.latitude === 0 && gps.longitude === 0)) {
      result.latitude = Math.round(gps.latitude * 1e6) / 1e6;
      result.longitude = Math.round(gps.longitude * 1e6) / 1e6;
    }
  } catch (err) {
    console.error('GPS read failed:', err?.name, err?.message);
  }
  return result;
}
