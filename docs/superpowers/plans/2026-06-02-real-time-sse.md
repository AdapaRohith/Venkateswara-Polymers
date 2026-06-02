# Real-Time SSE: Eliminate Polling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all `setInterval` polling with SSE-driven reactivity and add optimistic local state updates on form submit for instant perceived response.

**Architecture:** SSE infrastructure is already 70% done — `broadcast()` in server.py, `useSSE` hook, and `/events` endpoint all exist. Work is completing the wiring: 7 missing `broadcast()` calls in the backend, and 9 frontend pages that import `useSSE` but don't call it (or still keep their `setInterval` alongside it).

**Tech Stack:** FastAPI (Python) + React 19 + custom `useSSE` hook (fetch-based SSE reader)

---

## File Map

| File | Change |
|---|---|
| `server.py` | Add 7 missing `await broadcast(...)` calls |
| `src/pages/Dashboard.jsx` | Remove `setInterval` block (useSSE already wired) |
| `src/pages/RawMaterial.jsx` | Remove `setInterval` block (useSSE already wired) |
| `src/pages/MaterialMovement.jsx` | Wire `useSSE` + remove `setInterval` + optimistic prepend |
| `src/pages/Wastage.jsx` | Wire `useSSE` + remove `setInterval` + optimistic prepend |
| `src/pages/Users.jsx` | Wire `useSSE` + remove `setInterval` (already has optimistic update) |
| `src/pages/Fulfillment.jsx` | Wire `useSSE` + remove `setInterval` |
| `src/pages/Stocks.jsx` | Wire `useSSE` + remove `setInterval` |
| `src/pages/Production.jsx` | Wire `useSSE` + remove `setInterval` |
| `src/pages/MachineReports.jsx` | Wire `useSSE` + remove `setInterval` |

---

## Task 1: Add missing `broadcast()` calls to server.py

**Files:**
- Modify: `server.py`

The following endpoints mutate data but never broadcast an SSE event. Other connected clients have no way to know the data changed.

- [ ] **Step 1: Add broadcast to `POST /materials` (~line 593)**

Find the handler ending with:
```python
    return {"selected": material, "materials": all_mats}
```
Change it to:
```python
    await broadcast("raw_material")
    return {"selected": material, "materials": all_mats}
```

- [ ] **Step 2: Add broadcast to `PUT /raw-material/batches/{batch_id}` (~line 635)**

Find the handler ending with:
```python
    return {"success": True, "data": dict(updated), "tolerance": tol}
```
Change it to:
```python
    await broadcast("raw_material")
    return {"success": True, "data": dict(updated), "tolerance": tol}
```

- [ ] **Step 3: Add broadcast to `DELETE /raw-material/batches/{batch_id}` (~line 668)**

Find the handler ending with:
```python
    return {"success": True}
```
after the `DELETE FROM raw_material_batches` statement. Change it to:
```python
    await broadcast("raw_material")
    return {"success": True}
```

- [ ] **Step 4: Add broadcast to `POST /raw-material/batches/bulk-delete` (~line 682)**

Find the handler ending with:
```python
    return {"success": True, "deleted": len(ids)}
```
after `bulk_delete_batches`. Change it to:
```python
    await broadcast("raw_material")
    return {"success": True, "deleted": len(ids)}
```

- [ ] **Step 5: Add broadcast to `PUT /floor/transactions/{mv_id}` (~line 881)**

Find the handler ending with:
```python
    return {"success": True, "data": dict(updated)}
```
in `update_floor_tx`. Change it to:
```python
    await broadcast("material_movement")
    return {"success": True, "data": dict(updated)}
```

- [ ] **Step 6: Add broadcast to `DELETE /floor/transactions/{mv_id}` (~line 908)**

Find the handler ending with:
```python
    return {"success": True}
```
in `delete_floor_tx`. Change it to:
```python
    await broadcast("material_movement")
    return {"success": True}
```

- [ ] **Step 7: Add broadcast to `POST /floor/transactions/bulk-delete` (~line 924)**

Find the handler ending with:
```python
    return {"success": True, "deleted": len(ids)}
```
in `bulk_delete_floor_tx`. Change it to:
```python
    await broadcast("material_movement")
    return {"success": True, "deleted": len(ids)}
```

- [ ] **Step 8: Commit**

```bash
git add server.py
git commit -m "feat: add missing SSE broadcasts to raw_material and material_movement endpoints"
```

---

## Task 2: Remove polling from Dashboard and RawMaterial

