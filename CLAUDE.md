# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start Vite dev server
npm run build      # Production build
npm run lint       # ESLint
npm run preview    # Preview production build locally
```

No test suite exists in this project.

## Architecture

**Vite + React 19 SPA** — polymer manufacturing tracking system for Venkateswara Polymers, built by AvlokAI.

### Auth & Roles

Two roles: `owner` and `worker`. Auth state lives in `localStorage` (`token`, `user_id`, `role`, `demo_user`). `App.jsx` reads localStorage on init, stores user in React state. All protected routes check role via `ProtectedRoute`. Workers only see `/production-log` and `/wastage`; owners see everything.

### API Layer (`src/utils/api.js`)

Single axios client pointed at `https://vp-api.avlokai.com`. Two interceptors:
- **Request**: injects `Authorization: Bearer <token>` from localStorage; redirects to `/login` on missing token.
- **Response**: transforms snake_case API responses to camelCase using endpoint-keyed `transformers` map. Unwraps `response.data.data` automatically.

Enable API call logging: `localStorage.setItem('vp_api_logs', '1')` (auto-enabled in DEV).

### Pages & Routes

| Route | Role | Page |
|---|---|---|
| `/` | owner | Dashboard |
| `/trading` | owner | Trading |
| `/production-log` | owner, worker | Production |
| `/materials` | owner, worker | MaterialMovement |
| `/wastage` | owner, worker | Wastage |
| `/production-orders` | owner | ProductionOrders |
| `/fulfillment` | owner | Fulfillment |
| `/reports` | owner | MachineReports |
| `/raw-material` | owner | RawMaterial |
| `/users` | owner | Users |

Route transitions use `framer-motion` `AnimatePresence` with `opacity + y` animation.

### Component Conventions

- `src/components/ui/` — Radix UI primitives (button, checkbox, input, label) styled with `class-variance-authority` + `tailwind-merge`
- `src/components/` — app-level shared components (Sidebar, DataTable, EditEntryModal, Toast, Charts, etc.)
- `src/pages/` — one file per route, contains all page-specific logic
- `src/utils/` — pure utility modules: `api.js` (HTTP), `orders.js`, `stock.js`, `exportToExcel.js`, `logActions.js`, `productionSession.js`
- `src/hooks/` — `usePersistentState.js` for localStorage-backed state

### Styling

Tailwind CSS v4 via `@tailwindcss/vite`. Dark mode toggled by adding/removing `dark` class on `<html>`. Custom CSS variables used for semantic tokens (`bg-bg-primary`, `text-text-secondary`, `accent-gold`, `border-border-default`, etc.) — defined in `src/index.css`.

### Data Export

`src/utils/exportToExcel.js` uses the `xlsx` package to export table data.

### Toast System

`src/components/Toast.jsx` exports `ToastProvider` (wraps app in `App.jsx`) and a `useToast` hook. Use this for all user feedback.
