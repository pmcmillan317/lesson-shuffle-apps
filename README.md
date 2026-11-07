# Lesson Shuffle apps (apps.lessonshuffle.com)

A small static site, served by Cloudflare Pages straight from the repo root. No build step, no JavaScript, no cookies, no analytics, no external requests (fonts and images are self-hosted, and `_headers` sets a strict Content-Security-Policy). It lists Lesson Shuffle apps and hosts the SeatSolver help page, privacy policy and terms of service. The look matches lessonshuffle.com.

## Files

| Path | What it is |
|---|---|
| `index.html` | Apps home page. |
| `seatsolver/index.html` | SeatSolver help page (`/seatsolver/`, and `/seatsolver` redirects to it). |
| `seatsolver-privacy/index.html` | SeatSolver privacy policy. |
| `seatsolver-terms/index.html` | SeatSolver terms of service. |
| `404.html` | Not-found page. Cloudflare Pages serves it, with a 404 status, for any unknown address. |
| `style.css` | All styles. Colour and spacing tokens are in `:root` at the top (light and dark). |
| `fonts/` | Days One and Rubik (woff2) with their OFL licences. |
| `assets/` | Header and footer logos, `og-image.png` (social preview), `apple-touch-icon.png`. |
| `favicon.png`, `ls-logo.png`, `seatsolver-icon.png` | Original images. Do not rename, move or change them. They may be referenced from Google consoles. `ls-logo.png` is no longer used by the pages but must stay. |
| `_headers` | Security headers, the Content-Security-Policy and cache rules (Cloudflare Pages syntax). |
| `robots.txt`, `sitemap.xml` | Update `lastmod` in the sitemap when a page changes. |

## Rules

1. **Do not change or remove any existing URL.** The Google Workspace add-on submission links to `/seatsolver/`, `/seatsolver-privacy/` and `/seatsolver-terms/`, and Google consoles may use `/favicon.png`, `/ls-logo.png` and `/seatsolver-icon.png`. If a page ever has to move, leave a redirect behind.
2. **The privacy policy and terms pages are legal text.** Do not reword them. If a change is requested, make exactly that change, update the "Effective date" line, and tell the owner that the Google listing may need a re-review. The SeatSolver help text is also reviewed by Google, so keep it accurate.
3. **No inline `style=""` attributes, no `<script>`, and nothing loaded from another site.** The CSP in `_headers` blocks them. Put styling in `style.css`.
4. **Copy voice for new text:** plain and warm, no em dashes or en dashes, no invented facts, prices, dates or statistics.
5. Keep tap targets at least 44px, body text at least 16px, and check dark mode as well as light.

When the SeatSolver Marketplace listing goes live, replace the placeholder sentence on the SeatSolver page with the real link, and remove the "Marketplace listing coming soon" pill from the home page.

## Run it locally

Any static server works. With Node installed, from the repo root:

```
node -e "const h=require('http'),f=require('fs'),p=require('path');h.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);let a=p.join(process.cwd(),u);if(f.existsSync(a)&&f.statSync(a).isDirectory())a=p.join(a,'index.html');const ok=f.existsSync(a);if(!ok)a=p.join(process.cwd(),'404.html');const t={'.html':'text/html','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.txt':'text/plain','.xml':'application/xml'}[p.extname(a)]||'application/octet-stream';r.writeHead(ok?200:404,{'Content-Type':t});r.end(f.readFileSync(a))}).listen(4195,()=>console.log('http://localhost:4195'))"
```

Then open http://localhost:4195. (This one-liner does not mimic Cloudflare's redirect from `/seatsolver` to `/seatsolver/`, so use the addresses with the trailing slash locally.)

Cloudflare Pages serves the repo root. Work on a branch, check the pages at phone width (375px) and desktop width in light and dark, then merge.
