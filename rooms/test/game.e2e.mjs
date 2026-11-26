// End-to-end check of a whole Huddle Up game in real browsers: a teacher tab and four student tabs.
// Needs the relay running (`npm run dev` in /rooms, port 8790) and the site served at http://localhost:4195
// (see the README "Run it locally"). Run: node rooms/test/game.e2e.mjs [mode]
// Screenshots go to the folder in SHOTS (default: a temp folder).
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // the copy installed with the browser
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE || "http://localhost:4195";
const SHOTS = process.env.SHOTS || join(tmpdir(), "huddle-shots");
const MODE = process.argv[2] || "classic";
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const errors = [];
function watch(page, who) {
  page.on("pageerror", (e) => errors.push(who + ": " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/TUNNEL|cloudflareinsights|lessonshuffle.com\/api/.test(m.text())) errors.push(who + ": " + m.text()); });
}

const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const host = await hostCtx.newPage();
watch(host, "host");
await host.goto(BASE + "/huddle-up/host/");
await host.click("#hu-sample");
await host.check(`input[name=hu-mode][value=${MODE}]`);
if (MODE !== "eleven") await host.selectOption("#hu-target", "6");
if (process.env.TEAMS) await host.selectOption("#hu-teamcount", process.env.TEAMS);
// Put a picture on every match (a screenshot of the page stands in for a photo).
const photo = await host.screenshot({ clip: { x: 0, y: 0, width: 900, height: 600 } });
await host.click("#hu-pics-toggle");
const picCount = await host.$$eval(".hu-pic-input", (els) => els.length);
for (let i = 0; i < picCount; i++) {
  await host.locator(".hu-pic-input").nth(i).setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: photo });
  await host.waitForFunction((n) => document.querySelectorAll(".hu-pic-thumb[src]").length > n, i);
}
console.log("pictures added", picCount);
await host.screenshot({ path: join(SHOTS, "1-setup.png"), fullPage: true });
await host.click("#hu-open");
await host.waitForFunction(() => document.querySelector("#hu-code").textContent.trim().length === 7);
const code = (await host.textContent("#hu-code")).replace(/\s/g, "");
console.log("room", code);

// Read the term list back out of the sample, to know the right answers.
const pairs = await host.evaluate(() => document.querySelector("#hu-terms").value.split("\n").map((l) => l.split("\t")));
const byDef = Object.fromEntries(pairs.map(([t, d]) => [d, t]));

const names = ["Ava", "Ben", "Cy", ""];
const kids = [];
for (const name of names) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const page = await ctx.newPage();
  watch(page, "kid " + (name || "random"));
  await page.goto(BASE + "/join/?code=" + code);
  if (name) await page.fill("#pl-nick", name);
  await page.click("#pl-form button[type=submit]");
  kids.push(page);
}
await host.waitForFunction(() => document.querySelectorAll("#hu-players li").length === 4, null, { timeout: 10000 });
await kids[0].waitForSelector("text=You're in!");
await host.screenshot({ path: join(SHOTS, "2-lobby.png"), fullPage: true });
await kids[0].screenshot({ path: join(SHOTS, "2-kid-lobby.png") });

// Students write the set: one term comes in, the teacher keeps it.
await host.click("#hu-collect");
await kids[1].waitForSelector("#pl-term");
await kids[1].fill("#pl-term", "Sun");
await kids[1].fill("#pl-def", "The star at the center of our solar system");
await kids[1].click(".pl-submit button");
await host.waitForSelector("#hu-subs li");
await host.click("#hu-subs li .btn-main");
byDef["The star at the center of our solar system"] = "Sun";
await host.click("#hu-collect");

