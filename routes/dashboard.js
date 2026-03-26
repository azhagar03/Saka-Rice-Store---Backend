const express = require('express');
const router = express.Router();
const Sale = require('../models/Sale');
const Rice = require('../models/Rice');
const moment = require('moment');

// GET dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const { filter = 'today' } = req.query;
    
    let startDate, endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    switch (filter) {
      case 'today':
        startDate = moment().startOf('day').toDate();
        break;
      case 'week':
        startDate = moment().startOf('week').toDate();
        break;
      case 'month':
        startDate = moment().startOf('month').toDate();
        break;
      case 'year':
        startDate = moment().startOf('year').toDate();
        break;
      default:
        startDate = moment().startOf('day').toDate();
    }

    // Revenue stats
    const revenueStats = await Sale.aggregate([
      { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalAmount' },
          totalSales: { $sum: 1 },
          totalItems: { $sum: { $size: '$items' } }
        }
      }
    ]);

    // All rice stocks
    const riceStocks = await Rice.find({ isActive: true }).sort({ name: 1 });

    // Revenue chart data
    let chartData = [];
    if (filter === 'today') {
      // Hourly breakdown
      chartData = await Sale.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: { $hour: '$createdAt' },
            revenue: { $sum: '$totalAmount' },
            sales: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ]);
      chartData = chartData.map(d => ({ label: `${d._id}:00`, revenue: d.revenue, sales: d.sales }));
    } else if (filter === 'week') {
      chartData = await Sale.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: { $dayOfWeek: '$createdAt' },
            revenue: { $sum: '$totalAmount' },
            sales: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ]);
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      chartData = chartData.map(d => ({ label: days[d._id - 1], revenue: d.revenue, sales: d.sales }));
    } else if (filter === 'month') {
      chartData = await Sale.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: { $dayOfMonth: '$createdAt' },
            revenue: { $sum: '$totalAmount' },
            sales: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ]);
      chartData = chartData.map(d => ({ label: `Day ${d._id}`, revenue: d.revenue, sales: d.sales }));
    } else if (filter === 'year') {
      chartData = await Sale.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: { $month: '$createdAt' },
            revenue: { $sum: '$totalAmount' },
            sales: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ]);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      chartData = chartData.map(d => ({ label: months[d._id - 1], revenue: d.revenue, sales: d.sales }));
    }

    // Top selling rice
    const topSelling = await Sale.aggregate([
      { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.riceName',
          totalQty: { $sum: '$items.quantity' },
          totalRevenue: { $sum: '$items.totalPrice' }
        }
      },
      { $sort: { totalQty: -1 } },
      { $limit: 5 }
    ]);

    // Recent sales
    const recentSales = await Sale.find()
      .sort({ createdAt: -1 })
      .limit(5);

    const stats = revenueStats[0] || { totalRevenue: 0, totalSales: 0, totalItems: 0 };
    const totalStock = riceStocks.reduce((acc, r) => acc + r.totalStock, 0);
    const totalSoldStock = riceStocks.reduce((acc, r) => acc + r.soldStock, 0);
    const totalBalance = totalStock - totalSoldStock;
    const lowStockItems = riceStocks.filter(r => (r.totalStock - r.soldStock) <= r.minStockAlert);

    res.json({
      success: true,
      data: {
        stats: {
          ...stats,
          totalStock,
          totalBalance,
          lowStockCount: lowStockItems.length
        },
        riceStocks,
        chartData,
        topSelling,
        recentSales,
        lowStockItems
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
