---
name: design-interface
description: The workshop's visual language for every user-facing surface — apply whenever building or changing UI (pages, cards, buttons, badges, labels, dialogs). Encodes the operator's standard: understandable without reading, one glance per question, icons and color before words, short labels, explanations behind info affordances. Also use to review a UI candidate against this standard before publishing it.
---

Build surfaces a person understands **without knowing the language**. The
operator's test, verbatim: "Wenn ich es sehe, verstehe ich was ich machen kann,
ohne die Sprache zu kennen — Körpersprache, visuell, und es muss Spaß machen."
Reading is the fallback, never the mechanism.

## The five laws

1. **One question per page.** Every page answers exactly one question
   (Entrance = now, Work = to do, History = was, Gallery = created,
   Cockpit = intervene, Settings = adjust). Content that answers a different
   question belongs on that other page, not in a second panel here.
2. **State is carried by color and shape, words only confirm it.** A card's
   status must be readable from color/icon at arm's length. Red is reserved:
   it means *only a human can end this* — a red that is usually on carries no
   information and trains the eye to ignore it. Green/yellow cover everything
   the fleet resolves itself.
3. **Labels are one strong word, two at most.** A button carries a verb
   ("Land", "Retire", "Retry"), a status badge a noun ("Review", "Landing").
   Never a sentence, never a compound of both states and actions
   ("Ready TO LAND / Needs integration" is the named counterexample). If two
   words cannot carry it, the concept is cut wrong — split the control, don't
   grow the label.
4. **Explanation lives behind an info affordance, never inline.** One ⓘ per
   control, opening on hover *and* tap. Inline lead-notes, field-notes, and
   explanatory paragraphs are defects. Effect timing ("applies immediately" /
   "on next start") is a small badge, not prose.
5. **Every affordance exists once.** One "Show details" per card, one save
   surface per page (immediate-acting danger switches exempt), one way to do
   one thing. A duplicated affordance is a bug with the same severity as a
   duplicated work item.

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

## Reviewing against it

Walk the surface and ask, in order: Which question does this page answer?
Can I read every state with the text blurred? Is any label longer than two
words? Is any explanation inline? Does any affordance appear twice? Each "no"
is a REVISE with the law's number as the reason. A surface that passes all
five but feels joyless is still unfinished — the operator named fun as part
of the standard.
