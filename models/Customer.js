const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
  name:    { type: String, required: true, trim: true },
  phone:   { type: String, default: '', trim: true },
  address: { type: String, default: '', trim: true },
  notes:   { type: String, default: '' },

  // ── Manual balance override ───────────────────────────────────────────────
  // Admin can set an opening/adjusted balance that adds to the
  // auto-calculated pending from sales.  Can be negative to credit.
  manualPendingAdjustment: { type: Number, default: 0 },
  manualPendingNote:       { type: String, default: '' }, // reason / label

}, { timestamps: true });

// Text index — accepts both English and Tamil input in same field
CustomerSchema.index({ name: 'text', address: 'text' });
CustomerSchema.index({ phone: 1 });

module.exports = mongoose.model('Customer', CustomerSchema);