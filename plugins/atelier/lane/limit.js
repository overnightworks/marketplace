// The one decision whether an agent call failed, and whether a failed Claude agent hit its account usage limit. Every agent call of the lane
// goes through settledAgent, so a limit reaches the lane's runPart instead of being retried or counted as an ordinary failure.
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

// agent() with a schema throws when the subagent ends without a result. The answer is null when the call failed, with the error it threw when it threw one;
// the caller keeps its own verdict for a failed call. A usage limit is rethrown.
async function settledAgent(prompt, opts) {
  try {
    return { answer: await agent(prompt, opts), error: null }
  } catch (error) {
    rethrowClaudeUsageLimit(error)
    log(`${opts?.label || 'agent'} ended without a result: ${String(error).slice(0, 160)}`)
    return { answer: null, error }
  }
}
