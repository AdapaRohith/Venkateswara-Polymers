require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();

// ================= CORS =================
const allowedOriginPatterns = [
  /^https:\/\/.*\.avlokai\.com$/,
  /^https:\/\/.*\.vercel\.app$/,
  /^https:\/\/.*\.pages\.dev$/,
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/.*\.devtunnels\.ms$/
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowed = allowedOriginPatterns.some((re) => re.test(origin));
      if (allowed) return callback(null, true);
      return callback(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Internal-Token", "X-Requested-With"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  })
);
app.options(/.*/, cors());
app.use(express.json());

// ================= DB =================
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// ====================================================
// HELPERS
// ====================================================

/**
 * Find an existing material by name (case-insensitive) or create it.
 * Must be called inside an active transaction.
 * @returns {Promise<number>} material id from materials_master
 */
async function getOrCreateMaterial(client, name) {
  const normalized = String(name || '').trim();
  if (!normalized) throw new Error('material_name cannot be empty');

  const findRes = await client.query(
    `SELECT id FROM materials_master WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [normalized]
  );

  if (findRes.rows.length > 0) return findRes.rows[0].id;

  const insertRes = await client.query(
    `INSERT INTO materials_master (name)
     VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [normalized]
  );

  return insertRes.rows[0].id;
}

function getMachineIdVariants(machineId) {
  const raw = String(machineId ?? "").trim();
  if (!raw) return [];

  const digits = raw.replace(/\D/g, "");
  const normalizedDigits = digits ? String(Number(digits)) : "";
  const variants = new Set([raw, raw.toUpperCase()]);

  if (digits) {
    variants.add(digits);
    if (normalizedDigits && normalizedDigits !== "NaN") {
      variants.add(normalizedDigits);
      variants.add(`M${normalizedDigits}`);
    }
  }

  return Array.from(variants).filter(Boolean);
}

function normalizeOrderStatus(status) {
  const normalized = String(status || "Active").trim().toLowerCase();
  if (normalized === "active") return "Active";
  if (normalized === "completed") return "completed";
  if (normalized === "cancelled") return "cancelled";
  return "Active";
}

async function fetchOrderItems(client, orderId) {
  const result = await client.query(
    `
    SELECT
      oi.id,
      oi.order_id,
      oi.item_name,
      oi.required_quantity::float AS required_quantity,
      COALESCE(oi.unit_price, 0)::float AS unit_price,
      (oi.required_quantity * COALESCE(oi.unit_price, 0))::float AS total_amount,
      COALESCE(SUM(fr.supplied_quantity), 0)::float AS fulfilled_quantity,
      GREATEST(oi.required_quantity - COALESCE(SUM(fr.supplied_quantity), 0), 0)::float AS remaining_quantity,
      oi.created_at
    FROM order_items oi
    LEFT JOIN fulfillment_records fr ON fr.order_item_id = oi.id
    WHERE oi.order_id = $1
    GROUP BY oi.id, oi.order_id, oi.item_name, oi.required_quantity, oi.unit_price, oi.created_at
    ORDER BY oi.created_at ASC, oi.id ASC
    `,
    [orderId]
  );

  return result.rows;
}

async function hydrateOrders(client, orders) {
  const list = Array.isArray(orders) ? orders : [];
  return Promise.all(
    list.map(async (order) => ({
      ...order,
      items: await fetchOrderItems(client, order.id),
    }))
  );
}

async function syncOrderStatus(client, orderId) {
  const orderRes = await client.query(
    `SELECT status FROM orders WHERE id = $1 FOR UPDATE`,
    [orderId]
  );

  if (orderRes.rows.length === 0) return null;
  if (orderRes.rows[0].status === "cancelled") return "cancelled";

  const summaryRes = await client.query(
    `
    SELECT
      COUNT(*)::int AS total_items,
      COUNT(*) FILTER (
        WHERE COALESCE(fr.fulfilled_quantity, 0) >= oi.required_quantity
      )::int AS completed_items
    FROM order_items oi
    LEFT JOIN (
      SELECT order_item_id, COALESCE(SUM(supplied_quantity), 0) AS fulfilled_quantity
      FROM fulfillment_records
      GROUP BY order_item_id
    ) fr ON fr.order_item_id = oi.id
    WHERE oi.order_id = $1
    `,
    [orderId]
  );

  const summary = summaryRes.rows[0] || {};
  const totalItems = Number(summary.total_items) || 0;
  const completedItems = Number(summary.completed_items) || 0;
  const nextStatus = totalItems > 0 && totalItems === completedItems ? "completed" : "Active";

  await client.query(
    `
    UPDATE orders
    SET status = $1, updated_at = NOW()
    WHERE id = $2
    `,
    [nextStatus, orderId]
  );

  return nextStatus;
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

async function getMaterialNameById(client, materialId) {
  const parsedId = Number(materialId);
  if (!Number.isFinite(parsedId) || parsedId <= 0) return "";

  const result = await client.query(
    `SELECT name FROM materials_master WHERE id = $1 LIMIT 1`,
    [parsedId]
  );

  return result.rows[0]?.name || "";
}

async function getOrCreateMaterialType(client, name) {
  const normalized = String(name || "").trim();
  if (!normalized) throw new Error("material_name cannot be empty");

  const existing = await client.query(
    `SELECT id FROM material_types WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [normalized]
  );

  if (existing.rows.length > 0) return existing.rows[0].id;

  const inserted = await client.query(
    `INSERT INTO material_types (name)
     VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [normalized]
  );

  return inserted.rows[0].id;
}

async function resolveMaterialTypeId(client, materialId, materialName) {
  const parsedId = Number(materialId);

  if (Number.isFinite(parsedId) && parsedId > 0) {
    const typeMatch = await client.query(
      `SELECT id FROM material_types WHERE id = $1 LIMIT 1`,
      [parsedId]
    );
    if (typeMatch.rows.length > 0) return typeMatch.rows[0].id;

    const masterMatch = await client.query(
      `SELECT name FROM materials_master WHERE id = $1 LIMIT 1`,
      [parsedId]
    );
    if (masterMatch.rows.length > 0) {
      return getOrCreateMaterialType(client, masterMatch.rows[0].name);
    }
  }

  if (String(materialName || "").trim()) {
    return getOrCreateMaterialType(client, materialName);
  }

  return null;
}

async function adjustRawMaterialTotal(client, materialId, deltaKg) {
  const parsedMaterialId = Number(materialId);
  const delta = toNumber(deltaKg);

  if (!Number.isFinite(parsedMaterialId) || parsedMaterialId <= 0) {
    throw new Error("Invalid material id");
  }
  if (!delta) return;

  if (delta > 0) {
    await client.query(
      `INSERT INTO raw_material_totals (material_id, total_quantity_kg, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (material_id)
       DO UPDATE SET total_quantity_kg = raw_material_totals.total_quantity_kg + $2,
                     updated_at = NOW()`,
      [parsedMaterialId, delta]
    );
    return;
  }

  const result = await client.query(
    `SELECT total_quantity_kg
     FROM raw_material_totals
     WHERE material_id = $1
     FOR UPDATE`,
    [parsedMaterialId]
  );

  if (result.rows.length === 0) {
    throw new Error("Material not found in raw stock");
  }

  const available = toNumber(result.rows[0].total_quantity_kg);
  const required = Math.abs(delta);
  if (available < required) {
    throw new Error(`Insufficient raw stock. Available: ${available} kg`);
  }

  await client.query(
    `UPDATE raw_material_totals
     SET total_quantity_kg = total_quantity_kg - $1,
         updated_at = NOW()
     WHERE material_id = $2`,
    [required, parsedMaterialId]
  );
}

async function adjustFloorMaterialBalance(client, materialTypeId, deltaKg) {
  const parsedMaterialTypeId = Number(materialTypeId);
  const delta = toNumber(deltaKg);

  if (!Number.isFinite(parsedMaterialTypeId) || parsedMaterialTypeId <= 0) {
    throw new Error("Invalid floor material id");
  }
  if (!delta) return;

  if (delta > 0) {
    await client.query(
      `INSERT INTO floor_material_balance (material_type_id, total_quantity_kg)
       VALUES ($1, $2)
       ON CONFLICT (material_type_id)
       DO UPDATE SET total_quantity_kg = floor_material_balance.total_quantity_kg + $2`,
      [parsedMaterialTypeId, delta]
    );
    return;
  }

  const result = await client.query(
    `SELECT total_quantity_kg
     FROM floor_material_balance
     WHERE material_type_id = $1
     FOR UPDATE`,
    [parsedMaterialTypeId]
  );

  if (result.rows.length === 0) {
    throw new Error("No issued floor stock found for this material");
  }

  const available = toNumber(result.rows[0].total_quantity_kg);
  const required = Math.abs(delta);
  if (available < required) {
    throw new Error(`Insufficient floor stock. Available: ${available} kg`);
  }

  await client.query(
    `UPDATE floor_material_balance
     SET total_quantity_kg = total_quantity_kg - $1
     WHERE material_type_id = $2`,
    [required, parsedMaterialTypeId]
  );
}

async function adjustMachineAssignments(client, materialTypeId, deltaKg) {
  const parsedMaterialTypeId = Number(materialTypeId);
  const delta = toNumber(deltaKg);

  if (!Number.isFinite(parsedMaterialTypeId) || parsedMaterialTypeId <= 0 || !delta) {
    return;
  }

  const assignmentsRes = await client.query(
    `SELECT id, machine_id, quantity_kg
     FROM machine_stock_assignments
     WHERE material_type_id = $1
     ORDER BY id`,
    [parsedMaterialTypeId]
  );

  if (delta > 0) {
    const machinesRes = await client.query(`SELECT id::text AS id FROM machines ORDER BY id`);
    for (const machine of machinesRes.rows) {
      await client.query(
        `INSERT INTO machine_stock_assignments (machine_id, material_type_id, quantity_kg)
         VALUES ($1, $2, $3)
         ON CONFLICT (machine_id, material_type_id)
         DO UPDATE SET quantity_kg = machine_stock_assignments.quantity_kg + $3,
                       updated_at = NOW()`,
        [machine.id, parsedMaterialTypeId, delta]
      );
    }
    return;
  }

  const required = Math.abs(delta);
  if (assignmentsRes.rows.length === 0) {
    throw new Error("No machine assignments found for this floor stock");
  }

  for (const row of assignmentsRes.rows) {
    const available = toNumber(row.quantity_kg);
    if (available < required) {
      throw new Error(`Cannot reduce assigned stock for machine ${row.machine_id}`);
    }
  }

  await client.query(
    `UPDATE machine_stock_assignments
     SET quantity_kg = quantity_kg - $1,
         updated_at = NOW()
     WHERE material_type_id = $2`,
    [required, parsedMaterialTypeId]
  );
}

function normalizeMovementTypeValue(movementType) {
  const normalized = String(movementType || "").trim().toUpperCase();
  if (normalized === "WASTAGE") return "ADJUSTMENT";
  return normalized;
}

async function applyEditableMovementEffect(client, movement, multiplier = 1) {
  const quantityKg = toNumber(movement.quantity_kg);
  const direction = String(movement.direction || "").trim().toUpperCase();
  const movementType = normalizeMovementTypeValue(movement.movement_type);
  const materialId = Number(movement.material_id);
  const materialName =
    String(movement.material_name || "").trim() || await getMaterialNameById(client, materialId);

  if (!Number.isFinite(materialId) || materialId <= 0) {
    throw new Error("Invalid material selected");
  }
  if (quantityKg <= 0) {
    throw new Error("Quantity must be greater than zero");
  }
  if (!["IN", "OUT"].includes(direction)) {
    throw new Error("direction must be IN or OUT");
  }
  if (!movementType) {
    throw new Error("movement_type is required");
  }
  if (movementType === "CONSUMPTION") {
    throw new Error("Production consumption entries must be edited from production history");
  }

  const rawDelta = (direction === "IN" ? quantityKg : -quantityKg) * multiplier;
  await adjustRawMaterialTotal(client, materialId, rawDelta);

  if (movementType === "FLOOR_TRANSFER") {
    const materialTypeId = await resolveMaterialTypeId(client, materialId, materialName);
    if (!materialTypeId) {
      throw new Error("Unable to resolve floor material");
    }

    const floorDelta = (direction === "OUT" ? quantityKg : -quantityKg) * multiplier;
    await adjustFloorMaterialBalance(client, materialTypeId, floorDelta);
    await adjustMachineAssignments(client, materialTypeId, floorDelta);
  }
}

async function upsertProductionConsumptionMovement(client, productionLogId, payload) {
  const quantityKg = toNumber(payload.net_weight);
  const materialId = Number(payload.material_id);

  if (!Number.isFinite(productionLogId) || productionLogId <= 0) return;

  const existing = await client.query(
    `SELECT id
     FROM material_movements
     WHERE movement_type = 'CONSUMPTION'
       AND reference_id = $1
     ORDER BY id DESC
     LIMIT 1`,
    [productionLogId]
  );

  if (quantityKg <= 0 || !Number.isFinite(materialId) || materialId <= 0) {
    if (existing.rows.length > 0) {
      await client.query(`DELETE FROM material_movements WHERE id = $1`, [existing.rows[0].id]);
    }
    return;
  }

  const note = `Production consumption from machine ${payload.machine_id}`;

  if (existing.rows.length > 0) {
    await client.query(
      `UPDATE material_movements
       SET material_id = $1,
           quantity_kg = $2,
           direction = 'OUT',
           movement_type = 'CONSUMPTION',
           note = $3
       WHERE id = $4`,
      [materialId, quantityKg, note, existing.rows[0].id]
    );
    return;
  }

  await client.query(
    `INSERT INTO material_movements
     (material_id, quantity_kg, direction, movement_type, reference_id, note)
     VALUES ($1, $2, 'OUT', 'CONSUMPTION', $3, $4)`,
    [materialId, quantityKg, productionLogId, note]
  );
}

async function restoreProductionLogFloorStock(client, logRow) {
  if (!logRow) return;

  const netWeight = toNumber(logRow.gross_weight) - toNumber(logRow.tare_weight);
  if (netWeight <= 0) return;

  try {
    const materialTypeId = await resolveMaterialTypeId(client, logRow.material_id, logRow.material_name);
    if (!materialTypeId) return;
    await adjustFloorMaterialBalance(client, materialTypeId, netWeight);
  } catch (err) {
    console.warn(`Skipping floor-stock restore for production log ${logRow.id}: ${err.message}`);
  }
}

// =====================================================
// Auth Middleware
// =====================================================
const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization;

  if (!header) return res.status(401).json({ error: "Unauthorized" });

  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const normalized = { ...decoded };
    const derivedId =
      normalized.user_id ??
      normalized.id ??
      normalized.userId ??
      normalized.userID ??
      null;

    if (derivedId !== null && derivedId !== undefined) {
      if (normalized.id === undefined || normalized.id === null) {
        normalized.id = derivedId;
      }
      if (normalized.user_id === undefined || normalized.user_id === null) {
        normalized.user_id = derivedId;
      }
    }

    req.user = normalized;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user.role !== "owner") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
};

