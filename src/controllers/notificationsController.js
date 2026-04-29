const supabase = require('../config/supabaseClient');

// Get all notifications for a user
async function getAll(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { data, error } = await supabase
      .from('notifications')
      .select('id, title, message, type, reminder_id, is_read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Error fetching notifications:', error);
      return res.status(500).json({ message: 'Failed to fetch notifications' });
    }

    return res.status(200).json(data || []);
  } catch (err) {
    console.error('getAll notifications error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// Mark notification as read
async function markAsRead(req, res) {
  try {
    const userId = req.user?.id;
    const notificationId = req.params.id;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!notificationId) {
      return res.status(400).json({ message: 'Notification ID is required' });
    }

    // Verify the notification belongs to the user
    const { data: notification, error: checkError } = await supabase
      .from('notifications')
      .select('id')
      .eq('id', notificationId)
      .eq('user_id', userId)
      .single();

    if (checkError || !notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('user_id', userId)
      .select('id, is_read')
      .single();

    if (error) {
      console.error('Error marking notification as read:', error);
      return res.status(500).json({ message: 'Failed to update notification' });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('markAsRead notification error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// Mark all notifications as read
async function markAllAsRead(req, res) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      console.error('Error marking all notifications as read:', error);
      return res.status(500).json({ message: 'Failed to update notifications' });
    }

    return res.status(200).json({ message: 'All notifications marked as read' });
  } catch (err) {
    console.error('markAllAsRead notifications error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// Get unread count
async function getUnreadCount(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      console.error('Error counting unread notifications:', error);
      return res.status(500).json({ message: 'Failed to count notifications' });
    }

    return res.status(200).json({ count: count || 0 });
  } catch (err) {
    console.error('getUnreadCount error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// Create notification (internal use, for scheduling system)
async function createNotification(userId, title, message, type = 'reminder', reminderId = null) {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .insert([{
        user_id: userId,
        title,
        message,
        type,
        reminder_id: reminderId,
        is_read: false
      }])
      .select('id')
      .single();

    if (error) {
      console.error('Error creating notification:', error);
      return { success: false, error };
    }

    return { success: true, data };
  } catch (err) {
    console.error('createNotification error:', err);
    return { success: false, error: err };
  }
}

module.exports = {
  getAll,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  createNotification
};

