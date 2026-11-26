#!/usr/bin/env bash
# Deploys one release tag. Run it on the server, in the checkout (e.g. /opt/erp):
#   ./deploy.sh v0.1.0
# Rollback is the same command with an older tag. Database migrations only go forward:
# rolling back past a release that changed the database needs a database backup instead.
set -euo pipefail
TAG=${1:?usage: ./deploy.sh vX.Y.Z}
[[ $TAG =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "not a release tag: $TAG"; exit 1; }
cd "$(dirname "$0")"

git fetch --tags --quiet origin
git -c advice.detachedHead=false checkout --quiet "refs/tags/$TAG"

# Keep the version in .env, so a later plain `docker compose up -d` stays on this release.
if grep -q '^APP_VERSION=' .env; then sed -i "s/^APP_VERSION=.*/APP_VERSION=$TAG/" .env; else echo "APP_VERSION=$TAG" >> .env; fi

sudo docker compose up -d --build
sudo docker compose ps
echo "deployed $TAG"
