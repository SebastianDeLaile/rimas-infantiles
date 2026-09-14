# Handover — Mi Cancionero Bilingüe

Orientation doc for picking this project up cold. It tells you what the
project is and how to work in it safely; it does **not** re-explain past
decisions — `STATUS.md` is the append-only decision log and is the source
of truth for "why is it built this way." When in doubt, search STATUS.md
before changing something that looks odd — it's very likely odd on purpose,
with the story recorded.

## What this is

A single-file bilingual (Spanish/English) children's-rhyme songbook,
`index.html`, meant to be printed as A4 cards, hole-punched, and kept in a
binder — or, per the live owner, pinned to a blackboard with magnets. Live
at the GitHub Pages URL for this repo; source of truth is `index.html`
(~4600 lines: HTML markup for 75 rhyme cards, one shared `<style>` block,
one shared `<script>` block that generates each card's English "back" and
handles all print-time layout).

There is no build step. `index.html` is the whole site. Editing it and
reloading in a browser is the dev loop.

## Architecture, in five points

1. **Front/back pairing.** Each rhyme is authored once, in Spanish, as a
   static `<section class="a4-sheet frame-X-bi">` in the HTML. A parallel
   JS array `translations[]` (same order, same length: 75) holds each
   card's English title + verse. At load time, `fronts.forEach(...)`
   walks the static Spanish cards, looks up `translations[index]`, and
   *generates* the English back card into the DOM, cloning the
   illustration from the front. **Anything added to one side must be
   added to the other by construction, or it silently drifts** — this
   exact bug (mismatched illustration size/tier between front and back)
   was found and fixed for 17+13 cards this session. If you add a new
   rhyme, add both the front section AND the matching `translations[]`
   entry, at the same index.

2. **Card fitting (`fitCardPair`, `pxPerMm`, `measureSide`).** Body text
   is ONE fixed size book-wide (`VERSE_MM = 8`). The illustration is what
   flexes per card to fill whatever vertical space the verse leaves
   (50–135mm wide, capped for print resolution). Text only drops below
   `VERSE_MM` when a verse genuinely cannot fit even with the smallest
   illustration — found by binary search, not a proportional guess,
   because shrinking type re-wraps text and tightens leading
   non-linearly. This *replaced* an earlier tiered system
   (`long-verse`/`very-long-verse`/`big-verse` CSS classes) — if you see
   references to those in old commit messages, they're gone; don't
   reintroduce a static tier without a strong reason.

3. **Border patterns.** 15 hand-built SVG/CSS motifs (`crosshatch`,
   `diamond`, `teardrop`, `square`, `ticks`, `xmarks`, `plus`, `spiral`,
   `star`, `dots` — rendered via `BG_IMAGE_ICON_PATTERNS` /
   `addBackgroundImageFrame`; `zigzag`, `wave`, `loop`, `arches`,
   `scallop` — rendered via `CONNECTED_EDGE_TILES` /
   `addConnectedBgFrame`), assigned per-card via `frame-{pattern}-bi` on
   the section, with `--accent:#hex` for its colour. Every one of these
   patterns has, at some point, had a corner-alignment or
   edge-mirroring bug — the strip tile and the corner piece are
   authored independently and have to be made to meet exactly by hand.
   **If you touch a pattern's geometry, render all 4 corners at high
   DPI and look, per-pattern, before calling it done.** Reasoning about
   whether an arc bulges the "expected" direction has been wrong more
   than once this session; only rendering settled it.

