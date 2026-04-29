const supabase = require('../config/supabaseClient');

async function getCart(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { data, error } = await supabase
      .from('cart')
      .select('gift_id, quantity, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching cart:', error);
      return res.status(500).json({ message: 'Failed to fetch cart' });
    }

    // Get gift details including stock for each cart item
    if (data && data.length > 0) {
      const giftIds = data.map(item => item.gift_id);
      const { data: gifts, error: giftsError } = await supabase
        .from('gifts')
        .select('id, stock')
        .in('id', giftIds);

      if (!giftsError && gifts) {
        // Add stock info to cart items
        const enrichedData = data.map(item => {
          const gift = gifts.find(g => g.id === item.gift_id);
          return {
            ...item,
            stock: gift?.stock || 0,
          };
        });
        return res.status(200).json(enrichedData);
      }
    }

    return res.status(200).json(data || []);
  } catch (err) {
    console.error('getCart error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function addToCart(req, res) {
  try {
    const userId = req.user?.id;
    const { giftId } = req.params;
    const { quantity = 1 } = req.body;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!giftId) {
      return res.status(400).json({ message: 'Gift ID is required' });
    }

    // Check if gift exists
    const { data: gift, error: giftError } = await supabase
      .from('gifts')
      .select('id, stock')
      .eq('id', giftId)
      .single();

    if (giftError || !gift) {
      return res.status(404).json({ message: 'Gift not found' });
    }

    // Check if already in cart
    const { data: existing, error: checkError } = await supabase
      .from('cart')
      .select('id, quantity')
      .eq('user_id', userId)
      .eq('gift_id', giftId)
      .single();

    if (existing) {
      // Update quantity
      const newQuantity = existing.quantity + Number(quantity);
      if (newQuantity > gift.stock) {
        return res.status(400).json({ message: 'Insufficient stock' });
      }

      const { data, error } = await supabase
        .from('cart')
        .update({ quantity: newQuantity })
        .eq('id', existing.id)
        .select('gift_id, quantity')
        .single();

      if (error) {
        console.error('Error updating cart:', error);
        return res.status(500).json({ message: 'Failed to update cart' });
      }

      return res.status(200).json({ message: 'Cart updated', gift_id: giftId, quantity: newQuantity });
    } else {
      // Add new item
      if (Number(quantity) > gift.stock) {
        return res.status(400).json({ message: 'Insufficient stock' });
      }

      const { data, error } = await supabase
        .from('cart')
        .insert([{ user_id: userId, gift_id: giftId, quantity: Number(quantity) }])
        .select('gift_id, quantity')
        .single();

      if (error) {
        console.error('Error adding to cart:', error);
        return res.status(500).json({ message: 'Failed to add to cart' });
      }

      return res.status(201).json({ message: 'Added to cart', gift_id: giftId, quantity: Number(quantity) });
    }
  } catch (err) {
    console.error('addToCart error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function updateQuantity(req, res) {
  try {
    const userId = req.user?.id;
    const { giftId } = req.params;
    const { quantity } = req.body;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!giftId || quantity === undefined) {
      return res.status(400).json({ message: 'Gift ID and quantity are required' });
    }

    const qty = Number(quantity);
    if (qty < 1) {
      return res.status(400).json({ message: 'Quantity must be at least 1' });
    }

    // Check if gift exists and get stock
    const { data: gift, error: giftError } = await supabase
      .from('gifts')
      .select('id, stock')
      .eq('id', giftId)
      .single();

    if (giftError || !gift) {
      return res.status(404).json({ message: 'Gift not found' });
    }

    if (qty > gift.stock) {
      return res.status(400).json({ message: 'Insufficient stock' });
    }

    // Update quantity
    const { data, error } = await supabase
      .from('cart')
      .update({ quantity: qty })
      .eq('user_id', userId)
      .eq('gift_id', giftId)
      .select('gift_id, quantity')
      .single();

    if (error) {
      console.error('Error updating cart quantity:', error);
      return res.status(500).json({ message: 'Failed to update quantity' });
    }

    return res.status(200).json({ message: 'Quantity updated', gift_id: giftId, quantity: qty });
  } catch (err) {
    console.error('updateQuantity error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function removeFromCart(req, res) {
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
      .from('cart')
      .delete()
      .eq('user_id', userId)
      .eq('gift_id', giftId);

    if (error) {
      console.error('Error removing from cart:', error);
      return res.status(500).json({ message: 'Failed to remove from cart' });
    }

    return res.status(200).json({ message: 'Removed from cart', gift_id: giftId });
  } catch (err) {
    console.error('removeFromCart error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}


async function checkout(req, res) {
  try {
    const userId = req.user?.id;
    const { 
      shipping_address, 
      payment_method,
      needs_delivery,
      delivery_address,
      delivery_phone,
      house_name,
      floor
    } = req.body;

    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    // ===========================
    // GET CART
    // ===========================
    const { data: cartItems, error: cartError } = await supabase
      .from('cart')
      .select('gift_id, quantity')
      .eq('user_id', userId);

    if (cartError) return res.status(500).json({ message: 'Failed to fetch cart' });
    if (!cartItems.length) return res.status(400).json({ message: 'Cart is empty' });

    const giftIds = cartItems.map(c => Number(c.gift_id));
    const { data: gifts } = await supabase
      .from('gifts')
      .select('id, stock, price')
      .in('id', giftIds);

    let total = 0;
    const orderItems = [];

    for (const c of cartItems) {
      const gift = gifts.find(g => g.id === Number(c.gift_id));
      if (!gift) continue;
      if (c.quantity > gift.stock)
        return res.status(400).json({ message: `Insufficient stock for gift ${gift.id}` });

      total += gift.price * c.quantity;
      orderItems.push({ gift_id: gift.id, quantity: c.quantity, price: gift.price });
    }

    // ===========================
    // CREATE ORDER
    // ===========================
    const { data: order } = await supabase
      .from('orders')
      .insert([{
        user_id: userId,
        status: 'pending',
        payment_status: 'pending',
        total,
        shipping_address,
        payment_method: payment_method || 'fake-pay',
        needs_delivery: needs_delivery === true || needs_delivery === 'true',
        delivery_address: needs_delivery ? delivery_address : null,
        delivery_phone: needs_delivery ? delivery_phone : null,
        house_name: needs_delivery ? house_name : null,
        floor: needs_delivery ? floor : null
      }])
      .select('*')
      .single();

    // insert order items
    await supabase.from('order_items').insert(
      orderItems.map(i => ({ order_id: order.id, ...i }))
    );

    // reduce stock
    for (const c of cartItems) {
      const gift = gifts.find(g => g.id === Number(c.gift_id));
      if (gift) {
        await supabase
          .from('gifts')
          .update({ stock: gift.stock - c.quantity })
          .eq('id', gift.id);
      }
    }

    // Send response immediately
    res.status(201).json({
      message: 'Order created, awaiting payment',
      order_id: order.id,
      total,
      payment_status: 'pending',
    });

    // ===============================
    // SIMULATE PAYMENT (WORKING)
    // ===============================
    const capturedUserId = userId; // store userId safely

    setTimeout(async () => {
      console.log(`⏳ Simulating payment for order ${order.id}`);

      const { data: updatedOrder, error: updateError } = await supabase
        .from('orders')
        .update({ payment_status: 'paid', status: 'completed' })
        .eq('id', order.id)
        .select('*')
        .single();

      if (updateError) {
        console.error('❌ Payment update failed:', updateError);
        return;
      }

      console.log('✅ Payment updated:', updatedOrder);

      // Clear cart safely
      const { error: clearError } = await supabase
        .from('cart')
        .delete()
        .eq('user_id', capturedUserId);

      if (clearError) console.error('❌ Failed to clear cart:', clearError);
      else console.log(`🛒 Cart cleared for user ${capturedUserId}`);

    }, 2000);

  } catch (err) {
    console.error('checkout error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}


// GET order by ID (for polling)


async function getOrder(req, res) {
  try {
    const userId = req.user?.id;
    const orderId = Number(req.params.id);

    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!orderId) return res.status(400).json({ message: 'Order ID required' });

    // Include total explicitly
    const { data: order, error } = await supabase
      .from('orders')
      .select(`
        id,
        total,
        status,
        payment_status,
        shipping_address,
        needs_delivery,
        delivery_address,
        delivery_phone,
        house_name,
        floor,
        created_at,
        order_items (
          gift_id,
          quantity,
          price,
          gifts!inner ( name )
        )
      `)
      .eq('id', orderId)
      .eq('user_id', userId)
      .single();

    if (error || !order) return res.status(404).json({ message: 'Order not found' });

    res.status(200).json(order);
  } catch (err) {
    console.error('getOrder error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}



module.exports = {
  getCart,
  addToCart,
  updateQuantity,
  removeFromCart,
  checkout,
  getOrder, // add this for frontend polling
};




