# Lesson Shuffle apps (apps.lessonshuffle.com)

The tools hub for Lesson Shuffle. A small static site, served by Cloudflare Pages straight from the repo root. No build step, no cookies, no analytics, no forms, no external requests (fonts and images are self-hosted, and `_headers` sets a strict Content-Security-Policy). The one outside link, "Buy me a coffee", only opens when someone clicks it. One small script, `assets/js/site.js`, closes the phone menu, fades sections in as they scroll into view and opens the coffee tip dialog. Every page works without it.

It has one page listing every tool (`/`), a help page for each tool, and the SeatSolver privacy policy and terms of service. Each Chrome extension's privacy policy lives here too, at `/<slug>/privacy/`. The old `lessonshuffle.com/extensions/` addresses redirect here. The extensions have no terms page, so link only to their privacy policy, never to a terms page. SeatSolver keeps its terms page, because the Google Workspace Marketplace needs one. The look matches lessonshuffle.com and uses the Logo v2 brand kit: the four staggered cards of the logo, navy bands with the dark logo (the hub hero and the footer), a row of four suit-colour tabs (`.tabs`) along the hero's bottom and the footer's top edge, and solid suit-colour cards with a white "cut line" border (navy on dark mode) for the tool tiles and the tool page banner.

## Files

| Path | What it is |
|---|---|
| `index.html` | The hub: one grid with every tool, plus the dashed "More tools" tile. |
| `seatsolver/index.html` | SeatSolver help page (`/seatsolver/`, and `/seatsolver` redirects to it). |
| `seatsolver-privacy/index.html`, `seatsolver-terms/index.html` | SeatSolver privacy policy and terms of service. |
| `visual-timer/`, `webink/`, `polyread/`, `bell-schedule/` | One help page per Chrome extension (`index.html` in each). |
| `visual-timer/privacy/`, `webink/privacy/`, `polyread/privacy/`, `bell-schedule/privacy/` | The extensions' privacy policies. This is legal text (Bell Schedule's page also holds its terms). |
| `404.html` | Not-found page. Cloudflare Pages serves it, with a 404 status, for any unknown address. |
| `style.css` | All styles. Colour and spacing tokens are in `:root` at the top (light and dark): the suit colours, `--navy`, `--cut` (the cut line colour) and `--ink-on-suit`. `.suit-blue`, `.suit-green`, `.suit-yellow`, `.suit-red` and `.suit-navy` set a tool's colour (SeatSolver is navy and its text is white, via `--on-suit`). The header is a size container, so it swaps the horizontal logo for the icon on very narrow or enlarged-text phones and always stays on one row. |
| `assets/js/site.js` | The only script: phone menu closing, reveal on scroll, and the coffee tip dialog (it builds a `<dialog>` for any link marked `data-coffee`). Adds a `js` class to `<html>`. |
| `_redirects` | `/coffee/` and `/coffee` redirect (302) to the owner's Venmo tip link. The QR code and the dialog button point at `/coffee/`, so the tip page can change here without touching a page or an extension. |
| `assets/coffee-qr.svg` | Static QR code for `https://apps.lessonshuffle.com/coffee/` (version 3, error correction M, 4-module quiet zone, dark `#14212e` on white), made with the `qrcode-generator` package and checked with a decoder at five sizes. If the address it encodes ever changes, make a new one and check that it scans. |
| `assets/icons/` | The five tool icons (128px webp), made from `2 Brand\Product Icons v2\<tool>\icon-128.png`. WebInk keeps its original icon. SeatSolver's is `seatsolver.webp`, in the navy suit colour. |
| `assets/shots/` | One store screenshot per tool page (`<slug>-1.webp`, 1280x800, under 150 KB): slide 1 of each tool's Chrome Web Store set. The full-size originals are in `6 Extensions\<Tool>\store-graphics\screenshots\`. |
| `assets/brand/` | The Logo v2 SVGs, the same files as on lessonshuffle.com: `logo-horizontal-light.svg` and `logo-horizontal-dark.svg` (header and footer), `icon.svg` (header on very narrow phones, the hub hero and the 404 page), `logo-primary-light.svg` and `logo-primary-dark.svg` (not used on a page yet; the dark one is what `og-image.png` was made from). Use them as they are: never stretch, recolour or re-type them, put the dark versions on navy only, keep the horizontal logo at least 120px wide on screen, and leave clear space around it. The header swaps light and dark with `<picture>` and `prefers-color-scheme`. |
| `assets/` | `og-image.png` (1200x630 social preview: navy, the dark primary logo and four suit tabs, the same image as lessonshuffle.com) and `apple-touch-icon.png` (Logo v2 icon, 180px). |
| `fonts/` | Days One and Rubik (woff2) with their OFL licences. |
| `favicon.svg`, `favicon.ico`, `favicon.png` | Site icon: the Logo v2 icon (four staggered cards), copied from lessonshuffle.com. Pages link the `.ico`, the `.svg` and the apple-touch icon. |
| `ls-logo.png`, `seatsolver-icon.png` | Original images. Do not rename, move or change them. They may be referenced from Google consoles. Neither is used by the pages any more (SeatSolver's pages use `assets/icons/seatsolver.webp`), but both must stay. The old textured logo files (`assets/logo-xs.webp`, `assets/logo-sm.webp`) are no longer used by any page since the Logo v2 rebrand. They are kept only so no served address changes; delete them whenever you like. |
| `_headers` | Security headers, the Content-Security-Policy and cache rules (Cloudflare Pages syntax). Fonts and images cache for a long time. `assets/brand/` (SVG) caches for one week. `style.css` and `assets/js/` cache for one hour so a change shows up quickly. Keep the cache rules from overlapping, because Cloudflare joins repeated headers with a comma (so do not put `.webp` or `.png` files in `assets/brand/`). |
| `robots.txt`, `sitemap.xml` | Update `lastmod` in the sitemap when a page changes. |

## Rules

1. **Do not change or remove any existing URL.** The Google Workspace add-on submission links to `/seatsolver/`, `/seatsolver-privacy/` and `/seatsolver-terms/`. The Chrome Web Store listings link to `/visual-timer/privacy/`, `/webink/privacy/`, `/polyread/privacy/` and `/bell-schedule/privacy/`. Google consoles may use `/favicon.png`, `/ls-logo.png`, `/seatsolver-icon.png` and `/style.css`. If a page ever has to move, leave a redirect behind. These addresses must never move without one.
2. **The SeatSolver text must not change.** The words inside `<main>` on `/seatsolver/`, `/seatsolver-privacy/` and `/seatsolver-terms/` are what Google reviewed. Header, footer, markup, classes and styling around them may change. If a wording change is ever requested, make exactly that change, update the "Effective date" line on a legal page, and tell the owner that the Google listing may need a re-review. To prove nothing moved, compare the visible `<main>` text of each page with `git show main:<path>` (ignoring whitespace and entities).
3. **The four extension privacy pages are legal text too.** Do not reword them without the owner's OK. If a change is approved, make exactly that change, update the "Last updated" line on that page, and tell the owner that the Chrome Web Store listing may need a re-review. Their `<main>` text was carried over word for word from the old lessonshuffle.com pages; only the links bar at the bottom changed.
4. **No inline `style=""` attributes, no inline `<script>`, and nothing loaded from another site.** The CSP in `_headers` blocks them. The only script is `/assets/js/site.js`. Put styling in `style.css`.
5. **Copy voice for new text:** plain and warm, short sentences for busy teachers, no em dashes or en dashes, no invented facts, prices, dates or statistics. Tool help pages say only what is verified in the extension's own code and listing. If a store listing or legal page claims more than the code does, use the weaker, accurate wording.
6. **Never mention or link to the Lesson Shuffle card guide site.** It is a perk for deck buyers and stays off this site. (Note that every file in the repo root is publicly served, this README included.)
7. Keep tap targets at least 44px, body text at least 16px, and check dark mode as well as light. The header must stay on one row at 320px wide and with text enlarged to 150 percent.
8. **The coffee tip link.** `/coffee/` must keep working: the QR code (here and, later, in the Chrome extensions) encodes that address. Change where tips go only in `_redirects`, and keep it a 302, never a 301. The footer link (`.coffee-link`, with `data-coffee`) is on the hub and the four extension help pages only. It is deliberately NOT on SeatSolver's three pages (Google's OAuth verification is in progress and the reviewers read those pages), on the privacy pages (legal text) or on the 404 page. Add it to SeatSolver only after verification finishes and with the owner's OK. Never put it inside `<main>` text of a legal page, and keep it off anything students see.

