const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authMiddleware');
const { summary } = require('../controllers/analyticsController');

router.get('/summary', authenticateToken, summary);

module.exports = router;
