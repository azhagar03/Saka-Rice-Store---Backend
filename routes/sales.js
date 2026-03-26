const express = require('express');
const router = express.Router();
const Sale = require('../models/Sale');
const Rice = require('../models/Rice');
const mongoose = require('mongoose');

// ── Helper: build date range query from period ─────────────────────────────────
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
        const day = now.getDay(); // 0=Sun
        start = new Date(now); start.setDate(now.getDate() - day); start.setHours(0, 0, 0, 0);
        end   = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
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
      default:
        break;
    }
    if (start && end) query.createdAt = { $gte: start, $lte: end };
  } else if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.createdAt.$lte = end;
    }
  }

  return query;
}

// ── GET all sales with pagination + period filter ─────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 15, period, startDate, endDate, search } = req.query;

    const query = buildPeriodQuery(period, startDate, endDate);

    if (search) {
      query.$or = [
        { invoiceNumber: { $regex: search, $options: 'i' } },
        { customerName:  { $regex: search, $options: 'i' } },
        { customerPhone: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await Sale.countDocuments(query);
    const sales = await Sale.find(query)
      .sort({ invoiceSeq: 1 })          // sequential order
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({
      success: true,
      data: sales,
      pagination: { total, page: Number(page), pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET sales report (summary) ─────────────────────────────────────────────────
router.get('/report', async (req, res) => {
  try {
    const { period, startDate, endDate } = req.query;
    const query = buildPeriodQuery(period, startDate, endDate);

    const sales = await Sale.find(query).sort({ invoiceSeq: 1 });

    const totalSales   = sales.reduce((s, i) => s + (i.totalAmount || 0), 0);
    const totalSubtotal= sales.reduce((s, i) => s + (i.subtotal  || 0), 0);
    const totalDiscount= sales.reduce((s, i) => s + (i.discount  || 0), 0);
    const totalGst     = sales.reduce((s, i) => s + ((i.subtotal - (i.discount||0)) * (i.tax||0) / 100), 0);

    res.json({
      success: true,
      data: {
        invoices: sales,
        count:        sales.length,
        totalSales,
        totalSubtotal,
        totalDiscount,
        totalGst,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET single sale ────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id).populate('items.rice');
    if (!sale) return res.status(404).json({ success: false, message: 'Sale not found' });
    res.json({ success: true, data: sale });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST create new sale ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const {
      customerName, customerPhone, customerAddress,
      items, discount, tax,
      paymentMethod, paymentStatus, notes, soldBy,
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one item is required' });
    }

    // Validate stock & build sale items
    let subtotal = 0;
    const saleItems = [];

    for (const item of items) {
      const rice = await Rice.findById(item.rice).session(session);
      if (!rice) {
        await session.abortTransaction();
        return res.status(404).json({ success: false, message: 'Rice item not found' });
      }

      const balance = rice.totalStock - rice.soldStock;
      if (balance < item.quantity) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${rice.name}. Available: ${balance} kg`,
        });
      }

      const gross = item.quantity * rice.pricePerKg;
      const itemDiscount = Number(item.itemDiscount || 0);
      const totalPrice = Math.max(0, gross - itemDiscount);
      subtotal += totalPrice;

      saleItems.push({
        rice: rice._id,
        riceName: rice.name,
        riceType: rice.type,
        quantity: item.quantity,
        pricePerKg: rice.pricePerKg,
        itemDiscount,
        totalPrice,
      });

      rice.soldStock += Number(item.quantity);
      await rice.save({ session });
    }

    const discountAmt = discount || 0;
    const taxAmt      = tax || 0;
    const totalAmount = (subtotal - discountAmt) + ((subtotal - discountAmt) * taxAmt / 100);

    // ── Sequential invoice number: 1, 2, 3 … ────────────────────────────────
    // Use a counter on the document set to avoid race conditions
    const count = await Sale.countDocuments().session(session);
    const invoiceSeq    = count + 1;
    const invoiceNumber = String(invoiceSeq);   // "1", "2", "3" …

    const sale = new Sale({
      invoiceNumber,
      invoiceSeq,
      customerName,
      customerPhone,
      customerAddress,
      items: saleItems,
      subtotal,
      discount: discountAmt,
      tax: taxAmt,
      totalAmount,
      paymentMethod,
      paymentStatus,
      notes,
      soldBy: soldBy || 'Admin',
    });

    const saved = await sale.save({ session });
    await session.commitTransaction();

    res.status(201).json({ success: true, data: saved, message: 'Sale created successfully' });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ success: false, message: err.message });
  } finally {
    session.endSession();
  }
});

module.exports = router;