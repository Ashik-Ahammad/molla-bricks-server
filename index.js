const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion } = require("mongodb");

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI;
const port = process.env.PORT || 8008;

const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

let db; 

async function connectDB() {
  try {
    await client.connect();
    db = client.db("molla-bricks");
    console.log("✅ Molla Bricks Server Connected to MongoDB");

    // AUTO-SEED DEFAULT CATEGORIES
    const defaultCategories = ["Salary", "Sardar Payment", "Dadon (Advance)", "Maintenance", "Office Expense", "Other Expense"];
    for (const catName of defaultCategories) {
      const exists = await db.collection("categories").findOne({ name: catName, type: "category" });
      if (!exists) {
        await db.collection("categories").insertOne({ type: "category", name: catName, isDefault: true, created_at: new Date() });
      }
    }

    // AUTO-SYNC SARDARS FROM MILLS TO DIRECTORY
    const existingMills = await db.collection("mills").find().toArray();
    for (const mill of existingMills) {
      if (mill.sardarName) {
        const sardarExists = await db.collection("people").findOne({ role: "sardar", name: { $regex: new RegExp(`^${mill.sardarName.trim()}$`, "i") } });
        if (!sardarExists) {
          await db.collection("people").insertOne({
            role: "sardar", name: mill.sardarName.trim(), sardarRole: "Mill Sardar", address: "Auto-synced from Mills", phone: "", created_at: new Date()
          });
        }
      }
    }
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
  }
}

connectDB();

app.use((req, res, next) => {
  if (!db) return res.status(500).json({ error: "Database not connected yet. Please wait." });
  next();
});

// 🟢 ROUTE REGISTRATION (Fixed Base Path to exactly match frontend calls)
app.use("/api", require("./routes/people")(client));
app.use("/api", require("./routes/incomes")(client));
app.use("/api", require("./routes/cashbook")(client)); 
app.use("/api", require("./routes/production")(client)); 
app.use("/api", require("./routes/reports")(client));

app.get("/", (req, res) => res.send("Molla Bricks Server is running"));
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));