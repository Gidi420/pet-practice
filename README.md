# תרגול פסיכומטרי — PET Practice PWA

A mobile-first, offline-capable Progressive Web App for practising the Israeli
Psychometric Entrance Test (PET / פסיכומטרי) with **real NITE past papers**.
Plain HTML + CSS + vanilla JavaScript (ES modules). No build step, no backend,
no accounts — everything lives on your device.

> **The app never contains NITE question text.** Questions are shown by rendering
> pages from the official NITE PDFs, which you import on your phone. The PDFs and
> the per-test answer files live only on the device (IndexedDB) and are never
> committed to this repo. The repo contains only the app code, so it can be public.

---

## What it does

- **Practice** — one random question at a time from all imported tests, immediate
  feedback, filters (domain / topic / year), smart randomisation that leans toward
  your weak topics.
- **Timed question** — same, with a per-question countdown (defaults ~52s verbal /
  ~60s quant, editable in Settings).
- **Section simulation** — a timed 20-minute chapter or a **full test** (4 sections
  back-to-back with break screens). Free navigation, a question grid with flags,
  continuous save/resume if iOS kills the app, scored results with a per-topic
  breakdown, a review list, and for a full test the estimated **V / Q scaled scores**
  and three **general score estimates**.
- **Review mistakes** — a spaced-repetition queue of everything you got wrong or
  timed out on, served until you get each right twice in a row.
- **Stats** — accuracy, average time, streak, trends (inline SVG), per-topic
  weakness, slowest topics, coverage, simulation history, and an exam countdown.
- **Backup** — export/import a JSON file with your settings, history and answer
  files (without the PDFs) so you never lose your stats.
- Hebrew, right-to-left, with an English toggle. Dark mode (auto + manual), optional
  PDF inversion in dark mode.

---

## Setup — deploy and install on your iPhone

### 1. Put it on GitHub Pages
1. Create a GitHub repo and push this folder to `main` (see **Pushing** below).
2. On GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**,
   choose **`main`** and **`/ (root)`**, Save.
3. Wait ~1 minute. Your app is at `https://<your-user>.github.io/<repo>/`.

### 2. Install on the iPhone
1. Open that URL in **Safari**.
2. **Share → Add to Home Screen**. Open the new icon — it runs full-screen like a
   native app.

### 3. Import your files — **from inside the installed app**
> ⚠️ **Important:** a home-screen PWA on iOS has its **own storage, separate from
> Safari**. So you must import from inside the installed app, not from Safari.

1. Open the installed app → **הגדרות (Settings) → מבחנים (Tests)**.
2. **Import answer files** — pick the 20 `*.answers.json` files (from the iOS Files
   app). They are validated on import; bad files are rejected with a reason.
3. **Import PDFs** — pick your NITE PDFs. Each is matched to its answer file by
   filename (`psychometric_<season>_<year>`, ignoring prefixes and an `_acc` suffix)
   and confirmed by page count. If one can't be matched, you'll be asked which test
   it is.
4. A test shows **✅ ready** once it has both an answer file and a PDF. Practice uses
   only ready tests.

Tip: do the first import while **online** so the app can cache the pdf.js font/cMap
assets it may need; after that it works fully offline.

---

## Privacy & data

- All data (PDFs, answer files, your answer history) is stored **on the device** in
  IndexedDB. Nothing is uploaded anywhere.
- `navigator.storage.persist()` is requested on first import so iOS is less likely to
  evict your data.
- `.gitignore` blocks `*.pdf`, `*.answers.json` and `/private/` from ever being
  committed.
- Use **Settings → Export backup** regularly to keep a copy of your stats.

---

## Project structure

```
index.html              app shell
manifest.webmanifest    PWA manifest (standalone, icons)
sw.js                   service worker (offline app shell + /lib runtime cache)
test.html               scoring.js unit checks (open in a browser)
css/app.css
js/app.js               hash router + shell + theme/language
js/config.js            topic labels, timings, exam date, i18n, settings
js/db.js                IndexedDB wrapper
js/tests.js             import, validation, PDF↔answer matching, question pool
js/pdfview.js           pdf.js loading, render, LRU cache, PageViewer (pinch/swipe)
js/scoring.js           raw → scaled → general estimate
js/timer.js             timestamp-based, background-safe countdown
js/stats.js             attempt logging, aggregation, review queue
js/statsview.js         Stats screen
js/settings.js          Settings + Tests management + backup UI
js/backup.js            export/import backup JSON
js/ui.js                DOM helpers, haptics, dialogs, bottom sheets
js/question.js          shared single-question runner (practice/timed/review)
js/modes/practice.js    practice mode + smart randomisation + filters
js/modes/timedQuestion.js
js/modes/simulation.js  section / full-test simulation + scored results
js/modes/review.js      review-mistakes queue
lib/pdfjs/              vendored pdf.js 4.10.38 (legacy build) + worker + cMaps + standard_fonts
icons/                  192 / 512 / 180 + maskable
```

---

## Development

No build step. Serve the folder over HTTP (service workers and ES modules need a
server, not `file://`):

```bash
python -m http.server 8080
```

Then open <http://localhost:8080/>. Run the scoring checks at
<http://localhost:8080/test.html>.

To update the vendored pdf.js, replace the files under `lib/pdfjs/` and bump
`CACHE_VERSION` in `sw.js` so phones pick up the change.

### Pushing
```bash
git add -A
git commit -m "Your message"
git branch -M main
git remote add origin https://github.com/<your-user>/<repo>.git
git push -u origin main
```

---

## Notes

- Everything uses **relative paths** (`./`) so it works from a project subpath on
  GitHub Pages.
- Timers are **timestamp-based** (computed from a stored `endTime`), so they stay
  correct when iOS backgrounds the app. Simulation progress is saved continuously and
  resumes with the right remaining time.
- Score estimates exclude the writing task and are labelled as estimates.
