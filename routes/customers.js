const express  = require('express');
const router   = express.Router();
const Customer = require('../models/Customer');
const Sale     = require('../models/Sale');

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build a pending map  { phone → balance, 'name:xxx' → balance }
// from all Sales records.
// ─────────────────────────────────────────────────────────────────────────────
async function buildSalesPendingMap() {
  const pipeline = [
    {
      $group: {
        _id: { phone: '$customerPhone', name: '$customerName' },
        totalAmount: { $sum: '$totalAmount' },
        amountPaid:  { $sum: { $ifNull: ['$amountPaid', 0] } },
        // previousPending stored on each sale at creation time
        prevPending: { $sum: { $ifNull: ['$previousPending', 0] } },
      }
    }
  ];
  const groups = await Sale.aggregate(pipeline);

  const map = {};
  for (const g of groups) {
    // Balance = totalAmount - amountPaid
    // (previousPending was already folded into amountPaid logic on the frontend,
    //  so we do NOT add it again here — we just track what was actually unpaid)
    const bal = Math.max(0, (g.totalAmount || 0) - (g.amountPaid || 0));
    if (g._id.phone) {
      map[g._id.phone] = (map[g._id.phone] || 0) + bal;
    } else if (g._id.name) {
      const key = `name:${g._id.name.toLowerCase().trim()}`;
      map[key] = (map[key] || 0) + bal;
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /  — all customers with optional search + pagination
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const query = {};
    if (search) {
      query.$or = [
        { name:    { $regex: search, $options: 'i' } },
        { phone:   { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } },
      ];
    }
    const total     = await Customer.countDocuments(query);
    const customers = await Customer.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({
      success: true,
      data: customers,
      pagination: { total, page: Number(page), pages: Math.ceil(total / limit) }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /pending/summary
// Returns every customer with their effective pending amount:
//   effectivePending = salesPending + manualPendingAdjustment
// Used by the Billing page dropdown.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/pending/summary', async (req, res) => {
  try {
    const customers  = await Customer.find({}).sort({ name: 1 });
    const salesMap   = await buildSalesPendingMap();

    const result = customers.map(c => {
      // Raw pending from sales
      const salesPending = c.phone
        ? (salesMap[c.phone] || 0)
        : (salesMap[`name:${c.name.toLowerCase().trim()}`] || 0);

      // Add any manual adjustment (can be negative to reduce)
      const adjustment     = c.manualPendingAdjustment || 0;
      const effectivePending = Math.max(0, salesPending + adjustment);

      return {
        _id:                    c._id,
        name:                   c.name,
        phone:                  c.phone,
        address:                c.address,
        manualPendingAdjustment: adjustment,
        manualPendingNote:      c.manualPendingNote || '',
        salesPending,
        pendingAmount:          effectivePending,   // ← what the billing dropdown shows
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:id  — single customer with full sales history and pending breakdown
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const matchQ = customer.phone
      ? { $or: [{ customerPhone: customer.phone }, { customerName: { $regex: `^${customer.name}$`, $options: 'i' } }] }
      : { customerName: { $regex: `^${customer.name}$`, $options: 'i' } };

    const sales       = await Sale.find(matchQ).sort({ invoiceSeq: -1 });
    const totalAmount = sales.reduce((s, i) => s + (i.totalAmount || 0), 0);
    const amountPaid  = sales.reduce((s, i) => s + (i.amountPaid || (i.paymentStatus === 'paid' ? i.totalAmount : 0) || 0), 0);
    const salesPending  = Math.max(0, totalAmount - amountPaid);
    const adjustment    = customer.manualPendingAdjustment || 0;
    const pendingAmount = Math.max(0, salesPending + adjustment);

    res.json({
      success: true,
      data: {
        customer,
        sales,
        totalAmount,
        amountPaid,
        salesPending,
        adjustment,
        pendingAmount,          // effective total pending
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /  — create customer
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { name, phone, address, notes, manualPendingAdjustment, manualPendingNote } = req.body;
    if (!name || !name.trim())
      return res.status(400).json({ success: false, message: 'Customer name is required' });

    const customer = new Customer({
      name:                    name.trim(),
      phone:                   phone || '',
      address:                 address || '',
      notes:                   notes || '',
      manualPendingAdjustment: Number(manualPendingAdjustment) || 0,
      manualPendingNote:       manualPendingNote || '',
    });
    const saved = await customer.save();
    res.status(201).json({ success: true, data: saved, message: 'Customer added successfully' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /:id  — update customer (including manual balance adjustment)
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const {
      name, phone, address, notes,
      manualPendingAdjustment, manualPendingNote,
    } = req.body;

    const updated = await Customer.findByIdAndUpdate(
      req.params.id,
      {
        name,
        phone,
        address,
        notes,
        manualPendingAdjustment: Number(manualPendingAdjustment) || 0,
        manualPendingNote:       manualPendingNote || '',
      },
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Customer not found' });

    // Return updated customer with effective pending so the frontend
    // can immediately refresh the pending display.
    const salesMap     = await buildSalesPendingMap();
    const salesPending = updated.phone
      ? (salesMap[updated.phone] || 0)
      : (salesMap[`name:${updated.name.toLowerCase().trim()}`] || 0);
    const adjustment     = updated.manualPendingAdjustment || 0;
    const pendingAmount  = Math.max(0, salesPending + adjustment);

    res.json({
      success: true,
      data: { ...updated.toObject(), salesPending, pendingAmount }
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:id
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Customer.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.json({ success: true, message: 'Customer deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;