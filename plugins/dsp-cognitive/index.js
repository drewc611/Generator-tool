import { readFile } from "node:fs/promises";
import { buildIr, DIALECTS } from "../dsp-ir/ir.js";

/**
 * The cognitive accessibility audit.
 *
 * Contrast and tap targets are measurable and dsp-a11y measures them. The
 * harder half of accessibility is cognitive: copy that takes three reads,
 * buttons that are only an icon, sessions that expire mid thought, and motion
 * that cannot be stopped. Those decisions punish people with ADHD, dyslexia
 * and anybody having a bad day, hardest and quietest.
 *
 * Everything here is measured off what the run already holds: the catalogued
 * copy, the IR, the stylesheets and the source. A judgment call, like whether
 * a sentence is friendly, is out of scope on purpose; a sentence of 40 words
 * is not a judgment call.
 */

/** A rough syllable count, good enough to rank sentences, not to grade essays. */
export function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  const groups = w.replace(/e$/, "").match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch Kincaid grade, over one string of copy. */
export function grade(text) {
  const sentences = String(text).split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  const words = String(text).split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
  if (!sentences.length || !words.length) return null;
  const syllableCount = words.reduce((a, w) => a + syllables(w), 0);
  return Math.round((0.39 * (words.length / sentences.length) + 11.8 * (syllableCount / words.length) - 15.59) * 10) / 10;
}

export function auditCopy(entries) {
  const findings = [];
  for (const entry of entries ?? []) {
    const text = entry.value;
    const g = grade(text);
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words >= 8 && g !== null && g > 12) {
      findings.push({ kind: "hard-copy", severity: "medium", where: entry.key, evidence: `reads at grade ${g}: "${text.slice(0, 70)}${text.length > 70 ? "…" : ""}"` });
    }
    if (words > 25) {
      findings.push({ kind: "long-sentence", severity: "low", where: entry.key, evidence: `${words} words in one go` });
    }
    if (text.length > 3 && text === text.toUpperCase() && /[A-Z]{3}/.test(text)) {
      findings.push({ kind: "all-caps", severity: "low", where: entry.key, evidence: `"${text.slice(0, 40)}" is set in capitals, which is measurably slower to read` });
    }
  }
  return findings;
}

// Link text that names nothing. Each one is a fact: the words are these,
// and they say where the link goes to nobody.
const VAGUE_LINKS = new Set([
  "click here", "here", "more", "read more", "learn more", "see more",
  "this link", "link", "go", "details", "more info", "info", "click",
]);

/** The visible text of a node's direct and nested text children. */
function textOfNode(node) {
  if (!node) return "";
  if (node.kind === "text") return (node.parts ?? []).map((p) => p.literal ?? "").join("");
  return (node.children ?? []).map(textOfNode).join("");
}

export function auditIr(ir, selector) {
  const findings = [];
  const actions = [];
  const walk = (node) => {
    if (!node) return;
    if (node.kind === "element") {
      const tag = String(node.tag ?? "").toLowerCase();
      if (tag === "a") {
        const text = textOfNode(node).replace(/\s+/g, " ").trim().toLowerCase();
        if (VAGUE_LINKS.has(text)) {
          findings.push({ kind: "vague-link", severity: "medium", where: `<${selector}>`, evidence: `a link reading "${text}". Out of context, and a screen reader lists links out of context, it points nowhere.` });
        }
      }
      if (tag === "select") {
        const options = (node.children ?? []).filter((c) => c.kind === "element" && String(c.tag).toLowerCase() === "option").length;
        if (options > 15) {
          findings.push({ kind: "long-list", severity: "low", where: `<${selector}>`, evidence: `a select with ${options} options is a scan of ${options} lines held in working memory; grouping or search costs less.` });
        }
      }
      if (tag === "button" || ((node.attrs ?? []).some((a) => a.name.toLowerCase() === "type" && /submit/i.test(a.value ?? "")))) {
        const label = tag === "button"
          ? textOfNode(node).replace(/\s+/g, " ").trim()
          : (node.attrs ?? []).find((a) => a.name.toLowerCase() === "value")?.value ?? "";
        if (label) actions.push(label);
      }
      if (tag === "button" || (tag === "a" && node.events.length)) {
        const hasText = (node.children ?? []).some((c) => c.kind === "text" && c.parts.some((p) => (p.literal ?? "").trim() || p.expression !== undefined));
        const labelled = (node.attrs ?? []).some((a) => /^(aria-label|title|aria-labelledby)$/i.test(a.name));
        if (!hasText && !labelled) {
          findings.push({ kind: "icon-only-control", severity: "high", where: `<${selector}>`, evidence: `a <${tag}> with no text and no label. Whatever the icon means, it means it only to people who already know.` });
        }
      }
      if (tag === "marquee" || tag === "blink") {
        findings.push({ kind: "unstoppable-motion", severity: "high", where: `<${selector}>`, evidence: `a <${tag}> element. It moves forever and offers no way to stop.` });
      }
      if ((node.attrs ?? []).some((a) => a.name.toLowerCase() === "autoplay")) {
        findings.push({ kind: "autoplay", severity: "medium", where: `<${selector}>`, evidence: "media that starts by itself" });
      }
      node.children.forEach(walk);
    } else if (node.children) node.children.forEach(walk);
  };
  walk(ir.root);
  findings.actions = actions;
  return findings;
}

