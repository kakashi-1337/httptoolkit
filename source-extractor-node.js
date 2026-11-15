#!/usr/bin/env node

/**
 * Source Map Extractor — Node.js CLI
 *
 * Extracts original source files from a web app's source maps.
 * Reconstructs the full file tree as seen in DevTools Sources panel.
 *
 * Usage:
 *   node source-extractor-node.js <URL> [options]
 *
 * Examples:
 *   node source-extractor-node.js https://target.com
 *   node source-extractor-node.js https://target.com -o ./output
 *   node source-extractor-node.js https://target.com -H "Cookie: session=abc123"
 *   node source-extractor-node.js https://target.com --include-node-modules
 *
 * Options:
 *   -o, --output <dir>             Output directory (default: ./extracted-source)
 *   -H, --header <header>          Add custom header (repeatable)
 *   --include-node-modules         Include node_modules files
 *   --map-url <url>                Directly process a specific .js.map URL
 *   --timeout <ms>                 Request timeout in ms (default: 15000)
 *   -v, --verbose                  Verbose output
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ── Argument parsing ────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
Source Map Extractor — reconstruct original source from .js.map files

Usage:
  node source-extractor-node.js <URL> [options]

Options:
  -o, --output <dir>          Output directory (default: ./extracted-source)
  -H, --header <header>       Custom header, e.g. "Cookie: sess=abc" (repeatable)
  --include-node-modules      Include files from node_modules
  --map-url <url>             Process a specific .js.map URL directly
  --timeout <ms>              Request timeout (default: 15000)
  -v, --verbose               Verbose logging

Examples:
  node source-extractor-node.js https://app.example.com
  node source-extractor-node.js https://app.example.com -o ./target-src
  node source-extractor-node.js https://app.example.com -H "Authorization: Bearer token123"
  node source-extractor-node.js --map-url https://app.example.com/static/js/main.abc123.js.map
`);
  process.exit(0);
}

const config = {
  targetURL: null,
  outputDir: './extracted-source',
  headers: {},
  includeNodeModules: false,
  directMapURLs: [],
  timeout: 15000,
  verbose: false
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-o' || arg === '--output') {
    config.outputDir = args[++i];
  } else if (arg === '-H' || arg === '--header') {
    const header = args[++i];
    const colonIdx = header.indexOf(':');
    if (colonIdx > 0) {
      config.headers[header.slice(0, colonIdx).trim()] = header.slice(colonIdx + 1).trim();
    }
  } else if (arg === '--include-node-modules') {
    config.includeNodeModules = true;
  } else if (arg === '--map-url') {
    config.directMapURLs.push(args[++i]);
  } else if (arg === '--timeout') {
    config.timeout = parseInt(args[++i], 10);
  } else if (arg === '-v' || arg === '--verbose') {
    config.verbose = true;
  } else if (!arg.startsWith('-')) {
    config.targetURL = arg;
  }
}

if (!config.targetURL && config.directMapURLs.length === 0) {
  console.error('Error: provide a target URL or --map-url');
  process.exit(1);
}

// ── HTTP fetch helper ───────────────────────────────────────────────────
function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;

    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        ...config.headers,
        ...opts.headers
      },
      timeout: config.timeout,
      // Follow redirects manually is not built in, but most maps are direct
      rejectUnauthorized: true
    };

    const req = mod.request(reqOpts, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectURL = new URL(res.headers.location, url).href;
        if (config.verbose) console.log(`  [redirect] ${res.statusCode} -> ${redirectURL}`);
        resolve(fetch(redirectURL, opts));
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve({ status: res.statusCode, body, headers: res.headers });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
    req.end();
  });
}

// ── Find script URLs from HTML page ─────────────────────────────────────
function extractScriptURLs(html, baseURL) {
  const urls = new Set();

  // <script src="...">
  const srcRegex = /<script[^>]+src=["']([^"']+)["']/gi;
  let match;
  while ((match = srcRegex.exec(html)) !== null) {
    try {
      urls.add(new URL(match[1], baseURL).href);
    } catch {}
  }

  // Also look for preload/prefetch of JS
  const linkRegex = /<link[^>]+href=["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>/gi;
  while ((match = linkRegex.exec(html)) !== null) {
    try {
      urls.add(new URL(match[1], baseURL).href);
    } catch {}
  }

  // Chunk loading patterns: e.g. "static/js/" + chunkId + ".hash.chunk.js"
  // Also try to find webpack chunk manifest
  const chunkRegex = /["']([^"']*?\.(?:chunk|bundle)\.js(?:\?[^"']*)?)["']/g;
  while ((match = chunkRegex.exec(html)) !== null) {
    try {
      const chunkURL = new URL(match[1], baseURL).href;
      // Only add if same origin
      if (new URL(chunkURL).hostname === new URL(baseURL).hostname) {
        urls.add(chunkURL);
      }
    } catch {}
  }

  return [...urls];
}

// ── Extract sourceMappingURL from JS content ────────────────────────────
function extractSourceMapRef(jsContent, scriptURL) {
  const match = jsContent.match(/\/\/[#@]\s*sourceMappingURL=(.+?)(?:\s|$)/);
  if (!match) return null;

  const ref = match[1].trim();

  if (ref.startsWith('data:')) {
    return { type: 'inline', data: ref };
  }

  return { type: 'url', url: new URL(ref, scriptURL).href };
}

// ── Parse source map JSON ───────────────────────────────────────────────
function parseSourceMap(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Normalize file paths ────────────────────────────────────────────────
function normalizePath(sourcePath) {
  let p = sourcePath;

  p = p.replace(/^webpack:\/\/\//, '');
  p = p.replace(/^webpack:\/\/[^/]*\//, '');
  p = p.replace(/^webpack:\/\//, '');
  p = p.replace(/^vite:\/\//, '');
  p = p.replace(/^rollup:\/\//, '');
  p = p.replace(/^esbuild:\/\//, '');

  p = p.replace(/^\.\//, '');
  p = p.replace(/^\/+/, '');
  p = p.replace(/[?#].*$/, '');

  // Handle loader chains
  if (p.includes('!')) {
    p = p.split('!').pop();
    p = p.replace(/^\.\//, '');
  }

  // Prevent directory traversal
  p = p.replace(/\.\.\//g, '');

  return p;
}

// ── Write extracted files to disk ───────────────────────────────────────
function writeFile(outputDir, filePath, content) {
  const fullPath = path.join(outputDir, filePath);
  const dir = path.dirname(fullPath);

  // Safety: ensure we stay inside outputDir
  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(path.resolve(outputDir))) {
    if (config.verbose) console.log(`  [skip] path traversal blocked: ${filePath}`);
    return false;
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
  return true;
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  const stats = { total: 0, skipped: 0, maps: 0 };
  const seenPaths = new Set();

  async function processMap(mapJSON, label) {
    const sources = mapJSON.sources || [];
    const contents = mapJSON.sourcesContent || [];
    const sourceRoot = mapJSON.sourceRoot || '';

    let added = 0;
    for (let i = 0; i < sources.length; i++) {
      const rawPath = sourceRoot + sources[i];
      const content = contents[i];

      if (content === null || content === undefined) {
        stats.skipped++;
        continue;
      }

      const normalized = normalizePath(rawPath);

      if (!normalized || normalized.startsWith('data:') || /^https?:\/\//.test(normalized)) {
        stats.skipped++;
        continue;
      }

      if (normalized.startsWith('(webpack)') || normalized === 'webpack/bootstrap') {
        stats.skipped++;
        continue;
      }

      if (!config.includeNodeModules && normalized.includes('node_modules/')) {
        stats.skipped++;
        continue;
      }

      if (seenPaths.has(normalized)) continue;
      seenPaths.add(normalized);

      if (writeFile(config.outputDir, normalized, content)) {
        added++;
        stats.total++;
      }
    }

    console.log(`  [${label}] extracted ${added} file(s)`);
  }

  // Process direct --map-url arguments
  for (const mapURL of config.directMapURLs) {
    console.log(`Fetching map: ${mapURL}`);
    try {
      const resp = await fetch(mapURL);
      if (resp.status !== 200) {
        console.error(`  HTTP ${resp.status} — skipping`);
        continue;
      }
      const mapJSON = parseSourceMap(resp.body);
      if (!mapJSON) {
        console.error('  Invalid JSON — skipping');
        continue;
      }
      stats.maps++;
      await processMap(mapJSON, path.basename(new URL(mapURL).pathname));
    } catch (e) {
      console.error(`  Error: ${e.message}`);
    }
  }

  // If we have a target URL, crawl it for scripts
  if (config.targetURL) {
    console.log(`Fetching page: ${config.targetURL}`);
    const pageResp = await fetch(config.targetURL);
    if (pageResp.status !== 200) {
      console.error(`Page returned HTTP ${pageResp.status}`);
      if (!config.directMapURLs.length) process.exit(1);
    }

    // Save the HTML itself
    writeFile(config.outputDir, '_page.html', pageResp.body);

    const scriptURLs = extractScriptURLs(pageResp.body, config.targetURL);
    console.log(`Found ${scriptURLs.length} script(s)`);

    for (const scriptURL of scriptURLs) {
      const shortName = scriptURL.split('/').pop().split('?')[0];
      if (config.verbose) console.log(`  Checking: ${shortName}`);

      try {
        const jsResp = await fetch(scriptURL);
        if (jsResp.status !== 200) {
          if (config.verbose) console.log(`    HTTP ${jsResp.status} — skip`);
          continue;
        }

        // Also check the response header for SourceMap
        let mapRef = extractSourceMapRef(jsResp.body, scriptURL);
        if (!mapRef && jsResp.headers['sourcemap']) {
          mapRef = { type: 'url', url: new URL(jsResp.headers['sourcemap'], scriptURL).href };
        }
        if (!mapRef && jsResp.headers['x-sourcemap']) {
          mapRef = { type: 'url', url: new URL(jsResp.headers['x-sourcemap'], scriptURL).href };
        }

        if (!mapRef) {
          // Try appending .map as a guess
          const guessURL = scriptURL + '.map';
          try {
            const guessResp = await fetch(guessURL);
            if (guessResp.status === 200 && guessResp.body.startsWith('{')) {
              mapRef = { type: 'url', url: guessURL };
              if (config.verbose) console.log(`    Found map at guessed URL: ${guessURL}`);
            }
          } catch {}
        }

        if (!mapRef) {
          if (config.verbose) console.log(`    No source map found`);
          continue;
        }

        let mapBody;
        if (mapRef.type === 'inline') {
          const b64 = mapRef.data.split(',')[1];
          mapBody = Buffer.from(b64, 'base64').toString('utf-8');
        } else {
          console.log(`  Fetching map: ${mapRef.url.split('/').pop()}`);
          const mapResp = await fetch(mapRef.url);
          if (mapResp.status !== 200) {
            console.log(`    HTTP ${mapResp.status} — skip`);
            continue;
          }
          mapBody = mapResp.body;
        }

        const mapJSON = parseSourceMap(mapBody);
        if (!mapJSON) {
          console.log(`    Invalid source map JSON — skip`);
          continue;
        }

        stats.maps++;
        await processMap(mapJSON, shortName);

      } catch (e) {
        console.error(`  Error processing ${shortName}: ${e.message}`);
      }
    }
  }

  // Summary
  console.log('\n────────────────────────────────────────');
  console.log(`Source maps processed: ${stats.maps}`);
  console.log(`Files extracted:       ${stats.total}`);
  console.log(`Entries skipped:       ${stats.skipped}`);
  console.log(`Output directory:      ${path.resolve(config.outputDir)}`);
  console.log('────────────────────────────────────────');

  if (stats.total === 0) {
    console.log('\nNo files extracted. Possible reasons:');
    console.log('  - The app does not ship source maps in production');
    console.log('  - Source maps are behind authentication (use -H "Cookie: ...")');
    console.log('  - sourcesContent is stripped from the maps');
    console.log('  - Try --map-url with a direct URL to a .js.map file');
  }
}

main().catch((e) => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
