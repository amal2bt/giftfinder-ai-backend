const express = require('express');
const router = express.Router();
const { signup, verifyCode, sendVerificationCode, login, mobileLogin, forgotPassword, resetPassword, refresh, getAllUsers, createUser, updateUser, deleteUser } = require('../controllers/authController');
const authenticateToken = require('../middleware/authMiddleware');

router.post('/signup', signup);
router.post('/verify-code', verifyCode);
router.post('/send-code', sendVerificationCode); // <--- Needed for "Resend Code"
router.post('/login', login);
router.post('/mobile-login', mobileLogin);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/refresh', refresh);

router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const supabase = require('../config/supabaseClient');
    const userId = req.user?.id;
    
    if (!userId) {
      console.error('[DASHBOARD] No user ID in token');
      return res.status(401).json({ message: 'Invalid token' });
    }
    
    console.log('[DASHBOARD] Fetching user with ID:', userId, 'Type:', typeof userId);
    
    // Try to fetch user - handle both string and UUID formats
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, email, profile_picture_url')
      .eq('id', userId)
      .single();
    
    if (error) {
      console.error('[DASHBOARD] Supabase error:', error);
      console.error('[DASHBOARD] Error code:', error.code);
      console.error('[DASHBOARD] Error message:', error.message);
      console.error('[DASHBOARD] Error details:', error.details);
      
      // If single() returns PGRST116 (no rows), try without single() to see if user exists
      if (error.code === 'PGRST116') {
        const { data: users, error: listError } = await supabase
          .from('users')
          .select('id, username, email')
          .eq('id', userId)
          .limit(1);
        
        if (listError) {
          console.error('[DASHBOARD] List query also failed:', listError);
        } else {
          console.log('[DASHBOARD] List query result:', users);
        }
      }
      
      return res.status(404).json({ message: 'User not found' });
    }
    
    if (!user) {
      console.error('[DASHBOARD] User not found in database for ID:', userId);
      return res.status(404).json({ message: 'User not found' });
    }
    
    console.log('[DASHBOARD] User found:', user.username);
    res.json({ message: 'Welcome to your dashboard', user });
  } catch (err) {
    console.error('[DASHBOARD] Error:', err);
    console.error('[DASHBOARD] Error stack:', err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

// User management routes (admin only)
router.get('/users', authenticateToken, getAllUsers);
router.post('/users', authenticateToken, createUser);
router.put('/users/:id', authenticateToken, updateUser);
router.delete('/users/:id', authenticateToken, deleteUser);

module.exports = router;
