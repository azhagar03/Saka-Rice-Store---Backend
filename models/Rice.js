const mongoose = require('mongoose');

const riceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  type: {
    type: String,
    required: true,
    trim: true
  },
  pricePerKg: {
    type: Number,
    required: true,
    min: 0
  },
  totalStock: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  soldStock: {
    type: Number,
    default: 0,
    min: 0
  },
  description: {
    type: String,
    trim: true
  },
  unit: {
    type: String,
    default: 'kg'
  },
  minStockAlert: {
    type: Number,
    default: 50
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

riceSchema.virtual('balanceStock').get(function () {
  return this.totalStock - this.soldStock;
});

riceSchema.set('toJSON', { virtuals: true });
riceSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Rice', riceSchema);
