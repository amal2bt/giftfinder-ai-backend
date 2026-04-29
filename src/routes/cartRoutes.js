const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { getCart, addToCart, updateQuantity, removeFromCart, checkout } = require('../controllers/cartController');

router.get('/', authMiddleware, getCart);
router.post('/checkout', authMiddleware, checkout); // Must come before /:giftId route
router.post('/:giftId', authMiddleware, addToCart);
router.put('/:giftId', authMiddleware, updateQuantity);
router.delete('/:giftId', authMiddleware, removeFromCart);

module.exports = router;


