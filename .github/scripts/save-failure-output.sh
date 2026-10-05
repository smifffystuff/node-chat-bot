#!/usr/bin/env bash
# Saves the tail of a failed check's output (check-output.log) as the step
# output "log", so the report job can show it in the PR comment.
set -euo pipefail

delimiter="EOF_$(openssl rand -hex 8)"
{
  echo "log<<$delimiter"
  # Strip ANSI colour codes so the log reads cleanly in Markdown.
  tail -n 60 check-output.log | sed 's/\x1b\[[0-9;]*[A-Za-z]//g'
  echo "$delimiter"
} >> "$GITHUB_OUTPUT"