/**
 * The copy, read for the shapes that tax attention: a wall of text, an
 * abbreviation nobody expanded, the same action wearing different names.
 * Each finding is a count or a list, never an opinion about tone.
 */
export function auditLanguage(entries, actionsByScreen = new Map()) {
  const findings = [];
  const abbrs = new Map();
  for (const entry of entries ?? []) {
    const text = String(entry.value ?? "");
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words > 80) {
      findings.push({ kind: "wall-of-text", severity: "medium", where: entry.key, evidence: `${words} words in one block. A block this long is a commitment, and skimming it drops exactly the sentence that mattered.` });
    }
    for (const m of text.matchAll(/\b[A-Z]{3,}\b/g)) {
      // An expansion beside the letters, either way round, counts as explained.
      const near = text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60);
      const explained = new RegExp(`\\(\\s*${m[0]}\\s*\\)|${m[0]}\\s*\\(`).test(near);
      if (!explained) abbrs.set(m[0], (abbrs.get(m[0]) ?? 0) + 1);
    }
  }
  for (const [abbr, count] of [...abbrs.entries()].sort((a, b) => b[1] - a[1])) {
    if (count >= 3) {
      findings.push({ kind: "unexplained-abbreviation", severity: "low", where: "the copy", evidence: `${abbr} appears ${count} time(s) and is never expanded. Whoever knows it saves a second; whoever does not is stuck.` });
    }
  }
  // The same kind of action under different names is a vocabulary the person
  // has to learn per screen. Reported when the names genuinely differ.
  const submitLabels = new Map();
  for (const [screen, labels] of actionsByScreen) {
    for (const label of labels) {
      const key = label.toLowerCase();
      if (!submitLabels.has(key)) submitLabels.set(key, { label, on: [] });
      submitLabels.get(key).on.push(screen);
    }
  }
  if (submitLabels.size >= 3) {
    const names = [...submitLabels.values()].map((x) => `"${x.label}"`).join(", ");
    findings.push({ kind: "inconsistent-actions", severity: "low", where: "across screens", evidence: `the primary actions wear ${submitLabels.size} different names: ${names}. Each new name is a small relearning.` });
  }
  return findings;
}

/** The whole run's copy as two numbers: how much and how hard. */
export function summarizeCopy(entries) {
  const texts = (entries ?? []).map((e) => String(e.value ?? ""));
  const words = texts.reduce((a, t) => a + t.split(/\s+/).filter(Boolean).length, 0);
  const grades = texts.map((t) => grade(t)).filter((g) => g !== null).sort((a, b) => a - b);
  const median = grades.length ? grades[Math.floor(grades.length / 2)] : null;
  return { words, strings: texts.length, medianGrade: median };
}