**Marketplace wording (2026-11-10):** the Google Workspace Marketplace review team said the website must not carry Marketplace buttons or links, "coming soon" text or unclickable links until the listing is approved, because that can delay the OAuth review. So the hub tile's "Marketplace listing coming soon" pill and the SeatSolver help page's "Install SeatSolver ... from the Google Workspace Marketplace (link goes here)" step were removed. Do not add either back until the listing is approved. Once it is approved, add an install step with the real link as step 2 of Get started on `/seatsolver/` (this is the one allowed text change there) and, if wanted, a "Get it on Google Workspace Marketplace" button on the hub tile.

**Marketplace listing live (2026-11-11):** Google approved SeatSolver for the Google Workspace Marketplace, so the rule above about Marketplace links no longer applies. The SeatSolver help page now has the install step with the real link as step 2 of Get started and the Google Slides trademark line in its footer, and the hub tile has a "Get it on Google Workspace Marketplace" button. The link is `https://workspace.google.com/marketplace/app/seatsolver_by_lesson_shuffle/423807666646`. The SeatSolver coffee card is NOT added yet: it goes in after the new SeatSolver window and code (with the Buy me a coffee button) are in Apps Script.

**Trademark symbol (2026-11-10):** at the owner's request, `&trade;` was added after "Google Slides" in the three places it appears in the `<main>` text of `/seatsolver/` (and in its three description tags). Nothing else in `<main>` changed (checked against `main` ignoring the symbol). The Google listing may need a re-review for this wording change, per rule 2. A footer line ("Google Slides&trade; is a trademark of Google LLC.") is still planned for after approval, together with the real install link.

