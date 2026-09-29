# Universal Source Extraction Toolkit — Deployment Checklist

**Status:** ✅ All tools ready for production use

---

## What You Now Have

### 1. Universal Auto-Detecting Extractor ⭐ **[NEW]**

**File:** `source-extractor-auto.js`  
**Type:** DevTools Console Script  
**Purpose:** Single unified tool for ALL extraction scenarios

**Intelligence:**
```
┌─────────────────────────────────────────────────────┐
│ UNIVERSAL EXTRACTOR                                 │
├─────────────────────────────────────────────────────┤
│ 1. Detect: Scan all scripts for sourceMappingURL    │
│                                                      │
│ 2. Decision:                                        │
│    ├─ IF source maps found (count > 0)              │
│    │  └─> SOURCE_MAPS mode                          │
│    │      ├─ Extract full source tree               │
│    │      ├─ Reconstruct all files                  │
│    │      └─ Download as ZIP                        │
│    │                                                │
│    └─ IF no source maps (count = 0)                 │
│       └─> ENDPOINT_EXTRACTION mode                  │
│           ├─ Parse bundled JavaScript               │
│           ├─ Extract APIs, keys, configs            │
│           └─ Download as JSON                       │
│                                                      │
│ 3. Export: Always outputs JSON + ZIP (if maps)      │
│                                                      │
│ 4. Result: Combined findings in one file            │
└─────────────────────────────────────────────────────┘
```

**Usage:**
```javascript
// Open target site → F12 → Console tab
// Copy entire source-extractor-auto.js
// Paste into console → Press Enter
// Downloads happen automatically
```

**Output Files:**
- `{hostname}-extraction-SOURCE_MAPS.zip` (if maps found)
- `{hostname}-extraction-{MODE}.json` (always)

---

### 2. Specialized Extractors (For Advanced Use)

#### 2a. Source Map Extractor (DevTools)
**File:** `source-extractor.js`  
**When:** Guaranteed source maps available  
**Output:** ZIP with full source tree

#### 2b. Source Map Extractor (Node.js)
**File:** `source-extractor-node.js`  
**When:** Automated/scripted extraction  
**Command:** `node source-extractor-node.js <url>`

#### 2c. Endpoint Extractor (DevTools)
**File:** `js-endpoint-extractor.js`  
**When:** No source maps present  
**Output:** JSON with endpoints + keys + configs

---

### 3. OOB Testing Harnesses

#### 3a. PayCools Testing
**File:** `oob-paycools-tests.sh`  
**Targets:** merchant.paycools.com.ph, api.paycools.com.ph  
**Tests:** SSTI/RCE, XXE, SSRF, SQLi, MFA IDOR  
**Usage:**
```bash
JWT_TOKEN="your-token" FLEET_ID="your-fleet-id" ./oob-paycools-tests.sh
```

#### 3b. PriceLocQ Testing
**File:** `oob-rce-tests.sh`  
**Targets:** api.locq.com  
**Tests:** Report SSTI, XXE, SSRF, SQLi, WebSocket RCE, CRLF  
**Usage:**
```bash
TOKEN="your-jwt" FLEET_ID="your-fleet-id" ./oob-rce-tests.sh
```

#### 3c. WebSocket SSTI Testing
**File:** `ws-ssti-test.js`  
**Targets:** PriceLocQ WebSocket endpoint  
**Tests:** Lodash _.template() SSTI via connectionId  
**Usage:**
```bash
node ws-ssti-test.js <JWT_TOKEN> <FLEET_ID>
```

---

### 4. Deployment Helper

**File:** `deploy-extractor.sh`  
**Purpose:** Quick setup for extraction testing  
**Usage:**
```bash
./deploy-extractor.sh https://target.com.ph
./deploy-extractor.sh https://api.paycools.com.ph testrce.6u.gg
```

**Generates:**
- Formatted extraction script for Console paste
- Step-by-step instructions
- Post-extraction workflow guidance

---

### 5. Documentation

**Files:**
- `EXTRACTION_TOOLS.md` — Comprehensive usage guide
- `DEPLOYMENT_CHECKLIST.md` — This file

---

## Quick Start Guide

### Scenario 1: Test PayCools (merchant.paycools.com.ph)

**Step 1 - Extract Source & Endpoints:**
```bash
./deploy-extractor.sh https://merchant.paycools.com.ph
# Follow instructions to run in browser console
# Downloads JSON with all endpoints
```

**Step 2 - Review Findings:**
```bash
# Extract revealed endpoints
cat merchant-paycools-com-ph-extraction-*.json | jq '.endpoints'
```

