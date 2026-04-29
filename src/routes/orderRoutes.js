const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { listOrders, getOrderById, updateOrderStatus } = require('../controllers/orderController');

// Get all orders (with ?all=true for admin) or user's own orders
router.get('/', authMiddleware, listOrders);

// Get order by ID
router.get('/:id', authMiddleware, getOrderById);

// Update order status
router.put('/:id/status', authMiddleware, updateOrderStatus);

module.exports = router;


