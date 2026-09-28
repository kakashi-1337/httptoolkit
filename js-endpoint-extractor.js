/**
 * JS Endpoint & Secret Extractor — Chrome DevTools Console Script
 *
 * For apps that DON'T ship source maps.
 * Extracts API endpoints, URLs, keys, tokens, configs from minified JS.
 *
 * Usage: paste in DevTools Console on the target site
 */

void async function EndpointExtractor() {
  var LOG = '[EndpointExtractor]';
  var log = function(m) { console.log(LOG + ' ' + m); };
  var warn = function(m) { console.warn(LOG + ' ' + m); };

  log('Starting endpoint extraction...');

  // Collect all script URLs
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

  var results = {
    apiEndpoints: [],
    fullURLs: [],
    apiKeys: [],
    tokens: [],
    secrets: [],
    firebaseConfigs: [],
    awsRefs: [],
    emails: [],
    ipAddresses: [],
    jwtPatterns: [],
    interestingStrings: [],
    routePaths: [],
    graphqlOps: [],
    websocketURLs: [],
    s3Buckets: []
  };

  var seen = {};
  function addUnique(arr, val, source) {
    var key = val + '||' + arr;
    if (seen[key]) return;
    seen[key] = true;
    arr.push({ value: val, source: source });
  }

  function extractFromJS(code, scriptName) {
    // ── API Endpoints (path patterns) ──
    var pathPatterns = [
      /["'`](\/api\/[a-zA-Z0-9\/_\-{}:.]+)["'`]/g,
      /["'`](\/v[0-9]+\/[a-zA-Z0-9\/_\-{}:.]+)["'`]/g,
      /["'`]([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)["'`]/g,
      /["'`](\/auth\/[a-zA-Z0-9\/_\-]+)["'`]/g,
      /["'`](\/user[s]?\/[a-zA-Z0-9\/_\-]+)["'`]/g,
      /["'`](\/admin\/[a-zA-Z0-9\/_\-]+)["'`]/g,
      /["'`](\/merchant\/[a-zA-Z0-9\/_\-]+)["'`]/g,
      /["'`](\/payment[s]?\/[a-zA-Z0-9\/_\-]+)["'`]/g,
      /["'`](\/transaction[s]?\/[a-zA-Z0-9\/_\-]+)["'`]/g,
      /["'`](\/webhook[s]?\/[a-zA-Z0-9\/_\-]*)["'`]/g,
      /["'`](\/report[s]?\/[a-zA-Z0-9\/_\-]*)["'`]/g,
      /["'`](\/upload[s]?\/[a-zA-Z0-9\/_\-]*)["'`]/g,
      /["'`](\/export[s]?\/[a-zA-Z0-9\/_\-]*)["'`]/g,
      /["'`](\/download[s]?\/[a-zA-Z0-9\/_\-]*)["'`]/g,
      /["'`](\/config[s]?\/[a-zA-Z0-9\/_\-]*)["'`]/g,
      /["'`](\/setting[s]?\/[a-zA-Z0-9\/_\-]*)["'`]/g,
    ];

    for (var pi = 0; pi < pathPatterns.length; pi++) {
      var m;
      while ((m = pathPatterns[pi].exec(code)) !== null) {
        var p = m[1];
        if (p.length > 6 && p.length < 200 && !/\.(css|png|jpg|svg|woff|ico|gif)/.test(p)) {
          addUnique(results.apiEndpoints, p, scriptName);
        }
      }
    }

    // ── Full URLs ──
    var urlRegex = /["'`](https?:\/\/[a-zA-Z0-9._\-]+(?::[0-9]+)?(?:\/[^\s"'`<>{}|\\^[\]]*?)?)["'`]/g;
    while ((m = urlRegex.exec(code)) !== null) {
      var u = m[1];
      if (u.length > 10 && u.length < 500) {
        if (!/\.(css|png|jpg|svg|woff|woff2|ttf|eot|ico|gif)(\?|$)/.test(u)) {
          if (!/fonts\.googleapis|cdnjs|cdn\.jsdelivr|unpkg\.com|polyfill/.test(u)) {
            addUnique(results.fullURLs, u, scriptName);
          }
        }
      }
    }

    // ── WebSocket URLs ──
    var wsRegex = /["'`](wss?:\/\/[a-zA-Z0-9._\-:\/]+)["'`]/g;
    while ((m = wsRegex.exec(code)) !== null) {
      addUnique(results.websocketURLs, m[1], scriptName);
    }

    // ── API Keys / Tokens ──
    var keyPatterns = [
      { re: /["'`](AIza[a-zA-Z0-9_-]{35})["'`]/g, label: 'Google API Key' },
      { re: /["'`](sk[-_](?:live|test)[-_][a-zA-Z0-9]{24,})["'`]/g, label: 'Stripe Key' },
      { re: /["'`](pk[-_](?:live|test)[-_][a-zA-Z0-9]{24,})["'`]/g, label: 'Stripe Publishable' },
      { re: /["'`](sk-[a-zA-Z0-9]{32,})["'`]/g, label: 'OpenAI Key' },
      { re: /["'`](ghp_[a-zA-Z0-9]{36,})["'`]/g, label: 'GitHub PAT' },
      { re: /["'`](glpat-[a-zA-Z0-9_-]{20,})["'`]/g, label: 'GitLab PAT' },
      { re: /["'`](AKIA[A-Z0-9]{16})["'`]/g, label: 'AWS Access Key' },
      { re: /["'`](xox[bpsa]-[a-zA-Z0-9-]+)["'`]/g, label: 'Slack Token' },
      { re: /["'`]([a-zA-Z0-9_-]*(?:api[_-]?key|apikey|api[_-]?secret|secret[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)[a-zA-Z0-9_-]*)["'`]\s*[=:]\s*["'`]([^"'`]{8,})["'`]/gi, label: 'Generic Key Assignment' },
    ];

    for (var ki = 0; ki < keyPatterns.length; ki++) {
      while ((m = keyPatterns[ki].re.exec(code)) !== null) {
        var keyVal = m[2] ? m[1] + '=' + m[2] : m[1];
        addUnique(results.apiKeys, '[' + keyPatterns[ki].label + '] ' + keyVal, scriptName);
      }
    }

    // ── Firebase Config ──
    var fbRegex = /["'`](https?:\/\/[a-zA-Z0-9_-]+\.firebaseio\.com[^"'`]*)["'`]/g;
    while ((m = fbRegex.exec(code)) !== null) {
      addUnique(results.firebaseConfigs, m[1], scriptName);
    }
    var fbRegex2 = /["'`](https?:\/\/[a-zA-Z0-9_-]+\.firebasedatabase\.app[^"'`]*)["'`]/g;
    while ((m = fbRegex2.exec(code)) !== null) {
      addUnique(results.firebaseConfigs, m[1], scriptName);
    }
    var fbRegex3 = /["'`]([a-zA-Z0-9_-]+\.firebaseapp\.com)["'`]/g;
    while ((m = fbRegex3.exec(code)) !== null) {
      addUnique(results.firebaseConfigs, m[1], scriptName);
    }

    // ── AWS References ──
    var awsRegex = /["'`]([a-zA-Z0-9_-]+\.(?:s3|execute-api|lambda|dynamodb|sqs|sns)\.[a-zA-Z0-9.-]+\.amazonaws\.com[^"'`]*)["'`]/g;
    while ((m = awsRegex.exec(code)) !== null) {
      addUnique(results.awsRefs, m[1], scriptName);
    }

    // ── S3 Buckets ──
    var s3Regex = /["'`]((?:https?:\/\/)?[a-zA-Z0-9._-]+\.s3[a-zA-Z0-9.-]*\.amazonaws\.com[^"'`]*)["'`]/g;
    while ((m = s3Regex.exec(code)) !== null) {
      addUnique(results.s3Buckets, m[1], scriptName);
    }
    var s3Regex2 = /["'`]s3:\/\/([a-zA-Z0-9._-]+)["'`]/g;
    while ((m = s3Regex2.exec(code)) !== null) {
      addUnique(results.s3Buckets, 's3://' + m[1], scriptName);
    }

    // ── Email addresses ──
    var emailRegex = /["'`]([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})["'`]/g;
    while ((m = emailRegex.exec(code)) !== null) {
      if (!/example\.com|test\.com|placeholder/.test(m[1])) {
        addUnique(results.emails, m[1], scriptName);
      }
    }

    // ── Internal IPs ──
    var ipRegex = /["'`]((?:10|172\.(?:1[6-9]|2[0-9]|3[01])|192\.168)\.\d{1,3}\.\d{1,3}(?::\d+)?)["'`]/g;
    while ((m = ipRegex.exec(code)) !== null) {
      addUnique(results.ipAddresses, m[1], scriptName);
    }

    // ── GraphQL operation names ──
    var gqlRegex = /(?:query|mutation|subscription)\s+([A-Z][a-zA-Z0-9_]+)/g;
    while ((m = gqlRegex.exec(code)) !== null) {
      addUnique(results.graphqlOps, m[1], scriptName);
    }

    // ── Vue/React route paths ──
    var routeRegex = /path\s*:\s*["'`](\/[a-zA-Z0-9\/:_-]+)["'`]/g;
    while ((m = routeRegex.exec(code)) !== null) {
      addUnique(results.routePaths, m[1], scriptName);
    }

    // ── Interesting strings (admin, debug, internal, staging, dev) ──
    var interestingPatterns = [
      /["'`](https?:\/\/(?:staging|dev|internal|admin|test|debug|beta|uat|sandbox|preprod)[^"'`]*)["'`]/gi,
      /["'`]([^"'`]*(?:admin|debug|internal|staging|sandbox)[^"'`]*\.(?:com|net|org|io|app)[^"'`]*)["'`]/gi,
      /(?:password|passwd|pwd)\s*[=:]\s*["'`]([^"'`]+)["'`]/gi,
      /(?:DEBUG|VERBOSE|TRACE)\s*[=:]\s*["'`]?true["'`]?/gi,
    ];

    for (var ii = 0; ii < interestingPatterns.length; ii++) {
      while ((m = interestingPatterns[ii].exec(code)) !== null) {
        addUnique(results.interestingStrings, m[0].substring(0, 300), scriptName);
      }
    }
  }

  // Fetch and analyze each script
  var scriptURLs = getScriptURLs();
  log('Found ' + scriptURLs.length + ' script(s)');

  for (var i = 0; i < scriptURLs.length; i++) {
    var url = scriptURLs[i];
    var shortName = url.split('/').pop().split('?')[0];
    log('Analyzing: ' + shortName);

    try {
      var resp = await fetch(url, { credentials: 'same-origin' });
      if (!resp.ok) {
        warn('HTTP ' + resp.status + ' — ' + shortName);
        continue;
      }
      var code = await resp.text();
      log('  Size: ' + (code.length / 1024).toFixed(1) + ' KB');
      extractFromJS(code, shortName);
    } catch(e) {
      warn('Failed: ' + shortName + ' — ' + e.message);
    }
  }

  // Also extract from inline scripts
  var inlineScripts = document.querySelectorAll('script:not([src])');
  for (var k = 0; k < inlineScripts.length; k++) {
    var inlineCode = inlineScripts[k].textContent;
    if (inlineCode && inlineCode.length > 50) {
      log('Analyzing inline script #' + k + ' (' + (inlineCode.length / 1024).toFixed(1) + ' KB)');
      extractFromJS(inlineCode, 'inline-' + k);
    }
  }

  // Print results
  console.log('\n');
  log('========== EXTRACTION RESULTS ==========');

  var sections = [
    ['API Endpoints', results.apiEndpoints],
    ['Full URLs', results.fullURLs],
    ['WebSocket URLs', results.websocketURLs],
    ['API Keys / Secrets', results.apiKeys],
    ['Firebase Configs', results.firebaseConfigs],
    ['AWS References', results.awsRefs],
    ['S3 Buckets', results.s3Buckets],
    ['Email Addresses', results.emails],
    ['Internal IPs', results.ipAddresses],
    ['Vue/React Routes', results.routePaths],
    ['GraphQL Operations', results.graphqlOps],
    ['Interesting Strings', results.interestingStrings],
  ];

  var totalFindings = 0;

  for (var si = 0; si < sections.length; si++) {
    var name = sections[si][0];
    var items = sections[si][1];
    if (items.length > 0) {
      totalFindings += items.length;
      console.log('\n--- ' + name + ' (' + items.length + ') ---');
      console.table(items);
    }
  }

  log('Total findings: ' + totalFindings);
  log('========================================');

  // Also copy to clipboard as JSON
  try {
    var exportData = {};
    for (var ei = 0; ei < sections.length; ei++) {
      if (sections[ei][1].length > 0) {
        exportData[sections[ei][0]] = sections[ei][1].map(function(x) { return x.value; });
      }
    }
    var jsonStr = JSON.stringify(exportData, null, 2);

    // Try clipboard
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(jsonStr);
      log('Results copied to clipboard as JSON');
    }

    // Also offer download
    var blob = new Blob([jsonStr], { type: 'application/json' });
    var dlUrl = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = dlUrl;
    var siteName = location.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
    a.download = siteName + '-endpoints.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(dlUrl); }, 5000);
    log('Results downloaded as JSON file');
  } catch(e) {
    warn('Could not export: ' + e.message);
    log('Raw JSON in console:');
    console.log(JSON.stringify(exportData, null, 2));
  }
}();
