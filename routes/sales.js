const express   = require('express');
const router    = express.Router();
const Sale      = require('../models/Sale');
const Rice      = require('../models/Rice');
const Counter   = require('../models/Counter');
const mongoose  = require('mongoose');

// ── Atomic counter: always increments, never resets ──────────────────────────
async function nextInvoiceSeq(session) {
  const counter = await Counter.findByIdAndUpdate(
    'invoiceSeq',
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session }
  );
  return counter.seq;
}

function buildPeriodQuery(period, startDate, endDate) {
  const now = new Date();
  const query = {};
  if (period) {
    let start, end;
    switch (period) {
      case 'day':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        break;
      case 'week': {
        const day = now.getDay();
        start = new Date(now); start.setDate(now.getDate() - day); start.setHours(0,0,0,0);
        end   = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23,59,59,999);
        break;
      }
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        break;
      case 'year':
        start = new Date(now.getFullYear(), 0, 1);
        end   = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
        break;
    }
    if (start && end) query.createdAt = { $gte: start, $lte: end };
  } else if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) { const e = new Date(endDate); e.setHours(23,59,59,999); query.createdAt.$lte = e; }
  }
  return query;
}

// GET all — with search by address/city too
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 15, period, startDate, endDate, search } = req.query;
    const query = buildPeriodQuery(period, startDate, endDate);
    if (search) {
      query.$or = [
        { invoiceNumber:        { $regex: search, $options: 'i' } },
        { customerName:         { $regex: search, $options: 'i' } },
        { customerNameTamil:    { $regex: search, $options: 'i' } },
        { customerPhone:        { $regex: search, $options: 'i' } },
        { customerAddress:      { $regex: search, $options: 'i' } },
        { customerAddressTamil: { $regex: search, $options: 'i' } },
        { customerCity:         { $regex: search, $options: 'i' } },
      ];
    }
    const total = await Sale.countDocuments(query);
    const sales = await Sale.find(query).sort({ invoiceSeq: -1 }).skip((page-1)*limit).limit(Number(limit));
    res.json({ success: true, data: sales, pagination: { total, page: Number(page), pages: Math.ceil(total/limit) } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET report
router.get('/report', async (req, res) => {
  try {
    const { period, startDate, endDate } = req.query;
    const query = buildPeriodQuery(period, startDate, endDate);
    const sales = await Sale.find(query).sort({ invoiceSeq: 1 });
    const totalSales    = sales.reduce((s,i) => s+(i.totalAmount||0), 0);
    const totalSubtotal = sales.reduce((s,i) => s+(i.subtotal||0), 0);
    const totalDiscount = sales.reduce((s,i) => s+(i.discount||0), 0);
    const totalGst      = sales.reduce((s,i) => s+((i.subtotal-(i.discount||0))*(i.tax||0)/100), 0);
    res.json({ success: true, data: { invoices: sales, count: sales.length, totalSales, totalSubtotal, totalDiscount, totalGst } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET customer summary — all invoices for a customer (by name or phone)
router.get('/customer-summary', async (req, res) => {
  try {
    const { customerPhone, customerName } = req.query;
    let matchQuery = {};
    if (customerPhone) matchQuery.customerPhone = customerPhone;
    else if (customerName) matchQuery.customerName = { $regex: customerName, $options: 'i' };
    else return res.status(400).json({ success: false, message: 'Provide customerPhone or customerName' });

    const sales = await Sale.find(matchQuery).sort({ invoiceSeq: -1 });
    const totalAmount = sales.reduce((s,i) => s+(i.totalAmount||0), 0);
    const paidAmount  = sales.filter(i=>i.paymentStatus==='paid').reduce((s,i) => s+(i.totalAmount||0), 0);
    const pendingAmount = sales.filter(i=>i.paymentStatus==='pending').reduce((s,i) => s+(i.totalAmount||0), 0);
    const partialAmount = sales.filter(i=>i.paymentStatus==='partial').reduce((s,i) => s+(i.totalAmount||0), 0);
    const balance = totalAmount - paidAmount;

    res.json({ success: true, data: { sales, totalAmount, paidAmount, pendingAmount, partialAmount, balance, count: sales.length } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET single
router.get('/:id', async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id).populate('items.rice');
    if (!sale) return res.status(404).json({ success: false, message: 'Sale not found' });
    res.json({ success: true, data: sale });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST create
router.post('/', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { customerName, customerPhone, customerAddress, customerCity, customerNameTamil, customerAddressTamil, items, discount, tax, paymentMethod, paymentStatus, amountPaid, notes, soldBy } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ success: false, message: 'At least one item is required' });

    let subtotal = 0;
    const saleItems = [];

    for (const item of items) {
      const rice = await Rice.findById(item.rice).session(session);
      if (!rice) { await session.abortTransaction(); return res.status(404).json({ success: false, message: 'Rice item not found' }); }
      const balance = rice.totalStock - rice.soldStock;
      if (balance < item.quantity) { await session.abortTransaction(); return res.status(400).json({ success: false, message: `Insufficient stock for ${rice.name}. Available: ${balance} kg` }); }
      const gross = item.quantity * rice.pricePerKg;
      const itemDiscount = Number(item.itemDiscount || 0);
      const totalPrice = Math.max(0, gross - itemDiscount);
      subtotal += totalPrice;
      saleItems.push({ rice: rice._id, riceName: rice.name, riceType: rice.type, quantity: item.quantity, pricePerKg: rice.pricePerKg, itemDiscount, totalPrice });
      rice.soldStock += Number(item.quantity);
      await rice.save({ session });
    }

    const discountAmt = discount || 0;
    const taxAmt = tax || 0;
    const totalAmount = (subtotal - discountAmt) + ((subtotal - discountAmt) * taxAmt / 100);

    // Calculate balance based on amount paid
    const paid = Number(amountPaid || (paymentStatus === 'paid' ? totalAmount : 0));
    const balanceAmt = Math.max(0, totalAmount - paid);

    const seq = await nextInvoiceSeq(session);
    const invoiceNumber = String(seq);

    const sale = new Sale({
      invoiceNumber, invoiceSeq: seq,
      customerName, customerPhone, customerAddress, customerCity,
      customerNameTamil: customerNameTamil || '',
      customerAddressTamil: customerAddressTamil || '',
      items: saleItems, subtotal, discount: discountAmt, tax: taxAmt, totalAmount,
      paymentMethod, paymentStatus,
      amountPaid: paid,
      balanceAmount: balanceAmt,
      notes, soldBy: soldBy || 'Admin'
    });
    const saved = await sale.save({ session });
    await session.commitTransaction();
    res.status(201).json({ success: true, data: saved, message: 'Sale created successfully' });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ success: false, message: err.message });
  } finally { session.endSession(); }
});

// PUT update — full edit with stock delta and payment recalculation
router.put('/:id', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const existing = await Sale.findById(req.params.id).session(session);
    if (!existing) { await session.abortTransaction(); return res.status(404).json({ success: false, message: 'Sale not found' }); }

    const { customerName, customerPhone, customerAddress, customerCity, customerNameTamil, customerAddressTamil, items, discount, tax, paymentMethod, paymentStatus, amountPaid, notes, soldBy } = req.body;

    // Reverse old stock
    for (const oldItem of existing.items) {
      const rice = await Rice.findById(oldItem.rice).session(session);
      if (rice) { rice.soldStock = Math.max(0, rice.soldStock - oldItem.quantity); await rice.save({ session }); }
    }

    // Apply new stock
    let subtotal = 0;
    const saleItems = [];
    for (const item of items) {
      const rice = await Rice.findById(item.rice).session(session);
      if (!rice) { await session.abortTransaction(); return res.status(404).json({ success: false, message: 'Rice item not found' }); }
      const balance = rice.totalStock - rice.soldStock;
      if (balance < item.quantity) { await session.abortTransaction(); return res.status(400).json({ success: false, message: `Insufficient stock for ${rice.name}. Available: ${balance} kg` }); }
      const gross = item.quantity * rice.pricePerKg;
      const itemDiscount = Number(item.itemDiscount || 0);
      const totalPrice = Math.max(0, gross - itemDiscount);
      subtotal += totalPrice;
      saleItems.push({ rice: rice._id, riceName: rice.name, riceType: rice.type, quantity: item.quantity, pricePerKg: rice.pricePerKg, itemDiscount, totalPrice });
      rice.soldStock += Number(item.quantity);
      await rice.save({ session });
    }

    const discountAmt = discount || 0;
    const taxAmt = tax || 0;
    const totalAmount = (subtotal - discountAmt) + ((subtotal - discountAmt) * taxAmt / 100);
    const paid = Number(amountPaid || (paymentStatus === 'paid' ? totalAmount : 0));
    const balanceAmt = Math.max(0, totalAmount - paid);

    existing.customerName    = customerName;
    existing.customerPhone   = customerPhone;
    existing.customerAddress = customerAddress;
    existing.customerCity    = customerCity || '';
    existing.customerNameTamil    = customerNameTamil || '';
    existing.customerAddressTamil = customerAddressTamil || '';
    existing.items           = saleItems;
    existing.subtotal        = subtotal;
    existing.discount        = discountAmt;
    existing.tax             = taxAmt;
    existing.totalAmount     = totalAmount;
    existing.paymentMethod   = paymentMethod;
    existing.paymentStatus   = paymentStatus;
    existing.amountPaid      = paid;
    existing.balanceAmount   = balanceAmt;
    existing.notes           = notes;
    if (soldBy) existing.soldBy = soldBy;

    const updated = await existing.save({ session });
    await session.commitTransaction();
    res.json({ success: true, data: updated });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ success: false, message: err.message });
  } finally { session.endSession(); }
});

// DELETE
router.delete('/:id', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sale = await Sale.findById(req.params.id).session(session);
    if (!sale) { await session.abortTransaction(); return res.status(404).json({ success: false, message: 'Sale not found' }); }

    for (const item of sale.items) {
      const rice = await Rice.findById(item.rice).session(session);
      if (rice) { rice.soldStock = Math.max(0, rice.soldStock - item.quantity); await rice.save({ session }); }
    }

    await Sale.findByIdAndDelete(req.params.id, { session });
    await session.commitTransaction();
    res.json({ success: true, message: `Invoice #${sale.invoiceNumber} deleted. Stock restored.` });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ success: false, message: err.message });
  } finally { session.endSession(); }
});

module.exports = router;