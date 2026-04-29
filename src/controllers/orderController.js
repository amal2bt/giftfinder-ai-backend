const supabase = require('../config/supabaseClient');

// ------------------ Helper Functions ------------------
async function formatOrder(order) {
  let user = null;
  if (order.user_id) {
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, username, email')
      .eq('id', order.user_id)
      .single();
    if (!userError && userData) user = userData;
  }

  let items = [];
  const { data: orderItems, error: itemsError } = await supabase
    .from('order_items')
    .select('id, order_id, gift_id, quantity, price')
    .eq('order_id', order.id)
    .order('id', { ascending: true });

  if (!itemsError && orderItems?.length) {
    const giftIds = orderItems.map(i => i.gift_id);
    const { data: gifts, error: giftsError } = await supabase
      .from('gifts')
      .select('id, name, category, image')
      .in('id', giftIds);

    items = orderItems.map(item => {
      const gift = gifts?.find(g => g.id === item.gift_id) || null;
      return {
        id: item.id,
        order_id: item.order_id,
        gift_id: item.gift_id,
        quantity: item.quantity,
        price: parseFloat(item.price),
        subtotal: parseFloat(item.price) * item.quantity,
        gifts: gift ? { id: gift.id, name: gift.name, category: gift.category, image: gift.image } : null,
      };
    });
  }

  return {
    id: order.id,
    user_id: order.user_id,
    total_amount: parseFloat(order.total || 0),
    status: order.status,
    shipping_address: order.shipping_address,
    payment_method: order.payment_method,
    payment_status: order.payment_status || 'pending',
    needs_delivery: order.needs_delivery || false,
    delivery_address: order.delivery_address || null,
    delivery_phone: order.delivery_phone || null,
    house_name: order.house_name || null,
    floor: order.floor || null,
    created_at: order.created_at,
    updated_at: order.updated_at,
    items,
    user,
  };
}

// ------------------ Activity Logging ------------------
async function logActivity(userId, type, message) {
  try {
    await supabase.from('activity_logs').insert([{ user_id: userId || null, type, message }]);
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}

// ------------------ Orders ------------------
async function listOrders(req, res) {
  try {
    const userId = req.user?.id;
    const all = req.query.all === 'true';
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    let orders = [];
    if (all) {
      const { data: user, error: userError } = await supabase.from('users').select('role').eq('id', userId).single();
      if (userError || !user || !['admin', 'manager'].includes(user.role)) {
        return res.status(403).json({ message: 'Admin or manager access required' });
      }
      const { data: allOrders, error: ordersError } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
      if (ordersError) return res.status(500).json({ message: 'Failed to fetch orders' });
      orders = allOrders;
    } else {
      const { data: userOrders, error: ordersError } = await supabase.from('orders').select('*').eq('user_id', userId).order('created_at', { ascending: false });
      if (ordersError) return res.status(500).json({ message: 'Failed to fetch orders' });
      orders = userOrders;
    }

    const formattedOrders = await Promise.all(orders.map(formatOrder));
    return res.status(200).json(formattedOrders);
  } catch (err) {
    console.error('listOrders error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function getOrderById(req, res) {
  try {
    const userId = req.user?.id;
    const orderId = req.params.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!orderId) return res.status(400).json({ message: 'Order ID is required' });

    const { data: order, error: orderError } = await supabase.from('orders').select('*').eq('id', orderId).single();
    if (orderError || !order) return res.status(404).json({ message: 'Order not found' });

    const { data: user, error: userError } = await supabase.from('users').select('role').eq('id', userId).single();
    const isAdminOrManager = !userError && user && ['admin', 'manager'].includes(user.role);
    const isDeliveryWorker = !userError && user && user.role === 'delivery_worker';
    const isOwner = order.user_id === userId;

    // Check if delivery worker is assigned to this order
    let isAssigned = false;
    if (isDeliveryWorker) {
      const { data: assignment } = await supabase
        .from('delivery_assignments')
        .select('id')
        .eq('order_id', orderId)
        .eq('delivery_worker_id', userId)
        .single();
      isAssigned = !!assignment;
    }

    if (!isOwner && !isAdminOrManager && !isAssigned) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const formattedOrder = await formatOrder(order);
    return res.status(200).json(formattedOrder);
  } catch (err) {
    console.error('getOrderById error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function updateOrderStatus(req, res) {
  try {
    const userId = req.user?.id;
    const orderId = req.params.id;
    const { status } = req.body;

    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!orderId) return res.status(400).json({ message: 'Order ID is required' });
    if (!status) return res.status(400).json({ message: 'Status is required' });

    const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) return res.status(400).json({ message: 'Invalid status' });

    const { data: order, error: orderError } = await supabase.from('orders').select('*').eq('id', orderId).single();
    if (orderError || !order) return res.status(404).json({ message: 'Order not found' });

    const { data: user, error: userError } = await supabase.from('users').select('role').eq('id', userId).single();
    const isAdminOrManager = !userError && user && ['admin', 'manager'].includes(user.role);
    if (!isAdminOrManager) return res.status(403).json({ message: 'Admin or manager access required' });

    const { data: updatedOrder, error: updateError } = await supabase.from('orders')
      .update({ status }).eq('id', orderId).select('*').single();
    if (updateError) return res.status(500).json({ message: 'Failed to update order status' });

    // Log the status update
    await logActivity(userId, 'update_order_status', `Order ID ${orderId} status updated to "${status}"`);

    const formattedOrder = await formatOrder(updatedOrder);
    return res.status(200).json({ message: 'Order status updated successfully', order: formattedOrder });
  } catch (err) {
    console.error('updateOrderStatus error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

module.exports = {
  listOrders,
  getOrderById,
  updateOrderStatus,
};
