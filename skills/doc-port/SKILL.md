---
name: doc-port
description: Carry technical documents shipped as PDF (data sheets, manuals, spec documents) into a ported site as routed React pages without inventing a word, using portamp's input-pdf reader. Use when someone says "our docs are PDFs", "port the data sheets too", "make the manual a web page", "extract this PDF", or a source tree turns out to contain .pdf files beside the pages. Covers what the reader proves versus skips, the scanned and encrypted cases, when to trust the reading versus the original, and how the document of record rule keeps the port honest.
---

# Doc port

A data sheet shipped as PDF is legacy front end: somebody's words, laid out
once, that a port has to carry without inventing any. The reader extracts
what the file proves; this playbook is knowing what that covers, what it
cannot, and what to do at the edges.

## What one run gives you

Drop the PDFs beside the pages and run with `--site true`. Each document
becomes a routed React page: headings from the font sizes the document
actually set, a table of contents when there are two or more, paragraphs
gathered by the gaps, the link annotations listed as spelled, and the old
`.pdf` address answering with a real 301. The original file is copied in
byte for byte and linked from the page, because the PDF, not the reading of
it, stays the document of record. `DOCS.md` reports what was read, what the
document declared about itself, and what was skipped.

## What the reader proves, and what it skips

Proves: text with measured positions and sizes, Flate compressed content,
ToUnicode and WinAnsi decoding, URI link annotations, the outline, the
document's own title and producer.

Skips, and says so in the run: exotic stream filters, glyphs with no text
mapping (counted, never replaced with lookalikes), and everything inside an
encrypted file, which is refused by name.

## The cases that need a person

**A scanned document.** Scans carry images of text and no text operators,
so the reading comes back empty while the file is plainly full. The reader
does not guess with OCR because OCR output is exactly the wrong kind of
plausible. The honest port is the original linked prominently plus whatever
title the metadata proves; if the words must be on the page, a person runs
OCR outside the tool and owns its errors.

**An encrypted document.** The run notes it and reads nothing. Get a
decrypted copy from whoever owns the document; guessing at a password is
not a thing this tool does, and stripping protection you do not own is not
a thing you do either.

**A glyph gap.** A count of unmapped glyphs in the notes means the emitted
page is missing characters, usually from a decorative or subsetted font.
Compare the page against the original before shipping; if the gap lands in
a value somebody will act on (a part number, a voltage), the page must say
"see the original document" at that spot rather than showing a hole.

**A route collision.** `spec.pdf` beside `spec.html` cannot share a route;
the document steps aside to `/spec-pdf` and the run says so. Decide which
one deserves the clean address, and add a redirect if it is the document.

## When to trust the reading

The reading is for navigation, search, and skimming; the original is for
acting. A ported page makes the document findable by the site's own search
engine and readable on a phone, which the PDF never was. But the reader
reconstructs reading order from positions, and a document with a layout it
has never seen can order two columns wrong without knowing. So:

- Numbers people will type or wire from: verify against the original, or
  keep the instruction to consult it.
- Tables: the reader carries positioned text in reading order, not table
  structure. A dense spec table is better served by the original plus a
  one line summary than by a flattened paragraph.
- Legal text: verbatim matters; link the original section rather than
  excerpting.

## Verifying a doc port

1. `DOCS.md` first: page counts, heading counts, link counts, and every
   skip. A document with problems listed is not ready to ship silently.
2. Open each ported page beside the original at the same heading and read
   one paragraph of both. One paragraph catches decoding trouble; zero
   paragraphs catches nothing.
3. Click the original document link on every page; a port that lost its
   originals has lost its evidence.
4. Search the site for a term that only the document uses; the search
   engine finding it proves the words made it into the index.
