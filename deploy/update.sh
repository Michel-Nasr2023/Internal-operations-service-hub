#!/usr/bin/env bash
# Deploys a commit on the server and checks that it is healthy.
#   bash deploy/update.sh              latest master
#   bash deploy/update.sh <commit SHA> an exact commit, e.g. the submitted one
set -euo pipefail
cd "$(dirname "$0")/.."

git fetch --quiet origin
git checkout --quiet --detach "${1:-origin/master}"
echo "Deploying $(git rev-parse HEAD)"

npm ci --prefix backend
npm run build --prefix backend
npm ci --prefix frontend
# The web app calls the API on the same address, under /api.
VITE_API_URL=/api npm run build --prefix frontend

pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save

sleep 5
curl -fsS http://127.0.0.1:3000/api/health
echo
echo "Deployed $(git rev-parse --short HEAD). Now run the smoke test: npm run smoke -- https://<your domain>"
