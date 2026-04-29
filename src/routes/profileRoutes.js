const express = require('express');
const router = express.Router();
const { getProfile, updateProfile } = require('../controllers/profileController');
const authenticateToken = require('../middleware/authMiddleware');

// Get current user profile
router.get('/me', authenticateToken, getProfile);

// Update current user profile
router.put('/me', authenticateToken, updateProfile);

module.exports = router;

