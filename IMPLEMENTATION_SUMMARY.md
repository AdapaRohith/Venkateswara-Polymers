# Stock Auto-Assignment Implementation Summary

## What Was Changed

### 1. Backend Changes (server.js)

#### New Endpoint: POST `/floor/issue-from-raw`
- **Purpose**: Issue raw material to floor and auto-assign to all production machines
- **Location**: After `/floor/stock` endpoint  
- **Features**:
  - Takes `material_name` and `quantity_kg`
  - Deducts from raw_material_totals
  - Adds to floor_material_balance (pooled)
  - Creates assignment records for all M1-M5 machines
  - Records movement in material_movements table
  - **Returns**: Confirmation + number of machines assigned

#### New Endpoint: GET `/machines/:id/assigned-stock`
- **Purpose**: Retrieve assigned materials for a specific machine
- **Location**: After `/machines/:id/state` endpoint
- **Features**:
  - Lists all materials assigned to machine
  - Shows quantity allocated per material
  - Calculates total assigned quantity
  - **Returns**: Machine ID, assigned materials array, total quantity

#### Modified Endpoint: POST `/production/logs`
- **Changes in SINGLE MODE**:
  - Auto-detects assigned materials if machine_id provided without material_id
  - Automatically selects most recent assigned material if not specified
  - Deducts from both `floor_material_balance` (pooled) and `machine_stock_assignments` (tracking)
  - Now sends material_type_id instead of material_id in assignment update

#### Database Initialization (server startup)
- Added `initializeTables()` function
- Auto-creates `machine_stock_assignments` table on server start
- Creates necessary indexes
- Prevents errors if migration hasn't been run

### 2. Frontend Changes

#### Production.jsx
- **New State**: `assignedStock` to track materials assigned to active machine
- **New Hook**: `useEffect` to load assigned stock when machine changes
- **Modified selectMachine**: Clears assigned stock on machine deselection
- **New UI Card**: "Assigned Materials" info box at top of form
  - Shows material names
  - Shows quantity allocated per material
  - Visual confirmation with checkmark icon
- **Updated Material Dropdown**:
  - Auto-selects if only 1 material assigned
  - Shows only assigned materials when assignments exist
  - Displays quantity info (assigned vs issued)
  - Label indicates "auto-assigned" source
  - Disabled if only one selection and already selected
- **Updated handleSubmit**:
  - Sends `material_type_id` instead of `material_id`
  - Looks up material name from `assignedStock` first, then `floorStock`

### 3. Database Migration

#### New File: `migrations/002_create_machine_stock_assignments.sql`
- Creates `machine_stock_assignments` table with proper constraints
- Creates performance indexes
- Includes detailed comments explaining the design

## Key Design Decisions

### 1. Auto-Assignment Strategy
- **WHO**: All production machines (M1-M5) receive every issued material
- **WHEN**: Immediately when stock is issued to floor
- **WHY**: Simplifies UI and enables flexibility without complex assignment logic

### 2. Pooled vs Individual Tracking
- **Pool Level** (floor_material_balance): Actual consumption happens here
  - Single source of truth for available stock
  - Prevents total stock from going negative
  - All machines share same pool
  
- **Individual Level** (machine_stock_assignments): Tracks allocations
  - For reporting and capacity planning
  - Doesn't prevent consumption
  - Helps answer "which materials are available to Machine X?"

### 3. Graceful Degradation
- If `machine_stock_assignments` table missing: system falls back to full floor stock list
- All functionality works without the assignment table (it's optional)
- Auto-creation on server startup prevents manual migration hassles

## User Impact

### Before Implementation
- User had to manually select material for each production entry
- No indication of which materials were assigned to which machine
- All machines saw all available materials
- No per-machine material tracking

### After Implementation
- Material auto-selects if only one is assigned to machine
- Clear visual indicator of which materials are assigned to active machine
- Dropdown auto-filters to assigned materials (if any exist)
- Better visibility of machine-to-material relationships
- Same material is shown across production history

## Testing Checklist

- [ ] Server starts without errors
- [ ] `/floor/issue-from-raw` creates assignments for all machines
- [ ] `/machines/:id/assigned-stock` returns correct assignments
- [ ] Production page shows assigned materials when machine selected
- [ ] Material auto-selects when machine has single assignment
- [ ] Material dropdown shows assigned materials when available
- [ ] Production logging works with auto-detected material
- [ ] Production logging works with explicit material selection
- [ ] Stock deducts from floor_material_balance on production entry
- [ ] Stock deducts from machine_stock_assignments on production entry
- [ ] Fallback works if machine_stock_assignments table missing
- [ ] Existing production workflows still work unchanged

## Files Modified

1. **server.js**
   - Added `/floor/issue-from-raw` endpoint (≈90 lines)
   - Added `/machines/:id/assigned-stock` endpoint (≈30 lines)
   - Modified `/production/logs` endpoint single mode (≈50 lines changed)
   - Added `initializeTables()` function (≈40 lines)

2. **src/pages/Production.jsx**
   - Added `assignedStock` state
   - Added useEffect for loading assigned stock
   - Modified `selectMachine` function
   - Added assigned materials UI card
   - Updated material dropdown logic
   - Modified `handleSubmit` to use material_type_id

3. **migrations/002_create_machine_stock_assignments.sql** (NEW)
   - Table definition with constraints
   - Performance indexes
   - Documentation comments

4. **STOCK_AUTO_ASSIGNMENT.md** (NEW)
   - Complete implementation guide
   - Architecture documentation
   - API reference
   - Benefits and future enhancements

## Notes for Future Developers

### Extending the System
To assign materials to specific machines instead of all:
1. Add UI to select machines during `/floor/issue-from-raw`
2. Modify endpoint to loop through selected machines only
3. Update assignment logic in server

### Performance Considerations
- Indexes on `machine_id` and `material_type_id` ensure fast lookups
- UNIQUE constraint prevents duplicate assignments
- No cascading updates needed (pooled approach)

### Error Handling
- Table auto-creation on startup prevents missing table errors
- API gracefully falls back to floor stock if assignments unavailable
- All existing error messages and validations remain unchanged

## Rollback Plan (if needed)
If issues arise:
1. Users can manually select materials (works with or without assignments)
2. Leave `machine_stock_assignments` table empty/unused
3. System continues functioning normally
4. No risk to data integrity in floor_material_balance or production_logs
