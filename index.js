const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI;
const port = process.env.PORT || 8008;

const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("molla-bricks");

    // ==========================================
    // 🟢 0. AUTO-SEED DEFAULT CATEGORIES
    // ==========================================
    // সার্ভার স্টার্ট হলে এই ডিফল্ট ক্যাটাগরিগুলো ডাটাবেসে না থাকলে অটোমেটিক অ্যাড হয়ে যাবে।
    const defaultCategories = ["Salary", "Sardar Payment", "Dadon (Advance)", "Maintenance", "Office Expense", "Other Expense"];
    for (const catName of defaultCategories) {
      const exists = await db.collection("categories").findOne({ name: catName, type: "category" });
      if (!exists) {
        await db.collection("categories").insertOne({
          type: "category",
          name: catName,
          isDefault: true, // এটি ডিলিট করা যাবে না
          created_at: new Date()
        });
      }
    }

    // ==========================================
    // 🟢 1. INCOMES & INVOICE API
    // ==========================================
    app.post("/api/incomes", async (req, res) => {
      try {
        const data = req.body;
        const incomeType = data.type;

        let newIncome = { ...data, created_at: new Date() };
        let activityTitle = "";
        let activityAmount = 0;

        if (incomeType === "regular") {
          newIncome.amount = Number(data.amount);
          activityTitle = `Income: ${data.sourceType} from ${data.customerName}`;
          activityAmount = newIncome.amount;
        } else if (incomeType === "invoice") {
          newIncome.totalQty = Number(data.totalQty);
          newIncome.grandTotal = Number(data.grandTotal);
          newIncome.paidAmount = Number(data.paidAmount);
          newIncome.dueBalance = Number(data.dueBalance);
          activityTitle = `Invoice Sale: ${data.invoiceNo} to ${data.customerName}`;
          activityAmount = newIncome.paidAmount;
        } else {
          return res.status(400).json({ error: "Invalid type" });
        }

        const result = await db.collection("incomes").insertOne(newIncome);

        await db.collection("activities").insertOne({
          type: "income", actionType: incomeType, title: activityTitle, amount: activityAmount, created_at: new Date(),
        });

        res.status(200).json({ success: true, message: "Income saved!", data: result });
      } catch (error) { res.status(500).json({ error: "Internal Server Error." }); }
    });

    app.get("/api/incomes/next-invoice", async (req, res) => {
      try {
        const lastInvoice = await db.collection("incomes").find({ type: "invoice", invoiceNo: { $regex: /^INV-MB-/ } }).sort({ created_at: -1 }).limit(1).toArray();
        let nextNumber = 1;
        if (lastInvoice.length > 0 && lastInvoice[0].invoiceNo) {
          const match = lastInvoice[0].invoiceNo.match(/\d+$/);
          if (match) nextNumber = parseInt(match[0]) + 1;
        }
        res.status(200).json({ invoiceNo: `INV-MB-${nextNumber.toString().padStart(2, '0')}` });
      } catch (error) { res.status(500).json({ error: "Failed to generate invoice number" }); }
    });

    // ==========================================
    // 🟢 2. DIRECTORY (PEOPLE) API ROUTES
    // ==========================================
    app.get("/api/people", async (req, res) => {
      try {
        const { role } = req.query;
        const query = role ? { role } : {};
        const people = await db.collection("people").find(query).sort({ created_at: -1 }).toArray();
        res.status(200).json(people);
      } catch (error) { res.status(500).json({ error: "Failed to fetch data" }); }
    });

    app.post("/api/people", async (req, res) => {
      try {
        const data = req.body;
        if (data.role === "customer") {
          if (data.phone && data.phone.trim() !== "") {
            const existsByPhone = await db.collection("people").findOne({ role: "customer", phone: data.phone });
            if (existsByPhone) return res.status(400).json({ error: "Phone number already exists!" });
          } else {
            const addressPattern = data.address ? data.address : "";
            const existsByNameAndAddress = await db.collection("people").findOne({ role: "customer", name: { $regex: new RegExp(`^${data.name}$`, "i") }, address: { $regex: new RegExp(`^${addressPattern}$`, "i") } });
            if (existsByNameAndAddress) return res.status(400).json({ error: "Exact Name and Address already exists!" });
          }
        }
        const newPerson = { ...data, created_at: new Date() };
        const result = await db.collection("people").insertOne(newPerson);
        res.status(200).json({ success: true, data: { ...newPerson, _id: result.insertedId } });
      } catch (error) { res.status(500).json({ error: "Failed to save data" }); }
    });

    app.put("/api/people/:id", async (req, res) => {
      try {
        const { _id, created_at, ...updateData } = req.body;
        await db.collection("people").updateOne({ _id: new ObjectId(req.params.id) }, { $set: { ...updateData, updated_at: new Date() } });
        res.status(200).json({ success: true, message: "Updated successfully" });
      } catch (error) { res.status(500).json({ error: "Failed to update data" }); }
    });

    app.delete("/api/people/:id", async (req, res) => {
      try {
        await db.collection("people").deleteOne({ _id: new ObjectId(req.params.id) });
        res.status(200).json({ success: true, message: "Deleted successfully" });
      } catch (error) { res.status(500).json({ error: "Failed to delete data" }); }
    });

    // ==========================================
    // 🟢 3. BRICK CLASSES API ROUTES
    // ==========================================
    app.get("/api/classes", async (req, res) => {
      try {
        const classes = await db.collection("classes").find().sort({ created_at: -1 }).toArray();
        res.status(200).json(classes);
      } catch (error) { res.status(500).json({ error: "Failed to fetch classes" }); }
    });

    app.post("/api/classes", async (req, res) => {
      try {
        const existing = await db.collection("classes").findOne({ name: { $regex: new RegExp(`^${req.body.name}$`, "i") } });
        if (existing) return res.status(400).json({ error: "Brick class already exists!" });
        const newClass = { name: req.body.name, rate: Number(req.body.rate), created_at: new Date() };
        const result = await db.collection("classes").insertOne(newClass);
        res.status(200).json({ success: true, data: { ...newClass, _id: result.insertedId } });
      } catch (error) { res.status(500).json({ error: "Failed to save class" }); }
    });

    app.put("/api/classes/:id", async (req, res) => {
      try {
        const { _id, created_at, ...updateData } = req.body;
        updateData.rate = Number(updateData.rate);
        await db.collection("classes").updateOne({ _id: new ObjectId(req.params.id) }, { $set: { ...updateData, updated_at: new Date() } });
        res.status(200).json({ success: true });
      } catch (error) { res.status(500).json({ error: "Failed to update class" }); }
    });

    app.delete("/api/classes/:id", async (req, res) => {
      try {
        await db.collection("classes").deleteOne({ _id: new ObjectId(req.params.id) });
        res.status(200).json({ success: true });
      } catch (error) { res.status(500).json({ error: "Failed to delete class" }); }
    });

    // ==========================================
    // 🟢 4. FISCAL YEAR API ROUTES
    // ==========================================
    app.get("/api/fiscal-years", async (req, res) => {
      try {
        const years = await db.collection("fiscalYears").find().sort({ startDate: -1 }).toArray();
        res.status(200).json(years);
      } catch (error) { res.status(500).json({ error: "Failed to fetch fiscal years" }); }
    });

    app.get("/api/fiscal-years/active", async (req, res) => {
      try {
        const activeYear = await db.collection("fiscalYears").findOne({ isActive: true });
        res.status(200).json(activeYear || { name: "No Active FY" });
      } catch (error) { res.status(500).json({ error: "Failed to fetch active fiscal year" }); }
    });

    app.post("/api/fiscal-years", async (req, res) => {
      try {
        const { name, startDate, endDate, isActive } = req.body;
        if (isActive) await db.collection("fiscalYears").updateMany({}, { $set: { isActive: false } });
        const newYear = { name, startDate, endDate, isActive, created_at: new Date() };
        const result = await db.collection("fiscalYears").insertOne(newYear);
        res.status(200).json({ success: true, data: { ...newYear, _id: result.insertedId } });
      } catch (error) { res.status(500).json({ error: "Failed to save fiscal year" }); }
    });

    app.put("/api/fiscal-years/:id", async (req, res) => {
      try {
        const { isActive } = req.body;
        if (isActive) await db.collection("fiscalYears").updateMany({}, { $set: { isActive: false } });
        await db.collection("fiscalYears").updateOne({ _id: new ObjectId(req.params.id) }, { $set: { isActive } });
        res.status(200).json({ success: true });
      } catch (error) { res.status(500).json({ error: "Failed to update status" }); }
    });

    // ==========================================
    // 🟢 5. ULTIMATE CASHBOOK API ROUTES
    // ==========================================
    app.get("/api/cashbook/daily", async (req, res) => {
      try {
        const { date } = req.query;
        if (!date) return res.status(400).json({ error: "Date is required" });

        const allIncomes = await db.collection("incomes").find().toArray();
        const allCashbook = await db.collection("cashbook").find().toArray();

        let totalIncome = 0, totalDeposit = 0, totalWithdrawal = 0, totalExpense = 0;
        let prevIncome = 0, prevDeposit = 0, prevWithdrawal = 0, prevExpense = 0;
        let todayIncome = 0, todayDeposit = 0, todayWithdrawal = 0, todayExpense = 0;
        const todayTransactions = [];

        allIncomes.forEach(inc => {
          const amt = inc.type === 'regular' ? Number(inc.amount) : Number(inc.paidAmount || 0);
          totalIncome += amt;
          if (inc.date < date) prevIncome += amt;
          else if (inc.date === date) {
            todayIncome += amt;
            todayTransactions.push({ _id: inc._id, date: inc.date, type: 'income', category: inc.type === 'regular' ? inc.sourceType : 'Invoice Sale', amount: amt, description: inc.customerName ? `From: ${inc.customerName}` : 'Cash Sale', created_at: inc.created_at });
          }
        });

        allCashbook.forEach(tx => {
          const amt = Number(tx.amount);
          if (tx.type === 'deposit') totalDeposit += amt;
          if (tx.type === 'withdraw') totalWithdrawal += amt;
          if (tx.type === 'expense') totalExpense += amt;

          if (tx.date < date) {
            if (tx.type === 'deposit') prevDeposit += amt;
            if (tx.type === 'withdraw') prevWithdrawal += amt;
            if (tx.type === 'expense') prevExpense += amt;
          } else if (tx.date === date) {
            if (tx.type === 'deposit') todayDeposit += amt;
            if (tx.type === 'withdraw') todayWithdrawal += amt;
            if (tx.type === 'expense') todayExpense += amt;
            todayTransactions.push({ _id: tx._id, date: tx.date, type: tx.type, category: tx.category, amount: amt, description: (tx.personName ? `${tx.personName} - ` : '') + (tx.description || ''), created_at: tx.created_at });
          }
        });

        const safeBoxBalance = (totalIncome + totalDeposit) - (totalExpense + totalWithdrawal);
        const ownerEquity = totalDeposit - totalWithdrawal;
        const openingBalance = (prevIncome + prevDeposit) - (prevExpense + prevWithdrawal);
        const totalIn = todayIncome + todayDeposit;
        const totalOut = todayExpense + todayWithdrawal;
        const closingBalance = openingBalance + totalIn - totalOut;

        todayTransactions.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        res.status(200).json({ global: { safeBoxBalance, ownerEquity }, daily: { openingBalance, totalIn, totalOut, closingBalance }, transactions: todayTransactions });
      } catch (error) { res.status(500).json({ error: "Failed to fetch cashbook data" }); }
    });

    app.post("/api/cashbook", async (req, res) => {
      try {
        const data = req.body;
        const newEntry = { ...data, amount: Number(data.amount), created_at: new Date() };
        const result = await db.collection("cashbook").insertOne(newEntry);
        res.status(200).json({ success: true, data: result });
      } catch (error) { res.status(500).json({ error: "Failed to save cashbook entry" }); }
    });

    app.delete("/api/cashbook/:id", async (req, res) => {
      try {
        await db.collection("cashbook").deleteOne({ _id: new ObjectId(req.params.id) });
        res.status(200).json({ success: true, message: "Transaction deleted" });
      } catch (error) { res.status(500).json({ error: "Failed to delete transaction" }); }
    });

    // ==========================================
    // 🟢 6. CATEGORY MANAGEMENT API ROUTES
    // ==========================================
    app.get("/api/categories", async (req, res) => {
      try {
        const categories = await db.collection("categories").find().sort({ created_at: -1 }).toArray();
        res.status(200).json(categories);
      } catch (error) { res.status(500).json({ error: "Failed to fetch categories" }); }
    });

    app.post("/api/categories", async (req, res) => {
      try {
        const data = req.body;
        const newCategory = { ...data, created_at: new Date() };
        const result = await db.collection("categories").insertOne(newCategory);
        res.status(200).json({ success: true, data: { ...newCategory, _id: result.insertedId } });
      } catch (error) { res.status(500).json({ error: "Failed to save category" }); }
    });

    app.put("/api/categories/:id", async (req, res) => {
      try {
        const { _id, created_at, ...updateData } = req.body;
        await db.collection("categories").updateOne({ _id: new ObjectId(req.params.id) }, { $set: { ...updateData, updated_at: new Date() } });
        res.status(200).json({ success: true });
      } catch (error) { res.status(500).json({ error: "Failed to update category" }); }
    });

    app.delete("/api/categories/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const categoryToDelete = await db.collection("categories").findOne({ _id: new ObjectId(id) });

        // Protect System Defaults from being deleted
        if (categoryToDelete && categoryToDelete.isDefault) {
          return res.status(400).json({ error: "System Default Categories cannot be deleted." });
        }

        if (categoryToDelete && categoryToDelete.type === 'category') {
            await db.collection("categories").deleteMany({ parentId: id }); // Delete subcategories
        }
        await db.collection("categories").deleteOne({ _id: new ObjectId(id) });
        res.status(200).json({ success: true, message: "Deleted successfully" });
      } catch (error) { res.status(500).json({ error: "Failed to delete category" }); }
    });

    // ==========================================
    // 🟢 PRODUCTION, KILN & MILLS API ROUTES
    // ==========================================

    // Get Mills Configuration
    app.get("/api/mills", async (req, res) => {
      try {
        const mills = await db.collection("mills").find().toArray();
        res.status(200).json(mills);
      } catch (error) { res.status(500).json({ error: "Failed to fetch mills" }); }
    });

    // Add or Update Mill Target & Sardar
    app.post("/api/mills", async (req, res) => {
      try {
        const { id, millName, target, sardarName, ratePerThousand } = req.body;

        if (id) {
          // Update existing mill
          await db.collection("mills").updateOne(
            { _id: new ObjectId(id) },
            { $set: { millName, target: Number(target), sardarName, ratePerThousand: Number(ratePerThousand), updated_at: new Date() } }
          );
        } else {
          // Add new mill
          const existing = await db.collection("mills").findOne({ millName: { $regex: new RegExp(`^${millName}$`, "i") } });
          if (existing) return res.status(400).json({ error: "Mill name already exists!" });

          await db.collection("mills").insertOne({
            millName, target: Number(target), sardarName, ratePerThousand: Number(ratePerThousand), created_at: new Date()
          });
        }
        res.status(200).json({ success: true });
      } catch (error) { res.status(500).json({ error: "Failed to save mill" }); }
    });

    // Delete Mill
    app.delete("/api/mills/:id", async (req, res) => {
      try {
        await db.collection("mills").deleteOne({ _id: new ObjectId(req.params.id) });
        res.status(200).json({ success: true });
      } catch (error) { res.status(500).json({ error: "Failed to delete mill" }); }
    });

    // Get Production & Kiln Logs (Filtered by Fiscal Year)
    app.get("/api/production-logs", async (req, res) => {
      try {
        const { fy } = req.query;
        const query = fy && fy !== "N/A" ? { fiscalYear: fy } : {}; // 🟢 FY Filter
        const logs = await db.collection("productionLogs").find(query).sort({ created_at: -1 }).toArray();
        res.status(200).json(logs);
      } catch (error) { res.status(500).json({ error: "Failed to fetch logs" }); }
    });

    // Add Production (Raw Bricks)
    app.post("/api/production", async (req, res) => {
      try {
        const data = req.body;
        const newLog = {
          type: "production",
          date: data.date,
          millName: data.millName,
          quantity: Number(data.quantity),
          fiscalYear: data.fiscalYear, // 🟢 Attached FY
          created_at: new Date()
        };
        const result = await db.collection("productionLogs").insertOne(newLog);
        res.status(200).json({ success: true, data: result });
      } catch (error) { res.status(500).json({ error: "Failed to save production" }); }
    });

    // Add Kiln Action (Load/Unload with Loss Calculation)
    app.post("/api/kiln", async (req, res) => {
      try {
        const data = req.body;
        const lossQty = Number(data.sourceQty) - Number(data.destQty);

        const newLog = {
          type: "kiln_action",
          actionType: data.actionType,
          date: data.date,
          sourceQty: Number(data.sourceQty),
          destQty: Number(data.destQty),
          lossQty: Math.max(0, lossQty),
          fiscalYear: data.fiscalYear, // 🟢 Attached FY
          created_at: new Date()
        };
        const result = await db.collection("productionLogs").insertOne(newLog);
        res.status(200).json({ success: true, data: result });
      } catch (error) { res.status(500).json({ error: "Failed to save kiln action" }); }
    });

    app.delete("/api/production-logs/:id", async (req, res) => {
      try {
        await db.collection("productionLogs").deleteOne({ _id: new ObjectId(req.params.id) });
        res.status(200).json({ success: true });
      } catch (error) { res.status(500).json({ error: "Failed to delete log" }); }
    });

    // ==========================================
    // 🟢 MANAGE COST / EXPENSES API ROUTES
    // ==========================================

    // 1. Get All Expenses (Smart Filter for Fiscal Year)
    app.get("/api/expenses", async (req, res) => {
      try {
        const { fy } = req.query;
        let query = { type: "expense" }; // শুধুমাত্র Record Expense এর ডাটাগুলো

        // 🟢 Smart FY Filter: যেসব পুরনো ডাটায় FY নেই, সেগুলোও দেখাবে
        if (fy && fy !== "N/A") {
          query.$or = [
            { fiscalYear: fy },
            { fiscalYear: { $exists: false } },
            { fiscalYear: null },
            { fiscalYear: "" }
          ];
        }

        const expenses = await db.collection("cashbook")
          .find(query)
          .sort({ date: -1, created_at: -1 })
          .toArray();

        res.status(200).json(expenses);
      } catch (error) {
        console.error("Fetch Expenses Error:", error);
        res.status(500).json({ error: "Failed to fetch expenses" });
      }
    });

    // 2. Update Expense
    app.put("/api/expenses/:id", async (req, res) => {
      try {
        const { _id, created_at, ...updateData } = req.body;
        await db.collection("cashbook").updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: {
              ...updateData,
              amount: Number(updateData.amount),
              updated_at: new Date()
            }
          }
        );
        res.status(200).json({ success: true, message: "Expense updated" });
      } catch (error) {
        res.status(500).json({ error: "Failed to update expense" });
      }
    });

    // 3. Delete Expense
    app.delete("/api/expenses/:id", async (req, res) => {
      try {
        await db.collection("cashbook").deleteOne({ _id: new ObjectId(req.params.id) });
        res.status(200).json({ success: true, message: "Expense deleted" });
      } catch (error) {
        res.status(500).json({ error: "Failed to delete expense" });
      }
    });

    // ==========================================
    // 🟢 MANAGE INCOMES API ROUTES
    // ==========================================

    // 1. Get All Incomes (Smart Filter for Fiscal Year)
    app.get("/api/incomes", async (req, res) => {
      try {
        const { fy } = req.query;
        let query = {};

        // 🟢 Smart FY Filter: পুরনো ডাটাগুলোতে FY না থাকলেও দেখাবে
        if (fy && fy !== "N/A") {
          query.$or = [
            { fiscalYear: fy },
            { fiscalYear: { $exists: false } },
            { fiscalYear: null },
            { fiscalYear: "" }
          ];
        }

        const incomes = await db.collection("incomes")
          .find(query)
          .sort({ date: -1, created_at: -1 })
          .toArray();

        res.status(200).json(incomes);
      } catch (error) {
        console.error("Fetch Incomes Error:", error);
        res.status(500).json({ error: "Failed to fetch incomes" });
      }
    });

    // 2. Update Income
    app.put("/api/incomes/:id", async (req, res) => {
      try {
        const { _id, created_at, ...updateData } = req.body;

        // Ensure numbers remain numbers
        if (updateData.type === 'regular') updateData.amount = Number(updateData.amount);
        if (updateData.type === 'invoice') updateData.paidAmount = Number(updateData.paidAmount);

        await db.collection("incomes").updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { ...updateData, updated_at: new Date() } }
        );
        res.status(200).json({ success: true, message: "Income updated" });
      } catch (error) {
        res.status(500).json({ error: "Failed to update income" });
      }
    });

    // 3. Delete Income
    app.delete("/api/incomes/:id", async (req, res) => {
      try {
        await db.collection("incomes").deleteOne({ _id: new ObjectId(req.params.id) });
        res.status(200).json({ success: true, message: "Income deleted" });
      } catch (error) {
        res.status(500).json({ error: "Failed to delete income" });
      }
    });

    // ==========================================
    // 🟢 INVENTORY & PROFIT ANALYSIS API
    // ==========================================
    app.get("/api/inventory-analysis", async (req, res) => {
      try {
        const { fy } = req.query;

        // 1. Build FY Queries (Supporting old data without FY)
        let fyQuery = {};
        if (fy && fy !== "N/A") {
          fyQuery.$or = [
            { fiscalYear: fy },
            { fiscalYear: { $exists: false } },
            { fiscalYear: null },
            { fiscalYear: "" }
          ];
        }

        // 2. Fetch Data from 3 different collections
        const productionLogs = await db.collection("productionLogs").find(fyQuery).toArray();
        const expenses = await db.collection("cashbook").find({ ...fyQuery, type: "expense" }).toArray();
        const invoices = await db.collection("incomes").find({ ...fyQuery, type: "invoice" }).toArray();

        // 3. Process Production & Kiln Logs
        let totalProduced = 0;
        const kilnLogs = [];

        productionLogs.forEach(log => {
          if (log.type === "kiln_action") {
            kilnLogs.push({
              _id: log._id,
              date: log.date,
              action: log.actionType === 'load' ? 'LOAD IN' : 'UNLOAD OUT',
              detail: log.actionType === 'load' ? 'Raw Bricks' : 'Finished Goods',
              quantity: log.actionType === 'load' ? log.sourceQty : log.destQty,
              created_at: log.created_at
            });
            if (log.actionType === 'unload') {
              totalProduced += Number(log.destQty || 0); // Good finished bricks
            }
          }
        });

        // Sort Kiln Logs newest first
        kilnLogs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        // 4. Calculate Average Cost Per Brick
        let totalExpenses = 0;
        expenses.forEach(exp => totalExpenses += Number(exp.amount || 0));
        const avgCostPerBrick = totalProduced > 0 ? (totalExpenses / totalProduced) : 0;

        // 5. Process Sales & Profitability by Class
        let totalSold = 0;
        const classStats = {};

        invoices.forEach(inv => {
          if (inv.items && Array.isArray(inv.items)) {
            inv.items.forEach(item => {
              const qty = Number(item.qty || 0);
              const rate = Number(item.rate || 0);
              const revenue = qty * rate;
              const product = item.product || "Unknown Class";

              if (!classStats[product]) classStats[product] = { qty: 0, revenue: 0 };
              classStats[product].qty += qty;
              classStats[product].revenue += revenue;
              totalSold += qty;
            });
          }
        });

        const salesByClass = Object.keys(classStats).map(className => {
          const qty = classStats[className].qty;
          const revenue = classStats[className].revenue;
          const costOfGoodsSold = qty * avgCostPerBrick;
          const estProfit = revenue - costOfGoodsSold;
          return { className, quantitySold: qty, totalRevenue: revenue, estProfit };
        }).sort((a, b) => b.quantitySold - a.quantitySold); // Sort by highest sales

        // 6. Final Overview Stats
        const currentStock = totalProduced - totalSold;

        res.status(200).json({
          overview: {
            totalProduced,
            totalSold,
            currentStock,
            avgCostPerBrick,
            totalExpenses // Sending total expenses for reference
          },
          salesByClass,
          kilnLogs
        });

      } catch (error) {
        console.error("Inventory Analysis Error:", error);
        res.status(500).json({ error: "Failed to generate inventory analysis" });
      }
    });

    // ==========================================
    // 🟢 REPORTS API ROUTES
    // ==========================================

    // 1. Profit & Loss Statement
    app.get("/api/reports/profit-loss", async (req, res) => {
      try {
        const { startDate, endDate } = req.query;
        let incQuery = { type: { $in: ["regular", "invoice"] } };
        let expQuery = { type: "expense" };

        if (startDate && endDate) {
          incQuery.date = { $gte: startDate, $lte: endDate };
          expQuery.date = { $gte: startDate, $lte: endDate };
        }

        const incomes = await db.collection("incomes").find(incQuery).toArray();
        const expenses = await db.collection("cashbook").find(expQuery).toArray();

        const totalRevenue = incomes.reduce((sum, item) => sum + (item.type === 'regular' ? Number(item.amount) : Number(item.paidAmount || 0)), 0);

        // 🟢 Split expenses into COGS (Direct) and OPEX (Indirect)
        let cogs = 0;
        let operatingExpenses = 0;

        expenses.forEach(item => {
          const amt = Number(item.amount) || 0;
          const cat = item.category ? item.category.toLowerCase() : "";

          // Basic Direct Cost check (Coal, Sardar, Dadon, Mill, Fuel, Raw Materials)
          if (cat.includes("mill") || cat.includes("sardar") || cat.includes("dadon") || cat.includes("coal") || cat.includes("fuel") || cat.includes("load")) {
            cogs += amt;
          } else {
            operatingExpenses += amt; // Salary, Office, Maintenance etc.
          }
        });

        const grossProfit = totalRevenue - cogs;
        const totalExpenses = cogs + operatingExpenses;
        const netProfit = grossProfit - operatingExpenses;

        res.status(200).json({
          totalRevenue,
          cogs,
          grossProfit,
          operatingExpenses,
          totalExpenses,
          netProfit
        });
      } catch (error) { res.status(500).json({ error: "Failed to fetch P&L" }); }
    });

    // 2. Balance Sheet
    app.get("/api/reports/balance-sheet", async (req, res) => {
      try {
        const { date } = req.query;
        let queryDate = date ? { $lte: date } : {};

        const incomes = await db.collection("incomes").find(date ? { date: queryDate } : {}).toArray();
        const cashbook = await db.collection("cashbook").find(date ? { date: queryDate } : {}).toArray();

        let totalIncome = 0;
        incomes.forEach(i => totalIncome += (i.type === 'regular' ? Number(i.amount) : Number(i.paidAmount || 0)));

        let totalDeposit = 0, totalWithdrawal = 0, totalExpense = 0;
        cashbook.forEach(tx => {
          if (tx.type === 'deposit') totalDeposit += Number(tx.amount);
          if (tx.type === 'withdraw') totalWithdrawal += Number(tx.amount);
          if (tx.type === 'expense') totalExpense += Number(tx.amount);
        });

        const cashInHand = (totalIncome + totalDeposit) - (totalExpense + totalWithdrawal);
        const ownersCapital = totalDeposit - totalWithdrawal;
        const retainedEarnings = totalIncome - totalExpense;

        res.status(200).json({
          assets: { cashInHand, bankAccounts: 0, accountsReceivable: 0, totalAssets: cashInHand },
          liabilities: { accountsPayable: 0, shortTermLoans: 0, totalLiabilities: 0 },
          equity: { ownersCapital, retainedEarnings, totalEquity: ownersCapital + retainedEarnings },
          isBalanced: cashInHand === (ownersCapital + retainedEarnings) // Assets = Liabilities + Equity
        });
      } catch (error) { res.status(500).json({ error: "Failed to fetch Balance Sheet" }); }
    });

    // 3. General Ledger (Advanced with filtering)
    app.get("/api/reports/general-ledger", async (req, res) => {
      try {
        const { startDate, endDate, accountType, partyName } = req.query;

        // Fetch all transactions initially to calculate accurate Opening Balance
        const incomes = await db.collection("incomes").find().toArray();
        const cashbook = await db.collection("cashbook").find().toArray();

        let openingBalance = 0;
        let allTransactions = [];

        // 1. Process Incomes
        incomes.forEach(i => {
          const amt = i.type === 'regular' ? Number(i.amount) : Number(i.paidAmount || 0);
          const party = i.customerName || "Walk-in Customer";
          const type = "Income";
          const category = i.type === 'regular' ? i.sourceType : 'Invoice Sale';

          if (i.date < startDate) {
            // Calculate opening balance based on filters
            if ((!accountType || accountType === "All Accounts" || accountType === type) &&
                (!partyName || party.toLowerCase().includes(partyName.toLowerCase()))) {
              openingBalance += amt;
            }
          } else if (i.date >= startDate && i.date <= endDate) {
            allTransactions.push({
              date: i.date,
              type: type,
              category: category,
              party: party,
              description: i.description || i.notes || `Receipt: ${i.invoiceNo || 'Regular'}`,
              debit: amt, // Money coming IN
              credit: 0,
              created_at: i.created_at
            });
          }
        });

        // 2. Process Cashbook (Expenses, Deposits, Withdrawals)
        cashbook.forEach(tx => {
          const amt = Number(tx.amount);
          const party = tx.personName || "Owner / N/A";
          let type = "";
          let isDebit = false; // Debit = IN (+), Credit = OUT (-)

          if (tx.type === 'deposit') { type = "Owner Equity"; isDebit = true; }
          else if (tx.type === 'withdraw') { type = "Owner Draw"; isDebit = false; }
          else { type = "Expense"; isDebit = false; }

          if (tx.date < startDate) {
             if ((!accountType || accountType === "All Accounts" || accountType === type) &&
                 (!partyName || party.toLowerCase().includes(partyName.toLowerCase()))) {
               openingBalance += (isDebit ? amt : -amt);
             }
          } else if (tx.date >= startDate && tx.date <= endDate) {
            allTransactions.push({
              date: tx.date,
              type: type,
              category: tx.category,
              party: party,
              description: tx.description || "N/A",
              debit: isDebit ? amt : 0,
              credit: !isDebit ? amt : 0,
              created_at: tx.created_at
            });
          }
        });

        // 3. Filter the transactions array
        let filteredTransactions = allTransactions.filter(tx => {
          const matchAccount = (!accountType || accountType === "All Accounts" || tx.type === accountType);
          const matchParty = (!partyName || tx.party.toLowerCase().includes(partyName.toLowerCase()));
          return matchAccount && matchParty;
        });

        // 4. Sort chronologically
        filteredTransactions.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        // 5. Calculate Running Balance
        let currentBal = openingBalance;
        filteredTransactions = filteredTransactions.map(t => {
          currentBal += (t.debit - t.credit);
          return { ...t, balance: currentBal };
        });

        res.status(200).json({
          openingBalance,
          closingBalance: currentBal,
          transactions: filteredTransactions
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch GL" });
      }
    });

    // 4. Party Ledger
    app.get("/api/reports/party-ledger", async (req, res) => {
      try {
        const { partyName, startDate, endDate } = req.query;
        if (!partyName) return res.status(200).json({ transactions: [] });

        const incomes = await db.collection("incomes").find({
          customerName: { $regex: new RegExp(`^${partyName}$`, "i") },
          date: { $gte: startDate, $lte: endDate }
        }).toArray();

        const cashbook = await db.collection("cashbook").find({
          personName: { $regex: new RegExp(`^${partyName}$`, "i") },
          date: { $gte: startDate, $lte: endDate }
        }).toArray();

        let transactions = [];
        incomes.forEach(i => transactions.push({ date: i.date, type: "Income/Payment", description: i.notes || "Received", in: (i.type === 'regular' ? Number(i.amount) : Number(i.paidAmount || 0)), out: 0, created_at: i.created_at }));
        cashbook.forEach(tx => transactions.push({ date: tx.date, type: tx.category, description: tx.description || "Paid", in: 0, out: Number(tx.amount), created_at: tx.created_at }));

        transactions.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        res.status(200).json({ transactions });
      } catch (error) { res.status(500).json({ error: "Failed to fetch Party Ledger" }); }
    });

    console.log("Molla Bricks Server Connected to MongoDB");
  } finally {}
}

run().catch(console.dir);

app.get("/", (req, res) => res.send("Molla Bricks Server is running"));
app.listen(port, () => console.log(`Molla Bricks Server running on port ${port}`));