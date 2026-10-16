#!/usr/bin/env bash
set -euo pipefail
export PATH="/usr/local/google/home/jrcarter/.nvm/versions/node/v22.22.3/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH="/usr/local/google/home/jrcarter/agents/demo_spend/app/.playwright-browsers"
exec npx "$@"
