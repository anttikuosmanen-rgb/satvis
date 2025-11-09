#!/bin/bash

# Test custom satellite feature with various scenarios
# Usage: ./test-custom-sat.sh

PORT=5173
BASE_URL="http://localhost:${PORT}"

echo "Custom Satellite Feature Test Suite"
echo "===================================="
echo ""
echo "Dev server should be running on port ${PORT}"
echo "Start with: npm run start"
echo ""

# Test 1: ISS with current TLE
echo "Test 1: Current ISS TLE"
echo "----------------------"
ISS_TLE="$(head -3 data/tle/groups/stations.txt)"
ISS_ENCODED=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$ISS_TLE")
ISS_URL="${BASE_URL}/?sat=${ISS_ENCODED}"
echo "Satellite: [Custom] ISS (ZARYA)"
echo "URL: ${ISS_URL}"
echo ""

# Test 2: ISS from a different TLE source (space-track example)
echo "Test 2: Alternative ISS TLE (slightly different epoch)"
echo "------------------------------------------------------"
ALT_ISS="ISS (ZARYA)
1 25544U 98067A   25309.50000000  .00011800  00000+0  21600-3 0  9990
2 25544  51.6340 325.0000 0005100  20.0000 340.0000 15.49780000537000"
ALT_ISS_ENCODED=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$ALT_ISS")
ALT_ISS_URL="${BASE_URL}/?sat=${ALT_ISS_ENCODED}"
echo "Satellite: [Custom] ISS (ZARYA)"
echo "URL: ${ALT_ISS_URL}"
echo ""

# Test 3: Custom satellite from Starlink
echo "Test 3: Starlink Satellite"
echo "-------------------------"
if [ -f "data/tle/groups/starlink.txt" ]; then
  STARLINK_TLE="$(head -3 data/tle/groups/starlink.txt)"
  STARLINK_NAME=$(echo "$STARLINK_TLE" | head -1 | xargs)
  STARLINK_ENCODED=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$STARLINK_TLE")
  STARLINK_URL="${BASE_URL}/?sat=${STARLINK_ENCODED}"
  echo "Satellite: [Custom] ${STARLINK_NAME}"
  echo "URL: ${STARLINK_URL}"
else
  echo "Starlink data not found, skipping"
fi
echo ""

echo "Testing Instructions:"
echo "===================="
echo "1. Make sure dev server is running (npm run start)"
echo ""
echo "2. Option A - Use generated URL:"
echo "   - Copy one of the URLs above"
echo "   - Paste in your browser"
echo ""
echo "3. Option B - Paste TLE directly:"
echo "   - Open: ${BASE_URL}"
echo "   - Modify URL to: ${BASE_URL}/?sat=<PASTE_TLE_HERE>"
echo "   - Press Enter - browser will URL-encode it automatically"
echo "   - Example: ${BASE_URL}/?sat=ISS (ZARYA)"
echo "     1 25544U 98067A   25310..."
echo "     2 25544  51.6335..."
echo ""
echo "4. Check that:"
echo "   ✓ Satellite appears with [Custom] prefix in the UI"
echo "   ✓ Satellite is automatically enabled (visible)"
echo "   ✓ Satellite renders on the globe"
echo "   ✓ No errors in browser console"
echo "   ✓ URL parameter persists (check browser address bar)"
echo ""
echo "5. Test name clash prevention:"
echo "   - Enable regular ISS from the UI"
echo "   - Load custom ISS using Test 1 URL"
echo "   - Both should be visible: 'ISS (ZARYA)' and '[Custom] ISS (ZARYA)'"
echo ""
echo "6. Test URL persistence:"
echo "   - Load a custom satellite URL"
echo "   - Change other settings (time, view, etc.)"
echo "   - Copy URL from address bar"
echo "   - Open in new tab - custom satellite should still load"
