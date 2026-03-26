const mongoose = require('mongoose');

const saleItemSchema = new mongoose.Schema({
  rice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rice',
    required: true
  },
  riceName: String,
  riceType: String,
  quantity: {
    type: Number,
    required: true,
    min: 0.1
  },
  pricePerKg: {
    type: Number,
    required: true
  },
  itemDiscount: {
    type: Number,
    default: 0
  },
  totalPrice: {
    type: Number,
    required: true
  }
});

const saleSchema = new mongoose.Schema({
  invoiceNumber: {
    type: String,
    unique: true,
    required: true
  },
  customerName: {
    type: String,
    required: true,
    trim: true
  },
  customerPhone: {
    type: String,
    trim: true
  },
  customerAddress: {
    type: String,
    trim: true
  },
  items: [saleItemSchema],
  subtotal: {
    type: Number,
    required: true
  },
  discount: {
    type: Number,
    default: 0
  },
  tax: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'card', 'upi', 'credit'],
    default: 'cash'
  },
  paymentStatus: {
    type: String,
    enum: ['paid', 'pending', 'partial'],
    default: 'paid'
  },
  notes: String,
  soldBy: {
    type: String,
    default: 'Admin'
  }
}, {
  timestamps: true
});

// Auto generate invoice number
saleSchema.pre('save', async function (next) {
  if (!this.invoiceNumber) {
    const count = await mongoose.model('Sale').countDocuments();
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    this.invoiceNumber = `INV-${year}${month}-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

module.exports = mongoose.model('Sale', saleSchema);
