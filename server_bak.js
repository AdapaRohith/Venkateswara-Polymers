require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// PostgreSQL Pool
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// =====================================================
// HEALTH CHECK
// =====================================================
app.get("/", (req, res) => {
  res.send("API is running");
});

// =====================================================
// USERS
// =====================================================
app.post("/users", async (req, res) => {
  const { email, password, name, role } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [email, password, name, role]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/users", async (req, res) => {
  const result = await pool.query(`SELECT * FROM users`);
  res.json(result.rows);
});

// =====================================================
// ORDERS
// =====================================================
app.post("/orders", async (req, res) => {
  const { order_number, client_name, status = "Active" } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO orders (order_number, client_name, status)
       VALUES ($1, $2, $3) RETURNING *`,
      [order_number, client_name, status]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/orders", async (req, res) => {
  const result = await pool.query(`SELECT * FROM orders`);
  res.json(result.rows);
});

app.delete("/orders/:id", async (req, res) => {
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

app.put("/orders/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const allowedStatuses = ["Active", "completed", "cancelled"];

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: "Invalid order status" });
  }

  try {
    const result = await pool.query(
      `UPDATE orders
       SET status = $1
       WHERE id = $2
       RETURNING *`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// INVENTORY TRANSACTIONS (UNIFIED SYSTEM)
// =====================================================

// Helper: get current stock balance
const getStockBalance = async (client, stock_id) => {
  const result = await client.query(
    `
    SELECT COALESCE(SUM(
      CASE 
        WHEN direction = 'IN' THEN quantity_in_kg
        ELSE -quantity_in_kg
      END
    ), 0) AS balance
    FROM inventory_transactions
    WHERE stock_id = $1
    `,
    [stock_id]
  );

  return Number(result.rows[0].balance);
};

// =====================================================
// CREATE TRANSACTION (CORE ENDPOINT)
// =====================================================
app.post("/inventory/transaction", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      stock_id,
      transaction_type,
      direction,
      quantity_in_kg,
      quantity_display,
      quantity_unit,
      worker_id,
      order_number,
      reference_id,
      note,
      created_by,
    } = req.body;

    if (!stock_id || !transaction_type || !direction || !quantity_in_kg) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    await client.query("BEGIN");

    // 🔍 Get current balance
    const currentBalance = await getStockBalance(client, stock_id);

    // ❌ Prevent negative stock
    if (direction === "OUT" && currentBalance < quantity_in_kg) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Insufficient stock",
        currentBalance,
      });
    }

    // ✅ Insert transaction
    const result = await client.query(
      `
      INSERT INTO inventory_transactions
      (stock_id, transaction_type, direction, quantity_in_kg,
       quantity_display, quantity_unit, worker_id, order_number,
       reference_id, note, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
      `,
      [
        stock_id,
        transaction_type,
        direction,
        quantity_in_kg,
        quantity_display,
        quantity_unit,
        worker_id,
        order_number,
        reference_id,
        note,
        created_by,
      ]
    );

    await client.query("COMMIT");

    res.json({
      message: "Transaction successful",
      data: result.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// =====================================================
// GET ALL TRANSACTIONS
// =====================================================
app.get("/inventory/transactions", async (req, res) => {
  try {
    const { stock_id, type, worker_id } = req.query;

    let query = `SELECT * FROM inventory_transactions WHERE 1=1`;
    let values = [];

    if (stock_id) {
      values.push(stock_id);
      query += ` AND stock_id = $${values.length}`;
    }

    if (type) {
      values.push(type);
      query += ` AND transaction_type = $${values.length}`;
    }

    if (worker_id) {
      values.push(worker_id);
      query += ` AND worker_id = $${values.length}`;
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// GET ALL STOCK BALANCES
// =====================================================
app.get("/inventory/balance", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT 
        stock_id,
        SUM(
          CASE 
            WHEN direction = 'IN' THEN quantity_in_kg
            ELSE -quantity_in_kg
          END
        ) AS balance
      FROM inventory_transactions
      GROUP BY stock_id
      ORDER BY stock_id
      `
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// GET SINGLE STOCK BALANCE
// =====================================================
app.get("/inventory/balance/:stock_id", async (req, res) => {
  try {
    const { stock_id } = req.params;

    const result = await pool.query(
      `
      SELECT COALESCE(SUM(
        CASE 
          WHEN direction = 'IN' THEN quantity_in_kg
          ELSE -quantity_in_kg
        END
      ), 0) AS balance
      FROM inventory_transactions
      WHERE stock_id = $1
      `,
      [stock_id]
    );

    res.json({
      stock_id,
      balance: Number(result.rows[0].balance),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// DELETE TRANSACTION (REVERSAL SAFE VERSION RECOMMENDED)
// =====================================================
app.delete("/inventory/transaction/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM inventory_transactions WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    res.json({
      message: "Transaction deleted",
      deleted: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// START SERVER
// =====================================================
app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});

//==================================
// Updated version:
//===================================
/*
require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ================= DB =================
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// ================= HEALTH =================
app.get("/", (req, res) => {
  res.send("API running");
});

// =====================================================
// HELPER: GET STOCK BALANCE
// =====================================================
const getStockBalance = async (client, stock_id) => {
  const result = await client.query(
    `
    SELECT COALESCE(SUM(
      CASE 
        WHEN direction = 'IN' THEN quantity_in_kg
        ELSE -quantity_in_kg
      END
    ), 0) AS balance
    FROM inventory_transactions
    WHERE stock_id = $1
    `,
    [stock_id]
  );

  return Number(result.rows[0].balance);
};

// =====================================================
// CORE: INSERT INVENTORY TRANSACTION (REUSABLE)
// =====================================================
const insertTransaction = async (
  client,
  {
    stock_id,
    transaction_type,
    direction,
    quantity_in_kg,
    worker_id,
    order_number,
    note,
    created_by,
  }
) => {
  // Prevent negative stock
  if (direction === "OUT") {
    const balance = await getStockBalance(client, stock_id);
    if (balance < quantity_in_kg) {
      throw new Error(
        `Insufficient stock for stock_id ${stock_id}. Available: ${balance}`
      );
    }
  }

  await client.query(
    `
    INSERT INTO inventory_transactions
    (stock_id, transaction_type, direction, quantity_in_kg,
     worker_id, order_number, note, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
    [
      stock_id,
      transaction_type,
      direction,
      quantity_in_kg,
      worker_id,
      order_number,
      note,
      created_by,
    ]
  );
};

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

// =====================================================
// CREATE PRODUCTION BATCH
// =====================================================
app.post("/production/create", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      machine_id,
      order_number,
      inputs, // [{stock_id, quantity}]
      outputs, // [{stock_id, quantity}]
      worker_id,
      created_by,
      note,
    } = req.body;

    if (!machine_id || !inputs || inputs.length === 0 || !outputs || outputs.length === 0) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    await client.query("BEGIN");

    // ================= CALCULATE TOTALS =================
    const totalInput = inputs.reduce((sum, i) => sum + Number(i.quantity), 0);
    const totalOutput = outputs.reduce((sum, o) => sum + Number(o.quantity), 0);
    const waste = totalInput - totalOutput;

    if (waste < 0) {
      throw new Error("Output cannot exceed input");
    }

    // ================= CREATE BATCH =================
    const batchResult = await client.query(
      `
      INSERT INTO production_batches
      (machine_id, order_number, total_input_kg, total_output_kg, total_waste_kg)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
      `,
      [machine_id, order_number, totalInput, totalOutput, waste]
    );

    const batchId = batchResult.rows[0].id;

    // ================= HANDLE INPUTS =================
    for (const input of inputs) {
      await client.query(
        `
        INSERT INTO production_inputs (batch_id, stock_id, quantity_kg)
        VALUES ($1,$2,$3)
        `,
        [batchId, input.stock_id, input.quantity]
      );

      await insertTransaction(client, {
        stock_id: input.stock_id,
        transaction_type: "production_input",
        direction: "OUT",
        quantity_in_kg: input.quantity,
        worker_id,
        order_number,
        note,
        created_by,
      });
    }

    // ================= HANDLE OUTPUTS =================
    for (const output of outputs) {
      await client.query(
        `
        INSERT INTO production_outputs (batch_id, stock_id, quantity_kg)
        VALUES ($1,$2,$3)
        `,
        [batchId, output.stock_id, output.quantity]
      );

      await insertTransaction(client, {
        stock_id: output.stock_id,
        transaction_type: "production_output",
        direction: "IN",
        quantity_in_kg: output.quantity,
        worker_id,
        order_number,
        note,
        created_by,
      });
    }

    // ================= HANDLE WASTE =================
    const WASTE_STOCK_ID = 9999; // change if needed

    if (waste > 0) {
      await insertTransaction(client, {
        stock_id: WASTE_STOCK_ID,
        transaction_type: "waste_generated",
        direction: "IN",
        quantity_in_kg: waste,
        worker_id,
        order_number,
        note,
        created_by,
      });
    }

    await client.query("COMMIT");

    res.json({
      message: "Production batch created",
      batch: batchResult.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// =====================================================
// GET ALL PRODUCTION BATCHES
// =====================================================
app.get("/production/batches", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT pb.*, m.name AS machine_name
      FROM production_batches pb
      JOIN machines m ON pb.machine_id = m.id
      ORDER BY pb.created_at DESC
      `
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// MACHINE ANALYTICS
// =====================================================
app.get("/analytics/machines", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT 
        m.id,
        m.name,
        SUM(pb.total_input_kg) AS total_input,
        SUM(pb.total_output_kg) AS total_output,
        SUM(pb.total_waste_kg) AS total_waste,
        CASE 
          WHEN SUM(pb.total_input_kg) > 0 
          THEN SUM(pb.total_output_kg) / SUM(pb.total_input_kg)
          ELSE 0
        END AS efficiency
      FROM machines m
      LEFT JOIN production_batches pb ON pb.machine_id = m.id
      GROUP BY m.id
      ORDER BY m.id
      `
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// USERS
// =====================================================
app.post("/users", async (req, res) => {
  const { email, password, name, role } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [email, password, name, role || "worker"]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/users", async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, email, name, role FROM users`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// ORDERS
// =====================================================
app.post("/orders", async (req, res) => {
  let { order_number, client_name, status = "Active" } = req.body;

  // Normalize status: capitalize 'active' if needed, keep others lowercase
  if (status) {
    const normalized = String(status).toLowerCase();
    if (normalized === "active") {
      status = "Active";
    } else {
      status = normalized;
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO orders (order_number, client_name, status)
       VALUES ($1, $2, $3) RETURNING *`,
      [order_number, client_name, status]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/orders", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM orders`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/orders/:id", async (req, res) => {
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

app.put("/orders/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const allowedStatuses = ["Active", "completed", "cancelled"];

  // Normalize input: capitalize 'active' if needed, keep others lowercase
  let normalizedStatus = String(status).toLowerCase();
  if (normalizedStatus === "active") {
    normalizedStatus = "Active";
  }

  if (!allowedStatuses.includes(normalizedStatus)) {
    return res.status(400).json({ error: "Invalid order status" });
  }

  try {
    const result = await pool.query(
      `UPDATE orders
       SET status = $1
       WHERE id = $2
       RETURNING *`,
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

// =====================================================
// INVENTORY TRANSACTIONS (UNIFIED SYSTEM)
// =====================================================

// =====================================================
// CREATE TRANSACTION (CORE ENDPOINT)
// =====================================================
app.post("/inventory/transaction", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      stock_id,
      transaction_type,
      direction,
      quantity_in_kg,
      quantity_display,
      quantity_unit,
      worker_id,
      order_number,
      reference_id,
      note,
      created_by,
    } = req.body;

    if (!stock_id || !transaction_type || !direction || !quantity_in_kg) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    await client.query("BEGIN");

    // 🔍 Get current balance
    const currentBalance = await getStockBalance(client, stock_id);

    // ❌ Prevent negative stock
    if (direction === "OUT" && currentBalance < quantity_in_kg) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Insufficient stock",
        currentBalance,
      });
    }

    // ✅ Insert transaction
    const result = await client.query(
      `
      INSERT INTO inventory_transactions
      (stock_id, transaction_type, direction, quantity_in_kg,
       quantity_display, quantity_unit, worker_id, order_number,
       reference_id, note, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
      `,
      [
        stock_id,
        transaction_type,
        direction,
        quantity_in_kg,
        quantity_display,
        quantity_unit,
        worker_id,
        order_number,
        reference_id,
        note,
        created_by,
      ]
    );

    await client.query("COMMIT");

    res.json({
      message: "Transaction successful",
      data: result.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// =====================================================
// GET ALL TRANSACTIONS
// =====================================================
app.get("/inventory/transactions", async (req, res) => {
  try {
    const { stock_id, type, worker_id } = req.query;

    let query = `SELECT * FROM inventory_transactions WHERE 1=1`;
    let values = [];

    if (stock_id) {
      values.push(stock_id);
      query += ` AND stock_id = $${values.length}`;
    }

    if (type) {
      values.push(type);
      query += ` AND transaction_type = $${values.length}`;
    }

    if (worker_id) {
      values.push(worker_id);
      query += ` AND worker_id = $${values.length}`;
    }

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// GET ALL STOCK BALANCES
// =====================================================
app.get("/inventory/balance", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT 
        stock_id,
        SUM(
          CASE 
            WHEN direction = 'IN' THEN quantity_in_kg
            ELSE -quantity_in_kg
          END
        ) AS balance
      FROM inventory_transactions
      GROUP BY stock_id
      ORDER BY stock_id
      `
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// GET SINGLE STOCK BALANCE
// =====================================================
app.get("/inventory/balance/:stock_id", async (req, res) => {
  try {
    const { stock_id } = req.params;

    const result = await pool.query(
      `
      SELECT COALESCE(SUM(
        CASE 
          WHEN direction = 'IN' THEN quantity_in_kg
          ELSE -quantity_in_kg
        END
      ), 0) AS balance
      FROM inventory_transactions
      WHERE stock_id = $1
      `,
      [stock_id]
    );

    res.json({
      stock_id,
      balance: Number(result.rows[0].balance),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// DELETE TRANSACTION
// =====================================================
app.delete("/inventory/transaction/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM inventory_transactions WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    res.json({
      message: "Transaction deleted",
      deleted: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// START SERVER
// =====================================================
app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
}); */
/*require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();

// ================= CORS (FIXED) =================
const allowedOriginPatterns = [
  /^https:\/\/.*\.avlokai\.com$/,
  /^https:\/\/.*\.vercel\.app$/,
  /^https:\/\/.*\.pages\.dev$/,
  /^http:\/\/localhost:\d+$/
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
/*
app.options(/.*/, cors());
app.use(express.json());
/*
// ================= DB =================
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// ================= HEALTH =================
app.get("/", (req, res) => {
  res.send("API running");
});

// =====================================================
// HELPER: GET STOCK BALANCE
// =====================================================
const getStockBalance = async (client, stock_id) => {
  const result = await client.query(
    `
    SELECT COALESCE(SUM(
      CASE
        WHEN direction = 'IN' THEN quantity_in_kg
        ELSE -quantity_in_kg
      END
    ), 0) AS balance
    FROM inventory_transactions
    WHERE stock_id = $1
    `,
    [stock_id]
  );

  return Number(result.rows[0].balance);
};
//====================================================
// start production
//====================================================
app.post("/production/start", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const { machine_id, materials } = req.body;

    await client.query("BEGIN");

    // ensure only one active session per machine
    const active = await client.query(
      `SELECT id FROM production_sessions 
       WHERE machine_id = $1 AND status = 'active'`,
      [machine_id]
    );

    if (active.rows.length > 0) {
      throw new Error("Machine already has an active session");
    }

    // create session
    const sessionResult = await client.query(
      `INSERT INTO production_sessions (machine_id)
       VALUES ($1)
       RETURNING *`,
      [machine_id]
    );

    const session = sessionResult.rows[0];

    // insert materials
    for (const mat of materials) {
      await client.query(
        `
        INSERT INTO session_materials
        (session_id, stock_id, initial_quantity_kg, remaining_quantity_kg)
        VALUES ($1, $2, $3, $3)
        `,
        [session.id, mat.stock_id, mat.quantity]
      );
    }

    await client.query("COMMIT");
    res.json(session);

  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});
//====================================================
// log production
//====================================================
app.post("/production/log", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const { session_id, gross_weight, tare_weight } = req.body;
    const net = gross_weight - tare_weight;

    await client.query("BEGIN");

    // get materials
    const mats = await client.query(
      `SELECT * FROM session_materials WHERE session_id = $1`,
      [session_id]
    );

    if (mats.rows.length === 0) {
      throw new Error("No materials found for session");
    }

    // simple proportional distribution
    const totalRemaining = mats.rows.reduce(
      (sum, m) => sum + Number(m.remaining_quantity_kg),
      0
    );

    for (const m of mats.rows) {
      const proportion = m.remaining_quantity_kg / totalRemaining;
      const consume = net * proportion;

      if (m.remaining_quantity_kg < consume) {
        throw new Error("Insufficient stock");
      }

      await client.query(
        `
        UPDATE session_materials
        SET remaining_quantity_kg = remaining_quantity_kg - $1
        WHERE id = $2
        `,
        [consume, m.id]
      );
    }

    // log entry
    const log = await client.query(
      `
      INSERT INTO session_logs (session_id, gross_weight, tare_weight, net_weight)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [session_id, gross_weight, tare_weight, net]
    );

    await client.query("COMMIT");
    res.json(log.rows[0]);

  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});
//====================================================
// Get production details
//====================================================
app.get("/production/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const session = await pool.query(
      `SELECT * FROM production_sessions WHERE id = $1`,
      [id]
    );

    const materials = await pool.query(
      `SELECT * FROM session_materials WHERE session_id = $1`,
      [id]
    );

    const logs = await pool.query(
      `SELECT * FROM session_logs WHERE session_id = $1 ORDER BY created_at DESC`,
      [id]
    );

    res.json({
      session: session.rows[0],
      materials: materials.rows,
      logs: logs.rows
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
//====================================================
//end production
//====================================================
app.post("/production/end", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const { session_id } = req.body;

    await client.query("BEGIN");

    const mats = await client.query(
      `SELECT * FROM session_materials WHERE session_id = $1`,
      [session_id]
    );

    const logs = await client.query(
      `SELECT SUM(net_weight) as total_output 
       FROM session_logs WHERE session_id = $1`,
      [session_id]
    );

    const totalOutput = Number(logs.rows[0].total_output || 0);

    let totalWaste = 0;

    for (const m of mats.rows) {
      totalWaste += Number(m.remaining_quantity_kg);

      // log waste into inventory
      await client.query(
        `
        INSERT INTO inventory_transactions
        (stock_id, quantity_in_kg, direction)
        VALUES ($1, $2, 'OUT')
        `,
        [m.stock_id, m.remaining_quantity_kg]
      );
    }

    // mark session complete
    await client.query(
      `
      UPDATE production_sessions
      SET status = 'completed', completed_at = NOW()
      WHERE id = $1
      `,
      [session_id]
    );

    await client.query("COMMIT");

    res.json({
      total_output: totalOutput,
      total_waste: totalWaste
    });

  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});
//=====================================================
// Active Sessions
//=====================================================
app.get("/production/active/:machine_id", async (req, res) => {
  const { machine_id } = req.params;

  const result = await pool.query(
    `SELECT * FROM production_sessions 
     WHERE machine_id = $1 AND status = 'active'`,
    [machine_id]
  );

  res.json(result.rows[0] || null);
});
//=====================================================
// Auth Middleware (FIXED TOKEN PARSING)
//=====================================================
const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization;

  if (!header) return res.status(401).json({ error: "Unauthorized" });

  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
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

//======================================================
//Pending Approval
//======================================================
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
// CORE: INSERT INVENTORY TRANSACTION (REUSABLE)
// =====================================================
const insertTransaction = async (
  client,
  {
    stock_id,
    transaction_type,
    direction,
    quantity_in_kg,
    worker_id,
    order_number,
    note,
    created_by,
  }
) => {
  // Prevent negative stock
  if (direction === "OUT") {
    const balance = await getStockBalance(client, stock_id);
    if (balance < quantity_in_kg) {
      throw new Error(
        `Insufficient stock for stock_id ${stock_id}. Available: ${balance}`
      );
    }
  }

  await client.query(
    `
    INSERT INTO inventory_transactions
    (stock_id, transaction_type, direction, quantity_in_kg,
     worker_id, order_number, note, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
    [
      stock_id,
      transaction_type,
      direction,
      quantity_in_kg,
      worker_id,
      order_number,
      note,
      created_by,
    ]
  );
};
//======================================================
//login
//======================================================
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
//=====================================================
//Change Password
//=====================================================
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
//======================================================
//Get Pending Users
//======================================================
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
//=======================================================
// Approve User
//=======================================================
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
//=======================================================
//Reject User
//=======================================================
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

// =====================================================
// CREATE PRODUCTION BATCH
// =====================================================
app.post("/production/create", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      machine_id,
      order_number,
      inputs, // [{stock_id, quantity}]
      outputs, // [{stock_id, quantity}]
      worker_id,
      created_by,
      note,
    } = req.body;

    if (!machine_id || !inputs || inputs.length === 0 || !outputs || outputs.length === 0) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    await client.query("BEGIN");

    // ================= CALCULATE TOTALS =================
    const totalInput = inputs.reduce((sum, i) => sum + Number(i.quantity), 0);
    const totalOutput = outputs.reduce((sum, o) => sum + Number(o.quantity), 0);
    const waste = totalInput - totalOutput;

    if (waste < 0) {
      throw new Error("Output cannot exceed input");
    }

    // ================= CREATE BATCH =================
    const batchResult = await client.query(
      `
      INSERT INTO production_batches
      (machine_id, order_number, total_input_kg, total_output_kg, total_waste_kg)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
      `,
      [machine_id, order_number, totalInput, totalOutput, waste]
    );

    const batchId = batchResult.rows[0].id;

    // ================= HANDLE INPUTS =================
    for (const input of inputs) {
      await client.query(
        `
        INSERT INTO production_inputs (batch_id, stock_id, quantity_kg)
        VALUES ($1,$2,$3)
        `,
        [batchId, input.stock_id, input.quantity]
      );

      await insertTransaction(client, {
        stock_id: input.stock_id,
        transaction_type: "production_input",
        direction: "OUT",
        quantity_in_kg: input.quantity,
        worker_id,
        order_number,
        note,
        created_by,
      });
    }

    // ================= HANDLE OUTPUTS =================
    for (const output of outputs) {
      await client.query(
        `
        INSERT INTO production_outputs (batch_id, stock_id, quantity_kg)
        VALUES ($1,$2,$3)
        `,
        [batchId, output.stock_id, output.quantity]
      );

      await insertTransaction(client, {
        stock_id: output.stock_id,
        transaction_type: "production_output",
        direction: "IN",
        quantity_in_kg: output.quantity,
        worker_id,
        order_number,
        note,
        created_by,
      });
    }

    // ================= HANDLE WASTE =================
    const WASTE_STOCK_ID = 9999; // change if needed

    if (waste > 0) {
      await insertTransaction(client, {
        stock_id: WASTE_STOCK_ID,
        transaction_type: "waste_generated",
        direction: "IN",
        quantity_in_kg: waste,
        worker_id,
        order_number,
        note,
        created_by,
      });
    }

    await client.query("COMMIT");

    res.json({
      message: "Production batch created",
      batch: batchResult.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// =====================================================
// NEW: LOG ROLLS (CORE FLOW)
// =====================================================
app.post("/production/log-rolls", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      issuance_id,
      worker_id,
      order_number,
      rolls, // [{ machine_id, quantity_kg }]
      note,
      created_by,
    } = req.body;

    if (!issuance_id || !rolls || rolls.length === 0) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    await client.query("BEGIN");

    // ================= GET ISSUANCE =================
    const issuanceRes = await client.query(
      `SELECT * FROM stock_issuances WHERE id = $1 FOR UPDATE`,
      [issuance_id]
    );

    if (issuanceRes.rows.length === 0) {
      throw new Error("Issuance not found");
    }

    const issuance = issuanceRes.rows[0];

    const remaining =
      issuance.issued_quantity_kg - issuance.consumed_quantity_kg;

    // ================= CALCULATE OUTPUT =================
    const totalOutput = rolls.reduce(
      (sum, r) => sum + Number(r.quantity_kg),
      0
    );

    if (totalOutput <= 0) {
      throw new Error("Invalid output quantity");
    }

    // ================= VALIDATE =================
    if (totalOutput > remaining) {
      throw new Error(
        `Not enough stock. Remaining: ${remaining}, Tried: ${totalOutput}`
      );
    }

    // ================= CREATE BATCH =================
    const batchRes = await client.query(
      `
      INSERT INTO production_batches
      (machine_id, issuance_id, worker_id, order_number,
       total_input_kg, total_output_kg, total_waste_kg)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
      `,
      [
        null, // not tied to one machine
        issuance_id,
        worker_id,
        order_number,
        totalOutput, // treating input = output for now (no explicit waste input)
        totalOutput,
        0, // waste computed globally later
      ]
    );

    const batchId = batchRes.rows[0].id;

    // ================= INSERT ROLLS =================
    for (const roll of rolls) {
      if (!roll.machine_id || !roll.quantity_kg) {
        throw new Error("Invalid roll data");
      }

      // 1. Insert production output
      await client.query(
        `
        INSERT INTO production_outputs
        (batch_id, stock_id, quantity_kg, machine_id)
        VALUES ($1,$2,$3,$4)
        `,
        [
          batchId,
          1, // ⚠️ replace with your finished goods stock_id
          roll.quantity_kg,
          roll.machine_id,
        ]
      );

      // 2. Insert inventory transaction
      await client.query(
        `
        INSERT INTO inventory_transactions
        (stock_id, transaction_type, direction, quantity_in_kg,
         worker_id, order_number, reference_id, note, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `,
        [
          1, // same finished goods stock_id
          "production_output",
          "IN",
          roll.quantity_kg,
          worker_id,
          order_number,
          batchId,
          note,
          created_by,
        ]
      );
    }

    // ================= UPDATE ISSUANCE =================
    await client.query(
      `
      UPDATE stock_issuances
      SET consumed_quantity_kg = consumed_quantity_kg + $1
      WHERE id = $2
      `,
      [totalOutput, issuance_id]
    );

    await client.query("COMMIT");

    res.json({
      message: "Production logged successfully",
      batch_id: batchId,
      total_output: totalOutput,
      remaining_after:
        remaining - totalOutput,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// =====================================================
// GET ALL PRODUCTION BATCHES
// =====================================================
app.get("/production/batches", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT pb.*, m.name AS machine_name
      FROM production_batches pb
      LEFT JOIN machines m ON pb.machine_id = m.id
      ORDER BY pb.created_at DESC
      `
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// MACHINE ANALYTICS
// =====================================================
app.get("/analytics/machines", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        m.id,
        m.name,
        SUM(pb.total_input_kg) AS total_input,
        SUM(pb.total_output_kg) AS total_output,
        SUM(pb.total_waste_kg) AS total_waste,
        CASE
          WHEN SUM(pb.total_input_kg) > 0
          THEN SUM(pb.total_output_kg) / SUM(pb.total_input_kg)
          ELSE 0
        END AS efficiency
      FROM machines m
      LEFT JOIN production_batches pb ON pb.machine_id = m.id
      GROUP BY m.id
      ORDER BY m.id
      `
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= MACHINE OUTPUT ANALYTICS =================
app.get("/analytics/machine-output", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        m.id,
        m.name,
        COALESCE(SUM(po.quantity_kg), 0) AS total_output
      FROM machines m
      LEFT JOIN production_outputs po
        ON po.machine_id = m.id
      GROUP BY m.id
      ORDER BY m.id
    `);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= PLANT EFFICIENCY =================
app.get("/analytics/plant-efficiency", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM plant_efficiency
    `);

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
    // hash password
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

// GET USERS (ADMIN ONLY)
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

// ================= WORKER STOCK VIEW =================
app.get("/worker/stock/:worker_id", async (req, res) => {
  const { worker_id } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
        id,
        stock_id,
        issued_quantity_kg,
        consumed_quantity_kg,
        (issued_quantity_kg - consumed_quantity_kg) AS remaining_kg
      FROM stock_issuances
      WHERE issued_to_worker_id = $1
      AND (issued_quantity_kg - consumed_quantity_kg) > 0
      `,
      [worker_id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// ORDERS
// =====================================================
app.post("/orders", async (req, res) => {
  let { order_number, client_name, status = "Active" } = req.body;

  // Normalize status: capitalize 'active' if needed, keep others lowercase
  if (status) {
    const normalized = String(status).toLowerCase();
    if (normalized === "active") {
      status = "Active";
    } else {
      status = normalized;
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO orders (order_number, client_name, status)
       VALUES ($1, $2, $3) RETURNING *`,
      [order_number, client_name, status]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/orders", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM orders`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/orders/:id", async (req, res) => {
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

app.put("/orders/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const allowedStatuses = ["Active", "completed", "cancelled"];

  // Normalize input: capitalize 'active' if needed, keep others lowercase
  let normalizedStatus = String(status).toLowerCase();
  if (normalizedStatus === "active") {
    normalizedStatus = "Active";
  }

  if (!allowedStatuses.includes(normalizedStatus)) {
    return res.status(400).json({ error: "Invalid order status" });
  }

  try {
    const result = await pool.query(
      `UPDATE orders
       SET status = $1
       WHERE id = $2
       RETURNING *`,
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

// =====================================================
// INVENTORY TRANSACTIONS (UNIFIED SYSTEM)
// =====================================================

// =====================================================
// CREATE TRANSACTION (CORE ENDPOINT)
// =====================================================
app.post("/inventory/transaction", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      stock_id,
      transaction_type,
      direction,
      quantity_in_kg,
      quantity_display,
      quantity_unit,
      worker_id,
      order_number,
      reference_id,
      note,
      created_by,
    } = req.body;

    if (!stock_id || !transaction_type || !direction || !quantity_in_kg) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    await client.query("BEGIN");

    // 🔍 Get current balance
    const currentBalance = await getStockBalance(client, stock_id);

    // ❌ Prevent negative stock
    if (direction === "OUT" && currentBalance < quantity_in_kg) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Insufficient stock",
        currentBalance,
      });
    }

    // ✅ Insert transaction
    const result = await client.query(
      `
      INSERT INTO inventory_transactions
      (stock_id, transaction_type, direction, quantity_in_kg,
       quantity_display, quantity_unit, worker_id, order_number,
       reference_id, note, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
      `,
      [
        stock_id,
        transaction_type,
        direction,
        quantity_in_kg,
        quantity_display,
        quantity_unit,
        worker_id,
        order_number,
        reference_id,
        note,
        created_by,
      ]
    );

    await client.query("COMMIT");

    res.json({
      message: "Transaction successful",
      data: result.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// =====================================================
// GET ALL TRANSACTIONS
// =====================================================
app.get("/inventory/transactions", async (req, res) => {
  try {
    const { stock_id, type, worker_id } = req.query;

    let query = `SELECT * FROM inventory_transactions WHERE 1=1`;
    let values = [];

    if (stock_id) {
      values.push(stock_id);
      query += ` AND stock_id = $${values.length}`;
    }

    if (type) {
      values.push(type);
      query += ` AND transaction_type = $${values.length}`;
    }

    if (worker_id) {
      values.push(worker_id);
      query += ` AND worker_id = $${values.length}`;
    }

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// GET ALL STOCK BALANCES
// =====================================================
app.get("/inventory/balance", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        stock_id,
        SUM(
          CASE
            WHEN direction = 'IN' THEN quantity_in_kg
            ELSE -quantity_in_kg
          END
        ) AS balance
      FROM inventory_transactions
      GROUP BY stock_id
      ORDER BY stock_id
      `
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// GET SINGLE STOCK BALANCE
// =====================================================
app.get("/inventory/balance/:stock_id", async (req, res) => {
  try {
    const { stock_id } = req.params;

    const result = await pool.query(
      `
      SELECT COALESCE(SUM(
        CASE
          WHEN direction = 'IN' THEN quantity_in_kg
          ELSE -quantity_in_kg
        END
      ), 0) AS balance
      FROM inventory_transactions
      WHERE stock_id = $1
      `,
      [stock_id]
    );

    res.json({
      stock_id,
      balance: Number(result.rows[0].balance),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// DELETE TRANSACTION
// =====================================================
app.delete("/inventory/transaction/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM inventory_transactions WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    res.json({
      message: "Transaction deleted",
      deleted: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// START SERVER
// =====================================================
app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
}); 
