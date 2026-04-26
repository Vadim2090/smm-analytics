# smm-analytics — v0.1 Spec

> Free, self-hosted SMM analytics tool for marketers. Tracks your own LinkedIn + X
> profiles and segments engagement by audience type — so you see *who's actually
> reading you*, not just how many likes you got.

## Who it's for

Solo marketer / small marketing team / founder doing their own SMM. Anyone who
wants to answer:

1. **"Of the people engaging with my posts, how many are my target audience?"**
2. **"Which posts work best for which audience?"**

## Design principles

1. **Don't reinvent what works.** Reuse battle-tested infrastructure (GoLogin,
   Google Sheets, Puppeteer). The thing that's hard about SMM analytics isn't
   browser automation — it's segmentation. Spend complexity there.
2. **Local-first.** No SaaS, no third-party data store, no telemetry.
3. **No code edits for normal use.** Segments + exclusion list live in the user's
   own Google Sheet. Code change only for tuning DOM selectors after platform
   changes.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  User's machine                                                 │
│                                                                 │
│  .env  ──┐                                                      │
│          ├──> config.js ──> index.js                            │
│  GoLogin │         │             │                              │
│  profile │         ▼             ▼                              │
│          │     browser.js   classifier.js                       │
│          │         │             ▲                              │
│          │         ▼             │ segments + excluded          │
│          │     linkedin.js,  ────┴─── from Sheet                │
│          │     twitter.js                                       │
│          │         │                                            │
│          │         ▼                                            │
│          │     sheets.js ───────────┐                           │
│          │                          │                           │
└──────────┼──────────────────────────┼───────────────────────────┘
           │                          │
           ▼                          ▼
   ┌──────────────────┐      ┌─────────────────────────┐
   │  GoLogin / X     │      │   Your Google Sheet     │
   │  Multilogin /    │      │   • LinkedIn  ◄ output  │
   │  AdsPower / etc. │      │   • X         ◄ output  │
   │  (paid, BYO)     │      │   • Segments  ► input   │
   └──────────────────┘      │   • Excluded  ► input   │
                             └─────────────────────────┘
```

## What v0.1 does

- Scrapes own LinkedIn + X most recent posts
- Reads engagers (likes / reactions) — name + headline
- Classifies each engager via user-defined segments (Sheet-driven)
- Writes per-post breakdown to user's Google Sheet
- `% Target Audience` column = share of outside-team likes falling into `MY_TARGETS`
- Detail tab — every reactor with their classification

## What v0.1 does NOT do (cut intentionally)

- Track other people's profiles (competitors / influencers) — v0.2
- Comments / reposts classification (only likes are classified) — v0.2
- AI / LLM-powered classification — keyword rules only, deterministic
- Posting / drafting / scheduling content — out of scope
- Cloud sync / SaaS hosting — fully local

## Stack

- **Node 20** (ESM)
- **gologin** — browser profile management
- **puppeteer-core** (bundled with gologin) — DOM scraping
- **googleapis** — Sheets API v4
- **dotenv** — env loading
- That's it. Six dependencies including transitive.

## License

MIT.

## Repo

`github.com/Vadim2090/smm-analytics` (public).
