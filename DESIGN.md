# The Preprint — Final Design Specification
**Site:** `/home/drapandiger/Project/Blog/index.html` (single static file, Tailwind CDN) · **Owner:** Zeqi Li · 李泽其 · Robotics & AI researcher · **Version:** FINAL — implement literally.

---

## 1. Identity & Principles

- **Editorial-academic.** The page reads like a beautifully typeset journal / university-press page: warm paper ground, serif display type, hairline rules, mono metadata, one oxblood-brick accent. Zero decorative technology.
- **Signal-first for PIs.** Within 5 seconds a professor sees: name, affiliation (TUM → IIT), the green "Open to Ph.D. positions — Fall 2026" badge, publications with venue tags, and a CV button. Everything else is secondary.
- **Typography is the design.** Hierarchy comes from the three-role type system (Source Serif 4 display / Inter UI / IBM Plex Mono metadata) and hairline rules — never from cards-with-glow, gradients, or motion.
- **Three signature moves, all mandatory:** (a) numbered mono kickers on every section (`01 — RESEARCH`), (b) the static 3.5rem accent underline swash beneath the hero name, (c) the full-bleed tonal band on the Contact section. Omit none.
- **Total gimmick removal.** Particles, aurora, spotlight, custom cursor, typewriter, liquid text, glow shadows, pulse animations, scale hovers, gradient headings, custom scrollbar — all deleted with their JS/CSS. Permitted motion: color/border/underline/shadow transitions at 150ms, ≤2px translateY, one restrained one-time reveal, one 250ms expand.

---

## 2. Design Tokens

Place this literal block in the single custom `<style>` element, **after** the Tailwind CDN `<script>`:

```css
:root {
  /* --- Color: light (default) --- */
  --bg: #FBFAF7;              /* page paper */
  --bg-subtle: #F4F1EA;       /* code bg, contact band, thumbnails placeholder, tag bg */
  --surface: #FFFFFF;         /* cards, mobile nav bar */
  --ink: #1F1D1A;             /* headings, primary text */
  --ink-secondary: #44403A;   /* body text */
  --muted: #78716C;           /* dates, captions, meta */
  --faint: #A8A29B;           /* placeholder / tertiary text */
  --border: #E7E2D8;          /* hairlines, card borders */
  --border-strong: #D6CFC2;   /* hover borders, table header rules */
  --accent: #9A3B26;          /* oxblood brick: links, active nav, primary buttons, kicker words */
  --accent-hover: #7C2D1B;
  --accent-soft: #F5E9E4;     /* AI-explain box bg, active lang pill */
  --accent-on: #FFFFFF;       /* text on solid accent */
  --status: #3F6C51;          /* deep green — "Seeking Ph.D." badge ONLY */
  --status-soft: #E9F0EB;
  --warn: #8A6D1F;            /* IN PREPARATION / COMING SOON label text */
  --warn-soft: #F6EFDC;
  --selection-bg: #EBD9D2;
  --focus-ring: #9A3B26;

  /* --- Radii --- */
  --r-sm: 4px;                /* tags, chips, lang pills */
  --r-md: 8px;                /* buttons, thumbnails, code blocks */
  --r-lg: 12px;               /* cards, figures, profile photo */
  --r-full: 999px;            /* status badge only */

  /* --- Shadows (warm-tinted; NEVER colored glow) --- */
  --shadow-sm: 0 1px 2px rgba(31,29,26,0.05);
  --shadow-md: 0 2px 8px rgba(31,29,26,0.06), 0 1px 2px rgba(31,29,26,0.04);
  --shadow-lg: 0 8px 24px rgba(31,29,26,0.09), 0 2px 6px rgba(31,29,26,0.05);

  /* --- Type families --- */
  --font-serif: 'Source Serif 4', Georgia, 'Songti SC', 'STSong', 'SimSun', serif;
  --font-sans: 'Inter', system-ui, -apple-system, 'Segoe UI', 'PingFang SC',
               'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  /* --- Motion --- */
  --ease: cubic-bezier(0.25, 0.1, 0.25, 1);
  --t-fast: 150ms;   /* hovers */
  --t-med: 300ms;    /* reveals */
}

html.dark {
  --bg: #171512;
  --bg-subtle: #211E1A;
  --surface: #1E1B17;
  --ink: #EDE9E1;
  --ink-secondary: #C9C3B8;
  --muted: #948D82;
  --faint: #6B655C;
  --border: #322E28;
  --border-strong: #453F37;
  --accent: #D98E75;          /* lightened brick — never use #9A3B26 on dark */
  --accent-hover: #E5A992;
  --accent-soft: #33241E;
  --accent-on: #1F1D1A;
  --status: #8AB99A;
  --status-soft: #22302A;
  --warn: #CDB068;
  --warn-soft: #2E2817;
  --selection-bg: #4A2E24;
  --focus-ring: #D98E75;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.4);
  --shadow-md: 0 2px 8px rgba(0,0,0,0.45), 0 1px 2px rgba(0,0,0,0.3);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.5);
}
```