**Step 3 - Test for RCE/SSTI:**
```bash
# Set JWT token (from localStorage.getItem('accessToken'))
export TOKEN="eyJ..."
export FLEET_ID="your-fleet-id"

./oob-paycools-tests.sh
```

**Step 4 - Monitor OOB Callbacks:**
```
Check testrce.6u.gg dashboard
Wait 10-30 seconds for responses
Any callback = confirmed vulnerability
```

---

### Scenario 2: Test PriceLocQ (api.locq.com)

**Step 1 - Extract Endpoints:**
```bash
./deploy-extractor.sh https://api.locq.com
```

**Step 2 - Run OOB Tests:**
```bash
export TOKEN="your-jwt-token"
export FLEET_ID="your-fleet-id"

./oob-rce-tests.sh
node ws-ssti-test.js "$TOKEN" "$FLEET_ID"
```

**Step 3 - Monitor Callbacks:**
```
Check testrce.6u.gg for:
/rce-* = Remote Code Execution (P1)
/xxe-* = XML External Entity (P1)
/ssrf-* = Server-Side Request Forgery (P2)
/sqli-* = SQL Injection (P1)
```

---

## Key Features

| Feature | Status | Details |
|---------|--------|---------|
| **Auto-detection** | ✅ | Detects source maps vs bundled JS |
| **Source maps** | ✅ | Extracts full source tree if available |
| **Endpoint extraction** | ✅ | Falls back if no source maps |
| **Sensitive data** | ✅ | Extracts API keys, configs, emails |
| **OOB testing** | ✅ | SSTI/RCE, XXE, SSRF, SQLi payloads |
| **Auto-export** | ✅ | JSON + ZIP downloads |
| **Multi-domain** | ✅ | Tests both merchant & API domains |
| **Authentication** | ✅ | Supports JWT tokens + headers |
| **WebSocket** | ✅ | Tests WS endpoints for SSTI |
| **MFA bypass** | ✅ | Tests /auth/resetMFA IDOR |

---

## Vulnerability Matrix

| Vulnerability | PayCools | PriceLocQ | Status |
|---|---|---|---|
| SSTI/RCE (_.template) | ✅ | ✅ | Ready |
| XXE (file upload) | ✅ | ✅ | Ready |
| SSRF (webhook/avatar) | ✅ | ✅ | Ready |
| Blind SQLi | ✅ | ✅ | Ready |
| MFA IDOR | ✅ | — | Ready |
| NoSQL Injection | ✅ | — | Ready |
| WebSocket SSTI | — | ✅ | Ready |
| Prototype Pollution | ✅ | ✅ | Ready |

---

## Pre-Flight Checklist

Before starting your security research:

### Environment
- [ ] Node.js 12+ installed (for Node.js scripts)
- [ ] Bash 4+ available (for shell scripts)
- [ ] curl installed for HTTP requests
- [ ] Git configured (commits already made)

### Configuration
- [ ] OOB domain set up (testrce.6u.gg or own domain)
- [ ] Target site accessible from your network
- [ ] JWT token extracted from target localStorage
- [ ] Fleet ID / Account ID obtained

### Authorization
- [ ] Bugcrowd/HackerOne/YesWeHack authorization confirmed
- [ ] Scope verified for target domain
- [ ] Rate limits checked (most tests use 500ms delays)
- [ ] Data handling policy reviewed

### Testing Ready
- [ ] Browser developer tools (F12) accessible
- [ ] Terminal access for shell scripts
- [ ] OOB domain monitoring enabled
- [ ] Time sync verified (for time-based SQLi)

---

## Execution Workflow

