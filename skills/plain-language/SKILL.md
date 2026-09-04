---
name: plain-language
description: Rewrite interface copy and site prose so a tired, distracted, or hurried reader can act on it correctly, working from portamp's dsp-cognitive findings or from the text itself. Use when someone says "simplify this copy", "our error messages are terrible", "users don't read the instructions", "fix the wording", "plain language pass", "make this accessible", or when a run's COGNITIVE.md report lists walls, unexpanded abbreviations, inconsistent action names, or a reading grade far above the audience. Distinct from adhd-brief: that skill shapes answers in a conversation; this one repairs the words that ship inside a product.
---

# Plain language

Interface copy is read one line at a time by someone in the middle of doing
something else. Prose rules do not transfer: nobody reads a screen top to
bottom, and the reader's question is always "what do I do", never "what is
this about". Every repair below serves that one question.

## The pass, in order

Order matters because early fixes change what the later ones see.

1. **Actions first.** Collect every button and link label across the
   screens. One act gets one verb everywhere: if submitting is "Submit" on
   one screen it is not "Send", "Apply", and "Go" on three others. The
   measured version of this is the action names finding in COGNITIVE.md;
   pick the winner by which word the users themselves say.
2. **Links say where they go.** "Click here" carries nothing, and for a
   screen reader user jumping link to link it is the whole sentence. The
   destination's name is the link text: "the billing settings", not "here".
3. **Expand every abbreviation once.** First use spells it out with the
   short form beside it; after that the short form is fine. An
   abbreviation the team no longer notices is the one the report catches.
4. **Break the walls.** A block past about eighty words gets skimmed, and
   skimming drops sentences at random. Split at the topic turn and lead
   each piece with its point. Legalese that must stay verbatim stays, and
   gets a one line plain summary above it labeled as a summary.
5. **Shorten the selects.** A list past about fifteen options is a search
   pretending to be a choice. Group it, rank it by use, or make it an
   actual search; the default stays visible either way.
6. **Then, and only then, the sentences.** Shorter sentences first, rarer
   words second. The reading grade in the report ranks screens; it does
   not grade people, and the report says its formula's limits itself.

## Error messages

The highest value words in the product, read at the worst moment.

- Say what happened, what it affected, and what to do, in that order, in
  three sentences or fewer.
- Name the thing, not the internals: "That card number is one digit
  short", never "Validation failed: constraint PAN_LENGTH".
- If the user can fix it, the fix is the message. If they cannot, say who
  can and what to tell them, including the code they will be asked for.
- Never blame ("you entered an invalid…"); state ("that date is after the
  return flight").
- The retry rule: an error a user will meet twice must read differently
  from success, loudly, because the second read is a skim.

## Forms

- The label says what to type; the help text says only what the label
  cannot ("as printed on the card"). Help text that repeats the label
  trains readers to skip help text.
- Constraints appear before the mistake, not after: "12 characters or
  more" beside the field beats the same fact delivered as a rejection.
- Group by the reader's mental model, not the database's. The report's
  form findings say which fields cohabit a screen; whether they belong
  together is a judgment about people.

## What not to simplify

- Exact values, identifiers, commands, legal terms of art: verbatim, with
  plain prose around them.
- A warning whose softening changes behavior. "This deletes the account"
  does not become friendlier.
- Vocabulary the audience owns. A tool for accountants keeps "accrual";
  plain language means the audience's words, not the smallest words.
- Do not paper over a bad flow with good copy; when the words will not
  come clean, the screen usually has two jobs, and that finding goes back
  to design, stated plainly.

## Verifying the pass

Rerun the pipeline and read `COGNITIVE.md` again: the counts should fall,
and any finding that stays gets a written reason beside it in the notes.
Then the human check, which the report says it cannot do for you: hand a
changed screen to someone who has never seen it and ask them what they
would do next. Their first sentence is the audit.
