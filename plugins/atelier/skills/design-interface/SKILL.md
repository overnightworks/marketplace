---
name: design-interface
description: >-
  Guidance for building a user-facing surface so a person sees what it is and what they can do without reading it, and enjoys using it, and for commenting on a surface from screenshots. Use when building or changing UI (pages, cards, controls, states, motion, sound) on a tool board, a game, a call with figures, an editor or player or a presentation, or when asked to look at a surface's design. Advice a builder works from and a tester comments by; it blocks nothing.
---

The operator's wishes for a surface: „klar strukturiert, intuitiv, einfach zu
bedienen, kein unnützer Schnickschnack, ich muss schnell finden was ich
brauche — es darf trotzdem geil aussehen und Spaß machen" (atelier-2#336), and
„Intuitiv und es muss Spaß machen und cool aussehen" (atelier-2,
`docs/requirements/0003-ziel-ui.md`). His test of "understandable without the
language" is recorded by agents only, with no source: read it as a direction,
and the look counts as much as the moment.

This skill is advice. Where it disagrees with one of these, they win, in this
order: what the operator said about the surface and its blessed pictures (they
bind what they show, never pixels); the repository's own UI rules (its specs,
`docs/`, `docs/mockups/`); the design kit's ruled texts (overnightworks/design,
`docs/stylesheet.md`, `docs/languages.md`), where the repository takes the kit.
A repository with its own tokens, such as aco's board, keeps them. Report a
disagreement you notice to your parent with the picture; do not settle it in
code.

## The glance test

Blur a capture (`filter: blur(4px) grayscale(1)` on `body`) and answer as
someone who cannot read the page's language:

1. What is this, and what is the main thing on it?
2. What state is it in: what is mine, what waits, what is wrong?
3. What can I do now, and which is the main action?
4. When I act, does the surface answer?

Words may confirm an answer; they should not be its only carrier. An icon may
stand alone wherever its meaning is clear at a glance to someone who uses the
surface for the first time; its word is its accessible name and shows on hover
and focus.

## Core: every surface

1. **Shape, place and motion carry the meaning; words confirm it.** State,
   ownership and possible actions show by shape, icon, position, size and
   motion as well as colour, never by colour alone (WCAG 1.4.1, 1.4.11).
2. **One main thing per view.** A view has one focus and one main action;
   everything else is visibly secondary or one tap away. A game table or an
   editor shows many things and still has one that leads.
3. **Few words, the domain's own, the same everywhere.** A button names its
   action and a status its state, usually in one or two words, in the domain's
   word (Stich, Take, Land) and the same word for the same thing on every
   surface. Never a state and an unrelated action at once. Where a misreading
   costs consent, privacy, money or data, the whole sentence stays.
   Counterexample: "Ready TO LAND / Needs integration".
4. **What a person needs to act is on screen; background waits behind a tap.**
   A control's name, an action's consequence, why something failed and a
   disclosure the law requires stay visible. Background opens on demand from a
   fold or ⓘ that answers tap, click, focus and hover (WCAG 1.4.13).
5. **One way to do a thing, one place for a fact, one part for a behaviour.**
   A control or block of information that repeats goes, unless it answers a new
   question; a behaviour that exists elsewhere reuses that part. A shortcut for
   a visible control and a persistent bar are no repeats.
6. **Every state tells the truth.** Loading, empty, error, waiting and done are
   designed, not defaulted, and none claims what did not happen. Empty says
   what will appear; an error says what failed and the way on.
7. **Motion and sound have a job.** They answer an action at once, show work or
   presence that is happening now, carry expression (a figure's body language,
   a card that lands), or, on a surface made to be enjoyed (a game table, a
   listener page), set its mood with a slow motion that stops under reduced
   motion and can be paused (WCAG 2.2.2). A tool board is still at rest;
   nothing loops to look busy. Under reduced motion the meaning stays in a
   still cue. Sound never carries meaning alone and has a mute.
8. **It should look good and be fun, not only work.** Make the moments that
   matter answer with some life (a move lands, a song starts, a figure turns
   to you) and give the whole surface a considered look. Avoid the generic
   generated look: identical rounded cards, gradient washes.

## Where the rest lives

- Contrast, target size, reflow and focus: WCAG 2.2 AA (1.4.3, 1.4.10, 1.4.11,
  2.4.7, 2.4.11, 2.5.8) and the repository's own floors; the kit's coarse-
  pointer floor is in its stylesheet text.
- Red: the kit's ruled section "What the fail colour marks" in
  `docs/stylesheet.md`, for surfaces that take the kit; others follow their
  own rules.
- Words and languages: the kit's `docs/languages.md`.
- Tokens: the repository's token owner, the kit where it takes it; never a
  literal colour or a synonym for a state that has a token.

## Tool board

For a console a person scans and acts on (aco's board); its own UI rules in
the repository win.

- One question per page or tab; a second question gets its own tab.
- What only the person can end carries the attention mark, quiet at zero.
- Lead with the human name. An identifier (hash, fingerprint, source line) is
  detail behind one fold, copyable and linked to what it names; an item number
  people use as a handle may lead when it links. It proves, it is no reading
  matter. Counterexample: "Run desk/x-3" over an unnamed workflow.
- Undo beats confirm; only what undo cannot take back asks first, with one
  consequence line and the verb on the button.
- Show the time form the question asks: an age for "how long", a date for
  "when".

## Building with it

1. Find the blessed picture and the UI rules; name the view's main thing, its
   states and the person and device it serves.
2. Build every state from the repository's tokens and parts, then capture each
   changed view with the `see` skill at desktop and about 390 px width, in each
   changed state, plain and blurred; answer the glance test from the blurred
   one, fix what it shows and capture again.
3. Run checks such as axe, keyboard walks and reduced motion on your own
   captures and report them; a repository that wants them in its CI opens its
   own item.
4. Name the captures in your report, and each place you departed from this
   skill with its reason.

## Commenting by it

You write observations, never verdicts; none blocks a landing.

- Before reading the plan or the code, answer the glance test from the blurred
  capture as a stranger would; each answer that differs from what the surface
  means to show is an observation.
- One line each: `<view, width, state>: <what the picture shows>; <what a
  person might do or miss>; <core point>; <suggestion>`.
- A blessed picture or a repository rule that departs from this skill is not an
  observation; a core point a blessed picture itself breaks goes to the head as
  a question.
- Fun and look: a still cannot show motion. Report what you see and anything
  generic; the judgement is the operator's.
