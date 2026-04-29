const supabase = require('../config/supabaseClient');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');

// Helper: generate 6-digit code
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
const jwt = require('jsonwebtoken');

function generateToken(user) {
  const expiresIn = process.env.JWT_EXPIRES_IN || '2h';
  return jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn }
  );
}

function generateRefreshToken(user) {
  const refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '30d';
  return jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: refreshExpiresIn }
  );
}


// Helper: send email using env variables
async function sendEmail(to, subject, text) {
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
    from: `"Your App" <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
  });
}

async function signup(req, res) {
  console.log('✅ Signup endpoint called with data:', req.body);
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Check if email already exists
   const { data: existingUser, error: findError } = await supabase
  .from('users')
  .select('id')
  .eq('email', email)
  .single();

if (findError && findError.code !== 'PGRST116') {
  console.error('Unexpected error during user lookup:', findError);
  return res.status(500).json({ message: 'Internal server error' });
}

if (existingUser) {
  return res.status(400).json({ message: 'Email already registered' });
}


    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user and return inserted record
  // Insert new user and return inserted record
const { data, error } = await supabase
  .from('users')
  .insert([{ username, email, password: hashedPassword, is_verified: false, password_changed_at: new Date().toISOString() }])
  .select()
  .single();

if (error) {
  console.error('User insert error:', error);
  return res.status(500).json({ message: 'Failed to create user' });
}

// Log activity
await supabase.from('activity_logs').insert({
  user_id: data.id,
  type: 'user_created',
  message: `New user registered: ${data.username}`
});


    console.log('User inserted:', data);

    // Generate verification code & expiry
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // Save verification code in DB
    const { error: codeInsertError } = await supabase
      .from('email_verification_codes')
      .insert([{ user_id: data.id, code, expires_at: expiresAt, used: false }]);

    if (codeInsertError) {
      console.error("❌ Verification code insert error:", codeInsertError);
      return res.status(500).json({ message: 'Failed to generate verification code' });
    }

    // Send verification email
    await sendEmail(email, 'Your Verification Code', `Your verification code is: ${code}`);

    // Respond success
    res.status(201).json({
      message: 'User created and verification code sent',
      user: {
        id: data.id,
        username: data.username,
        email: data.email,
      },
    });

  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}

async function sendVerificationCode(req, res) {
  try {
    const { userId, email } = req.body;

    if (!userId || !email) {
      return res.status(400).json({ message: 'Missing userId or email' });
    }

    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from('email_verification_codes')
      .insert([{ user_id: userId, code, expires_at: expiresAt, used: false }]);

    if (error) return res.status(500).json({ message: error.message });

    // Send verification email with the code
    await sendEmail(email, 'Your Verification Code', `Your verification code is: ${code}`);

    res.status(200).json({ message: 'Verification code sent' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
}
async function verifyCode(req, res) {
  try {
    const { userId, code } = req.body;

    if (!userId || !code) {
      return res.status(400).json({ message: 'Missing userId or code' });
    }

    console.log('🔍 Attempting to verify code', { userId, code });

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('email_verification_codes')
      .select('*')
      .eq('user_id', userId)
      .eq('code', code)
      .eq('used', false)
      .gte('expires_at', now)
      .single();

    if (error || !data) {
      console.log('❌ Verification failed: code not found or invalid', { error });
      return res.status(400).json({ message: 'Invalid or expired code' });
    }

    // Mark the code as used
    const { error: updateError } = await supabase
      .from('email_verification_codes')
      .update({ used: true })
      .eq('id', data.id);

    if (updateError) {
      console.error('❌ Failed to update code to used', updateError);
      return res.status(500).json({ message: updateError.message });
    }

    // Update user as verified
    const { data: user, error: userUpdateError } = await supabase
      .from('users')
      .update({ is_verified: true })
      .eq('id', userId)
      .select()
      .single();

    if (userUpdateError) {
      console.error('❌ Failed to update user verification status', userUpdateError);
      return res.status(500).json({ message: userUpdateError.message });
    }

    console.log('✅ Email verified for user:', userId);

    // Generate token for the user
    const token = generateToken(user);

    // Return success with token and user info for auto-login
    res.status(200).json({
      message: 'Email verified successfully',
    token,
    refreshToken: generateRefreshToken(user),
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (err) {
    console.error('🔥 Unexpected error in verifyCode:', err);
    res.status(500).json({ message: 'Server error' });
  }
}

async function login(req, res) {
  try {
    const { identifier, password } = req.body; // identifier can be username or email

    if (!identifier || !password) {
      return res.status(400).json({ message: 'Missing username/email or password' });
    }

    // Query by email or username
    const ident = String(identifier).trim();
    let { data: user, error } = await supabase
      .from('users')
      .select('*')
      .or(`email.ilike.${ident},username.ilike.${ident}`)
      .single();

    if (error || !user) {
      if (error) console.warn('Login user lookup error:', error);
      return res.status(400).json({ message: 'Invalid username/email or password' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid username/email or password' });
    }

    if (!user.is_verified) {
      return res.status(403).json({ message: 'User not verified' });
    }

    // Enforce admin-only access
    if (!user.role || user.role.toLowerCase() !== 'admin') {
      return res.status(403).json({ message: 'Access denied: admin role required' });
    }

    const token = generateToken(user);

    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
      token,
      refreshToken: generateRefreshToken(user),
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}

async function mobileLogin(req, res) {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ message: 'Missing username/email or password' });
    }

    const ident = String(identifier).trim();
    let { data: user, error } = await supabase
      .from('users')
      .select('*')
      .or(`email.ilike.${ident},username.ilike.${ident}`)
      .single();

    if (error || !user) {
      if (error) console.warn('Mobile login user lookup error:', error);
      return res.status(400).json({ message: 'Invalid username/email or password' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid username/email or password' });
    }

    if (!user.is_verified) {
      return res.status(403).json({ message: 'User not verified' });
    }

    // No admin role enforcement here; mobile app supports role 'user'
    const token = generateToken(user);

    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
      token,
      refreshToken: generateRefreshToken(user),
    });

  } catch (err) {
    console.error('Mobile login error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    // find user by email
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (userError || !user) {
      // Optional: don't reveal whether email exists
      return res.status(200).json({ message: 'If that email exists, a reset code was sent.' });
    }

    // generate reset code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // valid for 15 minutes

    // insert into password_reset_codes
    const { error: insertError } = await supabase
      .from('password_reset_codes')
      .insert([{ user_id: user.id, code: resetCode, expires_at: expiresAt, used: false }]);

    if (insertError) {
      console.error('Reset code insert error:', insertError);
      return res.status(500).json({ message: 'Could not generate reset code' });
    }

    // send email with reset code
    await sendEmail(
      email,
      'Your Password Reset Code',
      `Here is your password reset code: ${resetCode}`
    );

    return res.status(200).json({ message: 'If the email exists, a reset code was sent' });
  } catch (err) {
    console.error('forgotPassword error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function resetPassword(req, res) {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ message: 'Missing email, code, or new password' });
    }

    // find user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (userError || !user) {
      return res.status(400).json({ message: 'Invalid email or code' });
    }

    const now = new Date().toISOString();

    // find reset code record
    const { data: resetRecord, error: codeError } = await supabase
      .from('password_reset_codes')
      .select('*')
      .eq('user_id', user.id)
      .eq('code', code)
      .eq('used', false)
      .gte('expires_at', now)
      .single();

    if (codeError || !resetRecord) {
      console.error('resetPassword code validation error', codeError);
      return res.status(400).json({ message: 'Invalid or expired reset code' });
    }

    // update user password and password_changed_at timestamp
    const hashed = await bcrypt.hash(newPassword, 10);
    const { error: updateUserError } = await supabase
      .from('users')
      .update({ 
        password: hashed,
        password_changed_at: new Date().toISOString()
      })
      .eq('id', user.id);

    if (updateUserError) {
      console.error('Failed to update password:', updateUserError);
      return res.status(500).json({ message: 'Failed to update password' });
    }

    // mark reset code used
    const { error: markUsedError } = await supabase
      .from('password_reset_codes')
      .update({ used: true })
      .eq('id', resetRecord.id);

    if (markUsedError) {
      console.error('Failed to mark reset code used:', markUsedError);
      // not critical to block success
    }

    return res.status(200).json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('resetPassword error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function refresh(req, res) {
  try {
    const provided = req.body?.refreshToken || req.headers['x-refresh-token'] || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : undefined);
    if (!provided) return res.status(400).json({ message: 'Missing refresh token' });

    let decoded;
    try {
      decoded = jwt.verify(provided, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.id)
      .single();
    if (error || !user) return res.status(401).json({ message: 'User not found' });
    if (!user.is_verified) return res.status(403).json({ message: 'User not verified' });

    const token = generateToken(user);
    return res.status(200).json({ token });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
}

// User management functions
async function getAllUsers(req, res) {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, username, email, role, is_verified, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching users:', error);
      return res.status(500).json({ message: 'Failed to fetch users' });
    }

    res.status(200).json({ users });
  } catch (err) {
    console.error('getAllUsers error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}

async function createUser(req, res) {
  try {
    const { username, email, password, role } = req.body;

    if (!username || !email || !password || !role) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Check if email or username already exists
    const { data: existingUser, error: findError } = await supabase
      .from('users')
      .select('id')
      .or(`email.eq.${email},username.eq.${username}`)
      .single();

    if (findError && findError.code !== 'PGRST116') {
      console.error('Unexpected error during user lookup:', findError);
      return res.status(500).json({ message: 'Internal server error' });
    }

    if (existingUser) {
      return res.status(400).json({ message: 'Email or username already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user
    const { data, error } = await supabase
      .from('users')
      .insert([{ 
        username, 
        email, 
        password: hashedPassword, 
        role, 
        is_verified: true,
        password_changed_at: new Date().toISOString()
      }])
      .select('id, username, email, role, is_verified, created_at')
      .single();

    if (error) {
      console.error('User insert error:', error);
      return res.status(500).json({ message: 'Failed to create user' });
    }

    res.status(201).json({
      message: 'User created successfully',
      user: data
    });

  } catch (err) {
    console.error('createUser error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}

async function updateUser(req, res) {
  try {
    const { id } = req.params;
    const { username, email, password, role } = req.body;

    if (!id) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    // Check if user exists
    const { data: existingUser, error: findError } = await supabase
      .from('users')
      .select('id')
      .eq('id', id)
      .single();

    if (findError || !existingUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Prepare update data
    const updateData = {};
    if (username) updateData.username = username;
    if (email) updateData.email = email;
    if (role) updateData.role = role;
    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
      updateData.password_changed_at = new Date().toISOString();
    }

    // Check for conflicts if updating email or username
    if (username || email) {
      const conflictQuery = [];
      if (username) conflictQuery.push(`username.eq.${username}`);
      if (email) conflictQuery.push(`email.eq.${email}`);
      
      const { data: conflictUser, error: conflictError } = await supabase
        .from('users')
        .select('id')
        .or(conflictQuery.join(','))
        .neq('id', id)
        .single();

      if (conflictError && conflictError.code !== 'PGRST116') {
        console.error('Conflict check error:', conflictError);
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (conflictUser) {
        return res.status(400).json({ message: 'Email or username already exists' });
      }
    }

    // Update user
    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', id)
      .select('id, username, email, role, is_verified, created_at')
      .single();

    if (error) {
      console.error('User update error:', error);
      return res.status(500).json({ message: 'Failed to update user' });
    }

    res.status(200).json({
      message: 'User updated successfully',
      user: data
    });

  } catch (err) {
    console.error('updateUser error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}

// Delete a user (admin only)
async function deleteUser(req, res) {
  try {
    // Assume req.user is set by auth middleware and contains id and probably role
    // Fetch user role from DB to be strict
    const requesterId = req.user?.id;
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'User ID is required' });
    // Only an admin can delete users
    const { data: requestingUser, error: reqErr } = await supabase
      .from('users')
      .select('role')
      .eq('id', requesterId)
      .single();
    if (reqErr || !requestingUser) {
      return res.status(401).json({ message: 'Unauthorized, bad token?' });
    }
    if (requestingUser.role !== 'admin') {
      return res.status(403).json({ message: 'Admin only' });
    }
    // Do not allow admin to delete themself
    if (requesterId === id) {
      return res.status(400).json({ message: "Admins can't delete themselves" });
    }
    // Try to delete
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', id);
    if (error) {
      console.error('Delete user error:', error);
      return res.status(500).json({ message: 'Failed to delete user' });
    }
    return res.status(200).json({ message: 'User deleted' });
  } catch (err) {
    console.error('deleteUser error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

module.exports = {
  signup,
  sendVerificationCode,
  verifyCode,
  login,
  mobileLogin,
  forgotPassword,
  resetPassword,
  refresh,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser
};
