# smm-analytics

> Free, self-hosted SMM analytics for marketers. Tracks your LinkedIn + X presence and segments engagement by audience type — so you see *who's actually reading you*, not just how many likes you got.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node 18+](https://img.shields.io/badge/Node-18%2B-green.svg)](https://nodejs.org)

## What it answers

1. **Of the people engaging with my posts, how many are my target audience?**
2. **Which posts work best for which audience?**

E.g. your deep-tech rants pull in Engineers, your career-arc reflections pull in Founders. Knowing the split changes what you write next.

## Quick start

```bash
npx smm-analytics
```

First run launches an interactive setup:

1. Asks for your LinkedIn / X handles
2. Asks which audiences you're targeting (Founder / Engineer / Designer / VC / etc.)
3. Opens a real Chrome window — log in to LinkedIn + X normally
4. Scrapes recent posts, classifies engagers, opens a local dashboard

No GoLogin. No Google Cloud. No API keys. No third-party servers.

## Status

🚧 **In active development.** v0.1 ships once Phases 0–4 are complete (see [SPEC.md](SPEC.md#build-phases)).

## Configuration

Two YAML files in `~/.smm-analytics/`:

`config.yaml`
```yaml
profiles:
  linkedin: vadim-smirnov
  twitter: GusevV1987

my_targets: [Founder, Engineer, Designer]

exclude:
  - linkedin: vova-gusev
  - name: "Irina Martyshova"
```

`segments.yaml`
```yaml
- id: VC
  keywords: [investor, partner at, venture, capital, fund]
- id: Founder
  keywords: [founder, ceo, co-founder, owner]
- id: Engineer
  keywords: [engineer, developer, swe, sre, devops, programmer]
# … add your own
```

## How it works

```
[ npx smm-analytics ]
        │
        ├─ setup wizard (first run)
        │    └─ launches Chrome → user logs in → cookies stored locally
        │
        ├─ scrape
        │    └─ Puppeteer → activity feeds → reactions modal → classify
        │    └─ writes to ~/.smm-analytics/data.db (SQLite)
        │
        └─ dashboard
             └─ npx smm-analytics dashboard
             └─ http://localhost:5173
```

## License

MIT.

## Contributing

Issues and PRs welcome once v0.1 is out. See [SPEC.md](SPEC.md) for architecture and roadmap.
