const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
  assignOrder,
  getDeliveryWorkers,
  getAvailableOrders,
  getMyAssignments,
  updateDeliveryStatus,
  submitClientFeedback,
  getAllAssignments,
  getAllAssignmentsForUser,
} = require('../controllers/deliveryController');

// Admin/Manager routes
router.get('/workers', authMiddleware, getDeliveryWorkers);
router.get('/available-orders', authMiddleware, getAvailableOrders);
router.get('/assignments', authMiddleware, getAllAssignments);
router.post('/assign', authMiddleware, assignOrder);

// Delivery worker routes
router.get('/my-assignments', authMiddleware, getMyAssignments);
router.put('/:id/status', authMiddleware, updateDeliveryStatus);
router.post('/:id/client-feedback', authMiddleware, submitClientFeedback);

// User routes
router.get('/user-assignments', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id; 
    const deliveries = await getAllAssignmentsForUser(userId); 
    res.json({ assignments: deliveries });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch deliveries' });
  }
});

module.exports = router;

