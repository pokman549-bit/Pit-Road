# Pit Road — CLAUDE.md

Personal fitness + athletic-progress tracker for a single user training to become a NASCAR over-the-wall pit athlete (fueler / jackman). Phone-first, dark theme, no login, all data in localStorage, AI via Anthropic Claude API.

## User
Zero coding experience. Requires step-by-step terminal instructions. Physical profile saved in memory.

## Stack
- Vanilla JS SPA (no React / no build tools)
- Node.js + Express local server (`server.js`) — serves `public/` and proxies Claude API
- `localStorage` for all data (keys prefixed `pr_`)
- Google Fonts: Barlow Condensed (headings) + Inter (body), loaded in `index.html`

## Files
```
Pit-Road/
  server.js          — Express server + Claude API proxy
  .env               — ANTHROPIC_API_KEY + PORT=3000
  public/
    index.html       — HTML shell, loads fonts + styles.css + app.js
    styles.css       — Full dark theme design system
    app.js           — All frontend logic (2400+ lines)
```

## Starting the server
```powershell
node server.js
```
- Runs on `0.0.0.0:3000` — accessible on phone via local network IP printed at startup
- DO NOT use `npm start` (PowerShell execution policy blocks it)
- If port already in use: previous instance still running; just open browser at localhost:3000

## .env quirk — IMPORTANT
`dotenv` must use `override: true` because Windows has an empty `ANTHROPIC_API_KEY` system env var that silently blocks loading:
```js
require('dotenv').config({ override: true });
```

## AI models
- **Workout generation:** `claude-haiku-4-5-20251001` — fast, structured JSON
- **Coach chat / nutrition chat / review:** `claude-sonnet-4-5`
- **Vision (label scan, photo estimate, body scan):** `claude-haiku-4-5-20251001` for fast reads, `claude-sonnet-4-5` for body screenshot scan
- Claude API proxy endpoint: `POST /api/claude`
- `callClaude(msg, maxTokens)` — text only, Haiku
- `callClaudeVision(base64, mediaType, prompt, maxTokens)` — vision, Haiku

## localStorage keys (all prefixed `pr_`)
- `pr_setup` — boolean, first-launch flag
- `pr_baselines` — array of baseline snapshots
- `pr_workouts` — array of logged workouts
- `pr_bodylogs` — array of body check-in entries (weight, body fat %, etc.)
- `pr_nutriday_YYYY-MM-DD` — array of food entries for that date
- `pr_nutri_targets` — macro targets object

## Nav bar (5 items)
Home | Train | Progress | Coach | Fuel

Screens: `screen-wizard` `screen-home` `screen-train` `screen-generated` `screen-log` `screen-progress` `screen-chat` `screen-history` `screen-detail` `screen-bodylog` `screen-nutrition` `screen-nutr-add` `screen-nutr-chat`

- History screen (`screen-history`) still exists but has NO nav button — accessible by tapping calendar days on Home
- Manual workout log via Train screen "Log Manually Instead" link or generated workout "Log This Workout"

## Features built (all complete)

### 1. Baseline wizard + manual log + dashboard
- 6-step wizard: sprint / broad jump / agility / lift / bodyweight
- Dashboard shows: stat pills (Sessions, Phase, Last workout) + streak card + baselines grid + calendar

### 2. AI Daily Trainer
- Generates session-typed workouts via Haiku; respects gym choice and phase
- `determinePhase(workouts)` / `getNextSessionType(workouts, phase)`
- Phase 1: weeks 1–4 (A/B/C) | Phase 2: weeks 5–10 (A/B/C/D) | Phase 3: week 11+ (S/P)
- Gym profiles: UNOH (full weights) | Planet Fitness (machines/DBs only, NO barbell/rack/platform)

### 3. AI Coach Chat
- Multi-turn with Sonnet; parses `WORKOUT_UPDATE:` marker to modify active workout
- `_chatHistory` array, `openChat(returnScreen)`

### 4. Progress Charts
- Compact 2×2 tile grid (Sprint, Agility, Broad Jump, Trap-Bar 1RM) + full-width bodyweight tile
- Tap tile → expands SVG chart below (accordion)
- `_progMetrics`, `_progSelected`, `expandMetricChart(id, skipScroll)`

