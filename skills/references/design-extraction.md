# Design extraction from screenshots

The goal is a system you can extend, not a copy of one screen. Measure, infer
the rule, then rebuild from the rule.

## Measure these six things, in this order

**1. Density.** Look at the vertical rhythm of a table row and a form field.
Row height under 40px means compact, an operational screen someone lives in.
Over 56px means airy. Pick one and hold it everywhere. Undecided density is
the most visible symptom of a port done screen by screen.

**2. Type scale.** Collect every distinct text size in the screenshots. You
will usually find five to nine, because the old app drifted. Cluster them and
fit a ratio, normally 1.2 or 1.25 for dense interfaces. Round to a clean scale,
for example 12 / 13 / 15 / 20 / 30, and map every legacy size onto it. Note in
`PORT_NOTES.md` which sizes you collapsed.

Count weights too. Two weights do nearly everything. If the old app used four,
pick two and use size for the rest of the hierarchy.

**3. Spacing.** Measure gaps between cards, inside cards, between a label and
its input, and around the page. Fit them to a 4px base with steps at 4, 8, 12,
16, 24, 32, 48. When a measurement lands on 14, the answer is 12 or 16, and
choosing which is the actual design work.

**4. Color roles, not color values.** Do not build a palette of every hex in
the screenshot. Identify roles: page background, surface, sunken, hairline,
strong border, primary text, muted text, faint text, one accent, and semantic
colors only if the product genuinely uses them. Then pick one value per role.

The accent marks the primary action and nothing else. If the old app used its
brand color on six unrelated things, that is drift, not a system. Fix it and
note the deviation.

Check the neutrals for temperature. A warm gray ramp and a cool one read very
differently, and matching the wrong one is the most common reason a port feels
subtly off while every measurement checks out.

**5. Radius and elevation.** Usually one radius for controls and a slightly
larger one for cards. Shadows in older apps tend to be hard and dark; a
faithful port keeps the geometry but softens the shadow, since a hard offset
shadow reads as dated even when it matches.

**6. Data formatting.** Currency symbol placement, thousands separators,
decimal places, date format, how a null renders, whether negative numbers use
a minus or parentheses. These are part of the look and are the details users
catch first, because they read the numbers.

## What not to carry over

Copy the system, not the accidents. Leave behind: inconsistent spacing between
otherwise identical screens, three shades of gray doing the same job, a button
that is a different height on one page, and any color contrast that fails
against its background. Record each one in `PORT_NOTES.md` as a deliberate
deviation so nobody files it as a regression.

## Output format

Write a tokens file before any component, and show it to the user for approval:

```ts
export const tokens = {
  density: "compact",
  font: { sans: "...", mono: "..." },
  size: { xs: 12, sm: 13, md: 15, lg: 20, xl: 30 },
  weight: { regular: 400, bold: 600 },
  space: [4, 8, 12, 16, 24, 32, 48],
  color: {
    bg: "#...", surface: "#...", sunken: "#...",
    line: "#...", lineStrong: "#...",
    ink: "#...", inkMuted: "#...", inkFaint: "#...",
    accent: "#...", danger: "#...", warn: "#...", ok: "#...",
  },
  radius: { control: 6, card: 10 },
  shadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.05)",
};
```

Every value in the built components comes from this object. A hardcoded hex or
a magic pixel value in a component is a defect, because it is the thing that
will not be found when the system changes.

## Verification

Screenshot the React build at the same widths as the source screenshots, place
them side by side, and check in this order: density, type hierarchy, alignment
of the left edges, color roles, then details. Differences in that order matter
in that order. A perfect accent color on a screen with the wrong density still
looks wrong.
