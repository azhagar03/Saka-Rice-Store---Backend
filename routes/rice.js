const express = require('express');
const router = express.Router();
const Rice = require('../models/Rice');

// GET all rice items
router.get('/', async (req, res) => {
  try {
    const riceItems = await Rice.find({ isActive: true }).sort({ name: 1 });
    res.json({ success: true, data: riceItems });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET single rice item
router.get('/:id', async (req, res) => {
  try {
    const rice = await Rice.findById(req.params.id);
    if (!rice) return res.status(404).json({ success: false, message: 'Rice not found' });
    res.json({ success: true, data: rice });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST create new rice item
router.post('/', async (req, res) => {
  try {
    const rice = new Rice(req.body);
    const saved = await rice.save();
    res.status(201).json({ success: true, data: saved, message: 'Rice item added successfully' });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'Rice item with this name already exists' });
    }
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT update rice item
router.put('/:id', async (req, res) => {
  try {
    const rice = await Rice.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!rice) return res.status(404).json({ success: false, message: 'Rice not found' });
    res.json({ success: true, data: rice, message: 'Rice item updated successfully' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PATCH update stock only
router.patch('/:id/stock', async (req, res) => {
  try {
    const { addStock } = req.body;
    const rice = await Rice.findById(req.params.id);
    if (!rice) return res.status(404).json({ success: false, message: 'Rice not found' });
    
    rice.totalStock += Number(addStock);
    await rice.save();
    res.json({ success: true, data: rice, message: `Stock updated. Added ${addStock} kg` });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE rice item (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const rice = await Rice.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!rice) return res.status(404).json({ success: false, message: 'Rice not found' });
    res.json({ success: true, message: 'Rice item deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
