#!/bin/bash
# Docker Build Test Script
# Tests all Docker builds before pushing to production

set -e

echo "======================================"
echo "Testing Satvis Docker Builds"
echo "======================================"
echo ""

# Test 1: Build just the artifacts (builder stage)
echo "Test 1: Building builder stage (artifacts only)..."
docker build --target builder -f Dockerfile.web -t satvis-builder:test .
echo "✓ Builder stage completed successfully"
echo ""

# Test 2: Build full web server image
echo "Test 2: Building full web server image..."
docker build -f Dockerfile.web -t satvis-web:test .
echo "✓ Web server image built successfully"
echo ""

# Test 3: Build TLE updater image
echo "Test 3: Building TLE updater image..."
docker build -f Dockerfile.tle-updater -t satvis-tle-updater:test .
echo "✓ TLE updater image built successfully"
echo ""

# Test 4: Extract artifacts from builder stage
echo "Test 4: Extracting artifacts from builder stage..."
docker create --name satvis-extract satvis-builder:test
docker cp satvis-extract:/app/dist ./dist-test
docker rm satvis-extract
echo "✓ Artifacts extracted to ./dist-test"
echo ""

# Test 5: Run web server container (detached)
echo "Test 5: Running web server container..."
docker run -d --name satvis-web-test -p 8080:80 satvis-web:test
sleep 3
echo "✓ Web server started on http://localhost:8080"
echo ""

# Test 6: Health check
echo "Test 6: Testing health endpoint..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/health)
if [ "$HTTP_CODE" = "200" ]; then
    echo "✓ Health check passed (HTTP $HTTP_CODE)"
else
    echo "✗ Health check failed (HTTP $HTTP_CODE)"
    exit 1
fi
echo ""

# Test 7: Test main page
echo "Test 7: Testing main page..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/)
if [ "$HTTP_CODE" = "200" ]; then
    echo "✓ Main page accessible (HTTP $HTTP_CODE)"
else
    echo "✗ Main page failed (HTTP $HTTP_CODE)"
    exit 1
fi
echo ""

# Cleanup
echo "Cleaning up..."
docker stop satvis-web-test
docker rm satvis-web-test
rm -rf ./dist-test
docker rmi satvis-builder:test satvis-web:test satvis-tle-updater:test
echo "✓ Cleanup complete"
echo ""

echo "======================================"
echo "All Docker build tests passed! ✓"
echo "======================================"
