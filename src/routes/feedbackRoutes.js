const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authMiddleware');

const { listFeedback, createFeedback } = require('../controllers/feedbackController');

// POST (Mobile App)
router.post('/', createFeedback);

// GET (Admin Only)
router.get('/', authenticateToken, listFeedback);

module.exports = router;