await host.click("#hu-start");
await host.waitForSelector("#hu-team-grid li");
await kids[0].waitForSelector("text=You're on the");
await host.screenshot({ path: join(SHOTS, "3-teams.png"), fullPage: true });
await kids[0].screenshot({ path: join(SHOTS, "3-kid-team.png") });
await host.click("#hu-go");
await kids[0].waitForSelector(".pl-prompt", { timeout: 8000 });
await host.screenshot({ path: join(SHOTS, "4-board.png"), fullPage: true });
await kids[0].screenshot({ path: join(SHOTS, "4-kid-play.png") });

// One wrong answer on purpose, then everyone plays it straight.
let wrongDone = false;
let sawPic = false, sawAgain = false;
let steps = 0;
async function playRound() {
  const deadline = Date.now() + (MODE === "eleven" ? 120000 : 60000);
  while (Date.now() < deadline) {
    if (await host.isVisible("#hu-results")) return true;
    for (const page of kids) {
      const prompt = await page.$(".pl-prompt-text");
      if (!prompt) continue;
      if (!sawPic && await page.$(".pl-pic img")) { sawPic = true; await page.click(".pl-pic").catch(() => {}); await page.screenshot({ path: join(SHOTS, "4-kid-picture.png") }); }
      if (!sawAgain && await page.$(".pl-again")) sawAgain = true;
      const text = ((await prompt.textContent().catch(() => "")) || "").trim();
      const want = byDef[text];
      const tiles = await page.$$(".pl-tile:not([disabled])");
      for (const tile of tiles) {
        const t = ((await tile.textContent().catch(() => "")) || "").trim();
        const right = t === want;
        if ((!wrongDone && !right) || (wrongDone && right)) {
          if (!wrongDone) wrongDone = true;
          await tile.click({ timeout: 1000 }).catch(() => {});
          steps++;
          if (steps === 3) await page.screenshot({ path: join(SHOTS, "5-kid-flash.png") });
          if (steps === 5) await host.screenshot({ path: join(SHOTS, "5-board-mid.png"), fullPage: true });
          break;
        }
      }
    }
    await host.waitForTimeout(120);
  }
  return false;
}
await playRound();
if (MODE === "playoffs") {
  let games = 1;
  while (await host.isVisible("#hu-next-game")) {
    console.log("playoffs:", (await host.textContent("#hu-res-head")).trim(), "|", (await host.textContent("#hu-res-sub")).trim());
    await host.screenshot({ path: join(SHOTS, "6-playoff-" + games + ".png"), fullPage: true });
    await host.click("#hu-next-game");
    await host.waitForSelector("#hu-go:not([disabled])");
    if (games === 1) await host.screenshot({ path: join(SHOTS, "6-playoff-teams.png"), fullPage: true });
    await host.click("#hu-go");
    await host.waitForSelector("#hu-game:not([hidden])", { timeout: 8000 });
    if (games === 1) await host.screenshot({ path: join(SHOTS, "6-playoff-board.png"), fullPage: true });
    await playRound();
    games++;
  }
  console.log("playoff games played:", games);
}
const done = await host.isVisible("#hu-results");
await host.screenshot({ path: join(SHOTS, "6-results.png"), fullPage: true });
await kids[0].screenshot({ path: join(SHOTS, "6-kid-results.png") });
console.log("saw picture:", sawPic, "| saw second chance:", sawAgain);
console.log("results shown:", done, "| taps:", steps, "|", (await host.textContent("#hu-res-head")).trim());

// Refresh a student mid-room: they keep their seat and name.
const before = (await kids[2].textContent("#pl-name")).trim();
await kids[2].reload();
await kids[2].waitForFunction(() => document.querySelector("#pl-name") && document.querySelector("#pl-name").textContent.trim().length > 0);
const after = (await kids[2].textContent("#pl-name")).trim();
console.log("rejoin keeps name:", before === after, before);

// Close the room: students see the game is over.
host.once("dialog", (d) => d.accept());
await host.click("#hu-results .hu-close");
await kids[0].waitForSelector("text=The game is over.", { timeout: 8000 });
console.log("close room reaches students: true");
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
await browser.close();
process.exit(done && sawPic && !errors.length && before === after ? 0 : 1);
