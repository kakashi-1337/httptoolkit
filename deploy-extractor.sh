#!/bin/bash
# Quick deployment helper for source extraction testing

set -e

LOG_PREFIX="[DeployExtractor]"

echo "$LOG_PREFIX Source Extraction Deployment Helper"
echo "$LOG_PREFIX This script prepares extraction tools for bug bounty testing"
echo ""

# Configuration
OOB_DOMAIN="${OOB_DOMAIN:-testrce.6u.gg}"
TARGET_URL="${1:-}"

if [ -z "$TARGET_URL" ]; then
    echo "Usage: $0 <TARGET_URL> [OOB_DOMAIN]"
    echo ""
    echo "Examples:"
    echo "  $0 https://merchant.paycools.com.ph"
    echo "  $0 https://api.locq.com"
    echo "  $0 https://target.com custom-oob-domain.xyz"
    echo ""
    echo "OOB Domain (optional):"
    echo "  Default: $OOB_DOMAIN"
    echo "  Custom:  \$OOB_DOMAIN=custom.xyz $0 <TARGET_URL>"
    echo ""
    exit 1
fi

if [ -n "$2" ]; then
    OOB_DOMAIN="$2"
fi

TARGET_HOST=$(echo "$TARGET_URL" | sed 's|https://||;s|http://||;s|/.*||')
echo "$LOG_PREFIX Target: $TARGET_URL"
echo "$LOG_PREFIX Target Host: $TARGET_HOST"
echo "$LOG_PREFIX OOB Domain: $OOB_DOMAIN"
echo ""

# Copy extractor to clipboard-friendly format
if [ -f "source-extractor-auto.js" ]; then
    echo "$LOG_PREFIX Creating browser console deployment..."

    # Create a version with instructions
    cat > /tmp/extractor-deploy.txt << 'EOF'
════════════════════════════════════════════════════════════════════════
 SOURCE EXTRACTION DEPLOYMENT
════════════════════════════════════════════════════════════════════════

1. OPEN TARGET IN BROWSER:
   Navigate to: <TARGET_URL>

2. OPEN DEVELOPER TOOLS:
   Press F12 or Right-click → Inspect → Console tab

3. PASTE EXTRACTOR:
   Copy everything below (between the ═══ lines)
   Paste into Console and press ENTER

4. WAIT FOR RESULTS:
   Script will auto-detect extraction mode:
   - If source maps found → downloads ZIP + JSON
   - If no maps → auto-switches to endpoint extraction → downloads JSON

5. CHECK DOWNLOADS:
   Look for files like:
   - merchant-paycools-com-ph-extraction-SOURCE_MAPS.zip (if maps found)
   - merchant-paycools-com-ph-extraction-ENDPOINT_EXTRACTION.json

════════════════════════════════════════════════════════════════════════
 COPY AND PASTE INTO CONSOLE (Everything below):
════════════════════════════════════════════════════════════════════════

EOF

    # Append the extractor code (minified to save space)
    cat source-extractor-auto.js >> /tmp/extractor-deploy.txt

    cat >> /tmp/extractor-deploy.txt << 'EOF'

════════════════════════════════════════════════════════════════════════
 AFTER EXTRACTION:
════════════════════════════════════════════════════════════════════════

1. REVIEW RESULTS:
   Open the downloaded JSON file in text editor
   Look for: endpoints, API keys, Firebase configs, emails

2. TEST ENDPOINTS (if you have test tools):
   ./oob-paycools-tests.sh (for PayCools)
   ./oob-rce-tests.sh (for PriceLocQ)

3. OOB DOMAIN MONITORING:
   Check your testrce.6u.gg dashboard for callbacks
   Any callback = confirmed vulnerability

════════════════════════════════════════════════════════════════════════
EOF

    echo "$LOG_PREFIX Deployment file created: /tmp/extractor-deploy.txt"
    echo "$LOG_PREFIX Size: $(wc -c < /tmp/extractor-deploy.txt) bytes"
    echo ""
else
    echo "$LOG_PREFIX ERROR: source-extractor-auto.js not found!"
    exit 1
fi

# Show OOB testing instructions
echo "$LOG_PREFIX Next steps for OOB testing:"
echo ""
echo "1. Extract endpoints from target using the browser console script"
echo ""
echo "2. Set up OOB domain (if testing PayCools or PriceLocQ):"
echo "   - Configure $OOB_DOMAIN to collect HTTP callbacks"
echo "   - Or use Burp Collaborator / 6u.gg"
echo ""
echo "3. Run OOB tests:"
echo "   ./oob-paycools-tests.sh  (for PayCools targets)"
echo "   ./oob-rce-tests.sh        (for PriceLocQ targets)"
echo ""
echo "4. Monitor for callbacks:"
echo "   Watch $OOB_DOMAIN dashboard for incoming requests"
echo "   Each callback = confirmed vulnerability"
echo ""

# List available test harnesses
echo "$LOG_PREFIX Available test harnesses:"
ls -lh oob-*.sh ws-ssti-test.js 2>/dev/null | awk '{print "   " $9 " (" $5 ")"}'
echo ""

echo "$LOG_PREFIX Deployment ready! ✓"
echo ""
echo "Next: Open $TARGET_URL → F12 → Console → Paste extractor script"
