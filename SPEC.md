# smm-analytics — v1 Spec

> Free, self-hosted SMM analytics tool for marketers. Tracks your own LinkedIn + X profiles
> and segments engagement by audience type — so you see *who's actually reading you*,
> not just how many likes you got.

## Who it's for
Solo marketer / small marketing team / founder doing their own SMM. Anyone who wants
to answer two questions:

1. **"Of the people engaging with my posts, how many are my target audience?"**
2. **"Which posts work best for which audience?"** (e.g., my deep-tech rants resonate with
   Engineers, but my career-arc reflections pull in Founders — so I should write more of
   each for the right audience.)

## What it does (v1)
1. Connects once to your LinkedIn + X via a launched browser window — log in normally,
   we save the session cookies locally. No paid GoLogin, no API keys, no third-party servers.
2. Scrapes your most recent posts (likes, comments, reposts, impressions).
3. For each like, reads the person's name + headline.
4. Classifies each person into a segment you defined (`segments.yaml`) — VC, Founder,
   Engineer, Designer, etc.
5. Computes `% target audience` per post: of the people who liked, how many are in
   the segments YOU declared as your target.
6. Stores everything in local SQLite. Opens a local web dashboard.

## Architecture (kept simple)

```
[ User runs: npx smm-analytics ]
        │
        ├─ setup wizard (first run)
        │     └─ launches Chrome → user logs in to LinkedIn / X
        │     └─ writes session cookies + config to ~/.smm-analytics/
        │
        ├─ scrape (one shot or daily cron)
        │     └─ Puppeteer → activity feed → reactions modal → classify
        │     └─ writes to ~/.smm-analytics/data.db (SQLite)
        │
        └─ dashboard
              └─ npx smm-analytics dashboard
              └─ opens http://localhost:5173 (static HTML + JSON from SQLite)
```

## What the user customizes

`~/.smm-analytics/config.yaml`:
```yaml
profiles:
  linkedin: vadim-smirnov            # username
  twitter: GusevV1987                # @ handle (no @)

# Which segments are "my target audience"? % is computed against these.
my_targets: [Founder, Engineer, Designer]

# Optional: people to exclude from all metrics (your own team, alt accounts)
exclude:
  - linkedin: vova-gusev
  - name: "Irina Martyshova"
```

`~/.smm-analytics/segments.yaml` (defaults shipped, fully editable):
```yaml
# Priority order: first match wins
- id: VC
  keywords: [investor, partner at, venture, capital, fund]
- id: Founder
  keywords: [founder, ceo, co-founder, owner]
- id: Engineer
  keywords: [engineer, developer, swe, sre, devops, programmer]
- id: Designer
  keywords: [designer, ux, ui, product design]
- id: Marketer
  keywords: [marketing, growth, demand gen, brand]
- id: Operator
  keywords: [coo, head of operations, chief of staff]
- id: Other       # fallback
  keywords: []
```

## Dashboard views (v1)

1. **Overview** — total posts, engagement, % target audience trend over time.
2. **Posts table** — every post with per-segment like breakdown.
3. **Top posts per segment** — for each segment in `segments.yaml`, the top 5 posts that
   resonated most. Answers "what kind of content works for Founders vs Engineers?"
4. **Heatmap** — posts × segments matrix. Quickly spot which themes hit which audience.

## What v1 does NOT do (cut intentionally)
- Multiple profiles per user / competitor tracking — v2
- Automatic scheduling (the user runs `npx smm-analytics run`, or sets their own cron) — v2
- AI-powered classification — keyword rules only, deterministic
- Posting / drafting / scheduling content — out of scope
- Cloud sync / SaaS hosting — fully local

## Distribution
- `npx smm-analytics` — no install required
- `npm install -g smm-analytics` — for daily users
- Runs on Mac / Linux / Windows (anywhere Node 18+ runs)

## Stack
- Node 20 + TypeScript
- Puppeteer (bundled Chromium) — no GoLogin dependency
- better-sqlite3 — local data, zero-config
- Vite + plain JS for the dashboard (no framework heavy lift)
- yaml + zod — config validation

## License
MIT.

## Repo
`github.com/Vadim2090/smm-analytics` (public)

## Out-of-the-box experience target

```
$ npx smm-analytics
🔧 First run — let's set you up.

? LinkedIn username (e.g. vadim-smirnov from your profile URL):  vadim-smirnov
? X / Twitter handle (without @):  GusevV1987
? Which audiences are you targeting? (space to select, enter to confirm)
  ◉ Founder
  ◉ Engineer
  ◯ VC
  ◉ Designer
  ◯ Marketer
  ◯ Operator

🌐 Opening browser. Please log in to LinkedIn and X, then come back here.
   (We never see your password — Chrome stores the session locally.)
✅ Logged in. Cookies saved to ~/.smm-analytics/cookies/

📊 Scraping LinkedIn (15 posts) and X (15 posts)...
   LinkedIn: 14 posts, 230 reactions classified
   X: 12 posts, 89 likers classified

🎯 Your target audience makes up 47% of LinkedIn engagement
   and 31% of X engagement. Top post: "Non-dev CEO now looks like this" (62%)

🔗 Open dashboard: http://localhost:5173
```

## Build phases

| Phase | Scope | Days |
|---|---|---|
| 0 | Repo skeleton, SPEC, LICENSE, README, package.json | 0.5 |
| 1 | Core scrape loop refactored to be config-driven (no Vova hardcoding) | 1 |
| 2 | Browser login flow (replace GoLogin) | 1 |
| 3 | SQLite storage + simple dashboard | 1 |
| 4 | `npx` packaging + setup wizard | 0.5 |
| 5 | README, screenshots, `awesome-list` submissions | 0.5 |

Total: ~4-5 focused days.