4. **Colour.** 12-colour palette (not 75 one-offs — see STATUS "12-colour
   palette" entry), each colour's darkness solved to clear 4.6:1 contrast
   against white title text. Assigned per-card to harmonise with that
   card's own illustration (its *secondary* hues, deliberately not its
   dominant warm ground colour — matching the dominant hue collapses the
   whole book toward brown, since the art style is uniformly warm).
   Don't hand-pick a hex for a new card; extract the art's hues and pick
   the nearest palette entry the same way the rest were assigned (see
   the palette-assignment script referenced in that STATUS entry, or ask
   for it to be rebuilt — it wasn't kept as a permanent script).

5. **Illustrations.** `assets/*.png`, generated via
   `scripts/generate_illustration.py` (OpenAI `gpt-image-1`,
   `--background transparent`). 26 of 75 cards use these bespoke
   paintings; the other 49 use inline flat SVG icons (still original
   style, just not migrated to painted). Every generated PNG needs a
   crop/pad pass afterward (tight bbox around non-transparent content +
   6% margin, padded to at least 112:84 aspect) so it renders at a
   consistent width — this is NOT automatic, do it by hand or script it
   per-batch. **Verify transparency and zero opaque corners on every
   generated image before using it** — two separate batches this
   session had opaque grounds that only became visible later (once
   against cream, once — the original ten — for years, until the sheet
   background changed to white).

## The validation suite — run before calling anything done

```bash
# 1. JS syntax (index.html's <script> blocks are the only executable code)
node -e 'const fs=require("fs");const h=fs.readFileSync("index.html","utf8");[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach(m=>new Function(m[1]));console.log("syntax OK")'

# 2. Div/section tag balance (550/550 divs is NOT the current baseline --
#    check git log or STATUS for the current expected count; the
#    dead-code cleanup changed it. 76/75 sections is a known,
#    pre-existing, harmless mismatch -- not a bug to fix.)
grep -o "<div" index.html | wc -l;  grep -o "</div>" index.html | wc -l

# 3. Overflow check -- the layout's most likely regression is a verse
#    that no longer fits after a font/spacing/illustration change.
node scripts/check_overflow.js          # exits non-zero if anything's tight

# 4. Full book renders correctly
node scripts/generate_print_pack.js --all --out /tmp/full.pdf
pdfinfo /tmp/full.pdf | grep Pages      # expect 150 (75 rhymes x 2 sides)
```

There is no standing front/back-mismatch or stray-tier audit script
committed to the repo (those were one-off Playwright scripts written
in-session, in `/tmp`, and lost to cleanup at least twice — see STATUS's
own note about this). If you're touching the tier/fitting system, or
adding cards, it is well worth writing a quick one again rather than
trusting a visual spot-check. Pattern to copy: `scripts/check_overflow.js`
already shows the "serve the repo over local HTTP, drive it with
`playwright-core` + a real Chrome via `executablePath`, evaluate in-page"
scaffold — reuse that scaffold rather than reinventing it.

## After any change: commit → push → confirm deploy → regenerate the pack

```bash
git add -A && git commit -m "..." && git push origin main
gh run list --limit 1          # find the Deploy to GitHub Pages run
gh run watch <id> --exit-status
node scripts/generate_print_pack.js "Title One" "Title Two" ... --out packs/favourites-pack.pdf
cp packs/favourites-pack.pdf ~/Inbox/favourites-pack-vNN.pdf   # increment NN
```

The live owner reviews printed packs, not the live site — always end a
round of changes by regenerating and delivering a pack to `~/Inbox`,
version-numbered one higher than the last `favourites-pack-vNN.pdf`
already there.

## Copyright line, established this session

The rhymes in the book are traditional/public-domain nursery rhymes.
When asked to add a rhyme or text sourced from a *specific, identifiable,
modern, copyrighted* work (a named published picture book, a named
author), don't transcribe that work's actual text into the file even for
declared personal/non-commercial use — write original text in the same
spirit instead, and say so plainly to the user rather than silently
substituting. Use fresh AI-generated art for the same reason (never trace
or closely recreate the source book's own illustrations).

## In progress at handover

A one-off "bonus" card (not one of the 75 traditional rhymes) featuring
original characters "Biguana" and "Pinto," at the request of the live
owner, who owns the source picture book. Two ORIGINAL rhymes (not the
book's text — see Copyright line above) with freshly generated
illustrations, appended as the 76th front/back pair so no existing card's
index shifts. Check git log / STATUS.md's most recent entry for whether
this landed and what its final frame pattern / accent / titles ended up
being.
