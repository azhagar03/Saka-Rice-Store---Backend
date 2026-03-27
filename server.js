const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/rice', require('./routes/rice'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/dashboard', require('./routes/dashboard'));

app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE']// for now (later restrict)
}));

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('✅ MongoDB Connected');
}).catch(err => {
  console.error('❌ MongoDB Connection Error:', err);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
