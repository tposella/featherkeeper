import { HttpError } from '../lib/errors.js';

/**
 * AI species identification behind one small interface:
 *
 *   identify(imageBuffer, mimeType, { candidates }) -> [{ scientificName, commonName, confidence, id? }]
 *
 * Providers (IDENTIFY_PROVIDER):
 *   none     identification is switched off (default)
 *   bioclip  the bundled identifier container (BioCLIP 2). It receives the candidate species,
 *            each with a location prior, and scores the photo against only those.
 *   http     POST the photo to any service you run or rent; it ignores candidates.
 *            See docs/ai-identification.md for the request/response contract.
 */

async function post(config, form, fetchImpl) {
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
    const why = err.name === 'TimeoutError' ? 'it took too long to answer' : err.message;
    throw new HttpError(502, `Identification service unreachable: ${why}`);
  }
  if (res.status === 503) {
    const body = await res.json().catch(() => null);
    throw new HttpError(503, body?.detail ?? 'The identification model is still loading. Try again in a minute.');
  }
  if (!res.ok) throw new HttpError(502, `Identification service returned HTTP ${res.status}`);
  return res.json().catch(() => null);
}

const PROVIDERS = {
  async bioclip(config, image, mime, fetchImpl, { candidates }) {
    if (!candidates?.length) throw new HttpError(400, 'No candidate species to compare against');
    const form = new FormData();
    form.append('image', new Blob([image], { type: mime }), 'photo.jpg');
    form.append('candidates', JSON.stringify(candidates));
    form.append('top', '10');
    const body = await post(config, form, fetchImpl);
    if (!Array.isArray(body?.predictions)) throw new HttpError(502, 'Identification service sent an unexpected response');
    return { predictions: body.predictions, model: body.model ?? 'bioclip' };
  },

  async http(config, image, mime, fetchImpl) {
    const form = new FormData();
    form.append('image', new Blob([image], { type: mime }), `photo.${mime.split('/')[1] ?? 'jpg'}`);
    const body = await post(config, form, fetchImpl);
    const list = Array.isArray(body) ? body : body?.predictions;
    if (!Array.isArray(list)) throw new HttpError(502, 'Identification service sent an unexpected response');
    return { predictions: list, model: body?.model ?? 'http' };
  },
};

function normalise(p) {
  const scientificName = p.scientificName ?? p.scientific_name ?? p.sciName ?? null;
  const commonName = p.commonName ?? p.common_name ?? p.comName ?? p.label ?? null;
  const raw = Number(p.confidence ?? p.score ?? p.probability ?? 0);
  const confidence = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw > 1 ? raw / 100 : raw)) : 0;
  return { id: p.id ?? null, scientificName, commonName, confidence };
}

export function createIdentifier(config, fetchImpl = globalThis.fetch) {
  const provider = config.provider === 'bioclip' && !config.url ? { ...config, url: 'http://identifier:8000/identify' } : config;
  const impl = PROVIDERS[provider.provider];
  const enabled = Boolean(impl) && Boolean(provider.url);

  return {
    enabled,
    provider: enabled ? provider.provider : 'none',
    /** Whether this provider narrows its answer to the candidates it is given. */
    usesCandidates: provider.provider === 'bioclip',
    async identify(image, mime, options = {}) {
      if (!enabled) throw new HttpError(503, 'Photo identification is not configured');
      const { predictions, model } = await impl(provider, image, mime, fetchImpl, options);
      return {
        model,
        predictions: predictions
          .map(normalise)
          .filter((p) => p.scientificName || p.commonName)
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 10),
      };
    },
  };
}
