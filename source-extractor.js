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

void async function SourceExtractor() {
  const LOG_PREFIX = '[SourceExtractor]';
  const log = function(msg) { console.log(LOG_PREFIX + ' ' + msg); };
  const warn = function(msg) { console.warn(LOG_PREFIX + ' ' + msg); };
  const error = function(msg) { console.error(LOG_PREFIX + ' ' + msg); };

  log('Starting source extraction...');

  // ── Step 1: Load JSZip from CDN ──────────────────────────────────────
  if (typeof JSZip === 'undefined') {
    log('Loading JSZip...');
    await new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = resolve;
      s.onerror = function() { reject(new Error('Failed to load JSZip from CDN')); };
      document.head.appendChild(s);
    });
    log('JSZip loaded.');
  }

  var zip = new JSZip();
  var totalFiles = 0;
  var skippedFiles = 0;
  var seenPaths = {};

  // ── Step 2: Collect all script URLs on the page ──────────────────────
  function getScriptURLs() {
    var urls = {};

    // From <script src="..."> tags
    var scripts = document.querySelectorAll('script[src]');
    for (var i = 0; i < scripts.length; i++) {
      try { urls[new URL(scripts[i].src, location.href).href] = true; } catch(e) {}
    }

    // From performance entries (catches dynamically loaded chunks)
    if (performance && performance.getEntriesByType) {
      var entries = performance.getEntriesByType('resource');
      for (var j = 0; j < entries.length; j++) {
        if (entries[j].initiatorType === 'script' || /\.js(\?|$)/.test(entries[j].name)) {
          try { urls[new URL(entries[j].name, location.href).href] = true; } catch(e) {}
        }
      }
    }

    return Object.keys(urls);
  }

  // ── Step 3: Extract sourceMappingURL from a JS file ──────────────────
  async function getSourceMapURL(scriptURL) {
    try {
      var resp = await fetch(scriptURL, { credentials: 'same-origin' });
      if (!resp.ok) { return null; }

      var text = await resp.text();

      // Check for //# sourceMappingURL=... at end of file
      var match = text.match(/\/\/[#@]\s*sourceMappingURL=(.+?)(?:\s|$)/);
      if (!match) { return null; }

      var mapRef = match[1].trim();

      // Inline base64 source map
      if (mapRef.startsWith('data:')) {
        return { type: 'inline', data: mapRef, scriptURL: scriptURL };
      }

      // External .map file — resolve relative to the script URL
      var mapURL = new URL(mapRef, scriptURL).href;
      return { type: 'url', url: mapURL, scriptURL: scriptURL };
    } catch (e) {
      warn('Failed to fetch script: ' + scriptURL + ' - ' + e.message);
      return null;
    }
  }

  // ── Step 4: Fetch and parse a source map ─────────────────────────────
  async function fetchSourceMap(mapInfo) {
    try {
      var json;

      if (mapInfo.type === 'inline') {
        var base64 = mapInfo.data.split(',')[1];
        json = JSON.parse(atob(base64));
      } else {
        var resp = await fetch(mapInfo.url, { credentials: 'same-origin' });
        if (!resp.ok) {
          warn('Source map 404: ' + mapInfo.url);
          return null;
        }
        json = await resp.json();
      }

      return json;
    } catch (e) {
      warn('Failed to parse source map for ' + mapInfo.scriptURL + ': ' + e.message);
      return null;
    }
  }

  // ── Step 5: Normalize a source path for the zip ──────────────────────
  function normalizePath(sourcePath) {
    var p = sourcePath;

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

    // Handle loader chains like: css-loader!./style.css
    if (p.indexOf('!') !== -1) {
      p = p.split('!').pop();
      p = p.replace(/^\.\//, '');
    }

    return p;
  }

  // ── Step 6: Process a source map and add files to zip ────────────────
  function processSourceMap(sourceMap) {
    var sources = sourceMap.sources || [];
    var contents = sourceMap.sourcesContent || [];
    var sourceRoot = sourceMap.sourceRoot || '';

    var added = 0;

    for (var i = 0; i < sources.length; i++) {
      var rawPath = sourceRoot + sources[i];
      var content = contents[i];

      if (content === null || content === undefined) {
        skippedFiles++;
        continue;
      }

      var normalized = normalizePath(rawPath);

      if (!normalized || normalized.startsWith('data:') || /^https?:\/\//.test(normalized)) {
        skippedFiles++;
        continue;
      }

      if (normalized.indexOf('(webpack)') === 0 || normalized === 'webpack/bootstrap') {
        skippedFiles++;
        continue;
      }

      if (seenPaths[normalized]) { continue; }
      seenPaths[normalized] = true;

      zip.file(normalized, content);
      added++;
      totalFiles++;
    }

    return added;
  }

  // ── Step 7: Trigger zip download ─────────────────────────────────────
  async function downloadZip(filename) {
    log('Generating zip file...');
    var blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(function() { URL.revokeObjectURL(url); }, 10000);

    var sizeMB = (blob.size / 1024 / 1024).toFixed(2);
    log('Download triggered: ' + filename + ' (' + sizeMB + ' MB)');
  }

  // ── Main execution ───────────────────────────────────────────────────
  try {
    var scriptURLs = getScriptURLs();
    log('Found ' + scriptURLs.length + ' script(s) on the page.');

    if (scriptURLs.length > 0) {
      // Find source maps
      log('Scanning for source maps...');
      var mapResults = [];
      for (var i = 0; i < scriptURLs.length; i++) {
        mapResults.push(getSourceMapURL(scriptURLs[i]));
      }
      var mapInfos = (await Promise.all(mapResults)).filter(function(x) { return x !== null; });
      log('Found ' + mapInfos.length + ' source map reference(s).');

      if (mapInfos.length > 0) {
        // Fetch and process each source map
        for (var j = 0; j < mapInfos.length; j++) {
          var info = mapInfos[j];
          var label = info.type === 'inline' ? 'inline map' : info.url.split('/').pop();
          log('Processing: ' + label);

          var sourceMap = await fetchSourceMap(info);
          if (sourceMap) {
            var added = processSourceMap(sourceMap);
            log('  -> extracted ' + added + ' file(s)');
          }
        }

        log('Done. ' + totalFiles + ' files extracted, ' + skippedFiles + ' skipped.');

        if (totalFiles > 0) {
          // Generate filename from the site hostname
          var siteName = location.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
          var timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
          var filename = siteName + '-source-' + timestamp + '.zip';

          await downloadZip(filename);

          log('Extraction complete.');
          log('Files: ' + totalFiles + ' | Paths in zip:');
          var paths = Object.keys(seenPaths).sort();
          console.table(paths.map(function(p) { return { path: p }; }));
        } else {
          error('No source files found in the maps. sourcesContent may be stripped.');
        }
      } else {
        error('No source maps found. The app may not ship them, or they may be behind auth.');
      }
    } else {
      error('No scripts found. Make sure the page has loaded.');
    }
  } catch (e) {
    error('Fatal error: ' + e.message);
    console.error(e);
  }
}();
