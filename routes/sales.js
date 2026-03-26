const express = require('express');
const router = express.Router();
const Sale = require('../models/Sale');
const Rice = require('../models/Rice');
const mongoose = require('mongoose');

// GET all sales with pagination
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, startDate, endDate, search } = req.query;
    const query = {};

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    if (search) {
      query.$or = [
        { invoiceNumber: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } },
        { customerPhone: { $regex: search, $options: 'i' } }
      ];
    }

    const total = await Sale.countDocuments(query);
    const sales = await Sale.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({
      success: true,
      data: sales,
      pagination: { total, page: Number(page), pages: Math.ceil(total / limit) }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET single sale / invoice
router.get('/:id', async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id).populate('items.rice');
    if (!sale) return res.status(404).json({ success: false, message: 'Sale not found' });
    res.json({ success: true, data: sale });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST create new sale
router.post('/', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { customerName, customerPhone, customerAddress, items, discount, tax, paymentMethod, paymentStatus, notes } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one item is required' });
    }

    // Validate stock and calculate totals
    let subtotal = 0;
    const saleItems = [];

    for (const item of items) {
      const rice = await Rice.findById(item.rice).session(session);
      if (!rice) {
        await session.abortTransaction();
        return res.status(404).json({ success: false, message: `Rice item not found` });
      }

      const balance = rice.totalStock - rice.soldStock;
      if (balance < item.quantity) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${rice.name}. Available: ${balance} kg`
        });
      }

      const grossPrice = item.quantity * rice.pricePerKg;
      const itemDiscount = Number(item.itemDiscount || 0);
      const totalPrice = Math.max(0, grossPrice - itemDiscount);
      subtotal += totalPrice;

      saleItems.push({
        rice: rice._id,
        riceName: rice.name,
        riceType: rice.type,
        quantity: item.quantity,
        pricePerKg: rice.pricePerKg,
        itemDiscount,
        totalPrice
      });

      // Update sold stock
      rice.soldStock += Number(item.quantity);
      await rice.save({ session });
    }

    const discountAmt = discount || 0;
    const taxAmt = tax || 0;
    const totalAmount = subtotal - discountAmt + (subtotal * taxAmt / 100);

    // Generate invoice number
    const count = await Sale.countDocuments().session(session);
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const invoiceNumber = `INV-${year}${month}-${String(count + 1).padStart(4, '0')}`;

    const sale = new Sale({
      invoiceNumber,
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
      notes
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
