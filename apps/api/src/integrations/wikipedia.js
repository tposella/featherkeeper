/**
 * A short habitat description for a species from its English Wikipedia article: the opening of
 * the section about habitat ("Habitat", "Distribution and habitat", "Habitat and range"...).
 * Shown with a link to the article, as its CC BY-SA licence requires. Cached for a week.
 */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CHARS = 420;

export function stripHtml(html) {
  return html
    .replace(/<span[^>]*mw-editsection[\s\S]*?<\/span>\s*<\/span>|<span[^>]*mw-editsection[\s\S]*?<\/span>/gi, ' ')
    .replace(/<(style|script|table|figure)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<sup[\s\S]*?<\/sup>/gi, '') // citation markers like [12]
    .replace(/<h[1-6][\s\S]*?<\/h[1-6]>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\[\s*\d+\s*\]|\[\s*edit\s*\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first sentences that fit in MAX_CHARS. */
export function firstSentences(text, maxChars = MAX_CHARS) {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  let out = '';
  for (const s of sentences) {
    if ((out + s).trim().length > maxChars) break;
    out += s;
  }
  return (out || text.slice(0, maxChars)).trim();
}

export function createWikipediaClient({ enabled = true, userAgent }, fetchImpl = globalThis.fetch) {
  const cache = new Map();

  async function api(params) {
    const qs = new URLSearchParams({ format: 'json', formatversion: '2', redirects: '1', ...params });
    const res = await fetchImpl(`https://en.wikipedia.org/w/api.php?${qs}`, {
      headers: { Accept: 'application/json', 'User-Agent': userAgent },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Wikipedia returned HTTP ${res.status}`);
    return res.json();
  }

  async function load(title) {
    const sections = await api({ action: 'parse', page: title, prop: 'sections' });
    if (sections.error) return null;
    const pageTitle = sections.parse?.title ?? title;
    const list = sections.parse?.sections ?? [];
    const pick =
      list.find((s) => /^habitat/i.test(s.line)) ??
      list.find((s) => /habitat/i.test(s.line)) ??
      list.find((s) => /distribution/i.test(s.line));
    if (!pick) return null;
    const section = await api({ action: 'parse', page: pageTitle, section: String(pick.index), prop: 'text' });
    const text = stripHtml(section.parse?.text ?? '');
    if (text.length < 40) return null;
    return {
      text: firstSentences(text),
      section: stripHtml(pick.line),
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}#${encodeURIComponent(pick.anchor ?? '')}`,
      title: pageTitle,
    };
  }

  return {
    enabled,
    /** { text, section, url, title } or null. `titles` are tried in order (article title, scientific name...). */
    async habitat(titles) {
      if (!enabled) return null;
      for (const title of titles.filter(Boolean)) {
        const key = title.toLowerCase();
        const hit = cache.get(key);
        if (hit && hit.expires > Date.now()) {
          if (hit.value) return hit.value;
          continue;
        }
        let value = null;
        try {
          value = await load(title);
        } catch {
          continue; // network trouble: don't cache, try the next title
        }
        cache.set(key, { value, expires: Date.now() + TTL_MS });
        if (value) return value;
      }
      return null;
    },
  };
}
