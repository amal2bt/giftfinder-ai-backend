const supabase = require('../config/supabaseClient');

// ------------------ Helper Functions ------------------
async function logActivity(userId, type, message) {
  try {
    await supabase.from('activity_logs').insert([{ user_id: userId || null, type, message }]);
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}

// ====================================================
// 📌 1. Enhanced List Feedback (Admin + Pagination)
// ====================================================
async function listFeedback(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || "";
    const ratingFilter = req.query.rating || "";
    const startDate = req.query.start_date || "";
    const endDate = req.query.end_date || "";
    const sort = req.query.sort || "newest"; // NEW — "newest" or "oldest"

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('feedback')
      .select('*', { count: 'exact' })
      .range(from, to);

    // Sorting
    if (sort === "oldest") {
      query = query.order('created_at', { ascending: true });
    } else {
      query = query.order('created_at', { ascending: false });
    }

    // Search filter
    if (search.trim() !== "") {
      query = query.or(`user_name.ilike.%${search}%,comment.ilike.%${search}%`);
    }

    // Rating filter
    if (ratingFilter) {
      query = query.eq('rating', ratingFilter);
    }

    // Date filters
    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      query = query.lte('created_at', endDate);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error("Error fetching feedback:", error);
      return res.status(500).json({ message: "Failed to fetch feedback" });
    }

    // Activity log (optional)
    if (req.user?.id) {
      await logActivity(req.user.id, 'view_feedback', `Viewed feedback page ${page}`);
    }

    return res.status(200).json({
      feedback: data,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });

  } catch (err) {
    console.error('listFeedback error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// ====================================================
// 📌 2. Create Feedback (Mobile App)
// ====================================================
async function createFeedback(req, res) {
  try {
    const { user_name, rating, comment } = req.body;

    if (!comment || comment.trim() === '') {
      return res.status(400).json({ error: 'Comment is required.' });
    }
    if (rating && (rating < 1 || rating > 5)) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    }

    const { data, error } = await supabase
      .from('feedback')
      .insert([
        {
          user_name: user_name || null,
          rating: rating || null,
          comment,
        },
      ])
      .select();

    if (error) {
      console.error("Error inserting feedback:", error);
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Duplicate feedback ID detected.' });
      }
      return res.status(500).json({ error: "Failed to submit feedback." });
    }

    // Log activity
    await logActivity(req.user?.id, 'create_feedback', `User submitted feedback${comment ? `: "${comment}"` : ''}`);

    return res.status(201).json({
      message: "Feedback submitted successfully",
      feedback: data[0],
    });
  } catch (err) {
    console.error("createFeedback error:", err);
    return res.status(500).json({ error: "Server error submitting feedback." });
  }
}

module.exports = { listFeedback, createFeedback };
