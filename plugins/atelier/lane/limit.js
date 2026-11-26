// The one decision whether an agent call failed, and whether a failed Claude agent hit its account usage limit. Every agent call of the lane
// goes through settledAgent, so a limit reaches the lane's runPart instead of being retried or counted as an ordinary failure.
const CLAUDE_USAGE_LIMIT = /\b(?:(?:usage|weekly|session|5-hour|opus|sonnet)\s+limit|hit\s+your\s+(?:[\w.-]+\s+){0,2}limit|out\s+of\s+usage\s+credits)\b/i
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

// The runtime does not throw at a usage limit too far out to wait for: agent() returns null and only the runtime's own log names the limit, which no script reads.
// A null answer is therefore probed once with a trivial agent of the same model; an account that cannot start it either is at its limit, which is thrown as one with no reset time.
async function rethrowWhenAccountLimited(opts) {
  const probe = await agent('Reply with the word ok.', { label: `limit-probe-${opts?.label || 'agent'}`, model: opts?.model, effort: 'low' }).catch(error => {
    rethrowClaudeUsageLimit(error)
    return 'ok'
  })
  if (probe === null) throw new Error('The account hit its usage limit: the agent ended without a result and a probe agent of the same model ended without one too.')
}

// agent() with a schema throws when the subagent ends without a result, and returns null when the runtime gives up on it. The answer is null when the call failed, with the error it threw when it threw one;
// the caller keeps its own verdict for a failed call. A usage limit is rethrown.
async function settledAgent(prompt, opts) {
  try {
    const answer = await agent(prompt, opts)
    if (answer === null) await rethrowWhenAccountLimited(opts)
    return { answer, error: null }
  } catch (error) {
    rethrowClaudeUsageLimit(error)
    log(`${opts?.label || 'agent'} ended without a result: ${String(error).slice(0, 160)}`)
    return { answer: null, error }
  }
}

// The answer of a settled agent call, null when it failed: the caller keeps its own verdict for an end without a result.
const agentAnswer = async (prompt, opts) => (await settledAgent(prompt, opts)).answer
