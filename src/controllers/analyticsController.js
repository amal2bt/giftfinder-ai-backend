const supabase = require('../config/supabaseClient');

// ------------------ Helper Functions ------------------
async function ensureAdmin(userId) {
  const { data: user, error } = await supabase
    .from('users')
    .select('id, role')
    .eq('id', userId)
    .single();

  if (error || !user) return { ok: false, status: 401, message: 'Unauthorized' };
  if (!user.role || String(user.role).toLowerCase() !== 'admin') {
    return { ok: false, status: 403, message: 'Admin role required' };
  }
  return { ok: true };
}

async function logActivity(userId, type, message) {
  try {
    await supabase.from('activity_logs').insert([{ user_id: userId || null, type, message }]);
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}

// ------------------ Analytics ------------------
async function summary(req, res) {
  try {
    // Ensure admin
    const auth = await ensureAdmin(req.user?.id);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    const sinceDays = Number(req.query.days || 14);
    const since = new Date();
    since.setDate(since.getDate() - sinceDays);
    const sinceIso = since.toISOString();

    // ---------------- Counts & Recent Data ----------------
    const [
      usersTotalRes,
      usersVerifiedRes,
      usersAdminRes,
      usersRecentRes,
      giftsTotalRes,
      chatsCountRes,
      wishlistsCountRes,
      feedbackTotalRes,
      recentUsersRaw,
      recentGiftsRaw,
      recentWishlistsRaw,
      recentChatsRaw,
      recentOrdersRaw,
      recentFeedbackRaw
    ] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_verified', true),
      supabase.from('users').select('*', { count: 'exact', head: true }).ilike('role', 'admin'),
      supabase.from('users').select('created_at').gte('created_at', sinceIso),
      supabase.from('gifts').select('*', { count: 'exact', head: true }),
      supabase.from('chat_logs').select('*', { count: 'exact', head: true }),
      supabase.from('wishlists').select('*', { count: 'exact', head: true }),
      supabase.from('feedback').select('*', { count: 'exact', head: true }),
      supabase.from('users').select('id, username, created_at').gte('created_at', sinceIso),
      supabase.from('gifts').select('id, name, created_at').gte('created_at', sinceIso),
      supabase.from('wishlists').select('id, created_at, user_id').gte('created_at', sinceIso),
      supabase.from('chat_logs').select('id, created_at').gte('created_at', sinceIso),
      supabase.from('orders').select('id, created_at, user_id').gte('created_at', sinceIso),
      supabase.from('feedback').select('id, user_name, comment, rating, created_at').gte('created_at', sinceIso)
    ]);

    const users = {
      total: usersTotalRes.count || 0,
      verified: usersVerifiedRes.count || 0,
      admins: usersAdminRes.count || 0
    };

    const feedbackSummary = {
      total: feedbackTotalRes.count || 0
    };

    // ---------------- Recent Users Per Day ----------------
    const recentBuckets = {};
    (usersRecentRes.data || []).forEach(u => {
      const key = new Date(u.created_at).toISOString().slice(0, 10);
      recentBuckets[key] = (recentBuckets[key] || 0) + 1;
    });

    const recentUsers = [];
    for (let i = sinceDays - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      recentUsers.push({ date: key, count: recentBuckets[key] || 0 });
    }

    // ---------------- Top Purchased Categories ----------------
    const { data: purchasedCategories, error: catError } = await supabase
      .from('order_items')
      .select('gift:gift_id (category)');

    let categories = [];
    if (!catError && Array.isArray(purchasedCategories)) {
      const counts = {};
      purchasedCategories.forEach(item => {
        const cat = item.gift?.category || 'Uncategorized';
        counts[cat] = (counts[cat] || 0) + 1;
      });
      categories = Object.entries(counts)
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    }

    const gifts = { total: giftsTotalRes.count || 0, categories };

    // ---------------- Sales Trends ----------------
    const { data: orderItems, error: salesError } = await supabase
      .from('order_items')
      .select('quantity, price, order:order_id (created_at)')
      .gte('order.created_at', sinceIso);

    const salesTrends = [];
    if (!salesError && Array.isArray(orderItems)) {
      const dailyTotals = {};
      orderItems.forEach(item => {
        if (item.order && item.order.created_at) {
          const date = new Date(item.order.created_at).toISOString().slice(0, 10);
          const total = Number(item.price) * Number(item.quantity);
          dailyTotals[date] = (dailyTotals[date] || 0) + total;
        }
      });

      for (let i = sinceDays - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        salesTrends.push({ date: key, total: dailyTotals[key] || 0 });
      }
    }

    // ---------------- Delivered Orders Trends ----------------
    const { data: deliveredOrders, error: deliveredError } = await supabase
      .from('orders')
      .select('id, status, created_at')
      .eq('status', 'delivered')
      .gte('created_at', sinceIso);

    const deliveredOrdersTrends = [];
    if (!deliveredError && Array.isArray(deliveredOrders)) {
      const dailyCounts = {};
      deliveredOrders.forEach(order => {
        if (order.created_at) {
          const date = new Date(order.created_at).toISOString().slice(0, 10);
          dailyCounts[date] = (dailyCounts[date] || 0) + 1;
        }
      });

      for (let i = sinceDays - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        deliveredOrdersTrends.push({ date: key, count: dailyCounts[key] || 0 });
      }
    }

    // ---------------- AI & Wishlists ----------------
    const ai = { chats: chatsCountRes.count || 0 };
    const wishlists = { total: wishlistsCountRes.count || 0 };

    // ---------------- Recent Activity ----------------
    const recentActivity = [];

    (recentUsersRaw.data || []).forEach(u =>
      recentActivity.push({ type: 'user_created', message: `New user registered: ${u.username || u.id}`, time: u.created_at })
    );
    (recentGiftsRaw.data || []).forEach(g =>
      recentActivity.push({ type: 'gift_created', message: `New gift added: ${g.name}`, time: g.created_at })
    );
    (recentWishlistsRaw.data || []).forEach(w =>
      recentActivity.push({ type: 'wishlist_created', message: `A new wishlist was created`, time: w.created_at })
    );
    (recentChatsRaw.data || []).forEach(c =>
      recentActivity.push({ type: 'chat', message: `AI chat interaction occurred`, time: c.created_at })
    );
    (recentOrdersRaw.data || []).forEach(o =>
      recentActivity.push({ type: 'order_created', message: `New order placed (ID: ${o.id})`, time: o.created_at })
    );
    (recentFeedbackRaw.data || []).forEach(f =>
      recentActivity.push({
        type: 'feedback_created',
        message: `New feedback submitted by ${f.user_name || 'Anonymous'}${f.rating ? ` (Rating: ${f.rating})` : ''}`,
        time: f.created_at
      })
    );

    recentActivity.sort((a, b) => new Date(b.time) - new Date(a.time));

    await logActivity(req.user?.id, 'view_analytics', 'Admin viewed analytics summary');

    return res.status(200).json({
      users,
      gifts,
      recentUsers,
      ai,
      wishlists,
      feedback: feedbackSummary,
      salesTrends,
      deliveredOrdersTrends,
      recentActivity
    });
  } catch (err) {
    console.error('Analytics summary error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

module.exports = { summary };