**Files:**
- Modify: `src/pages/Dashboard.jsx` (~line 172)
- Modify: `src/pages/RawMaterial.jsx` (~line 177)

These pages already call `useSSE` correctly. The `setInterval` alongside it is redundant.

- [ ] **Step 1: Remove `setInterval` from Dashboard (~line 172)**

Find this block:
```js
    useEffect(() => {
        cancelledRef.current = false
        fetchMetrics()
        const pollInterval = setInterval(fetchMetrics, 60000)
        return () => {
            cancelledRef.current = true
            clearInterval(pollInterval)
        }
    }, [fetchMetrics])
```
Replace with:
```js
    useEffect(() => {
        cancelledRef.current = false
        fetchMetrics()
        return () => {
            cancelledRef.current = true
        }
    }, [fetchMetrics])
```

- [ ] **Step 2: Remove `setInterval` from RawMaterial (~line 177)**

Find this block:
```js
  useEffect(() => {
    // Load immediately
    refreshRawTotals().catch(() => {})
    refreshMaterialOptions().catch(() => {})
    refreshBatches().catch(() => {})
    
    // Poll every 10 seconds
    const pollInterval = setInterval(() => {
      refreshRawTotals().catch(() => {})
      refreshMaterialOptions().catch(() => {})
      refreshBatches().catch(() => {})
    }, 60000)
    
    return () => clearInterval(pollInterval)
  }, [refreshMaterialOptions, refreshRawTotals, refreshBatches])
```
Replace with:
```js
  useEffect(() => {
    refreshRawTotals().catch(() => {})
    refreshMaterialOptions().catch(() => {})
    refreshBatches().catch(() => {})
  }, [refreshMaterialOptions, refreshRawTotals, refreshBatches])
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/Dashboard.jsx src/pages/RawMaterial.jsx
git commit -m "feat: remove polling from Dashboard and RawMaterial, SSE already wired"
```

---

## Task 3: Wire MaterialMovement to SSE + optimistic update

**Files:**
- Modify: `src/pages/MaterialMovement.jsx`

Current state: imports `useSSE` but never calls it. Has `setInterval(loadData, 10000)` at ~line 77. After submit, calls `loadData()` explicitly.

- [ ] **Step 1: Add `useSSE` call after the `loadData` function definition (~line 74)**

Find:
```js
    loadData()
    const pollInterval = setInterval(loadData, 10000)
    return () => clearInterval(pollInterval)
  }, [])
```
Replace with:
```js
    loadData()
  }, [])

  useSSE(['material_movement', 'floor_stock'], loadData)
```

- [ ] **Step 2: Replace `loadData()` call in submit handler with optimistic prepend**

Find this block in `handleSubmit` (after the `api.post` succeeds):
```js
      setLastTolerance(...)
      ...
      loadData()
```
The submit handler calls `loadData()` at the end of the try block. Replace that `loadData()` call with an optimistic prepend:
```js
      setMovements(prev => [data, ...prev])
```
`data` is already in scope from `const { data } = await api.post(...)`. The SSE broadcast will fire from the backend and trigger `loadData()` to get server truth within ~100ms.

- [ ] **Step 3: Verify in browser**

Start dev server (`npm run dev`). Go to `/materials`. Submit a floor transfer. Confirm:
- The new movement appears instantly in the table without a full reload
- Open a second browser tab on the same page — verify the second tab's table also updates within ~1 second (SSE push)

- [ ] **Step 4: Commit**

```bash
git add src/pages/MaterialMovement.jsx
git commit -m "feat: wire MaterialMovement to SSE, add optimistic movement prepend"
```

---

## Task 4: Wire Wastage to SSE + optimistic update

**Files:**
- Modify: `src/pages/Wastage.jsx`

Current state: has `setInterval(loadWastage, 50000)`. After submit, calls `loadWastage()` explicitly.

- [ ] **Step 1: Add `useSSE` call + remove `setInterval`**

Find:
```js
  useEffect(() => {
    loadWastage()
    const pollInterval = setInterval(loadWastage, 50000)
    return () => clearInterval(pollInterval)
  }, [loadWastage])
```
Replace with:
```js
  useEffect(() => {
    loadWastage()
  }, [loadWastage])

  useSSE(['wastage'], loadWastage)
```

- [ ] **Step 2: Add optimistic prepend in `handleSubmit` + capture API response**