**Global usage rules (also in the style block):**

```css
body { background: var(--bg); color: var(--ink-secondary); font-family: var(--font-sans); }
h1,h2,h3,h4 { color: var(--ink); }
::selection { background: var(--selection-bg); }
:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
/* Running-text links */
.prose-link, main p a {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent);
  transition: color var(--t-fast) var(--ease), text-decoration-color var(--t-fast) var(--ease);
}
main p a:hover { color: var(--accent-hover); text-decoration-color: currentColor; }
```

- Scrollbar: **native** — delete all `::-webkit-scrollbar` rules.
- **No raw Tailwind palette classes may survive** (`slate-*`, `violet-*`, `amber-*`, `primary-*`): every color flows through `var(--*)` via the Tailwind config mapping (§8) or arbitrary values like `text-[var(--muted)]`.
- `<head>` gets: `<meta name="theme-color" content="#FBFAF7" media="(prefers-color-scheme: light)">` and `<meta name="theme-color" content="#171512" media="(prefers-color-scheme: dark)">`.

---

## 3. Typography

**Google Fonts — one request, exact weights only, `display=swap`:**

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
```

Do not add weights during implementation. Never use weight above 700 anywhere (CJK fallback bold parity).

**Roles:**
- **Source Serif 4** (400, 400i, 600, 700) — wordmark, all headings h1–h4, publication/blog/card titles, hero standfirst, contact paragraph, article body text, blockquotes.
- **Inter** (400, 500, 600) — nav links, buttons, homepage body/descriptions, timeline body, captions, footer, all UI chrome.
- **IBM Plex Mono** (400, 500) — kickers, dates, venue tags, blog tags, section-header count annotations, code. Mono elements get `font-variant-numeric: tabular-nums`.

**Chinese handling (mandatory overrides):**

```css
html[lang="zh-CN"] h1, html[lang="zh-CN"] h2,
html[lang="zh-CN"] h3, html[lang="zh-CN"] h4 {
  font-family: var(--font-sans); font-weight: 600;
}
/* Kill tracking on any uppercase/tracked element in zh — CJK has no case and tracking breaks it */
html[lang="zh-CN"] .kicker, html[lang="zh-CN"] .meta-mono,
html[lang="zh-CN"] [class*="tracking-"] { letter-spacing: normal !important; }
```

The language-switch JS must set `document.documentElement.lang` to `zh-CN` / `en` / `de` on every switch (it currently only swaps strings — add this).

**Homepage type scale:**

| Element | Spec |
|---|---|
| Hero name (h1) | Source Serif 4 600, `clamp(2.75rem, 6vw, 4.25rem)`, lh 1.05, ls −0.015em, `var(--ink)` |
| Hero standfirst | Source Serif 4 400, 1.25rem/1.6 (md: 1.375rem), `var(--ink-secondary)` |
| Section h2 | Serif 600, `clamp(1.75rem, 3vw, 2.25rem)`, lh 1.15, ls −0.01em |
| Entry/card title (h3) | Serif 600, 1.25rem (research) / 1.125rem (blog, journey columns), lh 1.3 |
| Kicker | IBM Plex Mono 500, 0.75rem, uppercase, ls 0.08em |
| Body | Inter 400, 1rem/1.65, `var(--ink-secondary)` |
| Meta / dates | IBM Plex Mono 400, 0.8125rem, `var(--muted)`, tabular-nums |
| Small / captions / footer | Inter 400, 0.8125rem, `var(--muted)` |
| Tags | IBM Plex Mono 400, 0.6875rem |

---

## 4. Page Architecture

**Delete the fixed left sidebar entirely.** Replace with:

### Desktop header (md+)
Sticky top, height 64px, `z-50`, background `color-mix(in srgb, var(--bg) 92%, transparent)`, `backdrop-filter: blur(8px)` (the **only** blur on the site), `border-bottom: 1px solid var(--border)`. Inner container = content max-width.

- **Left:** wordmark "Zeqi Li" — Source Serif 4 600, 1.125rem, `var(--ink)`, links `#home`; beside it, mono 0.75rem `var(--muted)`: "李泽其". When lang=zh the two swap (wordmark 李泽其, mono "Zeqi Li").
- **Right, in order:** text links Research / Journey / Blog / Contact (Inter 500, 0.875rem, `var(--ink-secondary)`, gap 2rem) → 1px×16px vertical divider `var(--border)` → lang switcher → theme toggle (lucide sun/moon 18px, `var(--muted)`, hover `var(--accent)`) → "CV" outline button (border 1px `var(--border-strong)`, radius `var(--r-md)`, padding 6px 14px, Inter 500 0.875rem; hover: border & text `var(--accent)`), links `CV.pdf` target `_blank`.

