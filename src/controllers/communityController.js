const supabase = require('../config/supabaseClient');
const { containsBadWords } = require('../utils/badWords');

async function ensureUser(req) {
  const userId = req.user && req.user.id;
  if (!userId) return { ok: false, status: 401, message: 'Unauthorized' };
  return { ok: true, userId };
}

async function ensureAdmin(userId) {
  const { data: user, error } = await supabase
    .from('users')
    .select('id, role')
    .eq('id', userId)
    .single();

  if (error || !user) return { ok: false, status: 401, message: 'Unauthorized' };
  if (!user.role || user.role.toLowerCase() !== 'admin') {
    return { ok: false, status: 403, message: 'Admin role required' };
  }
  return { ok: true };
}

// ----------------------------
// GET ALL IDEAS
// ----------------------------
async function getIdeas(req, res) {
  try {
    const auth = await ensureUser(req);
    // Treat /my-ideas as \"mine\" even without query param
    const mine = req.query.mine === 'true' || req.path.includes('my-ideas');
    let query = supabase
      .from('community_ideas')
      .select(`
        *,
        users:user_id (id, username, email, profile_picture_url),
        comments:community_comments(count)
      `)
      .order('created_at', { ascending: false });

    if (mine) {
      if (!auth.ok) return res.status(auth.status).json({ message: auth.message });
      query = query.eq('user_id', auth.userId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const ideas = data.map((idea) => ({
      ...idea,
      comments_count: idea.comments && idea.comments[0] ? idea.comments[0].count : 0,
    }));

    res.status(200).json(ideas);
  } catch (err) {
    console.error('getIdeas error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}

// ----------------------------
// CREATE IDEA
// ----------------------------
async function createIdea(req, res) {
  try {
    const auth = await ensureUser(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });
    const { userId } = auth;
    const { description } = req.body;

    if (!description) return res.status(400).json({ message: 'Description required' });

    // Check for bad words and flag if found
    const isFlagged = containsBadWords(description);

    const { data, error } = await supabase
      .from('community_ideas')
      .insert([{ user_id: userId, description, likes_count: 0, is_flagged: isFlagged }])
      .select(`*, users:user_id (id, username, email, profile_picture_url)`)
      .single();

    if (error) throw error;

    res.status(201).json({ message: 'Idea created', idea: data });
  } catch (err) {
    console.error('createIdea error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}

// ----------------------------
// UPDATE IDEA
// ----------------------------
async function updateIdea(req, res) {
  try {
    const auth = await ensureUser(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });
    const { userId } = auth;

    const { ideaId } = req.params;
    const { description } = req.body;

    // Validate input
    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return res.status(400).json({ message: 'Description is required and cannot be empty' });
    }

    // Parse ideaId to number (Supabase expects number for BIGSERIAL)
    const ideaIdNum = parseInt(ideaId, 10);
    if (isNaN(ideaIdNum)) {
      return res.status(400).json({ message: 'Invalid idea ID' });
    }

    // Check if idea exists and user owns it
    const { data: oldIdea, error: fetchError } = await supabase
      .from('community_ideas')
      .select('user_id, description')
      .eq('id', ideaIdNum)
      .single();

    if (fetchError || !oldIdea) {
      return res.status(404).json({ message: 'Idea not found' });
    }

    if (oldIdea.user_id !== userId) {
      return res.status(403).json({ message: 'Forbidden: You can only edit your own ideas' });
    }

    // Check for bad words and flag if found
    const isFlagged = containsBadWords(description.trim());

    // Update the idea
    const { data, error } = await supabase
      .from('community_ideas')
      .update({
        description: description.trim(),
        is_flagged: isFlagged,
      })
      .eq('id', ideaIdNum)
      .select(`*, users:user_id (id, username, email, profile_picture_url)`)
      .single();

    if (error) {
      console.error('Supabase update error:', error);
      return res.status(500).json({ message: 'Failed to update idea', error: error.message });
    }

    res.json({ message: 'Idea updated', idea: data });
  } catch (err) {
    console.error('updateIdea error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}

// ----------------------------
// DELETE IDEA
// ----------------------------
// ----------------------------
// DELETE IDEA
// ----------------------------
async function deleteIdea(req, res) {
  try {
    const auth = await ensureUser(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });
    const { userId } = auth;

    const { ideaId } = req.params;

    // Parse ideaId to number
    const ideaIdNum = parseInt(ideaId, 10);
    if (isNaN(ideaIdNum)) {
      return res.status(400).json({ message: 'Invalid idea ID' });
    }

    const { data: idea, error: fetchError } = await supabase
      .from('community_ideas')
      .select('user_id, image')
      .eq('id', ideaIdNum)
      .single();

    if (fetchError || !idea) {
      return res.status(404).json({ message: 'Idea not found' });
    }

    // Check if user is admin
    const adminCheck = await ensureAdmin(userId);
    const isAdmin = adminCheck.ok;

    // Determine if admin route (for backward compatibility)
    const isAdminRoute = req.originalUrl.includes('/admin/');

    // Allow deletion if:
    // 1. User is admin (regardless of route)
    // 2. User owns the idea (and not admin route)
    // 3. It's an admin route (for backward compatibility)
    if (!isAdmin && !isAdminRoute && idea.user_id !== userId) {
      return res.status(403).json({ message: 'Forbidden: You can only delete your own ideas' });
    }

    // Remove image from storage if exists
    if (idea.image) {
      const oldPath = idea.image.split('/idea/').pop();
      if (oldPath) {
        try {
          await supabase.storage.from('idea').remove([oldPath]);
        } catch (storageError) {
          console.error('Error deleting image from storage:', storageError);
          // Continue with deletion even if image removal fails
        }
      }
    }

    const { error: deleteError } = await supabase
      .from('community_ideas')
      .delete()
      .eq('id', ideaIdNum);

    if (deleteError) {
      console.error('Error deleting idea:', deleteError);
      return res.status(500).json({ message: 'Failed to delete idea' });
    }

    res.json({ message: 'Idea deleted' });
  } catch (err) {
    console.error('deleteIdea error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}



// ----------------------------
// LIKE IDEA
// ----------------------------
async function likeIdea(req, res) {
  try {
    const auth = await ensureUser(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });
    const { userId } = auth;

    const { ideaId } = req.params;

    const { data: existing } = await supabase
      .from('community_idea_likes')
      .select('id')
      .eq('idea_id', ideaId)
      .eq('user_id', userId)
      .maybeSingle();

    const { data: idea } = await supabase
      .from('community_ideas')
      .select('likes_count')
      .eq('id', ideaId)
      .single();

    let newCount = idea.likes_count;

    if (existing) {
      await supabase.from('community_idea_likes').delete().eq('id', existing.id);
      newCount--;
    } else {
      await supabase.from('community_idea_likes').insert([{ idea_id: ideaId, user_id: userId }]);
      newCount++;
    }

    await supabase.from('community_ideas').update({ likes_count: newCount }).eq('id', ideaId);

    res.json({
      message: existing ? 'Idea unliked' : 'Idea liked',
      liked: !existing,
      likes_count: newCount,
    });
  } catch (err) {
    console.error('likeIdea error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}

// ----------------------------
// COMMENTS
// ----------------------------
async function getComments(req, res) {
  try {
    const { ideaId } = req.params;

    const { data, error } = await supabase
      .from('community_comments')
      .select(`*, users:user_id (id, username, email)`)
      .eq('idea_id', ideaId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('getComments error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}

async function addComment(req, res) {
  try {
    const auth = await ensureUser(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });
    const { userId } = auth;

    const { ideaId } = req.params;
    const { comment } = req.body;

    const { data, error } = await supabase
      .from('community_comments')
      .insert([{ idea_id: ideaId, user_id: userId, comment }])
      .select(`*, users:user_id (id, username, email)`)
      .single();

    if (error) throw error;

    res.json({ message: 'Comment added', comment: data });
  } catch (err) {
    console.error('addComment error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}

// ----------------------------
// DELETE ALL FLAGGED IDEAS (Admin only)
// ----------------------------
async function deleteAllFlagged(req, res) {
  try {
    const auth = await ensureUser(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });
    const { userId } = auth;

    // Check if user is admin
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: Admin access required' });
    }

    // Get all flagged ideas
    const { data: flaggedIdeas, error: fetchError } = await supabase
      .from('community_ideas')
      .select('id, image')
      .eq('is_flagged', true);

    if (fetchError) throw fetchError;

    if (!flaggedIdeas || flaggedIdeas.length === 0) {
      return res.json({ message: 'No flagged ideas found', deleted_count: 0 });
    }

    // Delete images from storage if they exist
    for (const idea of flaggedIdeas) {
      if (idea.image) {
        const oldPath = idea.image.split('/idea/').pop();
        if (oldPath) {
          await supabase.storage.from('idea').remove([oldPath]);
        }
      }
    }

    // Delete all flagged ideas
    const { error: deleteError } = await supabase
      .from('community_ideas')
      .delete()
      .eq('is_flagged', true);

    if (deleteError) throw deleteError;

    res.json({
      message: `Deleted ${flaggedIdeas.length} flagged idea(s)`,
      deleted_count: flaggedIdeas.length,
    });
  } catch (err) {
    console.error('deleteAllFlagged error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}

module.exports = {
  getIdeas,
  createIdea,
  updateIdea,
  deleteIdea,
  likeIdea,
  getComments,
  addComment,
  deleteAllFlagged,
};
