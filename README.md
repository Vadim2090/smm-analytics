# smm-analytics

> Self-hosted dashboard for LinkedIn + X. Tracks every post you make over time, segments your audience the way **you** define it, and shows you what content actually works for the people you care about.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node 18+](https://img.shields.io/badge/Node-18%2B-green.svg)](https://nodejs.org)

## Why this exists

LinkedIn does show per-post demographics — Company size, Job title, Industry, Seniority, Location. Useful, but with five real limits:

1. **Per post only** — you have to click into each post. No aggregate across your last 50 posts.
2. **LinkedIn's pre-baked buckets** — Software Engineer / Founder / Director / Senior / Entry / IT Consulting. You can't define "VC building AI" or "Founders in YC" or "Friends from college".
3. **Anonymous percentages** — you see *"22% are Software Engineers"* but not **which 22%**. You can't build a list. You can't follow up.
4. **No way to exclude noise** — your team, friends, alt accounts inflate every breakdown.
5. **Roughly 28-day window** for most metrics.

X gives you even less.

So the question that actually matters is hard to answer:

> *"What type of content is hitting my target audience — and which specific people engaged with it, so I can follow up?"*

This tool fills that gap:

- **Define your own audience segments** — VC, Founder, Engineer, Designer, your own buckets. Keyword rules in a Google Sheet, not code.
- **Cross-post and per-post breakdowns** — which posts pull in Founders, which pull in Engineers, across both LinkedIn and X.
- **Named individuals, not anonymous percentages** — every reactor with name, headline, profile URL, and segment. Drop into your CRM, follow up, build lookalike lists.
- **Exclude noise** — your team, friends, alt accounts never count toward audience segments.
- **Full history** — every post you make appended to your own Google Sheet, not capped at 28 days.

## The two questions it answers

1. **Of the people engaging with my posts, how many are my target audience?**
2. **Which of my posts work best with which audience?**

Your deep-tech rants pull in Engineers; your career-arc reflections pull in Founders. Knowing the split changes what you write next.

## How it works

```
GoLogin (or analogue) → logged-in browser → Puppeteer → scrape feed →
  classify each engager (segments YOU define) → write to your Google Sheet
```

You bring your own browser session (via GoLogin / Multilogin / AdsPower) and your own Google Sheet. The tool runs locally on your machine. Nothing is sent to a third-party server.

## What you'll need

- **Node 18+**
- **A GoLogin account** (free trial works) — or any analogue: Multilogin, AdsPower, Octo Browser. The default code uses `gologin` SDK; swap for your tool by editing [`src/browser.js`](src/browser.js).
- **A Google Cloud project + service account** (free) for writing to Sheets.
- **A Google Sheet** you create (the tool auto-populates the tabs).

## Setup (one-time, ~15 min)

### 1. Clone + install

```bash
git clone https://github.com/Vadim2090/smm-analytics.git
cd smm-analytics
npm install
```

### 2. GoLogin profile (or analogue)

1. Sign up at [gologin.com](https://gologin.com) (or your tool of choice).
2. Create a browser profile and **log in to LinkedIn + X manually inside it**.
3. Note the profile ID — you'll paste it into `.env`.
4. Get an API token from [your account settings](https://app.gologin.com/personalArea/TokenApi).

### 3. Google service account

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com).
2. Enable **Google Sheets API**.
3. Create a service account → key (JSON) → download.
4. Save the JSON somewhere (e.g. `~/.smm-analytics-sa.json`).

### 4. Google Sheet

1. Create a new blank Google Sheet.
2. Share it with the service account's email (Editor access).
3. Copy the sheet ID from the URL: `https://docs.google.com/spreadsheets/d/<THIS_PART>/edit`.

### 5. Configure

```bash
cp .env.example .env
```

Edit `.env` with your tokens, paths, IDs, handles, and target segments. See `.env.example` for inline guidance.

### 6. Run

```bash
npm start
```

First run auto-creates two tabs in your sheet:
- **Segments** — defines the audience buckets (VC, Founder, Engineer, etc.) and their keyword rules. Edit in Sheets, no code change.
- **Excluded People** — your team / alt accounts / anyone you want excluded from "outside team" totals.

Subsequent runs append/update the LinkedIn + X tabs.

## Daily / scheduled runs

This is a regular Node script, so use whatever scheduler you like:

```bash
# crontab — daily at 9am UTC
0 9 * * * cd /path/to/smm-analytics && /usr/bin/node src/index.js >> /var/log/smm-analytics.log 2>&1
```

## Customizing audiences (no code)

The **Segments** tab is the heart of the tool. Each row defines one audience bucket:

| Segment ID | Keywords (comma-separated)                        | Priority |
|------------|---------------------------------------------------|----------|
| VC         | investor, partner at, venture, capital, fund     | 1        |
| Founder    | founder, co-founder, ceo, owner                   | 2        |
| Engineer   | engineer, developer, swe, devops                  | 3        |
| Designer   | designer, ux, ui, product design                  | 4        |
| Marketer   | marketing, growth, brand, smm                     | 5        |
| Other      | _(empty = fallback)_                              | 99       |

**Priority** is ascending — lower number = checked first. The first segment whose keyword set matches the engager's headline wins. The empty-keywords segment catches everyone else.

You can rename segments, add new ones (Lawyer, Operator, Sales, Recruiter…), tune keywords. Re-run `npm start` to pick up changes.

## What goes into the sheet

Per platform tab (LinkedIn, X):

- One row per post: text, URL, date, impressions, total likes, comments, reposts
- Outside-team totals (after excluded list)
- One column per segment (`VC Likes`, `Founder Likes`, …)
- **% Target Audience** — share of outside-team likes that fall into your `MY_TARGETS`

Plus a **Detail** tab listing every reactor with their classification — for spot-checking and pivoting.

## Troubleshooting

- **0 posts scraped?** LinkedIn changed its DOM. Open `src/linkedin.js` and update selectors. See `console` output for clues.
- **`% Target Audience` is N/A?** Check that the IDs in `MY_TARGETS` (in `.env`) exactly match segment IDs in the Segments tab.
- **Browser hangs?** Run with `--visible` to see what GoLogin is doing: `npm start -- --visible`.
- **GoLogin proxy slow?** Consider switching the profile's proxy or removing it.

## Contributing

Issues and PRs welcome. See [SPEC.md](SPEC.md) for design notes.

## License

[MIT](LICENSE).
