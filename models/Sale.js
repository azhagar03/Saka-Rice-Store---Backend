// Sale.js — Updated Mongoose model
// Add these new fields to your existing Sale schema:

const mongoose = require('mongoose');

const SaleItemSchema = new mongoose.Schema({
  rice:        { type: mongoose.Schema.Types.ObjectId, ref: 'Rice' },
  riceName:    String,
  riceType:    String,
  quantity:    Number,
  pricePerKg:  Number,
  itemDiscount:{ type: Number, default: 0 },
  totalPrice:  Number,
});

const SaleSchema = new mongoose.Schema({
  invoiceNumber:  { type: String, required: true, unique: true },
  invoiceSeq:     { type: Number, required: true },

  // Customer — English + Tamil (bilingual)
  customerName:         { type: String, required: true },
  customerNameTamil:    { type: String, default: '' },       // ← NEW: Tamil name
  customerPhone:        { type: String, default: '' },
  customerAddress:      { type: String, default: '' },
  customerAddressTamil: { type: String, default: '' },       // ← NEW: Tamil address
  customerCity:         { type: String, default: '' },       // ← NEW: city for search filter

  items:          [SaleItemSchema],
  subtotal:       { type: Number, default: 0 },
  discount:       { type: Number, default: 0 },
  tax:            { type: Number, default: 0 },
  totalAmount:    { type: Number, default: 0 },

  // Payment
  paymentMethod:  { type: String, enum: ['cash','card','upi','credit'], default: 'cash' },
  paymentStatus:  { type: String, enum: ['paid','pending','partial'], default: 'paid' },
  amountPaid:     { type: Number, default: 0 },              // ← NEW: partial payment tracking
  balanceAmount:  { type: Number, default: 0 },              // ← NEW: auto-calculated balance

  notes:    { type: String, default: '' },
  soldBy:   { type: String, default: 'Admin' },
}, { timestamps: true });

// Index for fast customer and city searches
SaleSchema.index({ customerName: 'text', customerAddress: 'text', customerCity: 'text' });
SaleSchema.index({ customerPhone: 1 });
SaleSchema.index({ invoiceSeq: -1 });
SaleSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Sale', SaleSchema);

/*
MIGRATION NOTE:
For existing documents that don't have the new fields, run this one-time migration
in your MongoDB shell or a migration script:

db.sales.updateMany(
  { amountPaid: { $exists: false } },
  [{ $set: {
    customerNameTamil: "",
    customerAddressTamil: "",
    customerCity: "",
    amountPaid: {
      $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$totalAmount", 0]
    },
    balanceAmount: {
      $cond: [{ $eq: ["$paymentStatus", "paid"] }, 0, "$totalAmount"]
    }
  }}]
);
*/