Find in `handleSubmit`:
```js
      await api.post('/wastage', {
        date: form.date,
        weight,
        wastage_generated: weight,
      })
      toast.success('Wastage logged successfully')
      setForm((previous) => ({ ...previous, weight: '' }))
      loadWastage()
```
Replace with:
```js
      const { data } = await api.post('/wastage', {
        date: form.date,
        weight,
        wastage_generated: weight,
      })
      toast.success('Wastage logged successfully')
      setForm((previous) => ({ ...previous, weight: '' }))
      setWastageRows(prev => [normalizeWastageRow(data, prev.length), ...prev])
```
`normalizeWastageRow` is already defined in the file. The SSE broadcast will trigger `loadWastage()` within ~100ms to replace the optimistic entry with server truth.

- [ ] **Step 3: Verify in browser**

Go to `/wastage`. Submit a wastage entry. Confirm new row appears instantly without page reload. Open second tab — confirm it updates automatically.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Wastage.jsx
git commit -m "feat: wire Wastage to SSE, add optimistic row prepend"
```

---

## Task 5: Wire Users to SSE

**Files:**
- Modify: `src/pages/Users.jsx`

Current state: has `setInterval` polling every 10s. Already has optimistic update in `handleSubmit` (`setUsers(prev => [data, ...prev])`).

- [ ] **Step 1: Add `useSSE` call + remove `setInterval`**

Find:
```js
    useEffect(() => {
        // Load immediately
        fetchUsers()
        loadPendingUsers()
        
        // Poll every 10 seconds
        const pollInterval = setInterval(() => {
            fetchUsers()
            loadPendingUsers()
        }, 10000)
        
        return () => clearInterval(pollInterval)
    }, [])
```
Replace with:
```js
    useEffect(() => {
        fetchUsers()
        loadPendingUsers()
    }, [])

    useSSE(['users'], () => {
        fetchUsers()
        loadPendingUsers()
    })
```

- [ ] **Step 2: Verify in browser**

Go to `/users`. Create a new user. Confirm user appears instantly. Open second tab — confirm it appears there too within ~1 second.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Users.jsx
git commit -m "feat: wire Users to SSE, remove polling"
```

---

## Task 6: Wire Fulfillment to SSE

**Files:**
- Modify: `src/pages/Fulfillment.jsx`

Current state: has `setInterval(loadData, 50000)`. Uses `setRefreshKey(prev => prev + 1)` on submit to trigger reload via `useEffect([loadData, refreshKey])`.

- [ ] **Step 1: Add `useSSE` call + remove `setInterval`**

Find:
```js
    loadData()
    const pollInterval = setInterval(loadData, 50000)
    return () => clearInterval(pollInterval)
  }, [loadData, refreshKey])
```
Replace with:
```js
    loadData()
  }, [loadData, refreshKey])

  useSSE(['orders', 'floor_stock'], loadData)
```

- [ ] **Step 2: Verify in browser**

Go to `/fulfillment`. Record a fulfillment. Confirm the order data refreshes. Open second tab — confirm it updates automatically.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Fulfillment.jsx
git commit -m "feat: wire Fulfillment to SSE, remove polling"
```

---

## Task 7: Wire Stocks to SSE

**Files:**
- Modify: `src/pages/Stocks.jsx`

Current state: has `setInterval(loadStockData, 10000)`. `loadStockData` calls both `refreshFloorStock()` (prop) and `refreshRawTotals()`.

- [ ] **Step 1: Add `useSSE` call + remove `setInterval`**

Find:
```js
  useEffect(() => {
    const loadStockData = async () => {
      return Promise.allSettled([refreshFloorStock?.(), refreshRawTotals()]).catch(() => {})
    }
    
    // Load immedi...
    loadStockData()
    ...
    const pollInterval = setInterval(loadStockData, 10000)
    return () => clearInterval(pollInterval)
  }, [...])
```

The full block to replace — find the effect that contains `loadStockData` and `setInterval`. Replace it with:
```js
  useEffect(() => {
    Promise.allSettled([refreshFloorStock?.(), refreshRawTotals()]).catch(() => {})
  }, [refreshFloorStock, refreshRawTotals])

  useSSE(['floor_stock', 'raw_material'], () => {
    refreshFloorStock?.()
    refreshRawTotals()
  })
```

- [ ] **Step 2: Verify in browser**

Go to `/raw-material`, add a batch. Go to `/stocks` (in another tab) — confirm floor stock and raw totals update automatically.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Stocks.jsx
git commit -m "feat: wire Stocks to SSE, remove polling"
```

---

## Task 8: Wire Production to SSE

**Files:**
- Modify: `src/pages/Production.jsx`

