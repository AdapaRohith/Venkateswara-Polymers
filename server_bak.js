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
