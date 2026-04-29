const supabase = require('../config/supabaseClient');
const nodemailer = require('nodemailer');

/**
 * Helper: send email using env variables
 */
async function sendEmail(to, subject, text, html) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false, // true if port is 465
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: `"GiftShop Admin" <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html,
  });
}

/**
 * Check admin users and send password change reminders
 * - Checks for admins who haven't changed their password in 3 months
 * - Sends reminder email if last reminder was sent more than 7 days ago (to avoid spam)
 * - This should be called periodically (e.g., daily or weekly)
 */
async function checkAndSendPasswordReminders() {
  try {
    console.log('[Password Reminder Scheduler] Starting password reminder check...');
    
    const now = new Date();
    // Calculate date 3 months ago
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    // Calculate date 7 days ago (to avoid sending reminders too frequently)
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    console.log(`[Password Reminder Scheduler] Checking for admins who haven't changed password since ${threeMonthsAgo.toISOString()}`);
    
    // Find admin users who:
    // 1. Have role 'admin' or 'manager'
    // 2. Haven't changed password in the last 3 months (password_changed_at < threeMonthsAgo)
    // 3. Either haven't received a reminder, or last reminder was more than 7 days ago
    const { data: admins, error } = await supabase
      .from('users')
      .select('id, username, email, password_changed_at, last_password_reminder_sent, role')
      .in('role', ['admin', 'manager'])
      .lt('password_changed_at', threeMonthsAgo.toISOString())
      .or(`last_password_reminder_sent.is.null,last_password_reminder_sent.lt.${sevenDaysAgo.toISOString()}`);
    
    if (error) {
      console.error('[Password Reminder Scheduler] Error fetching admins:', error);
      return;
    }
    
    if (!admins || admins.length === 0) {
      console.log('[Password Reminder Scheduler] No admins need password reminders at this time');
      return;
    }
    
    console.log(`[Password Reminder Scheduler] Found ${admins.length} admin(s) who need password reminders`);
    
    // Process each admin
    for (const admin of admins) {
      try {
        const passwordChangedDate = new Date(admin.password_changed_at);
        const monthsSinceChange = Math.floor((now - passwordChangedDate) / (1000 * 60 * 60 * 24 * 30));
        
        // Prepare email content
        const subject = '🔒 Password Change Reminder - GiftShop Admin';
        const text = `Dear ${admin.username},

This is a friendly reminder that it has been ${monthsSinceChange} month(s) since you last changed your password for your GiftShop admin account.

For security reasons, we recommend changing your password every 3 months. Please update your password as soon as possible.

To change your password:
1. Log in to your admin account
2. Go to your profile settings
3. Use the "Forgot Password" feature if needed, or update it directly from your profile

If you have any questions or concerns, please contact the system administrator.

Best regards,
GiftShop Security Team`;

        const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
    .content { background-color: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
    .footer { background-color: #f3f4f6; padding: 15px; text-align: center; font-size: 12px; color: #6b7280; border-radius: 0 0 5px 5px; }
    .button { display: inline-block; padding: 12px 24px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .warning { background-color: #FEF3C7; border-left: 4px solid #F59E0B; padding: 15px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔒 Password Change Reminder</h1>
    </div>
    <div class="content">
      <p>Dear ${admin.username},</p>
      
      <div class="warning">
        <strong>Security Reminder:</strong> It has been <strong>${monthsSinceChange} month(s)</strong> since you last changed your password for your GiftShop admin account.
      </div>
      
      <p>For security reasons, we recommend changing your password every 3 months. Please update your password as soon as possible.</p>
      
      <h3>How to Change Your Password:</h3>
      <ol>
        <li>Log in to your admin account</li>
        <li>Go to your profile settings</li>
        <li>Use the "Forgot Password" feature if needed, or update it directly from your profile</li>
      </ol>
      
      <p>If you have any questions or concerns, please contact the system administrator.</p>
      
      <p>Best regards,<br>
      <strong>GiftShop Security Team</strong></p>
    </div>
    <div class="footer">
      <p>This is an automated security reminder. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;

        // Send email
        await sendEmail(admin.email, subject, text, html);
        
        // Update last_password_reminder_sent timestamp
        const { error: updateError } = await supabase
          .from('users')
          .update({ last_password_reminder_sent: now.toISOString() })
          .eq('id', admin.id);
        
        if (updateError) {
          console.error(`[Password Reminder Scheduler] Failed to update reminder timestamp for admin ${admin.id}:`, updateError);
        } else {
          console.log(`[Password Reminder Scheduler] ✅ Sent password reminder to ${admin.email} (${admin.username})`);
          
          // Log activity
          try {
            await supabase.from('activity_logs').insert({
              user_id: admin.id,
              type: 'password_reminder_sent',
              message: `Password change reminder sent to admin ${admin.username} (${admin.email})`
            });
          } catch (logError) {
            console.error('[Password Reminder Scheduler] Failed to log activity:', logError);
          }
        }
      } catch (adminError) {
        console.error(`[Password Reminder Scheduler] Error processing admin ${admin.id}:`, adminError);
        // Continue with next admin even if one fails
      }
    }
    
    console.log('[Password Reminder Scheduler] Password reminder check completed');
  } catch (err) {
    console.error('[Password Reminder Scheduler] Error:', err);
  }
}

/**
 * Start the password reminder scheduler
 * - Runs immediately on start
 * - Then runs daily at a specific time (e.g., 9 AM)
 */
function startPasswordReminderScheduler() {
  // Run immediately on start
  checkAndSendPasswordReminders();
  
  // Calculate milliseconds until next 9 AM
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setHours(9, 0, 0, 0); // 9 AM
  
  // If it's already past 9 AM today, schedule for 9 AM tomorrow
  if (now >= nextRun) {
    nextRun.setDate(nextRun.getDate() + 1);
  }
  
  const msUntilNextRun = nextRun.getTime() - now.getTime();
  
  // Schedule first daily run
  setTimeout(() => {
    checkAndSendPasswordReminders();
    
    // Then run every 24 hours
    setInterval(() => {
      checkAndSendPasswordReminders();
    }, 24 * 60 * 60 * 1000); // 24 hours
  }, msUntilNextRun);
  
  console.log(`[Password Reminder Scheduler] Started - will check daily at 9 AM (next run: ${nextRun.toISOString()})`);
}

module.exports = {
  checkAndSendPasswordReminders,
  startPasswordReminderScheduler
};

