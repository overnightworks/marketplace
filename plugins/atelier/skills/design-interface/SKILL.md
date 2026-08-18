---
name: design-interface
description: >-
  The workshop's visual language for every user-facing surface — apply whenever building or changing UI (pages, cards, buttons, badges, labels, dialogs, states, motion). Encodes the operator's standard as an enforceable contract: understandable without reading, one glance per question, state by shape and color, short labels, honest empty/loading/error states, motion only for life. Also use to review a UI candidate against this standard before publishing it; UI evidence is a real-browser screenshot, not test green alone.
---

Build surfaces a person understands **without knowing the language**. The
operator's test, verbatim: "Wenn ich es sehe, verstehe ich was ich machen kann,
ohne die Sprache zu kennen — Körpersprache, visuell, und es muss Spaß machen."
Reading is the fallback, never the mechanism.

This skill is a contract, not inspiration: it exists so UI quality does not
depend on who builds a slice or on the operator re-explaining his taste. A
candidate is judged against it before the operator ever sees the surface.

## The seven laws

1. **One question per page.** Every page answers exactly one question
   (Entrance = now, Work = to do, History = was, Gallery = created,
   Cockpit = intervene, Settings = adjust). Content answering a different
   question belongs on that page, not in a second panel here.
2. **State is carried by shape AND color, words only confirm it.** A card's
   status must be readable at arm's length — and with color removed, because
   color-blind eyes are real: every color signal has a shape/icon twin. Red is
   reserved: it means *only a human can end this*. A red that is usually on
   carries no information and trains the eye to ignore it; green/yellow cover
   everything the fleet resolves itself.
3. **Labels are one strong word, two at most.** A button carries a verb
   ("Land", "Retire", "Retry"), a status badge a noun ("Review", "Landing").
   Never a sentence, never states and actions compounded
   ("Ready TO LAND / Needs integration" is the named counterexample). If two
   words cannot carry it, the concept is cut wrong — split the control, don't
   grow the label. The words are the domain's own: a surface labels a
   contract concept with the contract's word ("Prompt", "Output", "Log"),
   never an invented dialog word ("Asked" over a prompt is the named
   counterexample) — the audience knows the domain; wrong words hide gaps.
4. **Explanation lives behind an info affordance, never inline.** One ⓘ per
   control, opening on hover *and* tap. Inline lead-notes, field-notes, and
   explanatory paragraphs are defects. Effect timing ("applies immediately" /
   "on next start") is a small badge, not prose.
5. **Every affordance exists once.** One "Show details" per card, one save
   surface per page (immediate-acting danger switches exempt), one way to do
   one thing. A duplicated affordance is a bug with the same severity as a
   duplicated work item — and so is duplicated *information*: a block that
   only repeats what the page already answers ("as it happened" re-listing
   the outputs above it is the named counterexample) earns its place by
   answering a new question or falls.
6. **Empty, loading, and error are states the surface tells the truth about.**
   "Looking…" while fetching, an honest empty message that names what absence
   means, a visible error that names what failed — never a default that lies
   ("the workshop is dark" over a working fleet is the named counterexample).
   A surface is unfinished until all three states are designed, not defaulted.
7. **Motion shows life, never decoration.** Something animates because it is
   working *right now* (a pulse on an active seat, progress that progresses);
   nothing animates to look busy. Idle surfaces are calm. Respect reduced-
   motion preferences.
8. **Identifiers are proof anchors, never reading matter.** A hash or id
   answers two questions — *what does it prove* and *where is the thing it
   names* — behind one affordance: hidden until asked, copyable, linking to
   the resource it identifies (a revision hash opens the document; an anchor
   with no destination gets a one-line "what this seals" instead). Lead with
   the human name of the thing; identity is the detail, not the title ("Run
   desk/x-3" over an unnamed workflow is the named counterexample).

## Applying it

- Before building: name the page's one question and the card's one state.
  Everything on the surface must serve them.
- Prefer the existing token owner for status vocabulary; never invent a
  synonym for a state that already has a token. New states need a new token
  at the owner, not an ad-hoc string.
- Actions that destroy or publish get a confirm; everything else acts
  directly. Confirmation dialogs repeat law 3: one verb, one consequence line.
- Timestamps show age ("for 5 hours"), not raw dates, wherever the question
  is "how long" rather than "when exactly".
- Keyboard and focus survive every change: what a pointer can do, focus can
  reach. A retained-mode view that swallows focus is a defect, not a quirk.
- Surfaces hold at narrow widths (the operator reads on ~390px too): stacking
  is fine, truncation of state-carrying content is not.
- Display strings come from a vocabulary owner, never inline literals, and the
  layout survives long words — the surface is translatable before anyone asks.
- A criterion a machine can check moves into a test: automated accessibility
  checks (axe) and keyboard walks belong in the e2e alongside the screenshot,
  so the agent's judgment is spent only on what machines cannot see.

## Reviewing against it

Walk the surface and ask, in order: Which question does this page answer? Can
I read every state with the text blurred — and in grayscale? Is any label
longer than two words, or not the domain's own word? Is any explanation
inline? Does any affordance — or block of information — appear twice? Are
empty, loading, and error designed? Does anything move that is not alive?
Is any identifier lying around as reading matter instead of anchoring proof?
Each "no" is a REVISE citing the law's number.

**Evidence is a screenshot, not test green.** A UI candidate's proof includes
a real-browser capture (the e2e Chromium against the live console serves) of
the changed surface in its common state and — when they changed — its
empty/error state. A reviewer judges the picture against the laws; code alone
cannot show joylessness. A surface that passes all seven laws but feels
joyless is still unfinished — the operator named fun as part of the standard.
