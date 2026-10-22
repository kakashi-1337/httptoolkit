// DevTools version B. Open the target, click through the features you care about so lazy chunks load,
// then paste this whole file into Console. Chrome asks you to type "allow pasting" the first time.
void async function ExtractorB() {
  const LOG = '[ExtractorB]';
  const log = (...a) => console.log(LOG, ...a);
  const t0 = Date.now();
  const POOL = 3;
  const TIMEOUT_MS = 20000;
  const PROBE_MAX = 80;
  const MAX_TEXT = 60 * 1024 * 1024;
  const RAW_BUDGET = 200 * 1024 * 1024;
  const MAX_ENTRIES = 60000;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const bundles = [];
  const failures = [];
  const notes = [];
  const files = new Map();
  const findings = new Map();
  const sourceIndex = {};
  let rawBytes = 0;
  let probes = 0;

  const STATIC = /\.(?:png|jpe?g|gif|svg|webp|ico|css|woff2?|ttf|eot|otf|js|mjs|map|mp4|webm|mp3|pdf)(?:[?#]|$)/i;
  const DENY_HOST = /w3\.org|schema\.org|reactjs\.org|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|fonts\.(?:googleapis|gstatic)\.com|googletagmanager\.com|google-analytics\.com/i;
  const FAKE_MAIL = /example\.|test\.|sentry|domain\.|yourdomain|@2x|\.(?:png|jpe?g|svg|gif)$/i;
  const PLACEHOLDER = /^(?:\*+|x{3,}|null|undefined|true|false|changeme|password|\$\{.*\})$/i;
  const API_HINT = /\/(?:api|v\d+|rest|graphql|gateway|svc|service|ms-|auth|oauth2?|admin|internal|webhook|upload|download|export|report|merchant|payment|payout|transaction|user|config|setting|token|session|mfa|otp|login|logout|callback|account|wallet|kyc|customer|driver|fleet|invoice)/i;
  const GLOBAL_RE = /config|env|setting|secret|api|firebase|__(?:next|nuxt|initial|app|state|data|preload|apollo|redux|store|runtime)/i;
  const MAP_REF = /[#@]\s*sourceMappingURL=([^\s'"*]+)\s*(?:\*\/)?\s*$/gm;

  const RULES = [
    { cat: 'call-target', re: /\b(?:fetch|axios(?:\.(?:get|post|put|patch|delete|request))?|\$\.(?:ajax|get|post)|request|http\.(?:get|post|put|patch|delete))\s*\(\s*(["'`])([^"'`\n]{2,300})\1/g, val: (m) => m[2], skip: (v) => !/[\/:]/.test(v) },
    { cat: 'config-value', re: /\b(baseURL|baseUrl|BASE_URL|API_URL|API_BASE_URL|apiUrl|apiBase|apiHost|endpoint|ENDPOINT|serviceUrl|wsUrl|socketUrl|(?:VITE|REACT_APP|NEXT_PUBLIC|NUXT|VUE_APP)_[A-Z0-9_]+)["']?\s*[:=]\s*(["'`])([^"'`\n]{2,300})\2/g, val: (m) => m[1] + ' = ' + m[3] },
    { cat: 'path', re: /(["'`])(\/[A-Za-z0-9_\-\/.{}:$@%+~]{1,200})\1/g, val: (m) => m[2], skip: (v) => v.startsWith('//') || STATIC.test(v) },
    { cat: 'api-path', re: /(["'`])((?:api|v\d+|rest|graphql)\/[A-Za-z0-9_\-\/.{}:$@%+~]{1,200})\1/g, val: (m) => m[2] },
    { cat: 'url', re: /\bhttps?:\/\/[^\s"'`<>\\)]{4,400}/g, skip: (v) => DENY_HOST.test(v) },
    { cat: 'websocket', re: /\bwss?:\/\/[^\s"'`<>\\)]{4,400}/g },
    { cat: 'cloud-host', re: /\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:amazonaws\.com|cloudfront\.net|firebaseio\.com|firebasedatabase\.app|firebaseapp\.com|web\.app|appspot\.com|azurewebsites\.net|blob\.core\.windows\.net|herokuapp\.com|vercel\.app|netlify\.app|pages\.dev|workers\.dev)\b/g },
    { cat: 'cloud-host', re: /\bs3:\/\/[A-Za-z0-9._-]{3,100}/g },
    { cat: 'internal-host', re: /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d{2,5})?\b/g },
    { cat: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, skip: (v) => FAKE_MAIL.test(v) },
    { cat: 'route', re: /\bpath\s*:\s*(["'`])(\/[^"'`\s]{1,200})\1/g, val: (m) => m[2] },
    { cat: 'graphql-op', re: /\b(?:query|mutation|subscription)\s+([A-Z][A-Za-z0-9_]{2,80})\s*[({]/g, val: (m) => m[1] },
    { cat: 'graphql-op', re: /\boperationName\s*:\s*["']([A-Za-z0-9_]{2,80})["']/g, val: (m) => m[1] },
    { cat: 'debug-flag', re: /\b(?:__DEV__|DEBUG|debug|isDebug|isDev|IS_DEV)\s*[:=]\s*(?:true|!0)\b/g },
    { cat: 'secret', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
    { cat: 'secret', re: /\b(?:sk|pk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/g },
    { cat: 'secret', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
    { cat: 'secret', re: /\bgh[pousr]_[0-9A-Za-z]{36,}\b/g },
    { cat: 'secret', re: /\bglpat-[0-9A-Za-z_-]{20,}/g },
    { cat: 'secret', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}/g },
    { cat: 'secret', re: /\beyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}/g },
    { cat: 'secret', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY/g },
    { cat: 'firebase', re: /\b(?:databaseURL|storageBucket|authDomain|projectId|messagingSenderId|measurementId)["']?\s*[:=]\s*(["'`])[^"'`\n]{3,200}\1/g },
    { cat: 'secret-assignment', re: /\b([A-Za-z0-9_]*(?:secret|token|passw(?:or)?d|api[_-]?key|apikey|access[_-]?key|private[_-]?key)[A-Za-z0-9_]*)["']?\s*[:=]\s*(["'`])([^"'`\s]{6,200})\2/gi, val: (m) => m[1] + ' = ' + m[3], skip: (v) => PLACEHOLDER.test(v.split(' = ')[1]) },
  ];

  const isHttp = (u) => /^https?:\/\//i.test(u);
  const abs = (ref, base) => {
    try { return new URL(ref, base).href; } catch (e) { return null; }
  };
  const probeURL = (u) => {
    try {
      const x = new URL(u);
      x.search = '';
      x.hash = '';
      x.pathname += '.map';
      return x.href;
    } catch (e) { return null; }
  };
  const toZipPath = (raw) => {
    const s = String(raw).replace(/[?#].*$/, '').replace(/^[A-Za-z][\w+.-]*:/, '').replace(/\\/g, '/');
    const parts = s.split('/').filter((p) => p && p !== '.' && p !== '..').map((p) => p.replace(/[<>:"|?*\x00-\x1f]/g, '_').slice(0, 150));
    return parts.length ? parts.join('/') : 'unnamed';
  };
  const putFile = (path, data) => {
    if (files.size >= MAX_ENTRIES) { notes.push('entry cap reached, skipped ' + path); return null; }
    let p = path;
    if (files.has(p)) {
      const dot = p.lastIndexOf('.');
      const slash = p.lastIndexOf('/');
      const stem = dot > slash ? p.slice(0, dot) : p;
      const ext = dot > slash ? p.slice(dot) : '';
      let n = 2;
      while (files.has(stem + '__' + n + ext)) n++;
      p = stem + '__' + n + ext;
    }
    files.set(p, typeof data === 'string' ? enc.encode(data) : data);
    return p;
  };
  const putRaw = (path, text) => {
    if (rawBytes + text.length > RAW_BUDGET) { notes.push('raw budget reached, skipped ' + path); return null; }
    rawBytes += text.length;
    return putFile(path, text);
  };
  const fetchText = async (url) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, { cache: 'force-cache', signal: ctrl.signal });
      if (!r.ok) return { ok: false, status: r.status, headers: r.headers, text: '' };
      return { ok: true, status: r.status, headers: r.headers, text: await r.text() };
    } catch (e) {
      return { ok: false, status: 0, headers: null, text: '', error: String(e) };
    } finally {
      clearTimeout(timer);
    }
  };
  const decodeDataURI = (uri) => {
    const comma = uri.indexOf(',');
    const meta = uri.slice(5, comma);
    const body = uri.slice(comma + 1);
    return /;base64/i.test(meta) ? dec.decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))) : decodeURIComponent(body);
  };
  const parseMap = (text) => {
    if (!text || text.length > MAX_TEXT || text.trimStart()[0] !== '{') return null;
    try {
      const m = JSON.parse(text);
      return Array.isArray(m.sources) && typeof m.mappings === 'string' ? m : null;
    } catch (e) { return null; }
  };
  const findMapRef = (code) => {
    let ref = null;
    for (const m of code.matchAll(MAP_REF)) ref = m[1];
    return ref;
  };
  const addFinding = (cat, value, src) => {
    const v = String(value).trim().slice(0, 400);
    if (!v) return;
    const c = cat === 'path' && API_HINT.test(v) ? 'api-path' : cat;
    const key = c + '\u0001' + v;
    let f = findings.get(key);
    if (!f) {
      f = { category: c, value: v, hits: 0, sources: [] };
      findings.set(key, f);
    }
    f.hits++;
    if (f.sources.length < 10 && !f.sources.includes(src)) f.sources.push(src);
  };
  const scan = (text, src) => {
    for (const r of RULES) {
      for (const m of text.matchAll(r.re)) {
        const v = r.val ? r.val(m) : m[0];
        if (v && !(r.skip && r.skip(String(v)))) addFinding(r.cat, v, src);
      }
    }
  };
  const fail = (rec, url, why) => {
    rec.error = why;
    failures.push({ url, error: why });
    return rec;
  };

  const CRC = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    CRC[n] = c;
  }
  const crc32 = (b) => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const buildZip = (entries) => {
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const e of entries) {
      const name = enc.encode(e.name);
      const size = e.data.length;
      const crc = crc32(e.data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(10, dosTime, true);
      lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true);
      lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true);
      parts.push(lh, name, e.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, size, true);
      ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(ch, name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((n, p) => n + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  };

  const pool = async (items, n, fn) => {
    let next = 0;
    const worker = async () => {
      while (next < items.length) await fn(items[next++]);
    };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  };

  const doBundle = async (t) => {
    const rec = { name: t.name, url: t.url || null, bytes: 0, mapStatus: 'none', sources: 0, withContent: 0, error: null };
    bundles.push(rec);
    let text = t.text;
    let headerRef = null;
    if (t.url) {
      const r = await fetchText(t.url);
      if (!r.ok) return fail(rec, t.url, r.status ? 'HTTP ' + r.status : 'fetch failed (CORS or network)');
      text = r.text;
      if (/^\s*</.test(text)) return fail(rec, t.url, 'HTML body, not JS');
      headerRef = r.headers.get('SourceMap') || r.headers.get('X-SourceMap');
    }
    rec.bytes = text.length;
    putRaw('bundles/' + t.name, text);
    scan(text, t.name);
    const ref = findMapRef(text) || headerRef;
    let mapRaw = null;
    let map = null;
    if (ref && /^data:/i.test(ref)) {
      try { mapRaw = decodeDataURI(ref); } catch (e) { mapRaw = null; }
      map = parseMap(mapRaw);
      rec.mapStatus = map ? 'inline-hit' : 'inline-invalid';
    } else if (ref || t.url) {
      const probing = !ref;
      const sameOrigin = !t.url || new URL(t.url).origin === location.origin;
      if (probing && (!sameOrigin || probes >= PROBE_MAX)) {
        rec.mapStatus = sameOrigin ? 'probe-skipped (cap)' : 'not-probed (cross-origin)';
      } else {
        if (probing) probes++;
        const target = probing ? probeURL(t.url) : abs(ref, t.url || location.href);
        const r = target ? await fetchText(target) : { ok: false, status: 0 };
        map = r.ok ? parseMap(r.text) : null;
        mapRaw = map ? r.text : null;
        if (map) rec.mapStatus = (probing ? 'probe' : 'ref') + '-hit';
        else if (probing) rec.mapStatus = 'none';
        else rec.mapStatus = 'ref-broken (' + (r.ok ? 'not a source map' : r.status || 'fetch failed') + ')';
      }
    }
    if (map) {
      const root = typeof map.sourceRoot === 'string' ? map.sourceRoot : '';
      const contents = Array.isArray(map.sourcesContent) ? map.sourcesContent : [];
      rec.sources = map.sources.length;
      sourceIndex[t.name] = map.sources.map((s, i) => ({ source: String(s), hasContent: typeof contents[i] === 'string' }));
      map.sources.forEach((s, i) => {
        const c = contents[i];
        if (typeof c !== 'string') return;
        rec.withContent++;
        putFile('sources/' + toZipPath(root + String(s)), c);
        scan(c, t.name + ' :: ' + String(s).slice(0, 120));
      });
      if (mapRaw) putRaw('maps/' + t.name + '.map', mapRaw);
    }
    return rec;
  };

  const observed = [...new Set(performance.getEntriesByType('resource')
    .filter((e) => /^(?:fetch|xmlhttprequest|beacon)$/.test(e.initiatorType))
    .map((e) => e.name))].slice(0, 2000);
  const jsURLs = new Set();
  for (const el of document.querySelectorAll('script[src], link[rel="modulepreload"][href], link[rel="preload"][as="script"][href]')) {
    const u = abs(el.getAttribute('src') || el.getAttribute('href'), location.href);
    if (u && isHttp(u)) jsURLs.add(u.split('#')[0]);
  }
  for (const e of performance.getEntriesByType('resource')) {
    if ((e.initiatorType === 'script' || /\.m?js(?:[?#]|$)/i.test(e.name)) && isHttp(e.name)) jsURLs.add(e.name.split('#')[0]);
  }
  const targets = [...jsURLs].map((u) => {
    const x = new URL(u);
    return { url: u, name: toZipPath(x.host.replace(/:/g, '_') + x.pathname) };
  });
  [...document.querySelectorAll('script:not([src])')].forEach((s, i) => {
    const text = s.textContent || '';
    if (text.trim()) targets.push({ name: 'inline/inline-' + i + (/json/i.test(s.type) ? '.json' : '.js'), text });
  });
  log('bundles: ' + targets.length + ' (' + jsURLs.size + ' external, ' + (targets.length - jsURLs.size) + ' inline)');
  await pool(targets, POOL, async (t) => {
    try {
      await doBundle(t);
    } catch (e) {
      failures.push({ url: t.url || t.name, error: String(e) });
    }
  });

  putFile('_page/index.html', '<!-- ' + location.href + ' -->\n' + document.documentElement.outerHTML);
  const globalParts = [];
  for (const k of Object.getOwnPropertyNames(window)) {
    if (!GLOBAL_RE.test(k)) continue;
    const d = Object.getOwnPropertyDescriptor(window, k);
    if (!d || !('value' in d) || typeof d.value === 'function') continue;
    try {
      const j = JSON.stringify(d.value);
      if (j === undefined) continue;
      if (j.length > 200000) notes.push('global ' + k + ' too large, skipped');
      else globalParts.push('{"key":' + JSON.stringify(k) + ',"value":' + j + '}');
    } catch (e) {}
  }
  putFile('_meta/page-globals.json', '[\n' + globalParts.join(',\n') + '\n]\n');

  const endpoints = [...findings.values()].sort((a, b) => a.category.localeCompare(b.category) || b.hits - a.hits);
  const counts = {};
  for (const f of endpoints) counts[f.category] = (counts[f.category] || 0) + 1;
  bundles.sort((a, b) => a.name.localeCompare(b.name));
  putFile('_meta/endpoints.json', JSON.stringify(endpoints, null, 2));
  putFile('_meta/observed-requests.json', JSON.stringify(observed, null, 2));
  putFile('_meta/source-index.json', JSON.stringify(sourceIndex, null, 2));
  const summary = {
    page: location.href,
    extractedAt: new Date().toISOString(),
    seconds: (Date.now() - t0) / 1000,
    bundles: bundles.length,
    bundlesWithSourceMap: bundles.filter((b) => /-hit$/.test(b.mapStatus)).length,
    sourceFiles: [...files.keys()].filter((p) => p.startsWith('sources/')).length,
    findingCounts: counts,
    failures,
    notes,
    bundleDetails: bundles,
  };
  putFile('_meta/summary.json', JSON.stringify(summary, null, 2));

  console.table(bundles.map((b) => ({ bundle: b.name, map: b.mapStatus, sources: b.sources, withContent: b.withContent, error: b.error })));
  console.table(counts);
  console.table(endpoints.filter((f) => !/^(?:path|url)$/.test(f.category)).slice(0, 150).map((f) => ({ category: f.category, value: f.value, hits: f.hits })));
  log(bundles.length + ' bundles, ' + summary.bundlesWithSourceMap + ' with source maps, ' + endpoints.length + ' findings, ' + failures.length + ' failures, ' + summary.seconds.toFixed(1) + 's');

  const stamp = new Date().toISOString().replace(/\.\d+Z$/, '').replace(/[-:]/g, '').replace('T', '-');
  const zipName = (location.hostname || 'page').replace(/[^A-Za-z0-9.-]/g, '_') + '-extraction-' + stamp + '.zip';
  const zip = buildZip([...files].map(([name, data]) => ({ name, data })));
  const link = document.createElement('a');
  link.href = URL.createObjectURL(zip);
  link.download = zipName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 60000);
  window.__extractB = { summary, endpoints };
  log('ZIP ' + zipName + ' (' + (zip.size / 1048576).toFixed(2) + ' MB, ' + files.size + ' entries). Results also in window.__extractB');
}();
