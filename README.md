# VFFL Fixed Income Report Generator

A React + Vite web application for **Vivek Financial Focus Limited** that generates professional, print-ready fixed income portfolio statements for clients.

## Features

- **CSV Upload** — Upload client bond data via CSV; clients sharing a `family_group` are automatically consolidated into one report
- **AI Market Commentary** — Generates concise, professional market commentary using Claude AI (Anthropic API)
- **PDF-Ready Reports** — Produces styled HTML reports that can be printed/saved as PDF via the browser
- **Cashflow Schedule** — Full cashflow-to-maturity table with cumulative totals
- **FD Benchmarking** — Compares portfolio weighted yield vs HDFC Bank & Post Office FD rates
- **Live Rate Fetching** — Optionally fetch current FD benchmark rates via AI web search
- **Logo Upload** — Customise reports with your firm logo
- **Family Grouping** — Clients with the same `family_group` value are merged into a single consolidated report

## Tech Stack

- [React 19](https://react.dev/) + [Vite 7](https://vite.dev/)
- [Anthropic Claude API](https://www.anthropic.com/) — for AI commentary and live rate fetching
- Vanilla CSS-in-JS (no UI library dependency)

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## CSV Format

The app expects a CSV with the following columns:

| Column | Description |
|---|---|
| `client_id` | Unique client ID |
| `client_name` | Full name |
| `family_group` | Clients with the same value get one consolidated report |
| `bond_name` | Bond description |
| `isin` | ISIN code |
| `num_bonds` | Units held |
| `face_value_invested` | Total face value (INR) |
| `date_of_investment` | YYYY-MM-DD |
| `yield_pct` | Yield to maturity (%) |
| `coupon_rate` | Coupon rate (%) |
| `purchase_date` | YYYY-MM-DD |
| `issue_date` | YYYY-MM-DD |
| `maturity_date` | YYYY-MM-DD |
| `interest_frequency` | Monthly / Quarterly / Half-Yearly / Annual |
| `credit_rating` | AAA / AA+ / AA etc. |
| `rating_agency` | CRISIL / ICRA / CARE |
| `cf_date_1` to `cf_date_24` | Future cashflow dates |
| `cf_amount_1` to `cf_amount_24` | Cashflow amounts (INR) |

A sample CSV template is available within the app (click **CSV Template**).

## Report Output

Each generated report includes:

- Firm header with logo
- AI-generated market commentary
- Portfolio summary (total invested, weighted yield, number of bonds)
- FD benchmark comparison with extra income calculation
- 30 / 60 / 90-day upcoming cashflow strip
- Full bond holdings table
- Cashflow schedule to maturity

Reports download as `.html` files. Open in browser then Ctrl+P to Save as PDF.

## Build

```bash
npm run build
```

Output goes to `dist/`.

---

*Vivek Financial Focus Limited — NSE & BSE Member · NSDL DP · SEBI Registered*
