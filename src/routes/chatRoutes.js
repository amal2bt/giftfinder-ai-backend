const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { sendMessage, getHistory, clearHistory } = require('../controllers/chatController');

// Mobile app endpoints (require authentication)
router.post('/giftbot', authMiddleware, sendMessage);
router.get('/history', authMiddleware, getHistory);
router.delete('/history', authMiddleware, clearHistory);

module.exports = router;