**Scroll-spy:** keep the existing IntersectionObserver logic (rootMargin −30%/−70% + bottom-of-page `#contact` fix), restyled: active link = `var(--accent)` + 2px underline (`text-underline-offset: 6px`, `text-decoration-thickness: 2px`). Non-active hover: color `var(--ink)` only. **Remove the homepage scroll-progress bar** (kept on article pages only).

### Lang switcher (both breakpoints)
Three text buttons `EN / 中 / DE`, Inter 500 0.8125rem, padding 4px 8px, radius `var(--r-sm)`. Inactive: `var(--muted)`, hover `var(--ink)`, **no scale transform**. Active: bg `var(--accent-soft)`, color `var(--accent)`. Keep the existing `data-lang` wiring and localStorage persistence unchanged.

### Mobile (< md)
- **Top bar**, 56px, same sticky/blur/border treatment: wordmark left; lang switcher (compact) + theme toggle right.
- **Bottom tab bar — KEPT and restyled** (decision: preserves working scroll-spy JS and muscle memory; no hamburger). Fixed bottom, height 60px + `env(safe-area-inset-bottom)` padding, background `var(--surface)` **opaque** (no blur), `border-top: 1px solid var(--border)`, `box-shadow: var(--shadow-lg)` pointing up is NOT used — use `var(--shadow-sm)` inverted or none; spec: no shadow, hairline only. Five items (same ids/hrefs `#home #research #journey #blog #contact`): lucide icon 20px stroke 1.75 over Inter 500 10px label, color `var(--faint)`. Active (scroll-spy): icon + label `var(--accent)` plus a 2px `var(--accent)` bar across the top edge of the active tab. Every page below md gets `padding-bottom: 5.5rem` on `<main>`/footer so the bar never covers content.
- **Skip link:** first element in `<body>` — visually-hidden "Skip to content" anchor to `#home`, revealed on focus (bg `var(--accent)`, text `var(--accent-on)`, padding 8px 16px, top-left fixed).

### Content column & rhythm
- `<main>`: `max-w-6xl` (72rem) `mx-auto`, `padding-inline: 1.5rem` (md: 2.5rem). Prose passages (standfirst, contact note) capped at **42rem** measure.
- Sections: `padding-block: 5rem` (md: 7rem). Only the hero uses `min-height: calc(100svh - 64px)` with vertically centered content. All sections keep `scroll-mt-16` (mobile: account for 56px header).
- Between sections: a full-container-width `<hr>` — 1px `var(--border)`, no margin tricks. This is the page's spine.
- **Section header lockup (identical for every h2):** row 1 = flex between: left mono kicker (`01 — RESEARCH`, `02 — JOURNEY`, `03 — WRITING`, `04 — CONTACT`; number + em-dash in `var(--muted)`, word in `var(--accent)`), right = right-aligned mono annotation 0.75rem `var(--muted)` (`2 SELECTED PAPERS`, `8 ENTRIES`, `5 POSTS`, empty for contact). Row 2 = serif h2. Then 2.5rem before content. All lucide icons in h2s are deleted.

---

## 5. Per-Section Spec

### 5.1 Hero (`#home`)
Two-column grid `md:grid-cols-[1fr_auto]`, gap 3rem, items-center. Mobile: single column, **photo first** at 144×144, left-aligned.

