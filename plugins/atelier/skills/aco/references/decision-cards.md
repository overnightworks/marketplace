# Decision cards

Reader: a head writing or revising an operator question as an option line. The
card's keys, limits and mechanical refusals belong to aco: read the
[body-block spec "Option lines" (BODY-95..BODY-100)](https://github.com/overnightworks/aco/blob/main/specs/body-block.spec.md)
in the aco repository, and pipe the body through `aco check -`. This file holds only
what `aco check` cannot judge. The operator's wish: a card he decides at a glance,
always in the same structure. Why no judged field carries an identifier:
`atelier:design-interface` law 8 (identifiers are proof anchors, never reading
matter).

## 1. Question

One plain sentence about the person's outcome, in the operator's language, short enough
to read in one breath. It asks what the person gets or loses, never which mechanism to
pick. Test: a reader who knows nothing of the repository can say what a "yes" changes
for them.

Not: "Soll der Resolver Zeilen über den Revisions-Hash binden?"
But: "Soll dein Song beim Sprung zum Ursprungs-Take offen bleiben?"

## 2. Plain fields

- `problem` says what a person loses, risks or cannot do today, never what the code
  lacks. If no person is hurt, the card is not a product question.
- No field that aco judges (BODY-95) names a repository or carries an internal label:
  a ruling, slice, spec or item ID, or a word only the team knows ("der E8-Satz").
  Say what the thing does instead.
- Technical names, paths and numbers stand only in `contract` (aco BODY-100 leaves it
  unjudged), where the head binds itself to what "yes" builds.

## 3. Pictures

The TODAY `picture` shows today as it is, in one of the forms the mockup draws
([`docs/board/mockup.html` in overnightworks/aco](https://github.com/overnightworks/aco/blob/main/docs/board/mockup.html)).
Describe the form in words; carry no SVG skeleton (aco keeps fixed picture templates for itself).

- The `caption` says what the picture shows ("Der Browser springt selbst, dabei geht der
  Song verloren"), never only "Heute".
- A result picture on an option has no caption of its own: that option's `effect` line
  is its caption.
- Frames inside a before-after picture are captioned with what happens between them
  ("Klick", then what follows), not with "Vorher" and "Nachher".
- Picture safety rules are aco's; read them there.

## 4. Faithful options

Each option is something the head would really build; no straw option makes the
recommendation look good. "As today" (`same_as_today`) stays whenever it is a real
choice.

- `effect` says what happens.
- `notice` says what the person sees, in "du" voice.
- `cost` is honest, for the recommended option too: effort, risk, what it blocks.
- `undo = "final"` marks what cannot be undone; `undo_how` names the way back where
  one exists.
- No option text claims to be recommended ("Empfohlen" in `notice`): only `recommended`
  and `reason` say that.

## 5. Recommendation

`reason` comes from evidence: what was measured, read or ruled. A quoted ruling is
verbatim and dated. It carries no process talk ("die Zeile wartet auf dein
gesprochenes Wort"); the reader decides the card, they do not need to hear how the
board works.

## 6. What a head never guesses

Material risk, a product choice that is not safely inferable, and the lines that wait
for the operator's spoken word are listed in the contract's
[How to work](https://github.com/overnightworks/marketplace/blob/main/instructions/AGENTS.md#how-to-work)
and [How to decide](https://github.com/overnightworks/marketplace/blob/main/instructions/AGENTS.md#how-to-decide). A card never states them again, and a head never fills such a line itself.

## 7. Unclear

The operator sent a card back (`aco rule <n> --line <k> --unclear`, see SKILL.md). The
line stays open and carries `returned_on` and, when he gave one, `returned_note`.

1. With a note: read it, and revise the card so it answers that note.
2. Without one: check the card against sections 1 to 5 and rewrite whatever fails.
3. Remove `returned_on` and `returned_note` only in the same edit that revises the card.
   Pipe the new body through `aco check -` first.

Never answer an unclear card by explaining it in chat: the card is the answer.
