const supabase = require('../config/supabaseClient');

// ------------------ Helper Functions ------------------
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

function getPublicImageUrl(path) {
  if (!path) return null;
  return process.env.SUPABASE_URL + '/storage/v1/object/public/gift-images/' + path.split('gift-images/').pop();
}

async function logActivity(userId, type, message) {
  try {
    await supabase.from('activity_logs').insert([
      { user_id: userId || null, type, message }
    ]);
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}

// ------------------ Gift Controllers ------------------

async function listGifts(req, res) {
  try {
    const q = (req.query.q || '').trim();
    const interests = (req.query.interests || '').trim();
    const budget = req.query.budget;
    const relationship = req.query.relationship;
    const emotion = req.query.emotion;

    let query = supabase
      .from('gifts')
      .select('id, name, category, price, stock, image, created_at, updated_at')
      .order('created_at', { ascending: false });

    const searchTerm = interests || q;
    if (searchTerm) {
      const like = `%${searchTerm}%`;
      query = query.or(`name.ilike.${like},category.ilike.${like}`);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching gifts:', error);
      return res.status(500).json({ message: 'Failed to fetch gifts' });
    }

    let filtered = data || [];
    if (budget && budget !== 'No limit') {
      const budgetMap = {
        'Under $20': { max: 20 },
        '$20–$50': { min: 20, max: 50 },
        '$50–$100': { min: 50, max: 100 },
      };
      const budgetRange = budgetMap[budget];
      if (budgetRange) {
        filtered = filtered.filter(g => {
          const price = parseFloat(g.price) || 0;
          if (budgetRange.min !== undefined && budgetRange.max !== undefined) {
            return price >= budgetRange.min && price <= budgetRange.max;
          } else if (budgetRange.max !== undefined) {
            return price <= budgetRange.max;
          }
          return true;
        });
      }
    }

    filtered = filtered.slice(0, 100);

    if (interests || budget || relationship || emotion) {
      return res.status(200).json(filtered);
    } else {
      return res.status(200).json({ gifts: filtered });
    }
  } catch (err) {
    console.error('listGifts error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function createGift(req, res) {
  try {
    const { name, category, price, stock } = req.body;
    let image = req.body.image || null;
    if (!name || !category || price === undefined || stock === undefined) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const auth = await ensureAdmin(req.user?.id);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    // Handle file upload (using express-fileupload)
    let imageUrl = null;
    if (req.files && req.files.image) {
      const file = Array.isArray(req.files.image) ? req.files.image[0] : req.files.image;
      const ext = file.name.split('.').pop();
      const filePath = `${Date.now()}-${Math.round(Math.random()*1e6)}.${ext}`;
      const { data, error } = await supabase.storage.from('gift-images').upload(filePath, file.data, { contentType: file.mimetype });
      if (error) {
        console.error('Supabase Storage upload error:', error);
        return res.status(500).json({ message: 'Failed to upload image' });
      }
      imageUrl = getPublicImageUrl(data?.path);
    }

    const { data, error } = await supabase.from('gifts').insert([
      {
        name,
        category,
        price: Number(price),
        stock: Number(stock),
        image: imageUrl || image,
        created_by: req.user?.id || null,
      }
    ]).select('id, name, category, price, stock, image, created_at, updated_at').single();

    if (error) {
      console.error('Gift insert error:', error);
      return res.status(500).json({ message: 'Failed to create gift' });
    }

    await logActivity(
      req.user?.id,
      'create_gift',
      `Created gift "${data.name}" (ID: ${data.id}, category: ${data.category}, price: ${data.price}, stock: ${data.stock})`
    );

    res.status(201).json({ message: 'Gift created', gift: data });
  } catch (err) {
    console.error('createGift error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}

async function updateGift(req, res) {
  try {
    const { id } = req.params;
    const { name, category, price, stock } = req.body;

    if (!id) return res.status(400).json({ message: 'Gift ID is required' });

    const auth = await ensureAdmin(req.user?.id);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    const { data: oldGift, error: oldGiftError } = await supabase.from('gifts').select('image').eq('id', id).single();
    if (oldGiftError || !oldGift) return res.status(404).json({ message: 'Gift not found' });

    let imageUrl = oldGift.image;

    // Handle file upload (using express-fileupload)
    if (req.files && req.files.image) {
      if (oldGift.image && oldGift.image.includes('gift-images/')) {
        const path = oldGift.image.split('/gift-images/').pop();
        await supabase.storage.from('gift-images').remove([path]);
      }
      const file = Array.isArray(req.files.image) ? req.files.image[0] : req.files.image;
      const ext = file.name.split('.').pop();
      const filePath = `${Date.now()}-${Math.round(Math.random()*1e6)}.${ext}`;
      const { data, error } = await supabase.storage.from('gift-images').upload(filePath, file.data, { contentType: file.mimetype });
      if (error) {
        console.error('Supabase Storage upload error (update):', error);
        return res.status(500).json({ message: 'Failed to upload new image' });
      }
      imageUrl = getPublicImageUrl(data?.path);
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (category !== undefined) updateData.category = category;
    if (price !== undefined) updateData.price = Number(price);
    if (stock !== undefined) updateData.stock = Number(stock);
    if (imageUrl !== undefined) updateData.image = imageUrl;

    const { data, error } = await supabase.from('gifts').update(updateData).eq('id', id)
      .select('id, name, category, price, stock, image, created_at, updated_at').single();

    if (error) {
      console.error('Gift update error:', error);
      return res.status(500).json({ message: 'Failed to update gift' });
    }

    await logActivity(
      req.user?.id,
      'update_gift',
      `Updated gift ID ${id}: ${JSON.stringify(updateData)}`
    );

    return res.status(200).json({ message: 'Gift updated', gift: data });
  } catch (err) {
    console.error('updateGift error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function deleteGift(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'Gift ID is required' });

    const auth = await ensureAdmin(req.user?.id);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    const { error } = await supabase.from('gifts').delete().eq('id', id);
    if (error) {
      console.error('Gift delete error:', error);
      return res.status(500).json({ message: 'Failed to delete gift' });
    }

    await logActivity(
      req.user?.id,
      'delete_gift',
      `Deleted gift ID ${id}`
    );

    return res.status(200).json({ message: 'Gift deleted' });
  } catch (err) {
    console.error('deleteGift error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

module.exports = {
  listGifts,
  createGift,
  updateGift,
  deleteGift,
};
