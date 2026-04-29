const supabase = require('../config/supabaseClient');
const bcrypt = require('bcrypt');

// Helper function to get public image URL
function getPublicImageUrl(path) {
  if (!path) return null;
  const supabaseUrl = process.env.SUPABASE_URL;
  return `${supabaseUrl}/storage/v1/object/public/prof-picture/${path}`;
}

// Get current user profile
async function getProfile(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { data, error } = await supabase
      .from('users')
      .select('id, username, email, profile_picture_url, created_at')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json({
      user: {
        id: data.id,
        username: data.username,
        email: data.email,
        profile_picture_url: data.profile_picture_url,
        created_at: data.created_at,
      },
    });
  } catch (err) {
    console.error('getProfile error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// Update profile (name, password, profile picture)
async function updateProfile(req, res) {
  try {
    // Log that we received the request
    console.log('[PROFILE UPDATE] Request received');
    console.log('[PROFILE UPDATE] Method:', req.method);
    console.log('[PROFILE UPDATE] Content-Type:', req.headers['content-type']);
    console.log('[PROFILE UPDATE] Content-Length:', req.headers['content-length']);
    
    const userId = req.user?.id;
    if (!userId) {
      console.log('[PROFILE UPDATE] No user ID found');
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Debug: Log what we're receiving
    console.log('[PROFILE UPDATE] Body keys:', req.body ? Object.keys(req.body) : 'none');
    console.log('[PROFILE UPDATE] Files keys:', req.files ? Object.keys(req.files) : 'none');
    
    // Try to stringify body safely (might contain circular refs or large data)
    try {
      const bodyPreview = req.body ? JSON.stringify(req.body).substring(0, 200) : 'null';
      console.log('[PROFILE UPDATE] Body preview:', bodyPreview);
    } catch (e) {
      console.log('[PROFILE UPDATE] Could not stringify body');
    }

    // Get current user data to compare
    const { data: currentUser, error: currentUserError } = await supabase
      .from('users')
      .select('username')
      .eq('id', userId)
      .single();

    if (currentUserError || !currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Parse form data - express-fileupload should put form fields in req.body
    // But if it's empty, the data might be in a different format
    const body = req.body || {};
    const username = body.username;
    const password = body.password;
    const currentPassword = body.currentPassword;
    
    const updateData = {};

    // Update username if provided and different from current
    if (username && username.trim() && username.trim() !== currentUser.username) {
      // Check if username is already taken by another user
      const { data: existingUser, error: checkError } = await supabase
        .from('users')
        .select('id')
        .eq('username', username.trim())
        .neq('id', userId)
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        console.error('Username check error:', checkError);
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (existingUser) {
        return res.status(400).json({ message: 'Username already taken' });
      }

      updateData.username = username.trim();
    }

    // Update password if provided
    if (password && password.trim()) {
      if (!currentPassword) {
        return res.status(400).json({ message: 'Current password is required to change password' });
      }

      // Verify current password
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('password')
        .eq('id', userId)
        .single();

      if (userError || !user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const isValidPassword = await bcrypt.compare(currentPassword, user.password);
      if (!isValidPassword) {
        return res.status(400).json({ message: 'Current password is incorrect' });
      }

      // Hash new password
      updateData.password = await bcrypt.hash(password.trim(), 10);
    }

    // Handle profile picture upload (using express-fileupload)
    let profilePictureUrl = null;
    
    // Check if file is in req.files (proper multipart/form-data)
    if (req.files && req.files.profilePicture) {
      const file = Array.isArray(req.files.profilePicture) 
        ? req.files.profilePicture[0] 
        : req.files.profilePicture;
      
      const ext = file.name.split('.').pop();
      const filePath = `${userId}-${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;

      // Upload to Supabase storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('prof-picture')
        .upload(filePath, file.data, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (uploadError) {
        console.error('Supabase Storage upload error:', uploadError);
        return res.status(500).json({ message: 'Failed to upload profile picture' });
      }

      profilePictureUrl = getPublicImageUrl(uploadData.path);

      // Delete old profile picture if exists
      const { data: oldUser } = await supabase
        .from('users')
        .select('profile_picture_url')
        .eq('id', userId)
        .single();

      if (oldUser && oldUser.profile_picture_url) {
        const oldPath = oldUser.profile_picture_url.split('/prof-picture/').pop();
        if (oldPath) {
          try {
            await supabase.storage.from('prof-picture').remove([oldPath]);
          } catch (deleteError) {
            console.error('Error deleting old profile picture:', deleteError);
            // Don't fail the update if deletion fails
          }
        }
      }

      updateData.profile_picture_url = profilePictureUrl;
    } else if (body.profilePicture && typeof body.profilePicture === 'object' && body.profilePicture.uri) {
      // Fallback: File came in body as JSON (React Native FormData issue)
      // This shouldn't happen, but we'll handle it gracefully
      console.warn('Profile picture received in body instead of files - this indicates a FormData issue');
      return res.status(400).json({ 
        message: 'File upload format error. Please ensure the app is using the latest version.' 
      });
    }

    // Update user if there's data to update
    if (Object.keys(updateData).length > 0) {
      const { data: updatedUser, error: updateError } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', userId)
        .select('id, username, email, profile_picture_url, created_at')
        .single();

      if (updateError) {
        console.error('User update error:', updateError);
        return res.status(500).json({ message: 'Failed to update profile' });
      }

      return res.status(200).json({
        message: 'Profile updated successfully',
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          email: updatedUser.email,
          profile_picture_url: updatedUser.profile_picture_url,
          created_at: updatedUser.created_at,
        },
      });
    }

    // Return success with current user data when no changes are needed
    const { data: currentUserData, error: fetchError } = await supabase
      .from('users')
      .select('id, username, email, profile_picture_url, created_at')
      .eq('id', userId)
      .single();
    
    if (fetchError || !currentUserData) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    return res.status(200).json({
      message: 'No changes were made',
      user: {
        id: currentUserData.id,
        username: currentUserData.username,
        email: currentUserData.email,
        profile_picture_url: currentUserData.profile_picture_url,
        created_at: currentUserData.created_at,
      },
    });
  } catch (err) {
    console.error('[PROFILE UPDATE] Error:', err);
    console.error('[PROFILE UPDATE] Error stack:', err.stack);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
}

module.exports = {
  getProfile,
  updateProfile,
};