### 5. Streak + Calendar (Home screen)
- Streak card: current streak (🔥 + big number) + best streak — sits above calendar
- `calcStreak(workouts)` → `{ current, longest }`
- Month calendar with workout dots; tap day → opens workout detail
- `calNav(delta)` updates both `dash-calendar` (Home) and `history-list` (History screen)
- `_calYear`, `_calMonth` shared state

### 6. Body Log
- Daily check-in: weight + 12 body composition fields (body fat %, muscle mass, etc.)
- AI screenshot scanner: photo of Starfit app → Claude reads all values via vision
- `screen-bodylog`, `openBodyLog()`, `scanBodyScreenshot()`, `saveBodyLog()`
- `DB.getBodyLogs()` / `DB.addBodyLog()`
- Bodyweight chart merges baseline weights + body log weights

### 7. Nutrition Tracker (`screen-nutrition`)
- Day-by-day food log with date navigation
- Tracks: **calories, protein, carbs, fat, fiber, sodium** (per serving × servings)
- Progress bars vs athletic targets (defaults: 3500 cal, 220g P, 450g C, 100g F, 40g fiber, 3500mg Na)
- **Add Food modes:**
  - ✍️ Manual entry
  - 📷 Scan Label — vision reads nutrition facts label, auto-fills form
  - 🤔 Photo Guess — vision estimates from food photo (clearly labeled ROUGH ESTIMATE)
- Serving size editable; totals auto-recalculate
- **AI Fuel Review** — inline in nutrition screen:
  - Meal / Today / This Week scope selector
  - Sends data to Sonnet; returns supportive performance-focused feedback
  - Never restrictive, never grades, always defers to RD for personalization
- **Fuel Coach Chat** (`screen-nutr-chat`) — open-ended sports fueling chat with Sonnet
- `_nutriDate`, `_nutriEntry`, `_nutriMode`, `_nutriFormData`, `_nutriReviewScope/EntryId/Result/Busy`
- `DB.getNutriDay(date)` / `DB.saveNutriDay(date, entries)` / `DB.getNutriTargets()` / `DB.saveNutriTargets(t)`

## Key formulas
- Epley 1RM: `weight × (1 + reps / 30)`
- 1RM for single rep: returns weight as-is

## BENCHMARKS constant (top of app.js)
```js
const BENCHMARKS = {
  sprint:    { label:'10-Yard Sprint',       unit:'s',   lowerIsBetter:true,  eliteMin:1.7, eliteMax:1.9 },
  agility:   { label:'Pro Agility (5-10-5)', unit:'s',   lowerIsBetter:true,  eliteMin:4.4, eliteMax:4.7 },
  broadJump: { label:'Broad Jump',           unit:'ft',  lowerIsBetter:false, eliteMin:8.5, eliteMax:9.5 },
  lift1RM:   { label:'Trap-Bar Est. 1RM',   unit:'lbs', lowerIsBetter:false, bwMultiplier:2.0 },
  bodyweight:{ label:'Bodyweight',           unit:'lbs', targetLo:240, targetHi:255 },
};
```

## CSS design tokens (styles.css — user-customized)
- `--bg` / `--surface` / `--surface2` — deep blue theme (user has been customizing these)
- `--red: #1e9fff` — primary accent (blue, despite the variable name)
- `--gold: #ffd700` — benchmark line color
- `--green: #2ecc71`
- Gradient background, blur/backdrop-filter on cards and header
- `.screen.active { display: block }` — except chat screens use `#screen-chat.active { display: flex }`

## JSON parsing for Claude responses
```js
const start = rawText.indexOf('{');
const end   = rawText.lastIndexOf('}');
const obj   = JSON.parse(rawText.slice(start, end + 1));
```

## max_tokens
- Workout generation: 1200
- Coach/nutrition chat: 600–700
- Nutrition review: 500
- Vision label scan / photo estimate: 600

## Nutrition entry data structure
```js
{
  id, name,
  perServing: { calories, protein, carbs, fat, fiber, sodium },
  servingSize,  // string e.g. "1 cup"
  servings,     // number multiplier
  source,       // 'manual' | 'label' | 'estimate'
  note          // warning text for estimates
}
```

## Security
- API key NEVER goes to browser — only lives in `.env`, only used server-side
- User has been reminded to rotate the key if ever exposed