Left column, top to bottom:
1. **Kicker:** mono 0.75rem uppercase `var(--muted)`: `ROBOTICS & AI RESEARCHER — TUM · IIT GENOA`.
2. **h1 name** (per scale) — plain `var(--ink)`, no gradient. Below it the **signature swash**: a static 3.5rem-wide, 3px-tall block of `var(--accent)`, margin-top 1rem. No animation.
3. **Status badge** (highest-value element, directly under the name block): inline-flex, radius `var(--r-full)`, bg `var(--status-soft)`, color `var(--status)`, Inter 500 0.8125rem, padding 4px 12px, leading 6px solid dot in `var(--status)` (no pulse). Text i18n'd: EN "Open to Ph.D. positions — Fall 2026" / zh "正在寻找博士机会 — 2026年秋季入学" / de "Offen für Ph.D.-Stellen — Herbst 2026".
4. **Standfirst** (replaces typewriter; new key `hero.standfirst`, delete `hero.typing_words`, `hero.typing_prefix`, `hero.greeting` usage): serif 1.25rem — EN: "Robotics & AI researcher. M.Sc. in Robotics, Cognition, Intelligence at TUM; currently a research assistant at the Italian Institute of Technology, Genoa, working on manipulation, navigation, and language-guided robots." (zh/de equivalents added to `translations`.)
5. **Keyword line** (replaces the five pill chips — delete them and their icons): one mono 0.8125rem `var(--muted)` line: `Robotics · LLM/VLM · ROS 2 · Python/PyTorch · Isaac Sim`.
6. **Button row:** primary "View CV" → `CV.pdf`: bg `var(--accent)`, color `var(--accent-on)`, Inter 600 0.9375rem, padding 12px 24px, radius `var(--r-md)`, lucide `file-text` 18px; hover bg `var(--accent-hover)` + `var(--shadow-sm)`, `var(--t-fast)`. Secondary "Email me" → `mailto:drapandiger@gmail.com`: transparent, border 1px `var(--border-strong)`, color `var(--ink)`; hover border+text `var(--accent)`. No icon bounce.
7. **Social row:** GitHub (`https://github.com/Drapandiger`), LinkedIn (`https://www.linkedin.com/in/zeqi-li-tum`), Scholar (`https://scholar.google.com/citations?hl=en&user=IiApesIAAAAJ`), Email — keep existing inline SVGs / lucide, 20px, `var(--muted)`, hover `var(--accent)`, color transition only, **no transform**.

Right column: **profile photo** `assets/home/profile.png`, 208×208 (md: 240×240), radius `var(--r-lg)`, border 1px `var(--border)`, `var(--shadow-md)`, object-cover. No ring, no glow, no pulse. Below it the **spec sheet** (graft, mandatory): a definition list, width matching the photo, each row a flex line with 1px `var(--border)` rule between rows; keys mono 0.6875rem uppercase `var(--faint)`, values Inter 400 0.8125rem `var(--ink-secondary)`, padding-block 8px:
```
LOCATION   Genoa, IT · Remote
DEGREE     M.Sc., TUM
NOW        Research Assistant @ IIT
```
On mobile the spec sheet renders directly under the 144px photo at full column width.

**Deleted:** scroll-down chevron, typewriter + cursor CSS, liquid-text, greeting span layout (fold "Hello, I'm" into the standfirst removal — h1 is just the name).

### 5.2 Featured Research (`#research`)
Kicker `01 — RESEARCH` (annotation `2 SELECTED PAPERS`) + h2 "Featured Research".

Entries are **stacked publication rows, not cards**: each row `grid md:grid-cols-[200px_1fr] gap-6`, `padding-block: 2rem`, separated by 1px `var(--border)` hairlines (first row also gets a top hairline). No surface bg, no container radius, no hover lift.

- **Thumbnail:** 200×134 (3:2), radius `var(--r-md)`, border 1px `var(--border)`, object-cover. Replace `placehold.co` URLs with a local `var(--bg-subtle)` div containing the venue acronym ("IROS" / "CBS") set in serif 600 1.5rem `var(--faint)`, centered. Never an external placeholder service. Swap in real teaser figures when available.
- **Text column, top to bottom:**
  1. Meta line: venue tag mono 0.75rem uppercase `var(--accent)` — normalize to `IROS 2025` and `IEEE CBS 2025` — followed by the status chip: **"IN PREPARATION"** — mono 0.6875rem uppercase, color `var(--warn)`, bg `var(--warn-soft)`, border 1px **dashed** `var(--warn)`, radius `var(--r-sm)`, padding 2px 8px. This chip replaces every amber "Under Construction" badge site-wide (same treatment, i18n key `common.in_preparation`: EN "In preparation" / zh "撰写中" / de "In Vorbereitung", rendered uppercase in EN/DE only).
  2. Title h3: serif 600 1.25rem `var(--ink)` — **full contrast; the current `text-slate-500` graying is removed.**
  3. Description: Inter 0.9375rem `var(--ink-secondary)`, max 3 lines.
  4. **Link row** (replaces pill buttons): textual links gap 1rem, Inter 500 0.875rem `var(--accent)` + 16px lucide icon (`globe` Page / `book` arXiv / `file-text` PDF / `video` Video), hover `var(--accent-hover)` + underline. Keep all existing hrefs (arXiv 2509.19261 abs+pdf, YouTube 3DhbUsv4eDo for item1; GODHS page, arXiv 2508.20899 abs+pdf, YouTube iU6U3HwSC9U for item2). Last item: the **AI-Explain toggle** — a `<button>` styled identically, lucide `sparkles` 16px, label i18n `common.ai_explain` re-copied to EN "Explain simply" / zh "通俗解读" / de "Einfach erklärt".
