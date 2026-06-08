const express = require("express");
const { ObjectId } = require("mongodb");

module.exports = (client) => {
  const router = express.Router();
  const getDb = () => client.db("molla-bricks");

  router.get("/people", async (req, res) => {
    try {
      const db = getDb();
      const { role } = req.query;
      const query = role ? { role } : {};
      const people = await db.collection("people").find(query).sort({ created_at: -1 }).toArray();

      const peopleWithBalance = await Promise.all(people.map(async (person) => {
        const nameRegex = new RegExp(`^${person.name}$`, "i");
        const invoices = await db.collection("incomes").find({ type: "invoice", customerName: nameRegex }).toArray();
        const totalBilled = invoices.reduce((sum, inv) => sum + (Number(inv.grandTotal) || 0), 0);
        const invoicePaid = invoices.reduce((sum, inv) => sum + (Number(inv.paidAmount) || 0), 0);
        
        const regularIncomes = await db.collection("incomes").find({ type: "regular", customerName: nameRegex }).toArray();
        const extraPaid = regularIncomes.reduce((sum, inc) => sum + (Number(inc.amount) || 0), 0);
        
        const cashbookPayments = await db.collection("cashbook").find({ personName: nameRegex }).toArray();
        const wePaidThem = cashbookPayments.reduce((sum, cb) => sum + (Number(cb.amount) || 0), 0);

        const totalPaidToUs = invoicePaid + extraPaid;
        const totalValueReceivedFromUs = totalBilled + wePaidThem;
        return { ...person, ledgerBalance: totalPaidToUs - totalValueReceivedFromUs };
      }));

      res.status(200).json(peopleWithBalance);
    } catch (error) { res.status(500).json({ error: "Failed to fetch data" }); }
  });

  router.post("/people", async (req, res) => {
    try {
      const db = getDb();
      const data = req.body;
      
      if (data.role === "customer") {
        if (data.phone && data.phone.trim() !== "") {
          const exists = await db.collection("people").findOne({ role: "customer", phone: data.phone });
          if (exists) return res.status(400).json({ error: "Phone number already exists!" });
        } else {
          const exists = await db.collection("people").findOne({ role: "customer", name: { $regex: new RegExp(`^${data.name}$`, "i") }, address: { $regex: new RegExp(`^${data.address || ""}$`, "i") } });
          if (exists) return res.status(400).json({ error: "Exact Name and Address already exists!" });
        }
      }
      
      const newPerson = { ...data, created_at: new Date() };

      if (newPerson.role === "staff") {
        newPerson.salaryHistory = [{
          amount: Number(newPerson.salary),
          effectiveDate: newPerson.joiningDate || new Date().toISOString().split("T")[0]
        }];
      }

      const result = await db.collection("people").insertOne(newPerson);
      res.status(200).json({ success: true, data: { ...newPerson, _id: result.insertedId } });
    } catch (error) { res.status(500).json({ error: "Failed to save data" }); }
  });

  router.put("/people/:id", async (req, res) => {
    try {
      const db = getDb();
      const { _id, created_at, salaryEffectiveDate, ...updateData } = req.body;
      const existingPerson = await db.collection("people").findOne({ _id: new ObjectId(req.params.id) });

      if (existingPerson.role === "staff" && updateData.salary && Number(updateData.salary) !== Number(existingPerson.salary)) {
        const newHistory = existingPerson.salaryHistory || [
            { amount: Number(existingPerson.salary), effectiveDate: existingPerson.joiningDate || existingPerson.created_at }
        ];
        newHistory.push({
            amount: Number(updateData.salary),
            effectiveDate: salaryEffectiveDate || new Date().toISOString().split("T")[0]
        });
        updateData.salaryHistory = newHistory;
      }

      await db.collection("people").updateOne({ _id: new ObjectId(req.params.id) }, { $set: { ...updateData, updated_at: new Date() } });
      res.status(200).json({ success: true, message: "Updated successfully" });
    } catch (error) { res.status(500).json({ error: "Failed to update data" }); }
  });

  router.delete("/people/:id", async (req, res) => {
    try {
      const db = getDb();
      await db.collection("people").deleteOne({ _id: new ObjectId(req.params.id) });
      res.status(200).json({ success: true, message: "Deleted successfully" });
    } catch (error) { res.status(500).json({ error: "Failed to delete data" }); }
  });

  return router;
};