// The one decision whether a failed Claude agent hit its account usage limit. Every agent call of the lane passes its error through
// rethrowClaudeUsageLimit, so a limit reaches the lane's runPart instead of being retried or counted as an ordinary failure.
const CLAUDE_USAGE_LIMIT = /\b(?:(?:usage|weekly|session|5-hour|opus|sonnet)\s+limit|hit\s+your\s+limit)\b/i
const CLAUDE_LIMIT_RESET = /\bresets?\s+(?:at\s+)?([^\n·.]+)/i

// The limit an agent error names, with the reset text when it has one, or null for any other error.
function claudeUsageLimitOf(error) {
  const text = String(error?.message ?? error)
  if (!CLAUDE_USAGE_LIMIT.test(text)) return null
  const resetsAt = CLAUDE_LIMIT_RESET.exec(text)?.[1].trim() ?? null
  return { resetsAt, error: text.slice(0, 300) }
}

function rethrowClaudeUsageLimit(error) {
  if (claudeUsageLimitOf(error)) throw error
}
