const express = require("express");

module.exports = (client) => {
  const router = express.Router();
  const getDb = () => client.db("molla-bricks");

  // 🟢 Helper Function to prevent RegEx crashes from special characters like "(Mati)"
  const escapeRegex = (string) => string.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

  router.get("/inventory-analysis", async (req, res) => {
    try {
      const db = getDb();
      const { fy } = req.query;
      let fyQuery = {};
      if (fy && fy !== "N/A") {
        fyQuery.$or = [{ fiscalYear: fy }, { fiscalYear: { $exists: false } }, { fiscalYear: null }, { fiscalYear: "" }];
      }

      const productionLogs = await db.collection("productionLogs").find(fyQuery).toArray();
      const expenses = await db.collection("cashbook").find({ ...fyQuery, type: "expense" }).toArray();
      const invoices = await db.collection("incomes").find({ ...fyQuery, type: "invoice" }).toArray();

      let totalProduced = 0;
      const kilnLogs = [];

      productionLogs.forEach(log => {
        if (log.type === "kiln_action") {
          kilnLogs.push({ _id: log._id, date: log.date, action: log.actionType === 'load' ? 'LOAD IN' : 'UNLOAD OUT', detail: log.actionType === 'load' ? 'Raw Bricks' : 'Finished Goods', quantity: log.actionType === 'load' ? log.sourceQty : log.destQty, created_at: log.created_at });
          if (log.actionType === 'unload') totalProduced += Number(log.destQty || 0);
        }
      });
      kilnLogs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      let totalExpenses = 0;
      expenses.forEach(exp => totalExpenses += Number(exp.amount || 0));
      const avgCostPerBrick = totalProduced > 0 ? (totalExpenses / totalProduced) : 0;

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
      }).sort((a, b) => b.quantitySold - a.quantitySold);

      const currentStock = totalProduced - totalSold;

      res.status(200).json({ overview: { totalProduced, totalSold, currentStock, avgCostPerBrick, totalExpenses }, salesByClass, kilnLogs });
    } catch (error) { res.status(500).json({ error: "Failed to generate inventory analysis" }); }
  });

  router.get("/reports/profit-loss", async (req, res) => {
    try {
      const db = getDb();
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

      let cogs = 0, operatingExpenses = 0;
      expenses.forEach(item => {
        const amt = Number(item.amount) || 0;
        const cat = item.category ? item.category.toLowerCase() : "";
        if (cat.includes("mill") || cat.includes("sardar") || cat.includes("dadon") || cat.includes("coal") || cat.includes("fuel") || cat.includes("load")) cogs += amt;
        else operatingExpenses += amt;
      });

      const grossProfit = totalRevenue - cogs;
      const totalExpenses = cogs + operatingExpenses;
      const netProfit = grossProfit - operatingExpenses;

      res.status(200).json({ totalRevenue, cogs, grossProfit, operatingExpenses, totalExpenses, netProfit });
    } catch (error) { res.status(500).json({ error: "Failed to fetch P&L" }); }
  });

  router.get("/reports/balance-sheet", async (req, res) => {
    try {
      const db = getDb();
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
        isBalanced: cashInHand === (ownersCapital + retainedEarnings)
      });
    } catch (error) { res.status(500).json({ error: "Failed to fetch Balance Sheet" }); }
  });

  router.get("/reports/general-ledger", async (req, res) => {
    try {
      const db = getDb();
      const { startDate, endDate, accountType, partyName } = req.query;

      const incomes = await db.collection("incomes").find().toArray();
      const cashbook = await db.collection("cashbook").find().toArray();

      let openingBalance = 0;
      let allTransactions = [];

      incomes.forEach(i => {
        const amt = i.type === 'regular' ? Number(i.amount) : Number(i.paidAmount || 0);
        const party = i.customerName || "Walk-in Customer";
        const type = "Income";
        const category = i.type === 'regular' ? i.sourceType : 'Invoice Sale';

        if (i.date < startDate) {
          if ((!accountType || accountType === "All Accounts" || accountType === type) &&
              (!partyName || party.toLowerCase().includes(partyName.toLowerCase()))) {
            openingBalance += amt;
          }
        } else if (i.date >= startDate && i.date <= endDate) {
          allTransactions.push({
            date: i.date, type: type, category: category, party: party,
            description: i.description || i.notes || `Receipt: ${i.invoiceNo || 'Regular'}`,
            debit: amt, credit: 0, created_at: i.created_at
          });
        }
      });

      cashbook.forEach(tx => {
        const amt = Number(tx.amount);
        const party = tx.personName || "Owner / N/A";
        let type = "";
        let isDebit = false;

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
            date: tx.date, type: type, category: tx.category, party: party,
            description: tx.description || "N/A", debit: isDebit ? amt : 0, credit: !isDebit ? amt : 0, created_at: tx.created_at
          });
        }
      });

      let filteredTransactions = allTransactions.filter(tx => {
        const matchAccount = (!accountType || accountType === "All Accounts" || tx.type === accountType);
        const matchParty = (!partyName || tx.party.toLowerCase().includes(partyName.toLowerCase()));
        return matchAccount && matchParty;
      });

      filteredTransactions.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

      let currentBal = openingBalance;
      filteredTransactions = filteredTransactions.map(t => {
        currentBal += (t.debit - t.credit);
        return { ...t, balance: currentBal };
      });

      res.status(200).json({ openingBalance, closingBalance: currentBal, transactions: filteredTransactions });
    } catch (error) { res.status(500).json({ error: "Failed to fetch GL" }); }
  });

  router.get("/reports/party-ledger", async (req, res) => {
    try {
      const db = getDb();
      const { partyName, startDate, endDate } = req.query;
      if (!partyName) return res.status(200).json({ openingBalance: 0, transactions: [] });

      // 🟢 FIX: Escape Special Characters in partyName 
      const safePartyName = escapeRegex(partyName);
      const nameRegex = new RegExp(`^${safePartyName}$`, "i");

      const allIncomes = await db.collection("incomes").find({ customerName: nameRegex }).toArray();
      const allCashbook = await db.collection("cashbook").find({ personName: nameRegex }).toArray();

      let openingBalance = 0;
      let transactions = [];

      allIncomes.forEach(i => {
        const date = i.date;
        if (i.type === 'invoice') {
          if (date < startDate) openingBalance += Number(i.grandTotal || 0);
          else if (date >= startDate && date <= endDate) {
            transactions.push({ date, type: "Billed (Invoice)", description: `Invoice #${i.invoiceNo}`, debit: Number(i.grandTotal || 0), credit: 0, created_at: i.created_at });
          }
          if (Number(i.paidAmount) > 0) {
            if (date < startDate) openingBalance -= Number(i.paidAmount || 0);
            else if (date >= startDate && date <= endDate) {
              transactions.push({ date, type: "Payment (Received)", description: `Advance/Paid for #${i.invoiceNo}`, debit: 0, credit: Number(i.paidAmount || 0), created_at: i.created_at });
            }
          }
        } else if (i.type === 'regular') {
          if (date < startDate) openingBalance -= Number(i.amount || 0);
          else if (date >= startDate && date <= endDate) {
            transactions.push({ date, type: "Payment (Received)", description: i.description || i.sourceType || "Received Cash", debit: 0, credit: Number(i.amount || 0), created_at: i.created_at });
          }
        }
      });

      allCashbook.forEach(tx => {
        const amt = Number(tx.amount || 0);
        if (tx.date < startDate) openingBalance += amt; 
        else if (tx.date >= startDate && tx.date <= endDate) {
          transactions.push({ date: tx.date, type: "Payment (Given)", description: tx.description || tx.category || "Paid to party", debit: amt, credit: 0, created_at: tx.created_at });
        }
      });

      transactions.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      res.status(200).json({ openingBalance, transactions });
    } catch (error) { res.status(500).json({ error: "Failed to fetch Party Ledger" }); }
  });

  router.get("/reports/staff-ledger", async (req, res) => {
    try {
      const db = getDb();
      const staffList = await db.collection("people").find({ role: "staff" }).toArray();
      const cashbook = await db.collection("cashbook").find().toArray();

      if (!staffList || staffList.length === 0) {
        return res.status(200).json([]);
      }

      const report = staffList.map(staff => {
        const joiningDate = staff.joiningDate ? new Date(staff.joiningDate) : new Date(staff.created_at || Date.now());
        const now = new Date();
        let totalSalaryDue = 0;

        if (staff.salaryHistory && staff.salaryHistory.length > 0) {
          const history = staff.salaryHistory.sort((a, b) => new Date(a.effectiveDate) - new Date(b.effectiveDate));
          let currentMonth = new Date(joiningDate.getFullYear(), joiningDate.getMonth(), 1);
          const endMonth = new Date(now.getFullYear(), now.getMonth(), 1);

          while (currentMonth <= endMonth) {
            let applicableSalary = history[0].amount;
            for (const record of history) {
              const recordMonth = new Date(new Date(record.effectiveDate).getFullYear(), new Date(record.effectiveDate).getMonth(), 1);
              if (recordMonth <= currentMonth) {
                applicableSalary = record.amount;
              }
            }
            totalSalaryDue += applicableSalary;
            currentMonth.setMonth(currentMonth.getMonth() + 1);
          }
        } else {
          let monthsWorked = (now.getFullYear() - joiningDate.getFullYear()) * 12 + (now.getMonth() - joiningDate.getMonth());
          monthsWorked = monthsWorked <= 0 ? 1 : monthsWorked;
          totalSalaryDue = monthsWorked * (Number(staff.salary) || 0);
        }

        const safeStaffName = escapeRegex(staff.name || "");
        const staffRegex = new RegExp(`^${safeStaffName}$`, "i");

        const totalPaid = cashbook
          .filter(tx => tx.category === "Salary" && staffRegex.test(tx.personName || ""))
          .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

        return {
          _id: staff._id,
          name: staff.name,
          joiningDate: joiningDate,
          totalSalaryDue,
          totalPaid,
          remainingDue: totalSalaryDue - totalPaid
        };
      });

      res.status(200).json(report);
    } catch (error) {
      console.error("Staff Report Backend Error:", error);
      res.status(500).json({ error: "Internal Server Error", details: error.message });
    }
  });

  router.post('/reports/pay-salary', async (req, res) => {
    try {
        const db = getDb();
        const { staffName, amount, date } = req.body;
        await db.collection("cashbook").insertOne({
            date, type: "expense", category: "Salary", personName: staffName,
            amount: Number(amount), description: "Monthly Salary Payment", created_at: new Date()
        });
        res.status(200).json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};