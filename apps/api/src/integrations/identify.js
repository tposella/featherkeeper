import { HttpError } from '../lib/errors.js';

/**
 * AI species identification behind one small interface:
 *
 *   identify(imageBuffer, mimeType) -> [{ scientificName, commonName, confidence }]
 *
 * Providers:
 *   none  identification is switched off (default)
 *   http  POST the photo to any service you run or rent. See docs/ai-identification.md
 *         for the request/response contract.
 *
 * Add a provider by adding a function to PROVIDERS that returns the same shape.
 */
const PROVIDERS = {
  async http(config, image, mime, fetchImpl) {
    if (!config.url) throw new HttpError(503, 'IDENTIFY_URL is not set');
    const form = new FormData();
    form.append('image', new Blob([image], { type: mime }), `photo.${mime.split('/')[1] ?? 'jpg'}`);
    const headers = { Accept: 'application/json' };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

    let res;
    try {
      res = await fetchImpl(config.url, {
        method: 'POST',
        body: form,
        headers,
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (err) {
      throw new HttpError(502, `Identification service unreachable: ${err.message}`);
    }
    if (!res.ok) throw new HttpError(502, `Identification service returned HTTP ${res.status}`);
    const body = await res.json().catch(() => null);
    const list = Array.isArray(body) ? body : body?.predictions;
    if (!Array.isArray(list)) throw new HttpError(502, 'Identification service sent an unexpected response');
    return list;
  },
};

function normalise(p) {
  const scientificName = p.scientificName ?? p.scientific_name ?? p.sciName ?? null;
  const commonName = p.commonName ?? p.common_name ?? p.comName ?? p.label ?? null;
  const raw = Number(p.confidence ?? p.score ?? p.probability ?? 0);
  const confidence = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw > 1 ? raw / 100 : raw)) : 0;
  return { scientificName, commonName, confidence };
}

export function createIdentifier(config, fetchImpl = globalThis.fetch) {
  const impl = PROVIDERS[config.provider];
  const enabled = Boolean(impl) && (config.provider !== 'http' || Boolean(config.url));

  return {
    enabled,
    provider: enabled ? config.provider : 'none',
    async identify(image, mime) {
      if (!enabled) throw new HttpError(503, 'Photo identification is not configured');
      const raw = await impl(config, image, mime, fetchImpl);
      return raw
        .map(normalise)
        .filter((p) => p.scientificName || p.commonName)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 10);
    },
  };
}
