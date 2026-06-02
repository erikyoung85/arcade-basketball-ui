#!/bin/bash

set -e

# =========================
# ABSOLUTE PATH CONFIG
# =========================
PROJECT_DIR="/home/easyjukebox/Desktop/arcade-basketball-ui"
DIST_DIR="$PROJECT_DIR/dist"
BUILD_OUTPUT="$PROJECT_DIR/dist/arcade-basketball-ui/browser"

DEPLOY_TARGET="/var/www/arcadebasketball"
NGINX_SERVICE="nginx"

# =========================
# STEP 1: BUILD PROJECT
# =========================
echo "🔨 Building Angular project..."

cd "$PROJECT_DIR"

npm install
ng build --configuration production --base-href /arcadebasketball/

echo "✅ Build complete"

# =========================
# STEP 2: VALIDATE BUILD OUTPUT
# =========================
echo "🔍 Validating build output..."

if [ ! -d "$BUILD_OUTPUT" ]; then
    echo "❌ Build output not found at: $BUILD_OUTPUT"
    exit 1
fi

if [ ! -f "$BUILD_OUTPUT/index.html" ]; then
    echo "❌ index.html missing in build output"
    exit 1
fi

echo "✅ Build validated"

# =========================
# STEP 3: DEPLOY TO NGINX DIRECTORY
# =========================
echo "🚀 Deploying to $DEPLOY_TARGET..."

sudo mkdir -p "$DEPLOY_TARGET"

sudo rm -rf "$DEPLOY_TARGET"/*
sudo cp -R "$BUILD_OUTPUT"/* "$DEPLOY_TARGET"/

# Ensure nginx can read files
sudo chown -R www-data:www-data "$DEPLOY_TARGET"
sudo chmod -R 755 "$DEPLOY_TARGET"

echo "✅ Deployment complete"

# =========================
# STEP 4: RELOAD NGINX
# =========================
echo "🔁 Reloading nginx..."

sudo nginx -t
sudo systemctl reload "$NGINX_SERVICE"

echo "🎯 Done!"
echo "👉 App running at: http://arcadebasketball.local/arcadebasketball/"