export function auditSource(text, rel) {
  const findings = [];
  for (const m of text.matchAll(/set(?:Timeout|Interval)\s*\(([\s\S]{0,200}?),\s*(\d{4,})\s*\)/g)) {
    if (/logout|log_out|signout|expire|session|idle|redirect/i.test(m[1])) {
      findings.push({ kind: "session-timer", severity: "high", where: rel, evidence: `a timer of ${Math.round(Number(m[2]) / 1000)}s appears to end the session. WCAG 2.2.1 wants that adjustable, and losing work to a timer costs the most from whoever needed the most time.` });
    }
  }
  if (/<meta[^>]+http-equiv=["']?refresh/i.test(text)) {
    findings.push({ kind: "meta-refresh", severity: "high", where: rel, evidence: "the page reloads itself on a timer" });
  }
  for (const m of text.matchAll(/animation[^;{]*\binfinite\b/g)) {
    findings.push({ kind: "infinite-animation", severity: "medium", where: rel, evidence: `\`${m[0].trim().slice(0, 60)}\` runs forever; WCAG 2.2.2 wants a way to pause anything that moves longer than five seconds` });
  }
  return findings;
}

export default {
  name: "dsp-cognitive",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const findings = [];
      const actionsByScreen = new Map();
      for (const screen of ctx.screens.filter((s) => s.template)) {
        const ir = screen.ir ?? buildIr(screen.template, { dialect: DIALECTS[screen.dialect] });
        const found = auditIr(ir, screen.selector);
        findings.push(...found);
        if (found.actions?.length) actionsByScreen.set(screen.selector, found.actions);
      }
      for (const file of ctx.sources.files.filter((f) => /\.(html?|js|ts|css|scss)$/.test(f.rel) && !/\.min\./.test(f.rel))) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (text) findings.push(...auditSource(text, file.rel));
      }
      ctx.cognitive = findings;
      ctx.cognitiveActions = actionsByScreen;
    });

    // The copy audits run at emit on purpose: the catalogue they read is
    // assembled by another plan stage plugin, and plan order inside a stage
    // is alphabetical, which is nobody's contract. At emit the catalogue is
    // complete whatever the order.
    on("emit", async (ctx) => {
      const findings = [
        ...(ctx.cognitive ?? []),
        ...auditCopy(ctx.i18n),
        ...auditLanguage(ctx.i18n, ctx.cognitiveActions ?? new Map()),
      ];
      if (!findings.length) return log.debug("nothing measured worth raising");
      ctx.cognitive = findings;
      const high = findings.filter((f) => f.severity === "high").length;
      log.info(`${findings.length} finding(s), ${high} of them serious`);
      await ctx.write("COGNITIVE.md", render(findings, summarizeCopy(ctx.i18n)));
    });
  },
};

const EXPLAIN = {
  "hard-copy": "Copy this dense takes several reads. Someone whose attention is expensive pays the most for it.",
  "long-sentence": "A long sentence in an interface is a queue people have to hold in their head.",
  "all-caps": "Words set in capitals lose their shape and read measurably slower.",
  "icon-only-control": "An icon with no name is a memory test in a place people came to get something done.",
  "unstoppable-motion": "Motion that cannot be stopped competes with everything else on the page and always wins.",
  "autoplay": "Media that starts itself takes the one resource the page does not own: attention.",
  "session-timer": "A session that expires mid thought converts a pause into lost work.",
  "meta-refresh": "A page that reloads itself discards whatever the person was in the middle of.",
  "infinite-animation": "An animation with no end and no pause is the strongest signal on the screen, forever.",
  "vague-link": "Link text is navigation for a screen reader and a scanning eye alike; words that name no destination make both start over.",
  "long-list": "A list longer than working memory turns choosing into searching.",
  "wall-of-text": "A block nobody can hold in one pass gets skimmed, and skimming drops sentences at random.",
  "unexplained-abbreviation": "Letters that stand for something stand for nothing to whoever meets them first.",
  "inconsistent-actions": "When the same action changes its name per screen, every screen starts with a small translation.",
};

function render(findings, summary = null) {
  const bySeverity = { high: [], medium: [], low: [] };
  for (const f of findings) bySeverity[f.severity].push(f);

  const section = (title, items) => items.length
    ? `\n## ${title}\n\n${items.map((f) => `- **${f.kind}** at ${f.where}: ${f.evidence}\n  <sub>${EXPLAIN[f.kind]}</sub>`).join("\n")}\n`
    : "";

  return `# The cognitive audit

Contrast is not the hard half of accessibility. These are the measured things
that cost attention: dense copy, controls that are only an icon, timers that
end a session mid thought, motion with no off switch. They punish people with
ADHD or dyslexia hardest, and everyone somewhat.

Everything below was measured, not judged: a reading grade, a missing label,
a timer's length. What is friendly is a judgment; what takes three reads is a
number.
${summary && summary.strings ? `
The copy, measured: ${summary.strings} string(s), ${summary.words} word(s), median reading grade ${summary.medianGrade ?? "n/a"}. The grade is Flesch Kincaid over interface copy, which it was not designed for; treat it as a ranking, not a verdict.
` : ""}${section("Serious", bySeverity.high)}${section("Worth fixing in the port", bySeverity.medium)}${section("Small, and cheap to fix while you are in there", bySeverity.low)}
---

A state this audit never saw is not certified. It read the catalogued copy,
the templates, and the source it was given, and nothing else.
`;
}