Current state: has `setInterval(loadFloorStock, 50000)` inside a `useEffect` at ~line 259. `loadFloorStock` is defined locally inside that effect.

- [ ] **Step 1: Lift `loadFloorStock` out of the effect and wire SSE**

Find this block (~line 242):
```js
  useEffect(() => {
    const loadFloorStock = async () => {
      setLoadingMaterials(true)
      try {
        const { data } = await api.get('/floor/stock')
        setFloorStock(Array.isArray(data) ? data : [])
        setHasLoadedMaterialsOnce(true)
      } catch (err) {
        console.error('Failed to load floor stock:', err)
      } finally {
        setLoadingMaterials(false)
      }
    }
    
    // Load immediately
    loadFloorStock()
    
    // Poll every 50 seconds
    const pollInterval = setInterval(loadFloorStock, 50000)
    
    return () => clearInterval(pollInterval)
  }, [])
```
Replace with:
```js
  const loadFloorStock = useCallback(async () => {
    setLoadingMaterials(true)
    try {
      const { data } = await api.get('/floor/stock')
      setFloorStock(Array.isArray(data) ? data : [])
      setHasLoadedMaterialsOnce(true)
    } catch (err) {
      console.error('Failed to load floor stock:', err)
    } finally {
      setLoadingMaterials(false)
    }
  }, [])

  useEffect(() => {
    loadFloorStock()
  }, [loadFloorStock])

  useSSE(['production', 'floor_stock'], loadFloorStock)
```

Then add `useCallback` to the imports if not already present. Check the import line at the top of the file — it likely already imports `useCallback` given the rest of the file uses it.

- [ ] **Step 2: Verify `useCallback` is imported**

Check the top of `Production.jsx`. If the import line is:
```js
import { useState, useEffect, ... } from 'react'
```
Ensure `useCallback` is in that list.

- [ ] **Step 3: Verify in browser**

Go to `/production-log`. Submit a production entry. Confirm floor stock updates. Open `/materials` in another tab — confirm it also updates.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Production.jsx
git commit -m "feat: wire Production to SSE, remove polling, lift loadFloorStock to useCallback"
```

---

## Task 9: Wire MachineReports to SSE

**Files:**
- Modify: `src/pages/MachineReports.jsx`

Current state: has `setInterval(pollForUpdates, 50000)` at ~line 151. `pollForUpdates` is a `useCallback` already defined at ~line 117.

- [ ] **Step 1: Add `useSSE` call + remove `setInterval`**

Find (~line 151):
```js
    const pollInterval = setInterval(pollForUpdates, 50000)
    return () => clearInterval(pollInterval)
```
inside its `useEffect`. Replace the entire effect block containing `setInterval` with:

Find the effect that has both the initial load call and the `setInterval(pollForUpdates, ...)`. It will look something like:
```js
  useEffect(() => {
    // initial load call
    ...
    const pollInterval = setInterval(pollForUpdates, 50000)
    return () => clearInterval(pollInterval)
  }, [...])
```
Remove the `setInterval` line and `return () => clearInterval(pollInterval)` line, keeping the initial load call.

Then add `useSSE` immediately after the effect:
```js
  useSSE(['production'], pollForUpdates)
```

- [ ] **Step 2: Verify in browser**

Go to `/reports`. Submit a production log from another tab (`/production-log`). Confirm the machine report updates automatically without refresh.

- [ ] **Step 3: Commit**

```bash
git add src/pages/MachineReports.jsx
git commit -m "feat: wire MachineReports to SSE, remove polling"
```

---

## Task 10: End-to-end verification

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Open two browser windows side by side**

Window A: `/production-log`  
Window B: `/reports`

Submit a production entry in Window A. Verify Window B updates within ~1 second without any manual refresh.

- [ ] **Step 3: Test raw material flow**

Window A: `/raw-material` — add a batch  
Window B: `/stocks` — verify floor stock and raw totals update automatically

- [ ] **Step 4: Test material movement flow**

Window A: `/materials` — submit a floor transfer  
Window B: `/materials` — verify the new movement appears in the table

- [ ] **Step 5: Test wastage flow**

Window A: `/wastage` — submit a wastage entry  
Window B: `/wastage` — verify entry appears

- [ ] **Step 6: Confirm no `setInterval` remains in page files**

```bash
grep -n "setInterval" src/pages/*.jsx
```

Expected output: no matches (or only inside comments).

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete SSE wiring — all pages real-time, polling eliminated"
```
