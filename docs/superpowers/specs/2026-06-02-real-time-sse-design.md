# Real-Time SSE: Eliminate Polling

**Date:** 2026-06-02  
**Status:** Approved

## Goal

Replace all `setInterval` polling with SSE-driven reactivity. Add optimistic local state updates on form submit for instant perceived response.

## Architecture

```
User submits form
  → optimistic local state update (instant)
  → await api.post(...) resolves
  → backend broadcast() fires
  → SSE pushes event to all connected clients
  → each page's useSSE callback invokes loadData()
  → server truth replaces optimistic state
```

No polling fallback. SSE auto-reconnects in 3s on disconnect — fast enough.

## Backend Changes (server.py)

Add `await broadcast(event_type)` before `return` in these handlers:

| Line | Endpoint | Event type |
|---|---|---|
| 593 | `POST /materials` | `raw_material` |
| 635 | `PUT /raw-material/batches/{id}` | `raw_material` |
| 668 | `DELETE /raw-material/batches/{id}` | `raw_material` |
| 682 | `POST /raw-material/batches/bulk-delete` | `raw_material` |
| 881 | `PUT /floor/transactions/{id}` | `material_movement` |
| 908 | `DELETE /floor/transactions/{id}` | `material_movement` |
| 924 | `POST /floor/transactions/bulk-delete` | `material_movement` |

## Frontend Changes (per page)

### Event type map

| Page | SSE events |
|---|---|
| MaterialMovement | `material_movement`, `floor_stock` |
| Production | `production`, `floor_stock` |
| Fulfillment | `orders`, `floor_stock` |
| Stocks | `floor_stock`, `raw_material` |
| Wastage | `wastage` |
| MachineReports | `production` |
| Users | `users` |
| Dashboard | already wired — remove setInterval only |
| RawMaterial | already wired — remove setInterval only |

### 3 changes per page

1. **Wire useSSE** — call `useSSE(events, loadData)` with correct event list
2. **Remove setInterval** — delete `setInterval` block and its `clearInterval` cleanup
3. **Optimistic prepend** — after API call resolves, prepend new entry to local state array

### Optimistic update pattern

```js
// After await api.post(...) resolves successfully:
setData(prev => [newEntry, ...prev])
// useSSE fires shortly after → loadData() runs → server truth replaces local state
```

No rollback needed. Optimistic add only runs after API resolves. If API throws, toast shows error and state is unchanged.

## Error Handling

No changes. Existing toast system handles API errors. SSE disconnect handled by useSSE auto-reconnect (3s delay, already implemented).

## Scope

- `server.py`: 7 broadcast additions
- `src/pages/`: 9 pages modified (7 full rewire + 2 setInterval removal)
- `src/hooks/useSSE.js`: no changes
- No new dependencies
