#!/usr/bin/env bash
# Quick audit: show risky actions from the last 24 hours
set -euo pipefail

agenttrust audit --above 7 --last 24h
