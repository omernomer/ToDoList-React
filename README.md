# Accessibility Audit Automation Tool

This repository now contains an MVP accessibility baseline scanner with a React dashboard and an Express worker-style API.

## What it does

- accepts a public root URL and creates a scan job
- crawls a limited number of internal pages with depth limits
- runs automated heuristic accessibility checks and maps findings to WCAG 2.2 references
- de-duplicates recurring findings and assigns a priority score
- generates JSON, CSV, and PDF reports
- can export grouped findings to GitHub issues
- clearly labels the output as an automated baseline, not legal advice or certification

## Apps

### Frontend

```bash
cd react-from-scratch
npm install
npm run dev
```

The UI is served on `http://localhost:3000`.

### API / scanner

```bash
cd react-ecosystems-server
npm install
npm start
```

The API is served on `http://localhost:8080`.

## Useful routes

- `POST /audit-jobs`
- `GET /audit-jobs`
- `GET /audit-jobs/:id`
- `GET /audit-jobs/:id/reports/:format`
- `POST /audit-jobs/:id/github-export`

## Important note

This MVP provides an automated technical baseline only. Manual accessibility testing is still required for keyboard support, dynamic UI behavior, assistive technology compatibility, contrast validation, and legal/compliance interpretation.
