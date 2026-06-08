const express = require("express");
const { ObjectId } = require("mongodb");

module.exports = (client) => {
  const router = express.Router();
  const getDb = () => client.db("molla-bricks");

  router.get("/incomes", async (req, res) => {
    try {
      const db = getDb();
      const { fy } = req.query;
      let query = {};
      if (fy && fy !== "N/A") {
        query.$or = [{ fiscalYear: fy }, { fiscalYear: { $exists: false } }, { fiscalYear: null }, { fiscalYear: "" }];
      }
      const incomes = await db.collection("incomes").find(query).sort({ date: -1, created_at: -1 }).toArray();
      res.status(200).json(incomes);
    } catch (error) { res.status(500).json({ error: "Failed to fetch incomes" }); }
  });

  router.post("/incomes", async (req, res) => {
    try {
      const db = getDb();
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
      }

      const result = await db.collection("incomes").insertOne(newIncome);
      await db.collection("activities").insertOne({ type: "income", actionType: incomeType, title: activityTitle, amount: activityAmount, created_at: new Date() });
      res.status(200).json({ success: true, data: result });
    } catch (error) { res.status(500).json({ error: "Failed to save income" }); }
  });

  router.put("/incomes/:id", async (req, res) => {
    try {
      const db = getDb();
      const { _id, created_at, ...updateData } = req.body;
      if (updateData.type === 'regular') updateData.amount = Number(updateData.amount);
      if (updateData.type === 'invoice') updateData.paidAmount = Number(updateData.paidAmount);
      await db.collection("incomes").updateOne({ _id: new ObjectId(req.params.id) }, { $set: { ...updateData, updated_at: new Date() } });
      res.status(200).json({ success: true, message: "Income updated" });
    } catch (error) { res.status(500).json({ error: "Failed to update income" }); }
  });

  router.delete("/incomes/:id", async (req, res) => {
    try {
      const db = getDb();
      await db.collection("incomes").deleteOne({ _id: new ObjectId(req.params.id) });
      res.status(200).json({ success: true, message: "Income deleted" });
    } catch (error) { res.status(500).json({ error: "Failed to delete income" }); }
  });

  router.get("/incomes/next-invoice", async (req, res) => {
    try {
      const db = getDb();
      const lastInvoice = await db.collection("incomes").find({ type: "invoice", invoiceNo: { $regex: /^INV-MB-/ } }).sort({ created_at: -1 }).limit(1).toArray();
      let nextNumber = 1;
      if (lastInvoice.length > 0 && lastInvoice[0].invoiceNo) {
        const match = lastInvoice[0].invoiceNo.match(/\d+$/);
        if (match) nextNumber = parseInt(match[0]) + 1;
      }
      res.status(200).json({ invoiceNo: `INV-MB-${nextNumber.toString().padStart(2, '0')}` });
    } catch (error) { res.status(500).json({ error: "Failed to generate invoice number" }); }
  });

  return router;
};