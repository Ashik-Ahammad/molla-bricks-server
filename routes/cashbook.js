const express = require("express");
const { ObjectId } = require("mongodb");

module.exports = (client) => {
  const router = express.Router();
  const getDb = () => client.db("molla-bricks");

  router.get("/cashbook/daily", async (req, res) => {
    try {
      const db = getDb();
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

  router.post("/cashbook", async (req, res) => {
    try {
      const db = getDb();
      const newEntry = { ...req.body, amount: Number(req.body.amount), created_at: new Date() };
      const result = await db.collection("cashbook").insertOne(newEntry);
      res.status(200).json({ success: true, data: result });
    } catch (error) { res.status(500).json({ error: "Failed to save entry" }); }
  });

  router.delete("/cashbook/:id", async (req, res) => {
    try {
      const db = getDb();
      await db.collection("cashbook").deleteOne({ _id: new ObjectId(req.params.id) });
      res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Failed to delete transaction" }); }
  });

  // EXPENSES
  router.get("/expenses", async (req, res) => {
    try {
      const db = getDb();
      const { fy } = req.query;
      let query = { type: "expense" };
      if (fy && fy !== "N/A") {
        query.$or = [{ fiscalYear: fy }, { fiscalYear: { $exists: false } }, { fiscalYear: null }, { fiscalYear: "" }];
      }
      const expenses = await db.collection("cashbook").find(query).sort({ date: -1, created_at: -1 }).toArray();
      res.status(200).json(expenses);
    } catch (error) { res.status(500).json({ error: "Failed to fetch expenses" }); }
  });

  router.put("/expenses/:id", async (req, res) => {
    try {
      const db = getDb();
      const { _id, created_at, ...updateData } = req.body;
      await db.collection("cashbook").updateOne({ _id: new ObjectId(req.params.id) }, { $set: { ...updateData, amount: Number(updateData.amount), updated_at: new Date() } });
      res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Failed to update expense" }); }
  });

  router.delete("/expenses/:id", async (req, res) => {
    try {
      const db = getDb();
      await db.collection("cashbook").deleteOne({ _id: new ObjectId(req.params.id) });
      res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Failed to delete expense" }); }
  });

  // CATEGORIES
  router.get("/categories", async (req, res) => {
    try {
      const db = getDb();
      const categories = await db.collection("categories").find().sort({ created_at: -1 }).toArray();
      res.status(200).json(categories);
    } catch (error) { res.status(500).json({ error: "Failed to fetch categories" }); }
  });

  router.post("/categories", async (req, res) => {
    try {
      const db = getDb();
      const newCategory = { ...req.body, created_at: new Date() };
      const result = await db.collection("categories").insertOne(newCategory);
      res.status(200).json({ success: true, data: { ...newCategory, _id: result.insertedId } });
    } catch (error) { res.status(500).json({ error: "Failed to save category" }); }
  });

  router.put("/categories/:id", async (req, res) => {
    try {
      const db = getDb();
      const { _id, created_at, ...updateData } = req.body;
      await db.collection("categories").updateOne({ _id: new ObjectId(req.params.id) }, { $set: { ...updateData, updated_at: new Date() } });
      res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Failed to update category" }); }
  });

  router.delete("/categories/:id", async (req, res) => {
    try {
      const db = getDb();
      const id = req.params.id;
      const categoryToDelete = await db.collection("categories").findOne({ _id: new ObjectId(id) });
      if (categoryToDelete && categoryToDelete.isDefault) return res.status(400).json({ error: "System Defaults cannot be deleted." });
      if (categoryToDelete && categoryToDelete.type === 'category') await db.collection("categories").deleteMany({ parentId: id });
      await db.collection("categories").deleteOne({ _id: new ObjectId(id) });
      res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Failed to delete category" }); }
  });

  return router;
};