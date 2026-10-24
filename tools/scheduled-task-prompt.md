Short, mechanical task. Do nothing else and keep the reply to one line.

1. Call the `mcp__ccd_session_mgmt__get_usage` tool with no arguments. If it's only listed as a deferred tool, load it first with ToolSearch, query "select:mcp__ccd_session_mgmt__get_usage".
2. Take the `plan` object from the result unchanged and pipe it to the save script with Bash:

python3 ~/.claude/epd-save-limits.py <<'EOF'
{"plan": <the plan object, verbatim JSON>}
EOF

3. Reply with the script's output line, e.g. "five_hour 2% · seven_day 59%". If the plan status isn't "ok", or the script fails, reply with the error in one line and don't retry.

Don't read, edit or create any other file.
