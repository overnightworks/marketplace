// The refusals of a routing override against the lane's routing tables (the model, provider and effort constants of the lane's inputs).
// The provider each role must run on: reviews on the reviewer provider, the gate on any provider but the builder's or the Opus stand-in, every other role on Claude.
function providerAllowed(role, model, effort) {
  const provider = MODEL_PROVIDER[model]
  if (role === 'gate') return provider !== 'claude' || isGateStandIn(role, model, effort)
  return provider === (role === 'review' ? REVIEWER_PROVIDER : 'claude')
}

// Why the resolved effort of one role is refused: not accepted by the provider, or above the model's cap without the operator's word; or null.
function effortRefusal(role, model, effort) {
  const efforts = PROVIDER_EFFORTS[MODEL_PROVIDER[model]]
  if (!efforts.includes(effort)) return `routing for ${role} sets effort "${effort}"; ${MODEL_PROVIDER[model]} accepts ${efforts.join(', ')}${MODEL_PROVIDER[model] in OPERATOR_WORD_PROVIDER_EFFORTS ? WORD_HINT : ''}`
  const cap = EFFORT_CAP[model] || 'high'
  if (!OPERATOR_WORD && efforts.indexOf(effort) > efforts.indexOf(cap) && !isGateStandIn(role, model, effort)) return `routing for ${role} sets ${model} to effort "${effort}"; ${model} is capped at ${cap}${WORD_HINT}`
  return null
}

// Why a role on its resolved model and effort breaks the provider it must run on, or null.
function providerRefusal(role, model, effort) {
  if (providerAllowed(role, model, effort)) return null
  return `routing for ${role} puts it on ${MODEL_PROVIDER[model]}, which breaks ${role === 'gate' ? 'gate provider separation from the builder; the one Claude gate is the stand-in opus at high effort' : 'the role\'s provider'}`
}

// Why one role's override is refused, or null.
function roleChoiceRefusal(role, choice) {
  if (!Object.hasOwn(DEFAULT_ROUTING, role)) return `routing names an unknown role "${role}"`
  if (typeof choice !== 'object' || choice === null) return `routing for ${role} must be {model, effort}`
  const knownModel = typeof choice.model === 'string' && Object.hasOwn(MODEL_PROVIDER, choice.model)
  if (choice.model !== undefined && !knownModel) return `routing for ${role} names an unknown model "${choice.model}"${Object.hasOwn(OPERATOR_WORD_MODEL_PROVIDER, choice.model) ? WORD_HINT : ''}`
  const model = choice.model || DEFAULT_ROUTING[role].model
  const effort = choice.effort || DEFAULT_ROUTING[role].effort
  return effortRefusal(role, model, effort) ?? providerRefusal(role, model, effort)
}

// Why a routing override is refused, or null. An override never bypasses reviewer independence or gate provider separation beyond the Opus stand-in, and bypasses the per-model effort caps only with the operator's word.
function routingRefusal(overrides) {
  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) return 'routing must be an object of roles'
  return Object.entries(overrides).map(([role, choice]) => roleChoiceRefusal(role, choice)).find(Boolean) ?? null
}