- **AI-Explain box** (keep `data-ai-*` wiring and pre-generated trilingual content): sits below the description. Bg `var(--accent-soft)`, `border-left: 3px solid var(--accent)`, radius `0 var(--r-md) var(--r-md) 0`, padding 1rem 1.25rem. Heading (replaces `common.ai_result_title`, **emoji stripped**): mono 0.75rem uppercase `var(--accent)` — EN "IN PLAIN TERMS" / zh "通俗解读" / de "EINFACH GESAGT". Body: Inter 0.9375rem/1.7 `var(--ink-secondary)`, `white-space: pre-wrap`; strip the 🚗 👀 ✨ from stored titles, keep body text. **Delete** `typeTextEffect` and the fake "Analyzing…" delay: content renders immediately; the box expands via a wrapper `display:grid; grid-template-rows: 0fr → 1fr` transition, 250ms `var(--ease)`, inner `overflow:hidden`, plus opacity 0→1. The button is a toggle: expanded state label becomes "Hide ×" (i18n `common.ai_hide`: EN "Hide" / zh "收起" / de "Ausblenden").
- **"See All Research" link:** mono 0.875rem `var(--accent)` + `arrow-right` 16px; hover: arrow `translateX(2px)` (the one allowed transform).

### 5.3 Academic Journey (`#journey`)
Kicker `02 — JOURNEY` (annotation `8 ENTRIES`) + h2 "Academic Journey". Grid `lg:grid-cols-3 gap-12`; mobile stacks Education → Research → Work with 3rem gaps.

- **Column headers:** lucide icon 18px `var(--muted)` (`graduation-cap` / `flask-conical` / `briefcase`) + h3 serif 600 1.125rem `var(--ink)`, then a 1px `var(--border)` rule, margin-bottom 1.25rem.
- **Timeline items:** `padding-left: 1.5rem`, position relative. Vertical line **1px** `var(--border)` at `left: 3px`; last item's line stops at its dot. Dot: 7px circle, no border, no glow — **background `var(--accent)` ONLY for entries whose date includes "Current"** (the IIT Research Assistant entry); all other dots `var(--border-strong)`. Dot top-aligned to the date line.
- **Item content:** date mono 0.75rem uppercase `var(--muted)` tabular-nums → role/degree **Inter 600 1rem** `var(--ink)` (sans, not serif — scannability) → institution Inter 0.9375rem `var(--ink-secondary)` → detail (GPA/thesis) Inter 0.8125rem `var(--muted)`. Item `padding-bottom: 2rem`.
- No per-item hover effects. Delete all inline `transition-delay` styles.

### 5.4 Blog (`#blog`)
Kicker `03 — WRITING` (annotation `5 POSTS`) + h2 "Thoughts & Notes".

