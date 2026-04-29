const supabase = require('../config/supabaseClient');
const authMiddleware = require('../middleware/authMiddleware');

async function getWishlist(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { data, error } = await supabase
      .from('wishlist')
      .select('gift_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching wishlist:', error);
      return res.status(500).json({ message: 'Failed to fetch wishlist' });
    }

    return res.status(200).json(data || []);
  } catch (err) {
    console.error('getWishlist error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function addToWishlist(req, res) {
  try {
    const userId = req.user?.id;
    const { giftId } = req.params;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!giftId) {
      return res.status(400).json({ message: 'Gift ID is required' });
    }

    // Check if gift exists
    const { data: gift, error: giftError } = await supabase
      .from('gifts')
      .select('id')
      .eq('id', giftId)
      .single();

    if (giftError || !gift) {
      return res.status(404).json({ message: 'Gift not found' });
    }

    // Check if already in wishlist
    const { data: existing, error: checkError } = await supabase
      .from('wishlist')
      .select('id')
      .eq('user_id', userId)
      .eq('gift_id', giftId)
      .single();

    if (existing) {
      return res.status(200).json({ message: 'Already in wishlist', gift_id: giftId });
    }

    // Add to wishlist
    const { data, error } = await supabase
      .from('wishlist')
      .insert([{ user_id: userId, gift_id: giftId }])
      .select('gift_id')
      .single();

    if (error) {
      console.error('Error adding to wishlist:', error);
      return res.status(500).json({ message: 'Failed to add to wishlist' });
    }
 
// ✅ Log activity
await supabase.from('activity_logs').insert({
  user_id: userId,
  type: 'wishlist_add',
  message: `Added gift ${giftId} to wishlist`
});
    return res.status(201).json({ message: 'Added to wishlist', gift_id: giftId });
  } catch (err) {
    console.error('addToWishlist error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function removeFromWishlist(req, res) {
  try {
    const userId = req.user?.id;
    const { giftId } = req.params;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!giftId) {
      return res.status(400).json({ message: 'Gift ID is required' });
    }

    const { error } = await supabase
      .from('wishlist')
      .delete()
      .eq('user_id', userId)
      .eq('gift_id', giftId);

    if (error) {
      console.error('Error removing from wishlist:', error);
      return res.status(500).json({ message: 'Failed to remove from wishlist' });
    }
    
// ✅ Log activity
await supabase.from('activity_logs').insert({
  user_id: userId,
  type: 'wishlist_remove',
  message: `Removed gift ${giftId} from wishlist`
});

    return res.status(200).json({ message: 'Removed from wishlist', gift_id: giftId });
  } catch (err) {
    console.error('removeFromWishlist error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

module.exports = {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
};


