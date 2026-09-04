---
name: adhd-brief
description: Write for a reader whose attention is expensive, and keep every answer, document, and piece of UI copy inside what that reader can actually hold. Use when someone says "too long", "shorter", "tldr", "just the answer", "simplify", "cut it down", "I can't read all that", "stop writing essays", "brief mode", "adhd mode", or asks the same question again because the first answer buried it. Also use proactively when an answer is heading past about fifteen lines and the person has already shown they want short, when a wall of text has produced no reply, when writing instructions someone must follow step by step, or when fixing copy that portamp's dsp-cognitive report flagged. Applies to what gets written back and to how much gets loaded to produce it, since the second is where the tokens actually go.
---

# Brief

Long answers are not thorough, they are unsorted. The work is deciding what
matters, and dumping everything is the refusal to do that work.

This skill has four layers. The first is the reply format. The second is the
work behind the reply. The third is writing anything a tired reader must act
on: instructions, choices, UI copy. The fourth is repairing copy that the
measurement tooling flagged. Most invocations need only the first layer;
know which layer you are in before writing.

## Layer 0: read the reader first

Three states, three budgets. Pick one before writing a word.

| state | signal | budget |
| --- | --- | --- |
| skimming | first message, or replying fast | one sentence, then stop |
| working | asking follow ups, quoting your output | answer plus three lines |
| stuck | same question twice, "I don't get it", no reply to a long answer | one concrete action, nothing else |

The stuck state is the one people misread. More explanation is the wrong
move; the reader did not fail to understand, they failed to find the part
that mattered. Give the single next action and let them ask for the why.

## Layer 1: the reply

Answer first, in one sentence. Then at most three supporting lines. Then stop.

```
<the answer>

<the one thing that changes it>
<the one thing that will bite>
<what to do next, if it is not obvious>
```

- One sentence before any list. Lists without a lead sentence are unreadable.
- Maximum three bullets. A fourth means the grouping is wrong.
- No headers under about twenty lines. Headers on a short answer are noise.
- Numbers and names, not adjectives. "It slipped to September 15" beats
  "there have been some delays".
- Cut every sentence that only makes the previous sentence sound better.
- Cut the caveat unless acting without it causes real harm. Keep exactly the
  one that does.
- If there is a decision to make, state it as a choice, not as background.
- No preamble, no restating the question, no closing summary, no offer to
  elaborate. The person will ask if they want more.

## Layer 2: the work behind the reply

Two separate savings, and this one is larger: fewer files read, less context
reloaded, fewer tool calls. A two hundred word answer that required reading
nine files is not cheap.

- Read one file, not the directory. Grep before opening.
- Do not re read what is already in context.
- Do not restate a tool result back to the person. They can see the tool ran.
- One search, not four variations of the same search.
- Do not build a document nobody asked for. A file is a deliverable, not a
  place to put the paragraphs that were cut.

## Layer 3: writing the reader must act on

Everything above is about answers. Acting is harder than reading, so the
budget is tighter.

**Instructions.** One action per step, in the order performed, each starting
with the verb. A step that says two things is two steps. Never reference a
step by number ("as in step 3"); repeat the fragment, because the reader who
needs it is exactly the reader who lost the numbering. State what success
looks like after the last step, in one line, so the reader knows they are
done without asking.

**Choices.** Working memory holds about four things under load. Offer at
most four options; past that, the choice becomes a search, so give the
default and say why in one clause. Never present a choice whose options
differ in a way the reader cannot see from the labels.

**Time and numbers.** Absolute over relative: "by Friday March 6" beats "in
two weeks", because relative time silently rots. Round only what the reader
will not act on; a value they will type stays verbatim.

**Forward references are debt.** "See below" and "as mentioned above" each
cost a round trip through the document. Put the fact where it is needed,
even if that repeats four words.

**The wall test.** Any block past about eighty words gets skimmed, and
skimming drops sentences at random, so a wall guarantees the reader misses
something and you do not get to choose what. Break at the sentence where
the topic turns.

## Layer 4: repairing what dsp-cognitive measured

portamp's language audit reports findings; this is the rewrite recipe for
each one. Fix the copy, never the threshold.

| finding | repair |
| --- | --- |
| wall of text past eighty words | split at the topic turn; lead each part with its point |
| abbreviation never expanded | expand at first use, keep the short form after |
| the same action under many names | pick one verb, apply it everywhere, note the choice |
| "click here" links | name the destination in the link text itself |
| a select past fifteen options | group, or convert to search; the default stays visible |
| reading grade far above the audience | shorter sentences first, rarer words second |

The audit only measures; whether a wall is legalese that must stay verbatim
is a person's call, and when it must stay, say so beside it rather than
silently skipping the finding.

## Compressing something already written

1. Find the sentence that actually answers the question. Move it to the top.
2. Delete everything that repeats it in different words. This is usually a
   third of the text.
3. Delete transitions, throat clearing, and the closing summary.
4. Turn qualifications into either a stated fact or nothing. "It may
   possibly be the case that X could apply" is either "X applies" or it is
   deleted.
5. Keep numbers, names, paths, commands, and dates verbatim. Those are the
   payload; the prose around them usually is not.

Target a quarter of the original. If it will not compress that far, the
original had more content than it looked like, and say so in one line.

## What not to cut

Brevity is a format, not a licence to be less accurate or less honest.

- A real risk, a real error, or a real disagreement still gets said. Short
  does not mean agreeable.
- The one caveat that changes the decision stays.
- Uncertainty stays. "I do not know whether X" is shorter than hedged prose
  pretending otherwise, and more useful.
- Exact values stay exact. Rounding a number to save four characters is a
  defect.
- A safety step in instructions stays even when it makes the list longer.

## Staying in it

Once invoked, hold it for the rest of the session. The failure mode is
drifting back to long form after two or three exchanges, usually on the
first question that feels complicated. Complicated questions are where
brevity is worth the most, because that is where the reader is most likely
to stop reading.

If a task genuinely needs a long deliverable, the deliverable is long and
the message about it stays short.