- **Category headers:** lucide 18px `var(--muted)` (`wrench` Project Practice / `telescope` Frontier Exploration) + serif 600 1.125rem `var(--ink)` + a flex-grow 1px `var(--border)` rule filling the row. (Category names get i18n keys — they are currently hard-coded: add `blog.cat.practice` / `blog.cat.frontier`.)
- **Cards** (grid `md:grid-cols-2 lg:grid-cols-3 gap-6`): `<a>` blocks, bg `var(--surface)`, border 1px `var(--border)`, radius `var(--r-lg)`, overflow hidden, `var(--shadow-sm)`. Image height 160px object-cover, **no hover zoom**. Body padding 1.25rem: date mono 0.75rem `var(--muted)` → title serif 600 1.125rem/1.35 `var(--ink)`, 3-line clamp → description Inter 0.875rem `var(--ink-secondary)`, 3-line clamp → tags: mono 0.6875rem `var(--muted)`, bg `var(--bg-subtle)`, border 1px `var(--border)`, radius `var(--r-sm)`, padding 2px 8px.
- **Hover (real posts only):** border `var(--border-strong)`, `var(--shadow-md)`, `translateY(-2px)`, `var(--t-fast) var(--ease)`; title gains accent underline.
- **In-progress items:** the BO card (real page, keep link live) gets the dashed **IN PREPARATION** chip (same as §5.2) pinned top-right, 12px inset — card stays full opacity and clickable. The placeholder 5th card: 60% opacity, `pointer-events: none`, `aria-disabled="true"`; image replaced by a `var(--bg-subtle)` block with a centered lucide `pen-line` 24px `var(--faint)`; chip text "COMING SOON" (`common.coming_soon`: EN "Coming soon" / zh "即将发布" / de "Demnächst"); **delete the lorem ipsum** — one honest line: "Draft in progress — Sim-to-Real transfer notes." (i18n'd via existing `blog.item3.*` keys, rewritten); keep tags Sim-to-Real / RL.

### 5.5 Contact (`#contact`)
The single tonal shift on the page: a **full-bleed band** — the section breaks out of the container (`width:100vw` breakout or wrapper outside `max-w-6xl`) with bg `var(--bg-subtle)`, `border-block: 1px solid var(--border)`, `padding-block: 5rem`; inner content re-constrained and centered.

- Kicker `04 — CONTACT` centered, h2 "Get In Touch" centered.
- **PhD note** (existing `contact.desc` keys): max-width 42rem centered, **Source Serif 4 400, 1.25rem/1.7**, `var(--ink-secondary)`; wrap "Fall 2026" / "2026年秋季" / "Herbst 2026" in a 600-weight `var(--ink)` span (add markup around the phrase; adjust i18n strings to split around it or use innerHTML-safe key).
- **Primary button:** `drapandiger@gmail.com` mailto — bg `var(--accent)`, color `var(--accent-on)`, radius `var(--r-md)`, padding 14px 28px, Inter 600 1rem, lucide `mail` 20px (no pulse); hover `var(--accent-hover)` + `var(--shadow-sm)`. Beside it: quiet link "or download my CV →" (i18n `contact.cv_alt`), 0.9375rem `var(--accent)` underlined, → `CV.pdf`.
- **Social row** below, centered, gap 1.5rem: GitHub / LinkedIn / Scholar, 22px icons `var(--muted)` hover `var(--accent)`.

### 5.6 Footer
Plain: `padding-block: 2.5rem`, no background, no border (the contact band supplies the rule). Centered two lines: line 1 — "© 2026 Zeqi Li · 李泽其" Inter 0.8125rem `var(--muted)` (keep `footer.copyright` key, update strings); line 2 — "Munich / Genoa · Built with plain HTML and Tailwind" Inter 0.75rem `var(--faint)` (`footer.builtWith`). Right-aligned within the container on md+: "Back to top ↑" text link `var(--muted)` hover `var(--accent)` → `#home`. Mobile: extra bottom padding for the tab bar (§4).

---

## 6. Interactions

**Delete — element, CSS, and JS, completely:**

| Old effect | Disposition |
|---|---|
| Neural particle canvas `#neural-canvas` + `initNeuralParticles` + listeners | Deleted, no replacement |
| Aurora blobs `.aurora-container` + keyframes | Deleted, no replacement |
| Mouse spotlight `#spotlight-effect` + mousemove handler | Deleted |
| Custom cursor `.cursor-dot/.cursor-outline`, `custom-cursor-active`, all `cursor-none` classes | Deleted; native cursor |
| Typewriter `#typewriter`, `initTypeWriter`, `.typing-cursor` | Deleted; static standfirst |
| Liquid text `.liquid-text` + keyframes | Deleted; plain ink name + accent swash |
| Glow shadows, `pulse-glow`, `bounce-slow`, `animate-tilt`, hover `scale(*)` everywhere | Deleted |
| Gradient h2s with drop-shadow | Deleted; kicker + serif lockup |
| Custom violet scrollbar | Deleted |
| Homepage scroll-progress bar + its scroll handler | Deleted (kept on article pages) |
| `typeTextEffect` + fake analyze delay in AI-Explain | Deleted; instant render + 250ms grid expand |
| Chevron scroll-down anchor | Deleted |

**Kept, restrained:**
- **Hover budget (exhaustive):** color, border-color, background-color, underline/text-decoration-color, shadow sm→md, ≤2px `translateY` (blog cards, primary buttons −1px), 2px `translateX` on arrow glyphs. All at `var(--t-fast) var(--ease)`. Scale transforms and image zoom are banned.
- **Scroll reveal:** `.reveal` — one-time only: opacity 0 + `translateY(12px)` → visible, 400ms `var(--ease)`. IntersectionObserver **unobserves after firing** (delete the re-hide else-branch). Delete all inline `transition-delay` styles; the only permitted stagger is ≤80ms increments within the two research rows. Guard:
```css
@media (prefers-reduced-motion: reduce) {
  .reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
  html { scroll-behavior: auto; }
}
```
JS also checks `matchMedia('(prefers-reduced-motion: reduce)')` and skips the observer.
- **Smooth scroll:** keep `scroll-smooth` on `<html>` (disabled above under reduced motion).
- **Scroll-spy:** existing IntersectionObserver logic unchanged; only active-state styling changes (§4).
- **Language switch:** instant swap as today, plus setting `documentElement.lang` (§3). LocalStorage behavior unchanged.
- **AI-Explain:** per §5.2 — toggle, instant content, grid-rows expand, no theater.

---

## 7. Article-Page Spec (the 4 posts: dodo, bo, cbf, embodied-ai)

Each article page copies the identical `:root`/`html.dark` token block, Google Fonts link, pre-paint theme script, and Tailwind config.

**Chrome:** same sticky header; wordmark links to `../../../../index.html` (relative as appropriate); nav links point to `index.html#research` etc.; lang + theme toggles identical; no bottom tab bar on article pages. **Reading-progress bar kept**: fixed top, 2px, solid `var(--accent)`, no gradient/glow, `z` above header border.

**Article header:** kicker — category in mono 0.75rem uppercase `var(--accent)` (`PROJECT PRACTICE` / `FRONTIER EXPLORATION`); title Source Serif 4 600 `clamp(2rem, 4.5vw, 3rem)/1.15` `var(--ink)`, max-width 46rem; byline mono 0.8125rem `var(--muted)`: "Zeqi Li · Mar 7, 2024 · 12 min read"; tag chips as on blog cards; then cover image as a full-measure figure.

**Measure & body:** prose column max-width **42rem**, centered, padding-inline 1.25rem. Body: **Source Serif 4 400, 1.125rem/1.8** (1.0625rem/1.75 below md), `var(--ink-secondary)`; paragraphs spaced 1.25em, no indent. `html[lang="zh-CN"]` article body: line-height 1.85 and `--font-serif` retained (Songti body is fine; only headings switch to sans per §3). Links per token rules; bold 600.

**Headings in prose:** h2 serif 600 1.5rem, margin-top 3rem, preceded by a 3rem-wide 2px `var(--accent)` rule (margin-bottom 1rem); h3 serif 600 1.1875rem, margin-top 2rem; h4 Inter 600 1rem. Every h2/h3 has an `id` and a **hover-revealed "#" anchor link** (`var(--faint)`, hover `var(--accent)`, positioned after the text, opacity 0→1 on heading hover).

**Lists:** disc/decimal, padding-left 1.5rem, `::marker` color `var(--muted)`, item spacing 0.5em. **Blockquote:** border-left 3px `var(--border-strong)`, padding-left 1.25rem, serif italic 1.125rem `var(--muted)`. **hr:** 1px `var(--border)`, margin-block 3rem.

**Figures:** `<figure>` may break out to max-width 52rem (centered, width 100%). Images: radius `var(--r-md)`, border 1px `var(--border)`; in dark mode white-background figures may add `background: var(--surface); padding: 8px`. Side-by-side comparisons: 2-col grid gap 1rem, collapsing below 640px. `<figcaption>`: Inter 0.8125rem/1.6 `var(--muted)`, margin-top 0.75rem, text-align left, leading "Figure N." in Inter 600 `var(--ink-secondary)`.

**MathJax (keep MathJax 3 CDN):** inline math inherits body serif size and `color: var(--ink-secondary)` via CSS (so dark toggle recolors without re-render). Display equations: margin-block 1.75rem, each wrapped in a div with `overflow-x: auto; overflow-y: hidden; padding-block: 0.25rem`. Equation numbers (`tags: 'ams'`) right-aligned in `var(--muted)`. Config: chtml scale 1.0; do **not** set `matchFontHeight: false`. No boxes or tints around math.

**Code:** inline — IBM Plex Mono 0.875em, bg `var(--bg-subtle)`, border 1px `var(--border)`, radius `var(--r-sm)`, padding 1px 5px, color `var(--ink)`. Blocks — bg `var(--bg-subtle)`, border 1px `var(--border)`, radius `var(--r-md)`, padding 1rem 1.25rem, mono 0.8125rem/1.7, `overflow-x: auto`, margin-block 1.5rem; optional top-right language label mono 0.6875rem `var(--faint)`. No highlight library.

**Tables:** full measure, Inter 0.875rem; `th` Inter 600 with `border-bottom: 2px solid var(--border-strong)`; `td` `border-bottom: 1px solid var(--border)`; row hover `var(--bg-subtle)`; wrapped in an `overflow-x: auto` div.

**Article footer:** hairline → "← Back to all posts" link in `var(--accent)` (→ `index.html#blog`) → standard site footer. Footnotes if present: 0.8125rem after a 3rem-wide hairline, mono superscript numbers linked both ways.

---

## 8. Implementation Notes

**Tailwind CDN config** (replaces the current one entirely — no violet, no glow keyframes):

```html
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    darkMode: 'class',
    theme: {
      extend: {
        colors: {
          paper: 'var(--bg)', subtle: 'var(--bg-subtle)', surface: 'var(--surface)',
          ink: 'var(--ink)', body: 'var(--ink-secondary)', muted: 'var(--muted)',
          faint: 'var(--faint)', line: 'var(--border)', 'line-strong': 'var(--border-strong)',
          accent: 'var(--accent)', 'accent-hover': 'var(--accent-hover)',
          'accent-soft': 'var(--accent-soft)', 'accent-on': 'var(--accent-on)',
          status: 'var(--status)', 'status-soft': 'var(--status-soft)',
          warn: 'var(--warn)', 'warn-soft': 'var(--warn-soft)'
        },
        fontFamily: {
          serif: ['Source Serif 4','Georgia','Songti SC','STSong','SimSun','serif'],
          sans: ['Inter','system-ui','-apple-system','Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC','sans-serif'],
          mono: ['IBM Plex Mono','ui-monospace','SFMono-Regular','Menlo','Consolas','monospace']
        },
        borderRadius: { sm: 'var(--r-sm)', md: 'var(--r-md)', lg: 'var(--r-lg)' },
        boxShadow: { sm: 'var(--shadow-sm)', md: 'var(--shadow-md)', lg: 'var(--shadow-lg)' }
      }
    }
  }
</script>
```
The custom `<style>` block (tokens, §2) comes **after** this script. Because all colors are CSS variables, there is no flash of unthemed content beyond the theme-class race handled below.

**Pre-paint theme script — mandatory, inline in `<head>` before the Tailwind script:**

```html
<script>
(function () {
  var stored = localStorage.getItem('theme'); // 'light' | 'dark' | null
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  function apply(dark) { document.documentElement.classList.toggle('dark', dark); }
  apply(stored ? stored === 'dark' : mq.matches);
  mq.addEventListener('change', function (e) {
    if (!localStorage.getItem('theme')) apply(e.matches); // live-track system only when no explicit choice
  });
})();
</script>
```
The header toggle sets `localStorage.theme` explicitly and calls the same class toggle. Identical script on all 5 pages.

**Gotchas — verify each before shipping:**
1. **CJK:** ship both zh overrides from §3 (sans headings at 600; `letter-spacing: normal` on every tracked/uppercase element). Test zh at 360px width. Bump zh article body line-height to 1.85.
2. **German strings are long** ("Wissenschaftlicher Mitarbeiter (Remote)"): nav, chips, and buttons must `flex-wrap`; no fixed widths. Test DE at 360px.
3. **Accent contrast:** `#9A3B26` is ~7:1 on `#FBFAF7` — fine — but never set accent text below 0.75rem at weight 400 on `var(--bg-subtle)`. Dark mode must use `#D98E75`; solid buttons in dark use accent bg with `#1F1D1A` text.
4. **Scroll-spy re-check:** the hero keeps near-full-height so existing rootMargin values hold, but re-verify Home highlights at top and Contact at bottom after the layout change; keep the bottom-of-page contact fix.
5. **placehold.co:** zero external placeholder URLs may survive — research thumbnails become local `var(--bg-subtle)` acronym blocks; the blog placeholder becomes the pen-line block; the BO card's `onerror` fallback points to a local block or is removed.
6. **i18n hygiene:** delete dead keys (`hero.typing_words`, `hero.typing_prefix`, `hero.greeting`, `hero.intro1/2`, `hero.field`, `hero.school`, `hero.goal`, `keywords.*`, `common.ai_loading`); add new keys (`hero.standfirst`, `hero.status`, `common.in_preparation`, `common.coming_soon`, `common.ai_hide`, `contact.cv_alt`, `blog.cat.practice`, `blog.cat.frontier`, spec-sheet labels). Every visible string in all three languages. Strip all emoji from i18n strings.
7. **Reduced motion:** the CSS guard (§6) plus JS `matchMedia` check; smooth-scroll disabled under it.
8. **Fonts:** exactly the URL in §3 — no extra weights; `display=swap`; keep `preconnect` links.
9. **Mobile clearance:** every page with the bottom tab bar needs ≥5.5rem bottom padding; article pages (no tab bar) do not.
10. **Lucide:** keep the CDN + `lucide.createIcons()`; icons used: `file-text, mail, sun, moon, graduation-cap, flask-conical, briefcase, wrench, telescope, sparkles, globe, book, video, arrow-right, pen-line, menu` (menu unused — omit), plus existing inline SVGs for GitHub/LinkedIn.
11. **Delete residue:** `overflow-x-hidden` body hack can stay; remove `font-inter` class usage in favor of the new `font-sans`; remove `md:ml-64` from `<main>`; remove the standalone mobile lang-switcher block (it moves into the mobile top bar).