// ================= HEALTH =================
app.get("/", (req, res) => {
  res.send("API running");
});

// ====================================================
// MATERIALS MASTER — dropdown list
// ====================================================
app.get("/materials", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name FROM materials_master ORDER BY name`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====================================================
// RAW MATERIAL TOTALS (SOURCE OF TRUTH)
// ====================================================
app.get("/raw-material/totals", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        mm.name  AS material_name,
        rmt.total_quantity_kg,
        rmt.updated_at
      FROM raw_material_totals rmt
      JOIN materials_master mm ON mm.id = rmt.material_id
      ORDER BY mm.name
    `);

    res.json(result.rows);
  } catch (err) {
    // fallback: try legacy name-based column so old data still works
    try {
      const fallback = await pool.query(`
        SELECT material_name, total_quantity_kg, updated_at
        FROM raw_material_totals ORDER BY material_name
      `);
      res.json(fallback.rows);
    } catch {
      res.status(500).json({ error: err.message });
    }
  }
});

// ====================================================
// RAW MATERIAL BATCHES
// ====================================================
app.get("/raw-material/batches", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        rb.*,
        u.name AS created_by_name
      FROM raw_material_batches rb
      LEFT JOIN users u ON u.id = rb.created_by
      ORDER BY rb.created_at DESC
      LIMIT 500
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/raw-material/batches/:id", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const batchId = Number(req.params.id);
    const nextQuantity = toNumber(req.body.quantity_kg);
    const nextMaterialName = String(req.body.material_name || "").trim();
    const nextNote = req.body.note ?? null;

    if (!Number.isFinite(batchId) || batchId <= 0) {
      return res.status(400).json({ error: "Invalid batch id" });
    }
    if (!nextMaterialName || nextQuantity <= 0) {
      return res.status(400).json({ error: "material_name and quantity_kg are required" });
    }

    await client.query("BEGIN");

    const currentRes = await client.query(
      `SELECT id, material_id, material_name, quantity_kg, note
       FROM raw_material_batches
       WHERE id = $1
       FOR UPDATE`,
      [batchId]
    );

    if (currentRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Batch not found" });
    }

    const current = currentRes.rows[0];
    const currentQuantity = toNumber(current.quantity_kg);
    const nextMaterialId = await getOrCreateMaterial(client, nextMaterialName);

    if (Number(current.material_id) === Number(nextMaterialId)) {
      await adjustRawMaterialTotal(client, nextMaterialId, nextQuantity - currentQuantity);
    } else {
      await adjustRawMaterialTotal(client, current.material_id, -currentQuantity);
      await adjustRawMaterialTotal(client, nextMaterialId, nextQuantity);
    }

    const updateRes = await client.query(
      `UPDATE raw_material_batches
       SET material_id = $1,
           material_name = $2,
           quantity_kg = $3,
           note = $4
       WHERE id = $5
       RETURNING *`,
      [nextMaterialId, nextMaterialName, nextQuantity, nextNote, batchId]
    );

    await client.query("COMMIT");
    res.json({ success: true, data: updateRes.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.delete("/raw-material/batches/:id", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const batchId = Number(req.params.id);
    if (!Number.isFinite(batchId) || batchId <= 0) {
      return res.status(400).json({ error: "Invalid batch id" });
    }

    await client.query("BEGIN");

    const currentRes = await client.query(
      `SELECT id, material_id, quantity_kg
       FROM raw_material_batches
       WHERE id = $1
       FOR UPDATE`,
      [batchId]
    );

    if (currentRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Batch not found" });
    }

    const current = currentRes.rows[0];
    await adjustRawMaterialTotal(client, current.material_id, -toNumber(current.quantity_kg));
    await client.query(`DELETE FROM raw_material_batches WHERE id = $1`, [batchId]);

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post("/raw-material/batches/bulk-delete", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const ids = Array.isArray(req.body.ids)
      ? req.body.ids.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
      : [];

    if (ids.length === 0) {
      return res.status(400).json({ error: "ids array is required" });
    }

    await client.query("BEGIN");

    const currentRes = await client.query(
      `SELECT id, material_id, quantity_kg
       FROM raw_material_batches
       WHERE id = ANY($1::int[])
       ORDER BY id
       FOR UPDATE`,
      [ids]
    );

    if (currentRes.rows.length !== ids.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "One or more batches were not found" });
    }

    for (const row of currentRes.rows) {
      await adjustRawMaterialTotal(client, row.material_id, -toNumber(row.quantity_kg));
    }

    await client.query(`DELETE FROM raw_material_batches WHERE id = ANY($1::int[])`, [ids]);

    await client.query("COMMIT");
    res.json({ success: true, deleted: ids.length });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get("/raw-material/options", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name AS material_name
      FROM materials_master
      WHERE name IS NOT NULL
        AND TRIM(name) <> ''
      ORDER BY name ASC
    `);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ====================================================
// ADD NEW MATERIAL OPTION (creates entry in dropdown list)
// ====================================================
app.post("/raw-material/options", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const { material_name } = req.body;
    const normalized = String(material_name || '').trim();

    if (!normalized) {
      return res.status(400).json({ error: "material_name cannot be empty" });
    }

    await client.query("BEGIN");

    // 1. Ensure it exists in materials_master (canonical source)
    await client.query(
      `INSERT INTO materials_master (name)
       VALUES ($1)
       ON CONFLICT (name) DO NOTHING`,
      [normalized]
    );

    // 2. Ensure it exists in material_name_mapping (dropdown source)
    await client.query(
      `INSERT INTO material_name_mapping (material_name)
       VALUES ($1)
       ON CONFLICT DO NOTHING`,
      [normalized]
    );

    await client.query("COMMIT");

    res.json({ message: "Material added to options", material_name: normalized });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post("/raw-material/add", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const { material_name, quantity_kg, note } = req.body;
    const qty = Number(quantity_kg);

    if (!String(material_name || '').trim() || !Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: "Invalid input" });
    }

    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "User not authenticated properly" });
    }

    await client.query("BEGIN");

    const materialId = await getOrCreateMaterial(client, material_name);
    const displayName = String(material_name).trim();

    // Ensure totals constraint exists
    const upsertRes = await client.query(
      `
      INSERT INTO raw_material_totals (material_id, total_quantity_kg, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (material_id)
      DO UPDATE SET total_quantity_kg = raw_material_totals.total_quantity_kg + $2,
                    updated_at = NOW()
      RETURNING total_quantity_kg, updated_at
      `,
      [materialId, qty]
    );

    await client.query(
      `
      INSERT INTO raw_material_batches (material_id, material_name, quantity_kg, created_by, note)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [materialId, displayName, qty, req.user.id, note || null]
    );

    await client.query("COMMIT");

    res.json({
      message: "Raw material added successfully",
      data: {
        material_name: displayName,
        total_quantity_kg: upsertRes.rows[0]?.total_quantity_kg
      }
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("RAW MATERIAL ADD ERROR:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ====================================================
// FLOOR MATERIAL BALANCE (READ-ONLY — view-based)
// ====================================================
app.get("/floor/stock", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        mt.id AS material_type_id,
        mt.name AS material_name,
        fmb.total_quantity_kg
      FROM floor_material_balance fmb
      JOIN material_types mt ON mt.id = fmb.material_type_id
      ORDER BY mt.name
      `
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====================================================
// ISSUE FROM RAW TO FLOOR (AUTO-ASSIGN TO MACHINES)
// ====================================================
app.post("/floor/issue-from-raw", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const { material_name, quantity_kg } = req.body;
    const qty = Number(quantity_kg);

    if (!String(material_name || '').trim() || !Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: "Invalid material_name or quantity_kg" });
    }

    await client.query("BEGIN");

    // 1. Get or create material from materials_master
    const materialId = await getOrCreateMaterial(client, material_name);
    const displayName = String(material_name).trim();

    // 2. Check if enough stock in raw_material_totals
    const rawStockRes = await client.query(
      `SELECT total_quantity_kg FROM raw_material_totals
       WHERE material_id = $1 FOR UPDATE`,
      [materialId]
    );

    if (rawStockRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Material not found in raw stock" });
    }

    const available = Number(rawStockRes.rows[0].total_quantity_kg);
    if (available < qty) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Insufficient raw stock. Available: ${available} kg`
      });
    }

    // 3. Deduct from raw_material_totals
    await client.query(
      `UPDATE raw_material_totals
       SET total_quantity_kg = total_quantity_kg - $1, updated_at = NOW()
       WHERE material_id = $2`,
      [qty, materialId]
    );

    // 4. Get or create material_type with same name
    const matTypeRes = await client.query(
      `SELECT id FROM material_types WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [displayName]
    );

    let materialTypeId;
    if (matTypeRes.rows.length > 0) {
      materialTypeId = matTypeRes.rows[0].id;
    } else {
      const insertTypeRes = await client.query(
        `INSERT INTO material_types (name)
         VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [displayName]
      );
      materialTypeId = insertTypeRes.rows[0].id;
    }

    // 5. Add to floor_material_balance (pooled approach)
    await client.query(
      `INSERT INTO floor_material_balance (material_type_id, total_quantity_kg)
       VALUES ($1, $2)
       ON CONFLICT (material_type_id)
       DO UPDATE SET total_quantity_kg = floor_material_balance.total_quantity_kg + $2`,
      [materialTypeId, qty]
    );

    // 6. AUTO-ASSIGN TO ALL MACHINES ON THE FLOOR
    const machinesRes = await client.query(
      `SELECT id::text AS id FROM machines ORDER BY id`
    );

    for (const machine of machinesRes.rows) {
      // Create machine_stock_assignments record
      await client.query(
        `INSERT INTO machine_stock_assignments (machine_id, material_type_id, quantity_kg)
         VALUES ($1, $2, $3)
         ON CONFLICT (machine_id, material_type_id)
         DO UPDATE SET quantity_kg = machine_stock_assignments.quantity_kg + $3,
                       updated_at = NOW()`,
        [machine.id, materialTypeId, qty]
      );
    }

    // 7. Record the movement
    await client.query(
      `INSERT INTO material_movements
       (material_id, quantity_kg, direction, movement_type, reference_id, note, created_by)
       VALUES ($1, $2, 'OUT', 'FLOOR_TRANSFER', $3, $4, $5)`,
      [materialId, qty, null, `Issued to floor and auto-assigned to all machines`, req.user.id]
    );

    await client.query("COMMIT");

    res.json({
      message: "Material issued to floor and auto-assigned to all machines",
      data: {
        material_name: displayName,
        quantity_kg: qty,
        material_type_id: materialTypeId,
        machines_assigned: machinesRes.rows.length
      }
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("FLOOR ISSUE ERROR:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ====================================================
// GET MACHINE ASSIGNED STOCK
// ====================================================
app.get("/machines/:id/assigned-stock", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const machineIds = getMachineIdVariants(id);

    const result = await pool.query(
      `SELECT
         MIN(msa.machine_id) AS machine_id,
         msa.material_type_id,
         mt.name AS material_name,
         SUM(msa.quantity_kg)::float AS quantity_kg,
         MIN(msa.assigned_at) AS assigned_at,
         COALESCE(MAX(fmb.total_quantity_kg), 0)::float AS available_quantity_kg
       FROM machine_stock_assignments msa
       JOIN material_types mt ON mt.id = msa.material_type_id
       LEFT JOIN floor_material_balance fmb ON fmb.material_type_id = msa.material_type_id
       WHERE msa.machine_id = ANY($1::text[])
       GROUP BY msa.material_type_id, mt.name
       ORDER BY mt.name`,
      [machineIds]
    );

    const totalQuantity = result.rows.reduce((sum, row) => sum + Number(row.quantity_kg), 0);
    const totalAvailable = result.rows.reduce((sum, row) => sum + Number(row.available_quantity_kg), 0);

    res.json({
      machine_id: id,
      assigned_materials: result.rows,
      total_assigned_kg: totalQuantity,
      total_available_kg: totalAvailable
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====================================================
// CREATE NEW MATERIAL
// ====================================================
// ====================================================
// GET MATERIALS (for dropdown/list)
// ====================================================
app.get("/materials", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name
      FROM materials_master
      ORDER BY name ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch materials" });
  }
});

// ====================================================
// POST MATERIALS (create or get existing)
// ====================================================
app.post("/materials", async (req, res) => {
  try {
    let { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Material name is required" });
    }

    name = name.trim();

    const existing = await pool.query(
      `
      SELECT id, name
      FROM materials_master
      WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
      LIMIT 1;
      `,
      [name]
    );

    let material;

    if (existing.rows.length > 0) {
      material = existing.rows[0];
    } else {
      const inserted = await pool.query(
        `
        INSERT INTO materials_master (name)
        VALUES ($1)
        RETURNING id, name;
        `,
        [name]
      );
      material = inserted.rows[0];
    }

    // 🔥 Return full updated list
    const allMaterials = await pool.query(`
      SELECT id, name
      FROM materials_master
      ORDER BY name ASC;
    `);

    res.json({
      selected: material,
      materials: allMaterials.rows
    });

  } catch (err) {
    console.error("ADD MATERIAL ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ====================================================
// MATERIAL MOVEMENTS (NEW SYSTEM)
// ====================================================
app.post("/materials/move", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      material_name,
      quantity_kg,
      direction,     // 'IN' or 'OUT'
      movement_type, // 'INWARD' | 'FLOOR_TRANSFER' | 'CONSUMPTION' | 'ADJUSTMENT' | 'WASTAGE'
      // or legacy snake_case: 'raw_add' | 'floor_issue' | 'production_use' | 'wastage'
      reference_id,
      note
    } = req.body;

    // Normalise frontend-friendly enum values to DB-accepted values
    const MOVEMENT_TYPE_MAP = {
      INWARD: 'INWARD',
      FLOOR_TRANSFER: 'FLOOR_TRANSFER',
      CONSUMPTION: 'CONSUMPTION',
      ADJUSTMENT: 'ADJUSTMENT',
      WASTAGE: 'ADJUSTMENT', // WASTAGE not in CHECK constraint, map to ADJUSTMENT
    };
    const resolvedMovementType =
      MOVEMENT_TYPE_MAP[String(movement_type || '').toUpperCase()] || movement_type;

    const qty = Number(quantity_kg);

    if (!String(material_name || '').trim() || !Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: "Invalid material_name or quantity_kg" });
    }
    if (!["IN", "OUT"].includes(direction)) {
      return res.status(400).json({ error: "direction must be IN or OUT" });
    }
    if (!resolvedMovementType) {
      return res.status(400).json({ error: "movement_type is required" });
    }

    await client.query("BEGIN");

    // Find or create the canonical material record
    const materialId = await getOrCreateMaterial(client, material_name);
    const displayName = String(material_name).trim();

    if (direction === "OUT") {
      // Lock the row and validate sufficient stock
      const balRes = await client.query(
        `SELECT total_quantity_kg FROM raw_material_totals
         WHERE material_id = $1 FOR UPDATE`,
        [materialId]
      );

      if (balRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Material not found in stock" });
      }

      const available = Number(balRes.rows[0].total_quantity_kg);
      if (available < qty) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `Insufficient stock. Available: ${available} kg`
        });
      }

      await client.query(
        `UPDATE raw_material_totals
         SET total_quantity_kg = total_quantity_kg - $1, updated_at = NOW()
         WHERE material_id = $2`,
        [qty, materialId]
      );

      // If FLOOR_TRANSFER, also add to floor_material_balance
      if (resolvedMovementType === "FLOOR_TRANSFER") {
        // Find or create material_type with the same name
        const matTypeRes = await client.query(
          `SELECT id FROM material_types WHERE LOWER(name) = LOWER($1) LIMIT 1`,
          [displayName]
        );
        
        let materialTypeId;
        if (matTypeRes.rows.length > 0) {
          materialTypeId = matTypeRes.rows[0].id;
        } else {
          // Create the material_type if it doesn't exist
          const insertTypeRes = await client.query(
            `INSERT INTO material_types (name)
             VALUES ($1)
             ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [displayName]
          );
          materialTypeId = insertTypeRes.rows[0].id;
        }

        // Upsert into floor_material_balance
        await client.query(
          `INSERT INTO floor_material_balance (material_type_id, total_quantity_kg)
           VALUES ($1, $2)
           ON CONFLICT (material_type_id)
           DO UPDATE SET total_quantity_kg = floor_material_balance.total_quantity_kg + $2`,
          [materialTypeId, qty]
        );
      }
    } else {
      // IN — upsert by material_id
      await client.query(
        `INSERT INTO raw_material_totals (material_id, total_quantity_kg, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (material_id)
         DO UPDATE SET total_quantity_kg = raw_material_totals.total_quantity_kg + $2,
                       updated_at = NOW()`,
        [materialId, qty]
      );
    }

    // Record the movement
    const mvResult = await client.query(
      `INSERT INTO material_movements
       (material_id, quantity_kg, direction, movement_type, reference_id, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [materialId, qty, direction, resolvedMovementType,
        reference_id || null, note || null, req.user.id]
    );

    await client.query("COMMIT");

    res.json({ success: true, movement: mvResult.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("MATERIAL MOVE ERROR:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ====================================================
// PRODUCTION LOGS (NEW CONTINUOUS LOGGING SYSTEM)
// ====================================================
app.post("/production/logs", authMiddleware, async (req, res) => {
  const { machine_id, material_id, material_type_id, size, worker_name, gross_weight, tare_weight, entered_by, machines } = req.body;

  const client = await pool.connect();
  const isBackend = client;

  try {
    await client.query('BEGIN');

    // Support two formats:
    // 1. Single log (Production.jsx): { machine_id, material_id, size, worker_name, gross_weight, tare_weight }
    // 2. Batch (ProductionLog.jsx): { entered_by, machines: [...] }

    let insertedCount = 0;
    let batchId = null;

    if (machines && Array.isArray(machines)) {
      // BATCH MODE: ProductionLog.jsx format
      const logs = [];

      for (const m of machines) {
        if (!m.machine_id) continue;

        // Validate weights
        if (m.gross_weight < m.tare_weight) {
          throw new Error(`Machine ${m.machine_id}: Gross weight must be >= tare weight`);
        }

        const net_weight = m.gross_weight - m.tare_weight;
        if (net_weight <= 0) {
          throw new Error(`Machine ${m.machine_id}: Net weight must be > 0`);
        }

        // Insert production log (no material_id required for batch mode)
        const logResult = await client.query(
          `INSERT INTO production_logs
           (machine_id, material_id, size, worker_name, gross_weight, tare_weight)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, machine_id, material_id, size, worker_name, gross_weight, tare_weight, created_at`,
          [
            m.machine_id,
            m.material_id || null,
            m.size || null,
            entered_by ? `User ${entered_by}` : m.worker_name || null,
            m.gross_weight,
            m.tare_weight
          ]
        );

        logs.push(logResult.rows[0]);
        insertedCount++;
      }

      // Generate batch ID (timestamp-based)
      batchId = `BATCH_${Date.now()}`;

      await client.query('COMMIT');

      return res.json({
        message: `Batch logged: ${insertedCount} production entries`,
        batch_id: batchId,
        inserted: insertedCount,
        data: logs
      });
    } else {
      // SINGLE MODE: Production.jsx format (original behavior)
      if (!machine_id) {
        throw new Error('machine_id is required');
      }

      // Validate weights
      if (gross_weight < tare_weight) {
        throw new Error('Gross weight must be >= tare weight');
      }

      const net_weight = gross_weight - tare_weight;
      const machineIdVariants = getMachineIdVariants(machine_id);

      // Determine stock material ID
      let stockMaterialId = material_type_id || material_id;

      // If no material provided, AUTO-DETECT from machine assignments
      if (!stockMaterialId) {
        const assignedRes = await client.query(
          `SELECT material_type_id 
           FROM machine_stock_assignments 
           WHERE machine_id = ANY($1::text[]) 
           ORDER BY assigned_at DESC 
           LIMIT 1`,
          [machineIdVariants]
        );

        if (assignedRes.rows.length > 0) {
          stockMaterialId = assignedRes.rows[0].material_type_id;
        }
      }

      // If stockMaterialId provided, check floor stock and deduct
      if (stockMaterialId) {
        await adjustFloorMaterialBalance(client, stockMaterialId, -net_weight);
      }

      // INSERT PRODUCTION LOG
      const logResult = await client.query(
        `INSERT INTO production_logs
         (machine_id, material_id, size, worker_name, gross_weight, tare_weight)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [machine_id, stockMaterialId || material_id, size, worker_name, gross_weight, tare_weight]
      );

      await upsertProductionConsumptionMovement(client, logResult.rows[0].id, {
        machine_id,
        material_id: stockMaterialId || material_id,
        net_weight
      });

      // OPTIONAL: Persist worker state
      if (worker_name) {
        await client.query(
          `INSERT INTO machine_state (machine_id, current_worker)
           VALUES ($1, $2)
           ON CONFLICT (machine_id)
           DO UPDATE SET current_worker = EXCLUDED.current_worker,
                         updated_at = NOW()`,
          [machine_id, worker_name]
        );
      }

      await client.query('COMMIT');

      res.json({
        message: 'Production logged and pooled floor stock deducted',
        data: logResult.rows[0]
      });
    }

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET PRODUCTION LOGS (for history display)
app.get("/production/logs", authMiddleware, async (req, res) => {
  try {
    const { machine_id, date_from, date_to, limit = "500" } = req.query;

    const conditions = [];
    const values = [];

    if (machine_id) {
      values.push(Number(machine_id));
      conditions.push(`pl.machine_id = $${values.length}`);
    }

    if (date_from) {
      values.push(date_from);
      conditions.push(`pl.created_at >= $${values.length}::date`);
    }

    if (date_to) {
      values.push(date_to);
      conditions.push(`pl.created_at < ($${values.length}::date + INTERVAL '1 day')`);
    }

    const parsedLimit = Math.min(Math.max(Number(limit) || 500, 1), 1000);
    values.push(parsedLimit);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pool.query(
      `
      SELECT
        pl.id,
        pl.machine_id,
        pl.material_id,
        pl.size,
        pl.worker_name,
        pl.gross_weight,
        pl.tare_weight,
        pl.created_at,
        m.name AS machine_name,
        mat.name AS material_name
      FROM production_logs pl
      LEFT JOIN machines m ON m.id = pl.machine_id
      LEFT JOIN materials_master mat ON mat.id = pl.material_id
      ${whereClause}
      ORDER BY pl.created_at DESC
      LIMIT $${values.length}
      `,
      values
    );

    // Calculate net weight for each log
    const logs = result.rows.map(row => ({
      ...row,
      net_weight: row.gross_weight - row.tare_weight
    }));

    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/production/logs/:id", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const logId = Number(req.params.id);
    const machineId = Number(req.body.machine_id);
    const grossWeight = toNumber(req.body.gross_weight);
    const tareWeight = toNumber(req.body.tare_weight);
    const size = req.body.size ?? null;
    const workerName = req.body.worker_name ?? null;
    const requestedMaterialId = req.body.material_type_id ?? req.body.material_id;

    if (!Number.isFinite(logId) || logId <= 0) {
      return res.status(400).json({ error: "Invalid production log id" });
    }
    if (!Number.isFinite(machineId) || machineId <= 0) {
      return res.status(400).json({ error: "machine_id is required" });
    }
    if (grossWeight <= 0 || tareWeight < 0 || grossWeight < tareWeight) {
      return res.status(400).json({ error: "Gross weight must be greater than or equal to tare weight" });
    }

    const nextNetWeight = grossWeight - tareWeight;
    if (nextNetWeight <= 0) {
      return res.status(400).json({ error: "Net weight must be greater than zero" });
    }

    await client.query("BEGIN");

    const currentRes = await client.query(
      `SELECT
         pl.*,
         mat.name AS material_name
       FROM production_logs pl
       LEFT JOIN materials_master mat ON mat.id = pl.material_id
       WHERE pl.id = $1
       FOR UPDATE OF pl`,
      [logId]
    );

    if (currentRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Production log not found" });
    }

    const current = currentRes.rows[0];
    const currentMaterialTypeId = await resolveMaterialTypeId(client, current.material_id, current.material_name);
    const nextMaterialTypeId = await resolveMaterialTypeId(client, requestedMaterialId, current.material_name);

    if (!nextMaterialTypeId) {
      throw new Error("Unable to resolve material for this production log");
    }

    await restoreProductionLogFloorStock(client, current);
    await adjustFloorMaterialBalance(client, nextMaterialTypeId, -nextNetWeight);

    const updateRes = await client.query(
      `UPDATE production_logs
       SET machine_id = $1,
           material_id = $2,
           size = $3,
           worker_name = $4,
           gross_weight = $5,
           tare_weight = $6
       WHERE id = $7
       RETURNING *`,
      [machineId, nextMaterialTypeId, size, workerName, grossWeight, tareWeight, logId]
    );

    await upsertProductionConsumptionMovement(client, logId, {
      machine_id: machineId,
      material_id: nextMaterialTypeId,
      net_weight: nextNetWeight
    });

    await client.query("COMMIT");
    res.json({ success: true, data: updateRes.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.delete("/production/logs/:id", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const logId = Number(req.params.id);
    if (!Number.isFinite(logId) || logId <= 0) {
      return res.status(400).json({ error: "Invalid production log id" });
    }

    await client.query("BEGIN");

    const currentRes = await client.query(
      `SELECT
         pl.*,
         mat.name AS material_name
       FROM production_logs pl
       LEFT JOIN materials_master mat ON mat.id = pl.material_id
       WHERE pl.id = $1
       FOR UPDATE OF pl`,
      [logId]
    );

    if (currentRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Production log not found" });
    }

    const current = currentRes.rows[0];
    await restoreProductionLogFloorStock(client, current);

    await client.query(
      `DELETE FROM material_movements
       WHERE movement_type = 'CONSUMPTION'
         AND reference_id = $1`,
      [logId]
    );
    await client.query(`DELETE FROM production_logs WHERE id = $1`, [logId]);

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post("/production/logs/bulk-delete", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const ids = Array.isArray(req.body.ids)
      ? req.body.ids.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
      : [];

    if (ids.length === 0) {
      return res.status(400).json({ error: "ids array is required" });
    }

    await client.query("BEGIN");

    const currentRes = await client.query(
      `SELECT
         pl.*,
         mat.name AS material_name
       FROM production_logs pl
       LEFT JOIN materials_master mat ON mat.id = pl.material_id
       WHERE pl.id = ANY($1::int[])
       ORDER BY pl.id
       FOR UPDATE OF pl`,
      [ids]
    );

    if (currentRes.rows.length !== ids.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "One or more production logs were not found" });
    }

    for (const row of currentRes.rows) {
      await restoreProductionLogFloorStock(client, row);
    }

    await client.query(
      `DELETE FROM material_movements
       WHERE movement_type = 'CONSUMPTION'
         AND reference_id = ANY($1::int[])`,
      [ids]
    );
    await client.query(`DELETE FROM production_logs WHERE id = ANY($1::int[])`, [ids]);

    await client.query("COMMIT");
    res.json({ success: true, deleted: ids.length });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});


// ====================================================
// REPORTS — MACHINE OUTPUT (NEW SYSTEM)
// ====================================================
app.get("/reports/machines", authMiddleware, async (req, res) => {
  try {
    const { date_from, date_to, machine_id } = req.query;

    const conditions = [];
    const values = [];

    if (date_from) {
      values.push(date_from);
      conditions.push(`pl.created_at >= $${values.length}::date`);
    }

    if (date_to) {
      values.push(date_to);
      conditions.push(`pl.created_at < ($${values.length}::date + INTERVAL '1 day')`);
    }

    if (machine_id) {
      values.push(Number(machine_id));
      conditions.push(`pl.machine_id = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pool.query(
      `
      SELECT
        m.id AS machine_id,
        m.name AS machine_name,
        COUNT(pl.id) AS total_entries,
        COALESCE(SUM(pl.gross_weight - pl.tare_weight), 0)::float AS total_net_weight_kg,
        COALESCE(SUM(pl.gross_weight), 0)::float AS total_gross_weight_kg,
        COALESCE(SUM(pl.tare_weight), 0)::float AS total_tare_weight_kg
      FROM machines m
      LEFT JOIN production_logs pl ON pl.machine_id = m.id
      ${whereClause}
      GROUP BY m.id, m.name
      ORDER BY m.id
      `,
      values
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get individual log entries (paginated)
app.get("/reports/logs", authMiddleware, async (req, res) => {
  try {
    const { machine_id, date_from, date_to, limit = "200" } = req.query;

    const conditions = [];
    const values = [];

    if (machine_id) {
      values.push(Number(machine_id));
      conditions.push(`mpl.machine_id = $${values.length}`);
    }

    if (date_from) {
      values.push(date_from);
      conditions.push(`mpl.created_at >= $${values.length}::date`);
    }

    if (date_to) {
      values.push(date_to);
      conditions.push(`mpl.created_at < ($${values.length}::date + INTERVAL '1 day')`);
    }

    const parsedLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    values.push(parsedLimit);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pool.query(
      `
      SELECT
        mpl.*,
        m.name AS machine_name,
        u.name AS entered_by_name
      FROM machine_production_logs mpl
      LEFT JOIN machines m ON m.id = mpl.machine_id
      LEFT JOIN users u ON u.id = mpl.entered_by
      ${whereClause}
      ORDER BY mpl.created_at DESC
      LIMIT $${values.length}
      `,
      values
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====================================================
// ANALYTICS — PLANT EFFICIENCY (kept — uses view)
// ====================================================
app.get("/analytics/plant-efficiency", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM plant_efficiency`);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/analytics/plant-efficiency-v2", authMiddleware, async (req, res) => {
  try {
    // Compute efficiency directly from tables (avoids dependency on missing view)
    const result = await pool.query(`
      SELECT
        COALESCE(SUM(rb.quantity_kg), 0)                          AS total_input_kg,
        COALESCE(SUM(pl.net_weight), 0)                            AS total_output_kg,
        CASE
          WHEN COALESCE(SUM(rb.quantity_kg), 0) = 0 THEN 0
          ELSE ROUND(
            (COALESCE(SUM(pl.net_weight), 0) /
             COALESCE(SUM(rb.quantity_kg), 0)) * 100, 2
          )
        END                                                        AS efficiency_percent
      FROM
        (SELECT COALESCE(SUM(quantity_kg), 0) AS quantity_kg FROM raw_material_batches) rb,
        (SELECT COALESCE(SUM(gross_weight - tare_weight), 0) AS net_weight FROM production_logs) pl
    `);
    res.json(result.rows[0] ?? { total_input_kg: 0, total_output_kg: 0, efficiency_percent: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====================================================
// DASHBOARD ALIAS ROUTES
// (Dashboard.jsx expects these paths — they proxy to
//  the canonical endpoints that already exist)
// ====================================================

// /floor/transactions  → material_movements log (direction-aware floor data)
app.get("/floor/transactions", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        mm.*,
        m.name AS material_name,
        u.name AS created_by_name
      FROM material_movements mm
      LEFT JOIN materials_master m ON m.id = mm.material_id
      LEFT JOIN users u ON u.id = mm.created_by
      ORDER BY mm.created_at DESC
      LIMIT 500
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/floor/transactions/:id", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const movementId = Number(req.params.id);
    const quantityKg = toNumber(req.body.quantity_kg);
    const direction = String(req.body.direction || "").trim().toUpperCase();
    const movementType = normalizeMovementTypeValue(req.body.movement_type);
    const materialName = String(req.body.material_name || "").trim();
    const note = req.body.note ?? null;

    if (!Number.isFinite(movementId) || movementId <= 0) {
      return res.status(400).json({ error: "Invalid transaction id" });
    }
    if (!materialName || quantityKg <= 0 || !["IN", "OUT"].includes(direction) || !movementType) {
      return res.status(400).json({ error: "material_name, quantity_kg, direction and movement_type are required" });
    }
    if (movementType === "CONSUMPTION") {
      return res.status(400).json({ error: "Production consumption entries must be edited from production history" });
    }

    await client.query("BEGIN");

    const currentRes = await client.query(
      `SELECT
         mm.*,
         m.name AS material_name
       FROM material_movements mm
       LEFT JOIN materials_master m ON m.id = mm.material_id
       WHERE mm.id = $1
       FOR UPDATE OF mm`,
      [movementId]
    );

    if (currentRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Transaction not found" });
    }

    const current = currentRes.rows[0];
    await applyEditableMovementEffect(client, current, -1);

    const nextMaterialId = await getOrCreateMaterial(client, materialName);
    const nextMovement = {
      material_id: nextMaterialId,
      material_name: materialName,
      quantity_kg: quantityKg,
      direction,
      movement_type: movementType,
    };

    await applyEditableMovementEffect(client, nextMovement, 1);

    const updateRes = await client.query(
      `UPDATE material_movements
       SET material_id = $1,
           quantity_kg = $2,
           direction = $3,
           movement_type = $4,
           note = $5
       WHERE id = $6
       RETURNING *`,
      [nextMaterialId, quantityKg, direction, movementType, note, movementId]
    );

    await client.query("COMMIT");
    res.json({ success: true, data: updateRes.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.delete("/floor/transactions/:id", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const movementId = Number(req.params.id);
    if (!Number.isFinite(movementId) || movementId <= 0) {
      return res.status(400).json({ error: "Invalid transaction id" });
    }

    await client.query("BEGIN");

    const currentRes = await client.query(
      `SELECT
         mm.*,
         m.name AS material_name
       FROM material_movements mm
       LEFT JOIN materials_master m ON m.id = mm.material_id
       WHERE mm.id = $1
       FOR UPDATE OF mm`,
      [movementId]
    );

    if (currentRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Transaction not found" });
    }

    const current = currentRes.rows[0];
    if (normalizeMovementTypeValue(current.movement_type) === "CONSUMPTION") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Production consumption entries must be deleted from production history" });
    }

    await applyEditableMovementEffect(client, current, -1);
    await client.query(`DELETE FROM material_movements WHERE id = $1`, [movementId]);

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post("/floor/transactions/bulk-delete", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const ids = Array.isArray(req.body.ids)
      ? req.body.ids.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
      : [];

    if (ids.length === 0) {
      return res.status(400).json({ error: "ids array is required" });
    }

    await client.query("BEGIN");

    const currentRes = await client.query(
      `SELECT
         mm.*,
         m.name AS material_name
       FROM material_movements mm
       LEFT JOIN materials_master m ON m.id = mm.material_id
       WHERE mm.id = ANY($1::int[])
       ORDER BY mm.id
       FOR UPDATE OF mm`,
      [ids]
    );

    if (currentRes.rows.length !== ids.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "One or more transactions were not found" });
    }

    if (currentRes.rows.some((row) => normalizeMovementTypeValue(row.movement_type) === "CONSUMPTION")) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Production consumption entries must be deleted from production history" });
    }

    for (const row of currentRes.rows) {
      await applyEditableMovementEffect(client, row, -1);
    }

    await client.query(`DELETE FROM material_movements WHERE id = ANY($1::int[])`, [ids]);

    await client.query("COMMIT");
    res.json({ success: true, deleted: ids.length });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// /inventory/transactions  → raw material batch history
app.get("/inventory/transactions", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        rb.*,
        u.name AS created_by_name
      FROM raw_material_batches rb
      LEFT JOIN users u ON u.id = rb.created_by
      ORDER BY rb.created_at DESC
      LIMIT 500
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// /inventory/balance  → current raw material stock totals
app.get("/inventory/balance", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT material_name, total_quantity_kg, updated_at
      FROM raw_material_totals
      ORDER BY material_name
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// AUTH — REGISTER
// =====================================================
app.post("/auth/register", async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "User already exists" });
    }

    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      `
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES ($1, $2, $3, 'worker', 'pending')
      `,
      [name, email, hash]
    );

    res.json({ message: "Account created. Awaiting admin approval." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// AUTH — LOGIN
// =====================================================
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const user = result.rows[0];

    if (user.status !== "approved") {
      return res.status(403).json({ error: "Account not approved" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { user_id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user_id: user.id,
      role: user.role,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// AUTH — CHANGE PASSWORD
// =====================================================
app.post("/auth/change-password", authMiddleware, async (req, res) => {
  const { old_password, new_password } = req.body;
  const user_id = req.user.user_id;

  try {
    const result = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [user_id]
    );

    const user = result.rows[0];

    const valid = await bcrypt.compare(old_password, user.password_hash);

    if (!valid) {
      return res.status(400).json({ error: "Incorrect old password" });
    }

    const newHash = await bcrypt.hash(new_password, 10);

    await pool.query(
      "UPDATE users SET password_hash = $1 WHERE id = $2",
      [newHash, user_id]
    );

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// ADMIN — PENDING USERS
// =====================================================
app.get("/admin/pending-users", authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, email FROM users WHERE status = 'pending'"
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// ADMIN — APPROVE USER
// =====================================================
app.post("/admin/approve-user", authMiddleware, adminOnly, async (req, res) => {
  const { user_id } = req.body;

  try {
    await pool.query(
      "UPDATE users SET status = 'approved' WHERE id = $1",
      [user_id]
    );

    res.json({ message: "User approved" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// ADMIN — REJECT USER
// =====================================================
app.post("/admin/reject-user", authMiddleware, adminOnly, async (req, res) => {
  const { user_id } = req.body;

  try {
    await pool.query(
      "UPDATE users SET status = 'rejected' WHERE id = $1",
      [user_id]
    );

    res.json({ message: "User rejected" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// MACHINES
// =====================================================
app.get("/machines", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM machines`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get machine state (e.g., current worker)
app.get("/machines/:id/state", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT current_worker, updated_at FROM machine_state WHERE machine_id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.json({ current_worker: null });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// =====================================================
// USERS
// =====================================================
app.post("/users", authMiddleware, adminOnly, async (req, res) => {
  const { email, password, name, role } = req.body;

  try {
    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `
      INSERT INTO users (email, password_hash, name, role, status)
      VALUES ($1, $2, $3, $4, 'approved')
      RETURNING id, email, name, role, status
      `,
      [email, hash, name, role || "worker"]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("CREATE USER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/users", authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, email, name, role, status
      FROM users
      ORDER BY id DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("GET USERS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// ORDERS
// =====================================================
app.post("/orders", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      order_number,
      client_name,
      status = "Active",
      items = [],
    } = req.body;

    const normalizedOrderNumber = String(order_number || "").trim();
    const normalizedClientName = String(client_name || "").trim();
    const normalizedStatus = normalizeOrderStatus(status);
    const normalizedItems = (Array.isArray(items) ? items : [])
      .map((item) => ({
        item_name: String(item?.item_name || "").trim(),
        required_quantity: Number(item?.required_quantity),
        unit_price: Number(item?.unit_price ?? 0),
      }))
      .filter(
        (item) =>
          item.item_name &&
          Number.isFinite(item.required_quantity) &&
          item.required_quantity > 0 &&
          Number.isFinite(item.unit_price) &&
          item.unit_price >= 0
      );

    if (!normalizedOrderNumber) {
      return res.status(400).json({ error: "order_number is required" });
    }
    if (!normalizedClientName) {
      return res.status(400).json({ error: "client_name is required" });
    }

    await client.query("BEGIN");

    const orderInsert = await client.query(
      `
      INSERT INTO orders (order_number, client_name, status)
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [normalizedOrderNumber, normalizedClientName, normalizedStatus]
    );

    const order = orderInsert.rows[0];

    for (const item of normalizedItems) {
      await client.query(
        `
        INSERT INTO order_items (order_id, item_name, required_quantity, unit_price)
        VALUES ($1, $2, $3, $4)
        `,
        [order.id, item.item_name, item.required_quantity, item.unit_price]
      );
    }

    const [hydratedOrder] = await hydrateOrders(client, [order]);

    await client.query("COMMIT");
    res.json(hydratedOrder);
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      return res.status(400).json({ error: "Order number already exists" });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get("/orders", authMiddleware, async (req, res) => {
  try {
    const includeItems = ["1", "true", "yes"].includes(String(req.query.include_items || "").toLowerCase());
    const result = await pool.query(
      `
      SELECT *
      FROM orders
      ORDER BY created_at DESC, id DESC
      `
    );

    if (!includeItems) {
      return res.json(result.rows);
    }

    const hydrated = await hydrateOrders(pool, result.rows);
    res.json(hydrated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/orders/:orderNumber/items", authMiddleware, async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const orderRes = await pool.query(
      `SELECT id FROM orders WHERE order_number = $1`,
      [orderNumber]
    );

    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    const items = await fetchOrderItems(pool, orderRes.rows[0].id);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/orders/:id", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM orders WHERE id = $1`, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }
    const [hydratedOrder] = await hydrateOrders(pool, result.rows);
    res.json(hydratedOrder);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/orders/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM orders WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json({
      message: "Order deleted",
      deleted: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/orders/:id/status", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const normalizedStatus = normalizeOrderStatus(req.body?.status);
  const allowedStatuses = ["Active", "completed", "cancelled"];

  if (!allowedStatuses.includes(normalizedStatus)) {
    return res.status(400).json({ error: "Invalid order status" });
  }

  try {
    const result = await pool.query(
      `
      UPDATE orders
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
      `,
      [normalizedStatus, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/fulfillment", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      order_number,
      item_id,
      item_index,
      supplied_quantity,
      note = null,
    } = req.body;

    const normalizedOrderNumber = String(order_number || "").trim();
    const quantity = Number(supplied_quantity);

    if (!normalizedOrderNumber) {
      return res.status(400).json({ error: "order_number is required" });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ error: "supplied_quantity must be greater than 0" });
    }

    await client.query("BEGIN");

    const orderRes = await client.query(
      `SELECT id, status FROM orders WHERE order_number = $1 FOR UPDATE`,
      [normalizedOrderNumber]
    );

    if (orderRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Order not found" });
    }

    const order = orderRes.rows[0];
    let targetItem = null;

    if (item_id) {
      const itemRes = await client.query(
        `
        SELECT id, item_name, required_quantity
        FROM order_items
        WHERE id = $1 AND order_id = $2
        FOR UPDATE
        `,
        [Number(item_id), order.id]
      );
      targetItem = itemRes.rows[0] || null;
    } else if (item_index !== undefined && item_index !== null && item_index !== "") {
      const itemRes = await client.query(
        `
        SELECT id, item_name, required_quantity
        FROM order_items
        WHERE order_id = $1
        ORDER BY created_at ASC, id ASC
        OFFSET $2 LIMIT 1
        FOR UPDATE
        `,
        [order.id, Number(item_index)]
      );
      targetItem = itemRes.rows[0] || null;
    }

    if (!targetItem) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Valid order item is required" });
    }

    const fulfilledRes = await client.query(
      `
      SELECT COALESCE(SUM(supplied_quantity), 0)::float AS fulfilled_quantity
      FROM fulfillment_records
      WHERE order_item_id = $1
      `,
      [targetItem.id]
    );

    const fulfilledQuantity = Number(fulfilledRes.rows[0]?.fulfilled_quantity) || 0;
    const remainingQuantity = Number(targetItem.required_quantity) - fulfilledQuantity;

    if (remainingQuantity < quantity) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Cannot supply more than remaining quantity (${Math.max(remainingQuantity, 0).toFixed(2)} kg)`,
      });
    }

    const insertRes = await client.query(
      `
      INSERT INTO fulfillment_records (order_id, order_item_id, supplied_quantity, note, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [order.id, targetItem.id, quantity, note, req.user?.id || req.user?.user_id || null]
    );

    await syncOrderStatus(client, order.id);

    await client.query("COMMIT");

    res.json({
      ...insertRes.rows[0],
      order_number: normalizedOrderNumber,
      item_name: targetItem.item_name,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get("/fulfillment", authMiddleware, async (req, res) => {
  try {
    const { order_number, limit = "500" } = req.query;
    const conditions = [];
    const values = [];

    if (order_number) {
      values.push(String(order_number).trim());
      conditions.push(`o.order_number = $${values.length}`);
    }

    const parsedLimit = Math.min(Math.max(Number(limit) || 500, 1), 1000);
    values.push(parsedLimit);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pool.query(
      `
      SELECT
        fr.*,
        o.order_number,
        oi.item_name
      FROM fulfillment_records fr
      JOIN orders o ON o.id = fr.order_id
      JOIN order_items oi ON oi.id = fr.order_item_id
      ${whereClause}
      ORDER BY fr.created_at DESC
      LIMIT $${values.length}
      `,
      values
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// WASTAGE
// =====================================================
app.post("/wastage", authMiddleware, async (req, res) => {
  const { date, weight } = req.body;

  // Validation
  if (!date) {
    return res.status(400).json({ error: "date is required" });
  }
  if (weight == null || Number(weight) <= 0) {
    return res.status(400).json({ error: "weight must be greater than 0" });
  }

  try {
    // Auto-compute next id and sno (table has no sequence defaults)
    const seqRes = await pool.query(
      "SELECT COALESCE(MAX(id), 0) + 1 AS next_id, COALESCE(MAX(sno), 0) + 1 AS next_sno FROM wastage_data"
    );
    const nextId  = seqRes.rows[0].next_id;
    const nextSno = seqRes.rows[0].next_sno;

    const insertRes = await pool.query(
      `INSERT INTO wastage_data (id, sno, date, weight)
       VALUES ($1, $2, $3, $4)
       RETURNING id, sno, date, weight`,
      [nextId, nextSno, date, Number(weight)]
    );

    return res.status(201).json({
      message: "Wastage recorded",
      data: insertRes.rows[0]
    });
  } catch (err) {
    console.error("WASTAGE INSERT ERROR:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/wastage", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, sno, date, weight FROM wastage_data ORDER BY sno DESC LIMIT 500`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("WASTAGE GET ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/wastage/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(Number(id))) {
    return res.status(400).json({ error: "Invalid id" });
  }
  try {
    const result = await pool.query(
      `DELETE FROM wastage_data WHERE id = $1 RETURNING id, sno`,
      [Number(id)]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Wastage entry not found" });
    }
    res.json({ message: "Wastage entry deleted", deleted: result.rows[0] });
  } catch (err) {
    console.error("WASTAGE DELETE ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// =====================================================
// START SERVER
// =====================================================

// Ensure required tables exist
const initializeTables = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_number VARCHAR(255) UNIQUE NOT NULL,
        client_name VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS order_number VARCHAR(255)
    `);

    await pool.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS client_name VARCHAR(255)
    `);

    await pool.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Active'
    `);

    await pool.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    await pool.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number
      ON orders(order_number)
      WHERE order_number IS NOT NULL
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        item_name VARCHAR(255) NOT NULL,
        required_quantity NUMERIC(12, 3) NOT NULL,
        unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      ALTER TABLE order_items
      ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_order_items_order_id
      ON order_items(order_id)
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS fulfillment_records (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
        supplied_quantity NUMERIC(12, 3) NOT NULL,
        note TEXT,
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_fulfillment_records_order_id
      ON fulfillment_records(order_id)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_fulfillment_records_order_item_id
      ON fulfillment_records(order_item_id)
    `);

    // Create machine_stock_assignments table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS machine_stock_assignments (
        id SERIAL PRIMARY KEY,
        machine_id VARCHAR(10) NOT NULL,
        material_type_id INTEGER NOT NULL,
        quantity_kg NUMERIC(12, 2) NOT NULL DEFAULT 0,
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(machine_id, material_type_id)
      )
    `);
    
    // Create indexes if they don't exist
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_machine_assignments_machine_id 
      ON machine_stock_assignments(machine_id)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_machine_assignments_material_type_id 
      ON machine_stock_assignments(material_type_id)
    `);
    
    console.log('Database tables initialized successfully');
  } catch (err) {
    console.error('Failed to initialize tables:', err);
  }
};

// Initialize tables before starting server
initializeTables().then(() => {
  app.listen(process.env.PORT, () => {
    console.log(`Server running on port ${process.env.PORT}`);
  });
}).catch(err => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
