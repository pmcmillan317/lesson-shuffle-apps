# Lesson Shuffle apps (apps.lessonshuffle.com)

The tools hub for Lesson Shuffle. A small static site, served by Cloudflare Pages straight from the repo root. No build step, no cookies, no analytics, no forms, no external requests (fonts and images are self-hosted, and `_headers` sets a strict Content-Security-Policy). One small script, `assets/js/site.js`, closes the phone menu and fades sections in as they scroll into view. Every page works without it.

It has one page listing every tool (`/`), a help page for each tool, and the SeatSolver privacy policy and terms of service. The Chrome extensions' privacy and terms pages live on lessonshuffle.com and stay there. The look matches lessonshuffle.com.

## Files

| Path | What it is |
|---|---|
| `index.html` | The hub: one grid with every tool, plus the dashed "More tools" tile. |
| `seatsolver/index.html` | SeatSolver help page (`/seatsolver/`, and `/seatsolver` redirects to it). |
| `seatsolver-privacy/index.html`, `seatsolver-terms/index.html` | SeatSolver privacy policy and terms of service. |
| `visual-timer/`, `webink/`, `polyread/`, `bell-schedule/` | One help page per Chrome extension (`index.html` in each). |
| `404.html` | Not-found page. Cloudflare Pages serves it, with a 404 status, for any unknown address. |
| `style.css` | All styles. Colour and spacing tokens are in `:root` at the top (light and dark). |
| `assets/js/site.js` | The only script: phone menu closing, reveal on scroll. Adds a `js` class to `<html>`. |
| `assets/icons/` | The four extension icons (128px webp). SeatSolver uses `/seatsolver-icon.png`. |
| `assets/` | Header and footer logos, `og-image.png` (social preview), `apple-touch-icon.png`. |
| `fonts/` | Days One and Rubik (woff2) with their OFL licences. |
| `favicon.svg`, `favicon.ico`, `favicon.png` | Site icon (card fan). Pages link the `.ico`, the `.svg` and the apple-touch icon. |
| `ls-logo.png`, `seatsolver-icon.png` | Original images. Do not rename, move or change them. They may be referenced from Google consoles. `ls-logo.png` is no longer used by the pages but must stay. |
| `_headers` | Security headers, the Content-Security-Policy and cache rules (Cloudflare Pages syntax). Fonts and images cache for a long time. `style.css` and `assets/js/` cache for one hour so a change shows up quickly. Keep the cache rules from overlapping, because Cloudflare joins repeated headers with a comma. |
| `robots.txt`, `sitemap.xml` | Update `lastmod` in the sitemap when a page changes. |

## Rules

1. **Do not change or remove any existing URL.** The Google Workspace add-on submission links to `/seatsolver/`, `/seatsolver-privacy/` and `/seatsolver-terms/`, and Google consoles may use `/favicon.png`, `/ls-logo.png`, `/seatsolver-icon.png` and `/style.css`. If a page ever has to move, leave a redirect behind.
2. **The SeatSolver text must not change.** The words inside `<main>` on `/seatsolver/`, `/seatsolver-privacy/` and `/seatsolver-terms/` are what Google reviewed. Header, footer, markup, classes and styling around them may change. If a wording change is ever requested, make exactly that change, update the "Effective date" line on a legal page, and tell the owner that the Google listing may need a re-review. To prove nothing moved, compare the visible `<main>` text of each page with `git show main:<path>` (ignoring whitespace and entities).
3. **No inline `style=""` attributes, no inline `<script>`, and nothing loaded from another site.** The CSP in `_headers` blocks them. The only script is `/assets/js/site.js`. Put styling in `style.css`.
4. **Copy voice for new text:** plain and warm, short sentences for busy teachers, no em dashes or en dashes, no invented facts, prices, dates or statistics. Tool help pages say only what is verified in the extension's own code and listing. If a store listing or legal page claims more than the code does, use the weaker, accurate wording.
5. **Never mention or link to the Lesson Shuffle card guide site.** It is a perk for deck buyers and stays off this site. (Note that every file in the repo root is publicly served, this README included.)
6. Keep tap targets at least 44px, body text at least 16px, and check dark mode as well as light. The header must stay on one row at 320px wide and with text enlarged to 150 percent.

When the SeatSolver Marketplace listing goes live, replace the placeholder sentence on the SeatSolver page with the real link (this is the one allowed text change there), and remove the "Marketplace listing coming soon" pill from the hub tile.

## How to add a tool

1. Copy an existing tool page, for example `webink/index.html`, to `<slug>/index.html`. Change the title, description, canonical, Open Graph and Twitter tags, the icon, the `suit-` colour class on `app-head`, the store link and the legal links. Rewrite the sections from verified facts only: Get started, Using it, Something not working?, Frequently asked questions, Your privacy in plain words, Contact and More Lesson Shuffle tools.
2. Put a 128px icon in `assets/icons/<slug>.webp`.
3. Add a tile to the grid in `index.html` (copy a `<li class="reveal ...">` block) with the one-line description, "Learn more" and, for a Chrome extension, "Get it on Chrome" (keep the hidden "(opens in a new tab)" text).
4. Add the tool to the phone menu (`<details class="menu">`) and the "Tools" list in the footer on **every** page, to the "More Lesson Shuffle tools" row on every tool page, and to `sitemap.xml`.
5. Run the checks below.

## Checks before merging

- Open each page at 320px, 390px and desktop width, in light and dark, and with the browser text size enlarged. There must be no sideways scrolling and the header must stay on one row. Open the phone menu: it must close on a link click, Escape and a click outside.
- Search the HTML for em dashes and en dashes, `style=`, any `<script` other than the `site.js` reference, and any mention of the card guide site. There must be none.
- Every `<img>` needs `alt`, `width` and `height`. Every internal link must resolve.
- For the SeatSolver pages, run the `<main>` text comparison from rule 2.

## Run it locally

Any static server works. With Node installed, from the repo root, this one mimics Cloudflare Pages (directory index, the `/seatsolver` redirect, and a 404 status with `404.html`):

```
node -e "const h=require('http'),f=require('fs'),p=require('path');const T={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.txt':'text/plain','.xml':'application/xml','.svg':'image/svg+xml','.ico':'image/x-icon'};h.createServer((q,r)=>{const u=decodeURIComponent(q.url.split('?')[0]);if(u.includes('..')){r.writeHead(400);return r.end()}let a=p.join(process.cwd(),u);if(f.existsSync(a)&&f.statSync(a).isDirectory()){if(!u.endsWith('/')){r.writeHead(308,{Location:u+'/'});return r.end()}a=p.join(a,'index.html')}const ok=f.existsSync(a)&&f.statSync(a).isFile();if(!ok)a=p.join(process.cwd(),'404.html');r.writeHead(ok?200:404,{'Content-Type':T[p.extname(a)]||'application/octet-stream'});r.end(f.readFileSync(a))}).listen(4195,()=>console.log('http://localhost:4195'))"
```

Then open http://localhost:4195. This server does not send the security headers from `_headers`, so it will not show Content-Security-Policy problems. Cloudflare Pages does.

Cloudflare Pages serves the repo root. Work on a branch, check the pages as described above, then merge.
