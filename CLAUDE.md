# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start Vite dev server
npm run build      # Production build
npm run lint       # ESLint
npm run preview    # Preview production build locally
```

Tests: `python -m pytest -q tests` (rules) and `tests/e2e/api_flow.py` (disposable API + DB).

## Architecture

**Vite + React 19 SPA** — polymer manufacturing tracking system for Venkateswara Polymers, built by AvlokAI.

### Auth & Roles

Two roles: `owner` and `worker`. Auth state lives in `localStorage` (`token`, `user_id`, `role`, `demo_user`). `App.jsx` reads localStorage on init, stores user in React state. All protected routes check role via `ProtectedRoute`. Workers see daily entry, stock and reports; owners also see the dashboard, adjustments, orders and admin. The API enforces roles and closed days.

### API Layer (`src/utils/api.js`)

Single axios client pointed at `https://vp-api.avlokai.com`. Two interceptors:
- **Request**: injects `Authorization: Bearer <token>` from localStorage; redirects to `/login` on missing token.
- **Response**: transforms snake_case API responses to camelCase using endpoint-keyed `transformers` map. Unwraps `response.data.data` automatically.

Enable API call logging: `localStorage.setItem('vp_api_logs', '1')` (auto-enabled in DEV).

### Pages & Routes

| Route | Role | Page |
|---|---|---|
| `/` | owner | Dashboard (stores, reorder warnings, today's day/night output, 14-day trend) |
| `/raw-material` | owner, worker | RawMaterial (receipts onto Ground/1st Floor, material master) |
| `/stock/transfers` | owner, worker | StockTransfers (Ground Floor ⇄ 1st Floor) |
| `/production-log` | owner, worker | Production (extruders: resin blend → rolls) |
| `/cutting` | owner, worker | Cutting (rolls → finished goods) |
| `/stock/adjustments` | owner | StockAdjustments (physical count, correction, return, damage) |
| `/stock/ledger` | owner, worker | StockLedger (day register + close day) |
| `/stock` | owner, worker | StockOverview (all stores, alert levels) |
| `/stock/activity` | owner, worker | StockActivity (the stock ledger) |
| `/reports?tab=register\|shift\|summary` | owner, worker | Reports (inventory register, shift sheet, summary; Excel) |
| `/production-orders`, `/fulfillment`, `/trading`, `/users`, `/issue-reports` | owner | unchanged |

Stock model, wastage → regrind, reversals and reports: see `ops/ipms/README.md`. Backend:
`server.py` (FastAPI) + `ipms_logic.py` (pure rules, unit-tested) + `reports_xlsx.py` (Excel) +
`schema.sql` (applied on start). Weights display via `src/utils/units.js` (kg below 1,000 kg, tons above).

Route transitions use `framer-motion` `AnimatePresence` with `opacity + y` animation.

### Component Conventions

- `src/components/ui/` — Radix UI primitives (button, checkbox, input, label) styled with `class-variance-authority` + `tailwind-merge`
- `src/components/` — app-level shared components (Sidebar, DataTable, Toast, Charts, `ipms/` stock kit, etc.)
- `src/pages/` — one file per route, contains all page-specific logic
- `src/utils/` — pure utility modules: `api.js` (HTTP), `orders.js`, `stock.js`, `exportToExcel.js`, `logActions.js`, `productionSession.js`
- `src/hooks/` — `usePersistentState.js` for localStorage-backed state

### Styling

Tailwind CSS v4 via `@tailwindcss/vite`. Dark mode toggled by adding/removing `dark` class on `<html>`. Custom CSS variables used for semantic tokens (`bg-bg-primary`, `text-text-secondary`, `accent-gold`, `border-border-default`, etc.) — defined in `src/index.css`.

### Data Export

`src/utils/exportToExcel.js` uses the `xlsx` package to export table data.

### Toast System

`src/components/Toast.jsx` exports `ToastProvider` (wraps app in `App.jsx`) and a `useToast` hook. Use this for all user feedback.
