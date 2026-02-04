# Oliver's Application Tracker

A minimalist, AI-assisted application tracker built for focus. Oliver’s keeps your pipeline clean, local, and beautifully readable across desktop, tablet, and phone.

## Release Highlights
- **Local-first**: All data stays in your browser. No server required.
- **AI-assisted updates**: Paste a rejection or interview email and let the assistant handle status changes.
- **Timeline clarity**: Every change lands in a clean, vertical timeline.
- **Note-first details**: One focused note per application—fast to read and edit.
- **Import/Export ready**: Drag in CSV/JSON, export your data anytime.
- **Dark mode**: Polished, low‑glare UI with smooth transitions.

## Quick Start
```bash
npm install
npm run dev
```

## AI Setup
1. Open **Settings → AI**.
2. Fill in your **API Key**, **Base URL**, and **Model**.
3. Paste an email or ask for changes, e.g. “Mark Shawmut as rejected.”

The assistant outputs structured actions only; no extra prose.

## Import & Export
Open **Settings → Import & Export**:
- **Drop** a `.csv` or `.json` file to import.
- **Download JSON export** to backup your data.
- **Download CSV template** to prep a clean import.

### CSV Template
The CSV template includes the following columns:
```
company,role,status,appliedDate,note
```
- `company`, `role` are required
- `status` values: `applied`, `interviewed`, `offer`, `accepted`, `rejected`, `archived`
- `appliedDate` uses `YYYY-MM-DD`

## Scripts
```bash
npm run dev
npm run build
npm run preview
npm test
```

## Data Storage
Oliver’s stores data locally in your browser:
- `resumeTracker.jobs`
- `resumeTracker.schema`

---

If you want a hosted version or cloud sync, Firebase integration can be added later.
