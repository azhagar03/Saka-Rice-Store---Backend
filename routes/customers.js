const express  = require('express');
const router   = express.Router();
const Customer = require('../models/Customer');
const Sale     = require('../models/Sale');

// GET all customers with optional search
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

    res.json({ success: true, data: customers, pagination: { total, page: Number(page), pages: Math.ceil(total / limit) } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET pending amounts for all customers (for billing dropdown)
router.get('/pending/summary', async (req, res) => {
  try {
    const customers = await Customer.find({}).sort({ name: 1 });

    const pendingPipeline = [
      {
        $group: {
          _id: { phone: '$customerPhone', name: '$customerName' },
          totalAmount: { $sum: '$totalAmount' },
          amountPaid:  { $sum: { $ifNull: ['$amountPaid', 0] } },
        }
      }
    ];
    const salesGroups = await Sale.aggregate(pendingPipeline);

    const pendingMap = {};
    for (const g of salesGroups) {
      const bal = Math.max(0, (g.totalAmount || 0) - (g.amountPaid || 0));
      if (g._id.phone) {
        pendingMap[g._id.phone] = (pendingMap[g._id.phone] || 0) + bal;
      } else if (g._id.name) {
        const key = `name:${g._id.name.toLowerCase()}`;
        pendingMap[key] = (pendingMap[key] || 0) + bal;
      }
    }

    const result = customers.map(c => ({
      _id:          c._id,
      name:         c.name,
      phone:        c.phone,
      address:      c.address,
      pendingAmount: c.phone
        ? (pendingMap[c.phone] || 0)
        : (pendingMap[`name:${c.name.toLowerCase()}`] || 0),
    }));

    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET single customer with pending amount from sales
router.get('/:id', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const matchQ = customer.phone
      ? { $or: [{ customerPhone: customer.phone }, { customerName: { $regex: `^${customer.name}$`, $options: 'i' } }] }
      : { customerName: { $regex: `^${customer.name}$`, $options: 'i' } };

    const sales = await Sale.find(matchQ).sort({ invoiceSeq: -1 });
    const totalAmount   = sales.reduce((s, i) => s + (i.totalAmount || 0), 0);
    const amountPaid    = sales.reduce((s, i) => s + (i.amountPaid || (i.paymentStatus === 'paid' ? i.totalAmount : 0) || 0), 0);
    const pendingAmount = Math.max(0, totalAmount - amountPaid);

    res.json({ success: true, data: { customer, sales, totalAmount, amountPaid, pendingAmount } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST create customer
router.post('/', async (req, res) => {
  try {
    const { name, phone, address, notes } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'Customer name is required' });
    const customer = new Customer({ name: name.trim(), phone: phone || '', address: address || '', notes: notes || '' });
    const saved = await customer.save();
    res.status(201).json({ success: true, data: saved, message: 'Customer added successfully' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT update customer
router.put('/:id', async (req, res) => {
  try {
    const { name, phone, address, notes } = req.body;
    const updated = await Customer.findByIdAndUpdate(
      req.params.id,
      { name, phone, address, notes },
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.json({ success: true, data: updated });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

// DELETE customer
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Customer.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.json({ success: true, message: 'Customer deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
