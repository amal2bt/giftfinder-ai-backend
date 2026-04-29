const supabase = require('../config/supabaseClient');
const { createNotification } = require('../controllers/notificationsController');

/**
 * Check reminders and create notifications
 * - 7 days before the event
 * - On the day of the event
 * This should be called daily (via cron job or scheduled task)
 */
// Calculate next occurrence date for recurring reminders
function calculateNextOccurrence(originalDate, recurrenceType) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const original = new Date(originalDate);
  
  if (recurrenceType === 'yearly') {
    const currentYear = today.getFullYear();
    let nextDate = new Date(currentYear, original.getMonth(), original.getDate());
    
    if (nextDate < today) {
      // If this year's date has passed, use next year
      nextDate = new Date(currentYear + 1, original.getMonth(), original.getDate());
    }
    
    return nextDate.toISOString().split('T')[0];
  } else if (recurrenceType === 'monthly') {
    let nextDate = new Date(today);
    nextDate.setDate(original.getDate());
    
    if (nextDate < today) {
      nextDate.setMonth(nextDate.getMonth() + 1);
    }
    
    return nextDate.toISOString().split('T')[0];
  } else if (recurrenceType === 'weekly') {
    const dayOfWeek = original.getDay();
    const todayDayOfWeek = today.getDay();
    let daysUntilNext = (dayOfWeek - todayDayOfWeek + 7) % 7;
    
    if (daysUntilNext === 0) {
      daysUntilNext = 7; // Next week if it's today
    }
    
    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + daysUntilNext);
    
    return nextDate.toISOString().split('T')[0];
  }
  
  return null;
}

async function checkAndCreateNotifications() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Calculate 7 days from now
    const sevenDaysFromNow = new Date(today);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    
    // Format dates as YYYY-MM-DD for database comparison
    const todayStr = today.toISOString().split('T')[0];
    const sevenDaysStr = sevenDaysFromNow.toISOString().split('T')[0];
    
    console.log(`[Notification Scheduler] Checking reminders for ${todayStr} and ${sevenDaysStr}`);
    
    // Get all reminders (both recurring and non-recurring)
    const { data: allReminders, error: fetchError } = await supabase
      .from('reminders')
      .select('id, user_id, person, remind_date, is_recurring, original_date, recurrence_type')
      .eq('pref', 'app'); // Only for app notifications
    
    if (fetchError) {
      console.error('Error fetching reminders for notifications:', fetchError);
      return;
    }
    
    if (!allReminders || allReminders.length === 0) {
      console.log('[Notification Scheduler] No reminders found');
      return;
    }
    
    // Process reminders and calculate next occurrence for recurring ones
    const reminders = [];
    for (const reminder of allReminders) {
      let checkDate = reminder.remind_date;
      
      // For recurring reminders, calculate next occurrence
      if (reminder.is_recurring && reminder.original_date && reminder.recurrence_type) {
        checkDate = calculateNextOccurrence(reminder.original_date, reminder.recurrence_type);
      }
      
      // Check if this reminder should trigger a notification (today or 7 days from now)
      if (checkDate === todayStr || checkDate === sevenDaysStr) {
        reminders.push({
          ...reminder,
          remind_date: checkDate // Use calculated date
        });
      }
    }
    
    if (!reminders || reminders.length === 0) {
      console.log('[Notification Scheduler] No reminders found for today or 7 days from now');
      return;
    }
    
    console.log(`[Notification Scheduler] Found ${reminders.length} reminder(s) to process`);
    
    // Process each reminder
    for (const reminder of reminders) {
      const reminderDate = new Date(reminder.remind_date);
      const daysDiff = Math.ceil((reminderDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      // Determine notification type and content
      const title = daysDiff === 0 
        ? `Reminder: ${reminder.person} is today!`
        : `Reminder: ${reminder.person} in 7 days`;
      const message = daysDiff === 0
        ? `Don't forget! ${reminder.person}'s special day is today! 🎉`
        : `Just a friendly reminder: ${reminder.person}'s special day is coming up in 7 days! 📅`;
      
      // Check if notification already exists for this reminder today
      // We check by title to ensure we don't create duplicate notifications
      const todayStart = new Date(today);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(today);
      todayEnd.setHours(23, 59, 59, 999);
      
      const { data: existing } = await supabase
        .from('notifications')
        .select('id')
        .eq('user_id', reminder.user_id)
        .eq('reminder_id', reminder.id)
        .eq('type', 'reminder')
        .eq('title', title)
        .gte('created_at', todayStart.toISOString())
        .lte('created_at', todayEnd.toISOString())
        .limit(1);
      
      if (existing && existing.length > 0) {
        console.log(`[Notification Scheduler] Notification already exists for reminder ${reminder.id}`);
        continue;
      }
      
      // Create notification
      const result = await createNotification(
        reminder.user_id,
        title,
        message,
        'reminder',
        reminder.id
      );
      
      if (result.success) {
        console.log(`[Notification Scheduler] Created notification for reminder ${reminder.id} (${reminder.person})`);
      } else {
        console.error(`[Notification Scheduler] Failed to create notification for reminder ${reminder.id}:`, result.error);
      }
    }
  } catch (err) {
    console.error('[Notification Scheduler] Error:', err);
  }
}

// Run the scheduler (this should be called periodically, e.g., via cron or setInterval)
// For now, we'll create a function that can be called manually or scheduled
function startScheduler() {
  // Run immediately on start
  checkAndCreateNotifications();
  
  // Then run every hour to check for new reminders
  setInterval(() => {
    checkAndCreateNotifications();
  }, 60 * 60 * 1000); // 1 hour
  
  console.log('[Notification Scheduler] Started - will check reminders every hour');
}

module.exports = {
  checkAndCreateNotifications,
  startScheduler
};

