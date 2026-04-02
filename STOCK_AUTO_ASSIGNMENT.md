# Stock Auto-Assignment System - Implementation Guide

## Overview
The system now automatically assigns stock to machines when materials are issued to the floor, eliminating manual material selection during production. Stock retains individual tracking but deduction is pooled across all assigned materials.

## How It Works

### 1. **Stock Issue Flow** (`/floor/issue-from-raw` endpoint)
When a user issues raw material to the floor via the Stocks page:

```
Raw Material Storage → Floor Stock Pool → Machine Assignments (all production machines)
```

**Step-by-step:**
1. User selects material and quantity in Stocks page
2. System deducts from `raw_material_totals`
3. System adds to `floor_material_balance` (pooled)
4. System **automatically creates assignments** in `machine_stock_assignments` for all production machines (M1-M5)
5. All machines are now aware they have this material available

### 2. **Production Logging** (`/production/logs` endpoint)
When logging production on a machine:

```
Machine Assigned Materials → Auto-detect Primary Material → Pooled Deduction from Floor
```

**Step-by-step:**
1. Backend retrieves assigned materials for the machine
2. If only one material assigned → automatically selected
3. If multiple materials → user selects from dropdown
4. When entry is logged:
   - Deducts from `floor_material_balance` (pooled approach - shared across all machines)
   - Also deducts from `machine_stock_assignments` (individual machine tracking)
5. Action recorded in `material_movements` table

### 3. **Individual vs Pooled Design**
- **Individual Tracking**: `machine_stock_assignments` tracks each machine's allocation
  - Useful for reporting: "How much of Material X is assigned to Machine 1?"
  - Useful for capacity planning
  
- **Pooled Deduction**: `floor_material_balance` is the source of truth for actual consumption
  - All machines share the same pool regardless of assignment
  - Prevents over-deduction at the floor level
  - Enables flexible material usage across machines

## Database Schema

### `machine_stock_assignments` Table
```sql
id              SERIAL PRIMARY KEY
machine_id      VARCHAR(10) NOT NULL       -- References machines.id
material_type_id INTEGER NOT NULL          -- References material_types.id
quantity_kg     NUMERIC(12, 2)             -- Current assignment quantity
assigned_at     TIMESTAMP                  -- When assignment was created
updated_at      TIMESTAMP                  -- Last update timestamp

UNIQUE(machine_id, material_type_id)
```

## API Endpoints

### Issue Stock to Floor (NEW)
**POST** `/floor/issue-from-raw`

Request:
```json
{
  "material_name": "HDPE Granules",
  "quantity_kg": 500
}
```

Response:
```json
{
  "message": "Material issued to floor and auto-assigned to all production machines",
  "data": {
    "material_name": "HDPE Granules",
    "quantity_kg": 500,
    "material_type_id": 1,
    "machines_assigned": 5
  }
}
```

### Get Machine Assigned Stock (NEW)
**GET** `/machines/:id/assigned-stock`

Response:
```json
{
  "machine_id": "1",
  "assigned_materials": [
    {
      "machine_id": "1",
      "material_type_id": 1,
      "material_name": "HDPE Granules",
      "quantity_kg": 500,
      "assigned_at": "2024-01-15T10:30:00Z"
    }
  ],
  "total_assigned_kg": 500
}
```

### Production Logging (UPDATED)
**POST** `/production/logs`

Request with auto-detection:
```json
{
  "machine_id": 1,
  "size": "50mm",
  "worker_name": "John",
  "gross_weight": 10.5,
  "tare_weight": 0.5
}
```
Backend will:
- Auto-detect assigned materials for machine 1
- Auto-select if only one
- Fail with message if none assigned

Request with explicit material:
```json
{
  "machine_id": 1,
  "material_type_id": 1,
  "size": "50mm",
  "worker_name": "John",
  "gross_weight": 10.5,
  "tare_weight": 0.5
}
```

## Frontend Changes

### Production Page Improvements
1. **Assigned Materials Display**
   - Blue info card shows all materials assigned to active machine
   - Display quantity allocated to each material
   - Visual confirmation of assignments

2. **Auto-Selection**
   - When machine is selected, assigned materials are loaded
   - If only 1 material assigned → automatically selected in dropdown
   - If multiple materials → user selects from "Assigned Materials" dropdown
   - Fallback to all floor stock if no assignments exist

3. **User Experience**
   - Eliminates need for manual material selection in most cases
   - Clear visual indicator of assigned materials
   - Graceful degradation if assignment table doesn't exist

## Migration Path

### Step 1: Database Setup
Run the migration file:
```sql
-- From migrations/002_create_machine_stock_assignments.sql
CREATE TABLE machine_stock_assignments (...)
```

Or the server will auto-create on startup.

### Step 2: Test the Flow
1. Go to Stocks page
2. Issue some raw material to floor
3. Verify it shows machines_assigned count
4. Go to Production page
5. Select a machine
6. Verify assigned materials are shown
7. Log production entry
8. Verify stock is deducted from floor

## Backwards Compatibility

- **Existing Data**: No changes to existing tables
- **Manual Assignment**: Users can still explicitly select materials if they don't want auto-assignment
- **Fallback**: If assignment table missing, falls back to all floor stock selection
- **Production Logs**: Continues to work with or without assignments

## Benefits

✅ **Faster Data Entry** - No need to manually select material each time
✅ **Reduced Errors** - Automatic selection prevents wrong material selection
✅ **Better Tracking** - Individual machine assignments aid in planning & reporting
✅ **Flexible** - Pooled deduction allows flexible material usage
✅ **Scalable** - Easy to extend to other scenarios (cutting machines, adjustment, etc.)

## Future Enhancements

- Allow manual machine assignment (vs automatic to all)
- Per-machine usage targets/quotas
- Material efficiency tracking by machine
- Predictive stock depletion warnings
- Reassignment between machines if one runs out
- Batch material assignment on floor issuance form
