const express = require("express");
const { ObjectId } = require("mongodb");

module.exports = (client) => {
  const router = express.Router();
  const getDb = () => client.db("molla-bricks");

  router.get("/mills", async (req, res) => {
    try {
      const db = getDb();
      const mills = await db.collection("mills").find().toArray();
      res.status(200).json(mills);
    } catch (error) { res.status(500).json({ error: "Failed to fetch mills" }); }
  });

  router.post("/mills", async (req, res) => {
    try {
      const db = getDb();
      const { id, millName, target, sardarName, ratePerThousand } = req.body;
      if (id) {
        await db.collection("mills").updateOne({ _id: new ObjectId(id) }, { $set: { millName, target: Number(target), sardarName, ratePerThousand: Number(ratePerThousand), updated_at: new Date() } });
      } else {
        const existing = await db.collection("mills").findOne({ millName: { $regex: new RegExp(`^${millName}$`, "i") } });
        if (existing) return res.status(400).json({ error: "Mill name already exists!" });
        await db.collection("mills").insertOne({ millName, target: Number(target), sardarName, ratePerThousand: Number(ratePerThousand), created_at: new Date() });
      }
      res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Failed to save mill" }); }
  });

  router.delete("/mills/:id", async (req, res) => {
    try {
      const db = getDb();
      await db.collection("mills").deleteOne({ _id: new ObjectId(req.params.id) });
      res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Failed to delete mill" }); }
  });

  router.get("/production-logs", async (req, res) => {
    try {
      const db = getDb();
      const { fy } = req.query;
      const query = fy && fy !== "N/A" ? { fiscalYear: fy } : {};
      const logs = await db.collection("productionLogs").find(query).sort({ created_at: -1 }).toArray();
      res.status(200).json(logs);
    } catch (error) { res.status(500).json({ error: "Failed to fetch logs" }); }
  });

  router.post("/production", async (req, res) => {
    try {
      const db = getDb();
      const newLog = { type: "production", ...req.body, quantity: Number(req.body.quantity), created_at: new Date() };
      const result = await db.collection("productionLogs").insertOne(newLog);
      res.status(200).json({ success: true, data: result });
    } catch (error) { res.status(500).json({ error: "Failed to save production" }); }
  });

  router.post("/kiln", async (req, res) => {
    try {
      const db = getDb();
      const lossQty = Number(req.body.sourceQty) - Number(req.body.destQty);
      const newLog = { type: "kiln_action", ...req.body, sourceQty: Number(req.body.sourceQty), destQty: Number(req.body.destQty), lossQty: Math.max(0, lossQty), created_at: new Date() };
      const result = await db.collection("productionLogs").insertOne(newLog);
      res.status(200).json({ success: true, data: result });
    } catch (error) { res.status(500).json({ error: "Failed to save kiln action" }); }
  });

  router.put("/production-logs/:id", async (req, res) => {
    try {
      const db = getDb();
      const { _id, created_at, ...updateData } = req.body;
      if (updateData.quantity) updateData.quantity = Number(updateData.quantity);
      if (updateData.sourceQty) updateData.sourceQty = Number(updateData.sourceQty);
      if (updateData.destQty) updateData.destQty = Number(updateData.destQty);
      if (updateData.sourceQty && updateData.destQty) updateData.lossQty = Math.max(0, updateData.sourceQty - updateData.destQty);

      await db.collection("productionLogs").updateOne({ _id: new ObjectId(req.params.id) }, { $set: { ...updateData, updated_at: new Date() } });
      res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Failed to update log" }); }
  });

  router.delete("/production-logs/:id", async (req, res) => {
    try {
      const db = getDb();
      await db.collection("productionLogs").deleteOne({ _id: new ObjectId(req.params.id) });
      res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Failed to delete log" }); }
  });

  router.get("/classes", async (req, res) => {
    try {
      const db = getDb();
      const classes = await db.collection("classes").find().sort({ created_at: -1 }).toArray();
      res.status(200).json(classes);
    } catch (error) { res.status(500).json({ error: "Failed to fetch classes" }); }
  });

  router.post("/classes", async (req, res) => {
    try {
      const db = getDb();
      const newClass = { name: req.body.name, rate: Number(req.body.rate), created_at: new Date() };
      const result = await db.collection("classes").insertOne(newClass);
      res.status(200).json({ success: true, data: { ...newClass, _id: result.insertedId } });
    } catch (error) { res.status(500).json({ error: "Failed to save class" }); }
  });

  router.put("/classes/:id", async (req, res) => {
    try {
      const db = getDb();
      const { _id, created_at, ...updateData } = req.body;
      updateData.rate = Number(updateData.rate);
      await db.collection("classes").updateOne({ _id: new ObjectId(req.params.id) }, { $set: { ...updateData, updated_at: new Date() } });
      res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Failed to update class" }); }
  });

  router.delete("/classes/:id", async (req, res) => {
    try {
      const db = getDb();
      await db.collection("classes").deleteOne({ _id: new ObjectId(req.params.id) });
      res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Failed to delete class" }); }
  });

  router.get("/fiscal-years", async (req, res) => {
    try {
      const db = getDb();
      const years = await db.collection("fiscalYears").find().sort({ startDate: -1 }).toArray();
      res.status(200).json(years);
    } catch (error) { res.status(500).json({ error: "Failed to fetch fiscal years" }); }
  });

  router.get("/fiscal-years/active", async (req, res) => {
    try {
      const db = getDb();
      const activeYear = await db.collection("fiscalYears").findOne({ isActive: true });
      res.status(200).json(activeYear || { name: "No Active FY" });
    } catch (error) { res.status(500).json({ error: "Failed to fetch active fiscal year" }); }
  });

  router.post("/fiscal-years", async (req, res) => {
    try {
      const db = getDb();
      const { name, startDate, endDate, isActive } = req.body;
      if (isActive) await db.collection("fiscalYears").updateMany({}, { $set: { isActive: false } });
      const newYear = { name, startDate, endDate, isActive, created_at: new Date() };
      const result = await db.collection("fiscalYears").insertOne(newYear);
      res.status(200).json({ success: true, data: { ...newYear, _id: result.insertedId } });
    } catch (error) { res.status(500).json({ error: "Failed to save fiscal year" }); }
  });

  router.put("/fiscal-years/:id", async (req, res) => {
    try {
      const db = getDb();
      const { isActive } = req.body;
      if (isActive) await db.collection("fiscalYears").updateMany({}, { $set: { isActive: false } });
      await db.collection("fiscalYears").updateOne({ _id: new ObjectId(req.params.id) }, { $set: { isActive } });
      res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Failed to update status" }); }
  });

  return router;
};