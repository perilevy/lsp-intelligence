#!/bin/bash
# Post-edit hook: only emit diagnostic prompt for TS/JS files in the workspace.
# Reads tool input from stdin as JSON.
FILE_PATH=$(cat /dev/stdin | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).tool_input.file_path||'')}catch{}})")

# Skip non-TS/JS files
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx) ;;
  *) exit 0 ;;
esac

# Skip files outside the workspace (e.g. editing other projects)
WORKSPACE="${LSP_WORKSPACE_ROOT:-$PWD}"
case "$FILE_PATH" in
  "$WORKSPACE"*) ;;
  *) exit 0 ;;
esac

echo "A TypeScript/JavaScript file was edited: $FILE_PATH
1. Run live_diagnostics on it to check for new type errors
2. If errors are found, run explain_error on each to provide fix suggestions
3. If the file contains export statements, note that the exported API may have changed — consider running api_guard if the user is working on a cross-package change
4. If no errors, say nothing"
