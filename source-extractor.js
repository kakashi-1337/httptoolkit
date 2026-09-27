/**
 * Source Map Extractor — Chrome DevTools Console Script
 *
 * Extracts the full original source tree from a web app's source maps
 * (webpack://, src/, .ts files, etc.) as seen in DevTools Sources panel.
 *
 * Usage:
 *   1. Open the target site in Chrome
 *   2. Open DevTools (F12) -> Console
 *   3. Paste this entire script and press Enter
 *   4. Wait for it to finish — downloads a .zip of the source tree
 *
 * What it does:
 *   - Finds all <script> tags and their sourceMappingURL references
 *   - Fetches each .js.map file
 *   - Extracts sources[] and sourcesContent[] from the maps
 *   - Packages everything into a zip and triggers a download
 *
 * Works with: webpack, vite, rollup, esbuild, parcel, next.js, CRA, etc.
 */

(async () => {
  const LOG_PREFIX = '[SourceExtractor]';
  const log = (msg) => console.log(`${LOG_PREFIX} ${msg}`);
  const warn = (msg) => console.warn(`${LOG_PREFIX} ${msg}`);
  const err = (msg) => console.error(`${LOG_PREFIX} ${msg}`);

  log('Starting source extraction...');

  // ── Step 1: Load JSZip from CDN ──────────────────────────────────────
  if (typeof JSZip === 'undefined') {
    log('Loading JSZip...');
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load JSZip from CDN'));
      document.head.appendChild(s);
    });
    log('JSZip loaded.');
  }

  const zip = new JSZip();
  const fileCount = { total: 0, skipped: 0 };
  const seenPaths = new Set();

  // ── Step 2: Collect all script URLs on the page ──────────────────────
  function getScriptURLs() {
    const urls = new Set();

    // From <script src="..."> tags
    document.querySelectorAll('script[src]').forEach((el) => {
      try {
        urls.add(new URL(el.src, location.href).href);
      } catch {}
    });

    // From performance entries (catches dynamically loaded chunks)
    if (performance && performance.getEntriesByType) {
      performance.getEntriesByType('resource').forEach((entry) => {
        if (entry.initiatorType === 'script' || /\.js(\?|$)/.test(entry.name)) {
          try {
            urls.add(new URL(entry.name, location.href).href);
          } catch {}
        }
      });
    }

    return [...urls];
  }

  // ── Step 3: Extract sourceMappingURL from a JS file ──────────────────
  async function getSourceMapURL(scriptURL) {
    try {
      const resp = await fetch(scriptURL, { credentials: 'same-origin' });
      if (!resp.ok) return null;

      const text = await resp.text();

      // Check for //# sourceMappingURL=... at end of file
      const match = text.match(/\/\/[#@]\s*sourceMappingURL=(.+?)(?:\s|$)/);
      if (!match) return null;

      const mapRef = match[1].trim();

      // Inline base64 source map
      if (mapRef.startsWith('data:')) {
        return { type: 'inline', data: mapRef, scriptURL };
      }

      // External .map file — resolve relative to the script URL
      const mapURL = new URL(mapRef, scriptURL).href;
      return { type: 'url', url: mapURL, scriptURL };
    } catch (e) {
      warn(`Failed to fetch script: ${scriptURL} — ${e.message}`);
      return null;
    }
  }

  // ── Step 4: Fetch and parse a source map ─────────────────────────────
  async function fetchSourceMap(mapInfo) {
    try {
      let json;

      if (mapInfo.type === 'inline') {
        // data:application/json;base64,...
        const base64 = mapInfo.data.split(',')[1];
        json = JSON.parse(atob(base64));
      } else {
        const resp = await fetch(mapInfo.url, { credentials: 'same-origin' });
        if (!resp.ok) {
          // Try common fallback: append .map to script URL
          warn(`Source map 404: ${mapInfo.url}`);
          return null;
        }
        json = await resp.json();
      }

      return json;
    } catch (e) {
      warn(`Failed to parse source map for ${mapInfo.scriptURL}: ${e.message}`);
      return null;
    }
  }

  // ── Step 5: Normalize a source path for the zip ──────────────────────
  function normalizePath(sourcePath) {
    // Strip common prefixes
    let p = sourcePath;

    // Remove webpack:// or similar protocol prefixes
    p = p.replace(/^webpack:\/\/\//, '');
    p = p.replace(/^webpack:\/\/[^/]*\//, '');
    p = p.replace(/^webpack:\/\//, '');

    // Remove other bundler protocols
    p = p.replace(/^vite:\/\//, '');
    p = p.replace(/^rollup:\/\//, '');
    p = p.replace(/^esbuild:\/\//, '');

    // Remove leading ./ or /
    p = p.replace(/^\.\//, '');
    p = p.replace(/^\/+/, '');

    // Remove query strings and hashes
    p = p.replace(/[?#].*$/, '');

    // Skip node_modules internals (webpack loaders, etc.)
    // But keep actual node_modules source if someone wants it
    if (p.includes('!')) {
      // Loader chain like: css-loader!./style.css — take the last part
      p = p.split('!').pop();
      p = p.replace(/^\.\//, '');
    }

    return p;
  }

  // ── Step 6: Process a source map and add files to zip ────────────────
  function processSourceMap(sourceMap) {
    const sources = sourceMap.sources || [];
    const contents = sourceMap.sourcesContent || [];
    const sourceRoot = sourceMap.sourceRoot || '';

    let added = 0;

    for (let i = 0; i < sources.length; i++) {
      const rawPath = sourceRoot + sources[i];
      const content = contents[i];

      // Skip if no content
      if (content === null || content === undefined) {
        fileCount.skipped++;
        continue;
      }

      const normalized = normalizePath(rawPath);

      // Skip empty paths, data URIs, http URLs
      if (!normalized || normalized.startsWith('data:') || /^https?:\/\//.test(normalized)) {
        fileCount.skipped++;
        continue;
      }

      // Skip webpack internal modules
      if (normalized.startsWith('(webpack)') || normalized === 'webpack/bootstrap') {
        fileCount.skipped++;
        continue;
      }

      // Deduplicate
      if (seenPaths.has(normalized)) continue;
      seenPaths.add(normalized);

      zip.file(normalized, content);
      added++;
      fileCount.total++;
    }

    return added;
  }

  // ── Step 7: Trigger zip download ─────────────────────────────────────
  async function downloadZip(filename) {
    log('Generating zip file...');
    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Clean up after a delay
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
    log(`Download triggered: ${filename} (${sizeMB} MB)`);
  }

  // ── Main execution ───────────────────────────────────────────────────
  try {
    const scriptURLs = getScriptURLs();
    log(`Found ${scriptURLs.length} script(s) on the page.`);

    if (scriptURLs.length === 0) {
      err('No scripts found. Make sure the page has loaded.');
      return;
    }

    // Find source maps
    log('Scanning for source maps...');
    const mapInfos = (await Promise.all(scriptURLs.map(getSourceMapURL))).filter(Boolean);
    log(`Found ${mapInfos.length} source map reference(s).`);

    if (mapInfos.length === 0) {
      err('No source maps found. The app may not ship them, or they may be behind auth.');
      return;
    }

    // Fetch and process each source map
    for (const info of mapInfos) {
      const label = info.type === 'inline' ? 'inline map' : info.url.split('/').pop();
      log(`Processing: ${label}`);

      const sourceMap = await fetchSourceMap(info);
      if (!sourceMap) continue;

      const added = processSourceMap(sourceMap);
      log(`  -> extracted ${added} file(s)`);
    }

    log(`Done. ${fileCount.total} files extracted, ${fileCount.skipped} skipped.`);

    if (fileCount.total === 0) {
      err('No source files found in the maps. sourcesContent may be stripped.');
      return;
    }

    // Generate filename from the site hostname
    const siteName = location.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const filename = `${siteName}-source-${timestamp}.zip`;

    await downloadZip(filename);

    log('Extraction complete.');
    log(`Files: ${fileCount.total} | Paths in zip:`);
    console.table([...seenPaths].sort().map((p) => ({ path: p })));

  } catch (e) {
    err(`Fatal error: ${e.message}`);
    console.error(e);
  }
})();
