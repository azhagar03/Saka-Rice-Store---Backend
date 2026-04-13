const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
  name:    { type: String, required: true, trim: true },
  phone:   { type: String, default: '', trim: true },
  address: { type: String, default: '', trim: true },
  notes:   { type: String, default: '' },

  // ── Manual balance override ───────────────────────────────────────────────
  manualPendingAdjustment: { type: Number, default: 0 },
  manualPendingNote:       { type: String, default: '' },

  // ── சிப்பம் (bag/sack) tracking ──────────────────────────────────────────
  // Stores the latest சிப்பம் value entered by admin and the date it was recorded
  chipbam:     { type: String, default: '' },   // e.g. "5 சிப்பம்" or any label
  chipbamDate: { type: Date,   default: null },  // date admin entered/updated it

}, { timestamps: true });

// Text index — accepts both English and Tamil input in same field
CustomerSchema.index({ name: 'text', address: 'text' });
CustomerSchema.index({ phone: 1 });

module.exports = mongoose.model('Customer', CustomerSchema);