## How to add a tool

1. Copy an existing tool page, for example `webink/index.html`, to `<slug>/index.html`. Change the title, description, canonical, Open Graph and Twitter tags, the icon, the `suit-` colour class on `app-head`, the store link and the legal links. Rewrite the sections from verified facts only: Get started, Using it, Something not working?, Frequently asked questions, Your privacy in plain words, Contact and More Lesson Shuffle tools.
2. Put a 128px icon in `assets/icons/<slug>.webp`. For a screenshot under the page hero, convert one of the owner's own store images to `assets/shots/<slug>-1.webp` and give it real alt text, `width` and `height`. Only use an image that shows the current look of that tool.
3. Add a tile to the grid in `index.html` (copy a `<li class="reveal ...">` block) with the one-line description, "Get it on Chrome" (the filled button, for a Chrome extension) and "Learn more" (keep the hidden "(opens in a new tab)" text). SeatSolver stays last in every list until its Marketplace listing is live. On a tool page each FAQ question is a native `<details><summary>`; keep it closed by default and keep the answer in the HTML.
4. Add the tool to the phone menu (`<details class="menu">`) and the "Tools" list in the footer on **every** page, to the "More Lesson Shuffle tools" row on every tool page, and to `sitemap.xml`.
5. Run the checks below.

## Checks before merging

- Open each page at 320px, 390px and desktop width, in light and dark, and with the browser text size enlarged to 150 percent. There must be no sideways scrolling and the header must stay on one row. Open the phone menu: it must close on a link click, Escape and a click outside.
- Search the HTML for em dashes and en dashes, `style=`, any `<script` other than the `site.js` reference, and any mention of the card guide site. There must be none.
- Every `<img>` needs `alt`, `width` and `height`. Every internal link must resolve.
- For the SeatSolver pages, run the `<main>` text comparison from rule 2.
- On the hub and a tool page: click "Buy me a coffee". The dialog must open with the QR code, close with the Close button, Escape and a click outside, and give focus back to the link. "Open Venmo" and the QR code must both end at the tip page (`/coffee/` redirects there).

## Run it locally

Any static server works. With Node installed, from the repo root, this one mimics Cloudflare Pages (directory index, the `/seatsolver` redirect, and a 404 status with `404.html`):

```
node -e "const h=require('http'),f=require('fs'),p=require('path');const T={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.txt':'text/plain','.xml':'application/xml','.svg':'image/svg+xml','.ico':'image/x-icon'};h.createServer((q,r)=>{const u=decodeURIComponent(q.url.split('?')[0]);if(u.includes('..')){r.writeHead(400);return r.end()}let a=p.join(process.cwd(),u);if(f.existsSync(a)&&f.statSync(a).isDirectory()){if(!u.endsWith('/')){r.writeHead(308,{Location:u+'/'});return r.end()}a=p.join(a,'index.html')}const ok=f.existsSync(a)&&f.statSync(a).isFile();if(!ok)a=p.join(process.cwd(),'404.html');r.writeHead(ok?200:404,{'Content-Type':T[p.extname(a)]||'application/octet-stream'});r.end(f.readFileSync(a))}).listen(4195,()=>console.log('http://localhost:4195'))"
```

Then open http://localhost:4195. This server does not send the security headers from `_headers`, so it will not show Content-Security-Policy problems. Cloudflare Pages does.

Cloudflare Pages serves the repo root. Work on a branch, check the pages as described above, then merge.