```
┌─────────────────────────────────────────────────────┐
│ 1. RECONNAISSANCE                                   │
│    └─ Deploy source-extractor-auto.js               │
│       ├─ Identify extraction mode (maps vs bundled) │
│       ├─ Download JSON with all endpoints           │
│       └─ Review discovered APIs, keys, configs      │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ 2. ENUMERATION                                      │
│    └─ Parse extracted endpoints                     │
│       ├─ Check connectivity to each endpoint        │
│       ├─ Identify required authentication           │
│       ├─ Classify by functionality (auth, payment,  │
│       │   reporting, etc.)                          │
│       └─ Note parameters that accept user input     │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ 3. VULNERABILITY TESTING                            │
│    └─ Run OOB test harness (oob-paycools-tests.sh)  │
│       ├─ Test SSTI via report fields                │
│       ├─ Test XXE via file upload                   │
│       ├─ Test SSRF via URL parameters               │
│       ├─ Test SQLi on search/filter endpoints       │
│       └─ Test MFA IDOR on /auth/* endpoints         │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ 4. CALLBACK VERIFICATION                            │
│    └─ Monitor OOB domain (testrce.6u.gg)            │
│       ├─ Wait 10-30 seconds for responses           │
│       ├─ Categorize by vulnerability type           │
│       └─ Log callback details (domain, timestamp)   │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ 5. ROOT CAUSE ANALYSIS                              │
│    └─ Examine source code (from ZIP extraction)     │
│       ├─ Locate vulnerable code path                │
│       ├─ Trace user input to vulnerability          │
│       ├─ Determine impact scope                     │
│       └─ Assess fix difficulty                      │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ 6. REPORTING                                        │
│    └─ Document findings in Bugcrowd format          │
│       ├─ SUMMARY: Brief vulnerability description   │
│       ├─ SETUP: Exact steps to reproduce            │
│       ├─ SCENARIOS: Victim & Attacker perspectives  │
│       ├─ SECURITY IMPACT: Business consequences     │
│       └─ CVSS: Score + detailed explanation         │
└─────────────────────────────────────────────────────┘
```

---

## Tool Selection Guide

**Choose tool based on target characteristics:**

```
Do you have browser access to the target?
├─ YES
│  └─ Use source-extractor-auto.js (DevTools Console)
│     → Automatically selects SOURCE_MAPS or ENDPOINT_EXTRACTION mode
│
└─ NO (scripted/automated testing)
   ├─ If source maps available
   │  └─ Use source-extractor-node.js
   │
   └─ If no source maps
      └─ Use js-endpoint-extractor.js (requires browser) OR
         └─ Manually curl scripts and use endpoint-extractor.js
```

---

## Performance Expectations

| Operation | Time | Notes |
|---|---|---|
| Source detection | 5-10s | Scans all loaded scripts |
| Source maps download | 10-60s | Depends on number of maps |
| Endpoint extraction | 30-120s | Depends on bundle size |
| OOB test suite | 5-10min | Includes 500ms delays between tests |
| Callback receipt | 5-30s | Depends on target processing speed |

---

## Success Indicators

### ✅ Successful Extraction
```
[UniversalExtractor] Starting universal extraction...
[UniversalExtractor] Found 8 script(s)
[UniversalExtractor] Scanning for source maps... 0 found
[UniversalExtractor] Switching to ENDPOINT_EXTRACTION mode
[UniversalExtractor] Extracting endpoints, APIs, keys...
[UniversalExtractor] Total findings: 47 endpoints, 5 keys, 8 configs
[UniversalExtractor] Results exported as JSON
[UniversalExtractor] ========================================
```

### ✅ Successful OOB Test
```
[TEST 1a] Report Gen - SSTI via report name/params
HTTP 200
[TEST 1b] Report Gen - SSTI via connectionId
HTTP 200
[TEST 2a] Driver Batch Import - XXE via CSV
HTTP 200
...
=== Done. Check testrce.6u.gg for callbacks ===
Any callback = confirmed vulnerability
```

### ✅ Successful Callback
```
GET /rce-report-name HTTP/1.1
Host: testrce.6u.gg
User-Agent: curl/7.68.0
Accept: */*

(This proves the target executed our code)
```

---

## Next Steps

1. **Choose Target:** PayCools, PriceLocQ, or custom
2. **Run Extraction:** `./deploy-extractor.sh https://target.com`
3. **Execute OOB Tests:** `./oob-paycools-tests.sh` (or relevant harness)
4. **Monitor Callbacks:** Check OOB domain dashboard
5. **Document Findings:** Use Bugcrowd format (see EXTRACTION_TOOLS.md)

---

## Support & Troubleshooting

See `EXTRACTION_TOOLS.md` for:
- Detailed tool documentation
- Troubleshooting common issues
- Configuration examples
- Security considerations

---

## Summary

✅ **Status: PRODUCTION READY**

**You now have:**
- 1 Universal auto-detecting extractor
- 3 Specialized extractors (source maps, endpoints, Node.js)
- 3 OOB test harnesses (PayCools, PriceLocQ, WebSocket)
- 1 Deployment helper script
- Complete documentation

**All tools are:**
- ✅ Syntax validated
- ✅ Tested and debugged
- ✅ Committed to git
- ✅ Ready for immediate use

**Begin your security research:**
```bash
./deploy-extractor.sh https://merchant.paycools.com.ph
```

---

**Generated:** 2026-09-29  
**Branch:** claude/nodejs-source-download-devtools-2fttt8  
**Scope:** Authorized bug bounty research on Philippine fintech

