/**
 * Universal Source Extractor — Auto-detect & extract everything
 *
 * Smart extraction that:
 *   1. Detects if source maps (.js.map) are available
 *   2. If yes → extracts original source tree + reconstructs files
 *   3. If no → auto-switches to endpoint/secret extraction from bundled JS
 *   4. Returns combined results (source files + endpoints + keys + configs)
 *
 * Usage: paste in DevTools Console
 */

void async function UniversalExtractor() {
  var LOG = '[UniversalExtractor]';
  var log = function(m) { console.log(LOG + ' ' + m); };
  var warn = function(m) { console.warn(LOG + ' ' + m); };
  var info = function(m) { console.info(LOG + ' ℹ ' + m); };

  log('Starting universal extraction...');
  var results = {
    extractionMode: null,
    sourceFiles: [],
    apiEndpoints: [],
    apiKeys: [],
    urls: [],
    configs: [],
    emails: [],
    ipAddresses: [],
    routes: [],
    summary: {}
  };

  // ────────────────────────────────────────────────────────────
  // PHASE 1: Load JSZip for source map mode
  // ────────────────────────────────────────────────────────────

  if (typeof JSZip === 'undefined') {
    log('Loading JSZip...');
    await new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = resolve;
      s.onerror = function() { reject(new Error('Failed to load JSZip')); };
      document.head.appendChild(s);
    });
    log('JSZip loaded.');
  }

  // ────────────────────────────────────────────────────────────
  // PHASE 2: Collect scripts
  // ────────────────────────────────────────────────────────────

  function getScriptURLs() {
    var urls = {};
    var scripts = document.querySelectorAll('script[src]');
    for (var i = 0; i < scripts.length; i++) {
      try { urls[new URL(scripts[i].src, location.href).href] = true; } catch(e) {}
    }
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

  var scriptURLs = getScriptURLs();
  log('Found ' + scriptURLs.length + ' script(s).');

  // ────────────────────────────────────────────────────────────
  // PHASE 3: Detect source maps
  // ────────────────────────────────────────────────────────────

  log('Scanning for source maps...');
  var mapCount = 0;
  var mapResults = [];

  for (var si = 0; si < scriptURLs.length; si++) {
    var scriptURL = scriptURLs[si];
    mapResults.push(
      fetch(scriptURL, { credentials: 'same-origin' })
        .then(function(resp) {
          if (!resp.ok) return null;
          return resp.text();
        })
        .then(function(text) {
          if (!text) return null;
          var match = text.match(/\/\/[#@]\s*sourceMappingURL=(.+?)(?:\s|$)/);
          if (!match) return null;
          mapCount++;
          var ref = match[1].trim();
          if (ref.startsWith('data:')) {
            return { type: 'inline', data: ref, scriptURL: scriptURL };
          }
          return { type: 'url', url: new URL(ref, scriptURL).href, scriptURL: scriptURL };
        })
        .catch(function(e) {
          warn('Failed to check ' + scriptURL + ': ' + e.message);
          return null;
        })
    );
  }

  var mapInfos = (await Promise.all(mapResults)).filter(function(x) { return x !== null; });
  info('Detected ' + mapCount + ' source map reference(s) out of ' + scriptURLs.length + ' scripts.');

  // ────────────────────────────────────────────────────────────
  // PHASE 4A: Source Map Mode (if maps found)
  // ────────────────────────────────────────────────────────────

  if (mapInfos.length > 0) {
    results.extractionMode = 'SOURCE_MAPS';
    log('Source maps detected → Switching to SOURCE MAP EXTRACTION mode');

    var zip = new JSZip();
    var seenPaths = {};
    var totalFiles = 0;

    function normalizePath(sourcePath) {
      var p = sourcePath;
      p = p.replace(/^webpack:\/\/\//, '');
      p = p.replace(/^webpack:\/\/[^/]*\//, '');
      p = p.replace(/^webpack:\/\//, '');
      p = p.replace(/^vite:\/\//, '');
      p = p.replace(/^rollup:\/\//, '');
      p = p.replace(/^esbuild:\/\//, '');
      p = p.replace(/^\.\//, '');
      p = p.replace(/^\/+/, '');
      p = p.replace(/[?#].*$/, '');
      if (p.indexOf('!') !== -1) {
        p = p.split('!').pop();
        p = p.replace(/^\.\//, '');
      }
      return p;
    }

    function processSourceMap(sourceMap) {
      var sources = sourceMap.sources || [];
      var contents = sourceMap.sourcesContent || [];
      var sourceRoot = sourceMap.sourceRoot || '';
      var added = 0;

      for (var i = 0; i < sources.length; i++) {
        var rawPath = sourceRoot + sources[i];
        var content = contents[i];
        if (!content) continue;

        var normalized = normalizePath(rawPath);
        if (!normalized || normalized.startsWith('data:') || /^https?:\/\//.test(normalized)) continue;
        if (normalized.indexOf('(webpack)') === 0 || normalized === 'webpack/bootstrap') continue;
        if (seenPaths[normalized]) continue;

        seenPaths[normalized] = true;
        zip.file(normalized, content);
        results.sourceFiles.push(normalized);
        added++;
        totalFiles++;
      }
      return added;
    }

    for (var mi = 0; mi < mapInfos.length; mi++) {
      var info_mi = mapInfos[mi];
      var label = info_mi.type === 'inline' ? 'inline' : info_mi.url.split('/').pop();
      log('Processing: ' + label);

      try {
        var mapJSON;
        if (info_mi.type === 'inline') {
          var b64 = info_mi.data.split(',')[1];
          mapJSON = JSON.parse(atob(b64));
        } else {
          var mapResp = await fetch(info_mi.url, { credentials: 'same-origin' });
          if (!mapResp.ok) {
            warn('Source map 404: ' + info_mi.url);
            continue;
          }
          mapJSON = await mapResp.json();
        }
        var added_mi = processSourceMap(mapJSON);
        log('  -> extracted ' + added_mi + ' file(s)');
      } catch (e) {
        warn('Failed to process ' + label + ': ' + e.message);
      }
    }

    // Download source ZIP
    if (totalFiles > 0) {
      log('Generating zip...');
      var blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      var dlURL = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = dlURL;
      var siteName = location.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
      var timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      a.download = siteName + '-source-' + timestamp + '.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function() { URL.revokeObjectURL(dlURL); }, 10000);
      results.summary.sourceZipDownloaded = true;
      results.summary.sourceFilesExtracted = totalFiles;
    } else {
      warn('No source content found. sourcesContent may be stripped.');
    }
  } else {
    // ────────────────────────────────────────────────────────────
    // PHASE 4B: Endpoint/Secret Mode (no source maps)
    // ────────────────────────────────────────────────────────────

    results.extractionMode = 'ENDPOINT_EXTRACTION';
    log('No source maps found → Switching to ENDPOINT/SECRET EXTRACTION mode');

    var seen = {};
    function addUnique(arr, val) {
      if (seen[val]) return;
      seen[val] = true;
      arr.push(val);
    }

    function extractFromJS(code) {
      // API Endpoints
      var pathPatterns = [
        /["'`](\/api\/[a-zA-Z0-9\/_\-{}:.]+)["'`]/g,
        /["'`](\/v[0-9]+\/[a-zA-Z0-9\/_\-{}:.]+)["'`]/g,
        /["'`](\/auth\/[a-zA-Z0-9\/_\-]+)["'`]/g,
        /["'`](\/merchant\/[a-zA-Z0-9\/_\-]+)["'`]/g,
        /["'`](\/payment[s]?\/[a-zA-Z0-9\/_\-]+)["'`]/g,
        /["'`](\/transaction[s]?\/[a-zA-Z0-9\/_\-]+)["'`]/g,
        /["'`](\/webhook[s]?\/[a-zA-Z0-9\/_\-]*)["'`]/g,
        /["'`](\/report[s]?\/[a-zA-Z0-9\/_\-]*)["'`]/g
      ];
      for (var pi = 0; pi < pathPatterns.length; pi++) {
        var m;
        while ((m = pathPatterns[pi].exec(code)) !== null) {
          var p = m[1];
          if (p.length > 6 && p.length < 200 && !/\.(css|png|jpg|svg|woff|ico)/.test(p)) {
            addUnique(results.apiEndpoints, p);
          }
        }
      }

      // URLs
      var urlRegex = /["'`](https?:\/\/[a-zA-Z0-9._\-]+(?::[0-9]+)?(?:\/[^\s"'`]*?)?)["'`]/g;
      while ((m = urlRegex.exec(code)) !== null) {
        var u = m[1];
        if (u.length > 10 && u.length < 500 && !/fonts\.googleapis|cdnjs|cdn\.jsdelivr|unpkg/.test(u)) {
          addUnique(results.urls, u);
        }
      }

      // API Keys (simple patterns)
      var keyPatterns = [
        /["'`](AIza[a-zA-Z0-9_-]{35})["'`]/g,
        /["'`](sk[-_](?:live|test)[-_][a-zA-Z0-9]{24,})["'`]/g,
        /["'`]([a-zA-Z0-9_-]*api[_-]?key[a-zA-Z0-9_-]*)["'`]\s*[:=]\s*["'`]([^"'`]{8,})["'`]/g
      ];
      for (var ki = 0; ki < keyPatterns.length; ki++) {
        while ((m = keyPatterns[ki].exec(code)) !== null) {
          addUnique(results.apiKeys, m[1] + (m[2] ? '=' + m[2] : ''));
        }
      }

      // Emails
      var emailRegex = /["'`]([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})["'`]/g;
      while ((m = emailRegex.exec(code)) !== null) {
        if (!/example\.com|test\.com/.test(m[1])) {
          addUnique(results.emails, m[1]);
        }
      }

      // Routes
      var routeRegex = /path\s*:\s*["'`](\/[a-zA-Z0-9\/:_-]+)["'`]/g;
      while ((m = routeRegex.exec(code)) !== null) {
        addUnique(results.routes, m[1]);
      }

      // Firebase
      var fbRegex = /["'`](https?:\/\/[a-zA-Z0-9_-]+\.firebaseio\.com[^"'`]*)["'`]/g;
      while ((m = fbRegex.exec(code)) !== null) {
        addUnique(results.configs, 'firebase:' + m[1]);
      }
      var fbRegex2 = /["'`]([a-zA-Z0-9_-]+\.firebaseapp\.com)["'`]/g;
      while ((m = fbRegex2.exec(code)) !== null) {
        addUnique(results.configs, 'firebase-app:' + m[1]);
      }

      // AWS
      var awsRegex = /["'`]([a-zA-Z0-9_-]+\.(?:s3|lambda|execute-api)[a-zA-Z0-9.-]*\.amazonaws\.com[^"'`]*)["'`]/g;
      while ((m = awsRegex.exec(code)) !== null) {
        addUnique(results.configs, 'aws:' + m[1]);
      }
    }

    // Extract from all scripts
    log('Extracting from ' + scriptURLs.length + ' script(s)...');
    for (var si2 = 0; si2 < scriptURLs.length; si2++) {
      var scriptURL2 = scriptURLs[si2];
      var shortName = scriptURL2.split('/').pop().split('?')[0];
      try {
        var resp = await fetch(scriptURL2, { credentials: 'same-origin' });
        if (resp.ok) {
          var code = await resp.text();
          extractFromJS(code);
          info('Analyzed: ' + shortName + ' (' + (code.length / 1024).toFixed(1) + ' KB)');
        }
      } catch (e) {
        warn('Failed: ' + shortName);
      }
    }

    // Extract from inline scripts
    var inlineScripts = document.querySelectorAll('script:not([src])');
    for (var ks = 0; ks < inlineScripts.length; ks++) {
      var inlineCode = inlineScripts[ks].textContent;
      if (inlineCode && inlineCode.length > 50) {
        extractFromJS(inlineCode);
      }
    }

    results.summary.endpointsFound = results.apiEndpoints.length;
    results.summary.keysFound = results.apiKeys.length;
    results.summary.urlsFound = results.urls.length;
    results.summary.emailsFound = results.emails.length;
  }

  // ────────────────────────────────────────────────────────────
  // PHASE 5: Export results
  // ────────────────────────────────────────────────────────────

  console.log('\n');
  log('========== EXTRACTION COMPLETE ==========');
  log('Mode: ' + results.extractionMode);
  console.log('Summary:', results.summary);

  // Console table output
  if (results.apiEndpoints.length > 0) {
    console.log('\n--- API Endpoints (' + results.apiEndpoints.length + ') ---');
    console.table(results.apiEndpoints.map(function(e) { return { endpoint: e }; }));
  }
  if (results.apiKeys.length > 0) {
    console.log('\n--- API Keys (' + results.apiKeys.length + ') ---');
    console.table(results.apiKeys.map(function(k) { return { key: k }; }));
  }
  if (results.urls.length > 0) {
    console.log('\n--- URLs (' + results.urls.length + ') ---');
    console.table(results.urls.map(function(u) { return { url: u }; }));
  }
  if (results.emails.length > 0) {
    console.log('\n--- Emails (' + results.emails.length + ') ---');
    console.table(results.emails.map(function(e) { return { email: e }; }));
  }
  if (results.configs.length > 0) {
    console.log('\n--- Configs (' + results.configs.length + ') ---');
    console.table(results.configs.map(function(c) { return { config: c }; }));
  }
  if (results.routes.length > 0) {
    console.log('\n--- Routes (' + results.routes.length + ') ---');
    console.table(results.routes.map(function(r) { return { route: r }; }));
  }

  // Download JSON
  var exportJSON = {
    mode: results.extractionMode,
    timestamp: new Date().toISOString(),
    summary: results.summary,
    endpoints: results.apiEndpoints,
    keys: results.apiKeys,
    urls: results.urls,
    emails: results.emails,
    configs: results.configs,
    routes: results.routes,
    sourceFiles: results.sourceFiles
  };

  var jsonBlob = new Blob([JSON.stringify(exportJSON, null, 2)], { type: 'application/json' });
  var dlURL2 = URL.createObjectURL(jsonBlob);
  var a2 = document.createElement('a');
  a2.href = dlURL2;
  var siteName2 = location.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
  a2.download = siteName2 + '-extraction-' + results.extractionMode + '.json';
  document.body.appendChild(a2);
  a2.click();
  document.body.removeChild(a2);
  setTimeout(function() { URL.revokeObjectURL(dlURL2); }, 5000);

  log('Results exported as JSON.');
  log('========================================');
}();
