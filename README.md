# Video Game Buylist Website

A simple website to publish your buylist, let customers submit selected games with quantities, and let you manage prices/titles without editing code.

## Features
- Seller submission page with search and quantity selection
- Submission form that creates a shipment summary with itemized totals
- Admin page to:
  - Add / edit / delete games
  - Mark titles active/inactive (hide without deleting)
  - Export buylist to CSV for Excel
  - Import buylist from CSV to replace the list monthly
  - View recent submissions and item totals
- SQLite database storage (local file)

## Quick Start
1. Install dependencies:

```bash
npm install
```

2. Create environment file:

```bash
cp .env.example .env
```

3. Set a strong `ADMIN_KEY` in `.env`.

4. Run the server:

```bash
npm start
```

5. Open:
- Seller page: `http://localhost:3000/` (also available at `/seller.html`)
- Admin page: `http://localhost:3000/admin.html`

## CSV Format
When importing CSV in admin, use this exact header:

```csv
title,platform,condition,price,active
```

Example row:

```csv
Super Mario Odyssey,Nintendo Switch,Complete in box,25.00,1
```

`active` values:
- `1` = visible on public buylist
- `0` = hidden from public buylist

## Notes
- CSV import fully replaces the game list.
- Submission records remain in the database.
- Default seeded sample titles are added automatically when database is empty.

## Deploy To Render (Alternative Host)
1. Push this project to a GitHub repo.
2. In Render, choose **New +** -> **Blueprint**.
3. Connect the repo and deploy using `render.yaml`.
4. In Render environment variables, set:
   - `ADMIN_KEY` = your admin password key
5. Open the generated Render URL.

`render.yaml` mounts persistent disk storage at `/var/data` so your SQLite buylist data stays saved.
