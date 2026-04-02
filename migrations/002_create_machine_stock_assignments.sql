-- Migration: Create machine_stock_assignments table for auto-assignment system
-- Purpose: Track which materials are assigned to which machines
-- This enables automatic material selection during production and pooled stock management

-- Create the machine_stock_assignments table
CREATE TABLE IF NOT EXISTS machine_stock_assignments (
  id SERIAL PRIMARY KEY,
  machine_id VARCHAR(10) NOT NULL,
  material_type_id INTEGER NOT NULL,
  quantity_kg NUMERIC(12, 2) NOT NULL DEFAULT 0,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Constraint: each machine can only have one entry per material
  UNIQUE(machine_id, material_type_id),
  
  -- Foreign keys (if tables exist)
  CONSTRAINT fk_machine FOREIGN KEY (machine_id) 
    REFERENCES machines(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_material_type FOREIGN KEY (material_type_id) 
    REFERENCES material_types(id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Create index for faster lookups by machine
CREATE INDEX IF NOT EXISTS idx_machine_assignments_machine_id 
ON machine_stock_assignments(machine_id);

-- Create index for faster lookups by material_type
CREATE INDEX IF NOT EXISTS idx_machine_assignments_material_type_id 
ON machine_stock_assignments(material_type_id);

-- Add comment explaining the table
COMMENT ON TABLE machine_stock_assignments IS 
  'Tracks material stock assigned to individual machines. When stock is issued to a floor, '
  'it is automatically assigned to all production machines. When production consumes material, '
  'it deducts from the pooled total in floor_material_balance, but also updates this table '
  'to track individual machine allocations for reporting.';

COMMENT ON COLUMN machine_stock_assignments.quantity_kg IS 
  'Current quantity of material assigned to this machine. This is tracked separately from '
  'floor_material_balance for reporting purposes, but actual deduction happens at the floor level (pooled).';
