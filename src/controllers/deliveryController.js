const supabase = require('../config/supabaseClient');
const { createNotification } = require('./notificationsController');

// Helper function to format delivery assignment with order details
async function formatDeliveryAssignment(assignment) {
  // Get order details
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .eq('id', assignment.order_id)
    .single();

  if (orderError || !order) {
    return { ...assignment, order: null };
  }

  // Get order items
  const { data: orderItems, error: itemsError } = await supabase
    .from('order_items')
    .select('id, order_id, gift_id, quantity, price')
    .eq('order_id', order.id);

  let items = [];
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

  // Get customer info
  let customer = null;
  if (order.user_id) {
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, username, email')
      .eq('id', order.user_id)
      .single();
    if (!userError && userData) customer = userData;
  }

  // Get delivery worker info
  let worker = null;
  if (assignment.delivery_worker_id) {
    const { data: workerData, error: workerError } = await supabase
      .from('users')
      .select('id, username, email, role')
      .eq('id', assignment.delivery_worker_id)
      .single();
    if (!workerError && workerData) worker = workerData;
  }

  return {
    id: assignment.id,
    order_id: assignment.order_id,
    delivery_worker_id: assignment.delivery_worker_id,
    delivery_status: assignment.delivery_status,
    driver_feedback: assignment.driver_feedback,
    client_feedback: assignment.client_feedback,
    assigned_at: assignment.assigned_at,
    started_at: assignment.started_at,
    delivered_at: assignment.delivered_at,
    updated_at: assignment.updated_at,
    worker,
    order: {
      id: order.id,
      total_amount: parseFloat(order.total || 0),
      status: order.status,
      payment_status: order.payment_status,
      needs_delivery: order.needs_delivery,
      delivery_address: order.delivery_address,
      delivery_phone: order.delivery_phone,
      house_name: order.house_name,
      floor: order.floor,
      created_at: order.created_at,
      items,
      user: customer, // Use 'user' to match frontend expectations
    },
  };
}

// Admin: Assign order to delivery worker
async function assignOrder(req, res) {
  try {
    const userId = req.user?.id;
    const { order_id, delivery_worker_id } = req.body;

    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!order_id || !delivery_worker_id) {
      return res.status(400).json({ message: 'Order ID and delivery worker ID are required' });
    }

    // Check if user is admin
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (userError || !user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    // Verify order exists and needs delivery
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (!order.needs_delivery) {
      return res.status(400).json({ message: 'Order does not require delivery' });
    }

    // Verify delivery worker exists and has correct role
    const { data: worker, error: workerError } = await supabase
      .from('users')
      .select('id, username, email, role')
      .eq('id', delivery_worker_id)
      .single();

    if (workerError || !worker || worker.role !== 'delivery_worker') {
      return res.status(404).json({ message: 'Delivery worker not found' });
    }

    // Check if order is already assigned
    const { data: existingAssignment, error: checkError } = await supabase
      .from('delivery_assignments')
      .select('id')
      .eq('order_id', order_id)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      return res.status(500).json({ message: 'Failed to check existing assignments' });
    }

    if (existingAssignment) {
      // Update existing assignment
      const { data: updatedAssignment, error: updateError } = await supabase
        .from('delivery_assignments')
        .update({
          delivery_worker_id,
          delivery_status: 'assigned',
          assigned_at: new Date().toISOString(),
        })
        .eq('id', existingAssignment.id)
        .select('*')
        .single();

      if (updateError) {
        return res.status(500).json({ message: 'Failed to update assignment' });
      }

      // Send notification to delivery worker
      await createNotification(
        delivery_worker_id,
        'New Delivery Assignment',
        `You have been assigned to deliver Order #${order_id}`,
        'delivery',
        null
      );

      const formatted = await formatDeliveryAssignment(updatedAssignment);
      return res.status(200).json({
        message: 'Order reassigned successfully',
        assignment: formatted,
      });
    }

    // Create new assignment
    const { data: assignment, error: insertError } = await supabase
      .from('delivery_assignments')
      .insert([{
        order_id,
        delivery_worker_id,
        delivery_status: 'assigned',
      }])
      .select('*')
      .single();

    if (insertError) {
      console.error('Assignment insert error:', insertError);
      return res.status(500).json({ message: 'Failed to create assignment' });
    }

    // Update order status to processing
    await supabase
      .from('orders')
      .update({ status: 'processing' })
      .eq('id', order_id);

    // Send notification to delivery worker
    await createNotification(
      delivery_worker_id,
      'New Delivery Assignment',
      `You have been assigned to deliver Order #${order_id}`,
      'delivery',
      null
    );

    const formatted = await formatDeliveryAssignment(assignment);
    return res.status(201).json({
      message: 'Order assigned successfully',
      assignment: formatted,
    });
  } catch (err) {
    console.error('assignOrder error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// Get all delivery workers (for admin to select)
async function getDeliveryWorkers(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    // Check if user is admin
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (userError || !user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { data: workers, error } = await supabase
      .from('users')
      .select('id, username, email, role, created_at')
      .eq('role', 'delivery_worker')
      .order('username', { ascending: true });

    if (error) {
      return res.status(500).json({ message: 'Failed to fetch delivery workers' });
    }

    return res.status(200).json({ workers: workers || [] });
  } catch (err) {
    console.error('getDeliveryWorkers error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// Get orders available for assignment (orders with needs_delivery=true and not yet assigned)
async function getAvailableOrders(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    // Check if user is admin
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (userError || !user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    // Get all orders that need delivery
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('*')
      .eq('needs_delivery', true)
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false });

    if (ordersError) {
      return res.status(500).json({ message: 'Failed to fetch orders' });
    }

    // Get all assignments to filter out already assigned orders
    const { data: assignments, error: assignmentsError } = await supabase
      .from('delivery_assignments')
      .select('order_id');

    if (assignmentsError) {
      return res.status(500).json({ message: 'Failed to fetch assignments' });
    }

    const assignedOrderIds = new Set((assignments || []).map(a => a.order_id));
    const availableOrders = (orders || []).filter(order => !assignedOrderIds.has(order.id));

    // Format orders with customer info
    const formattedOrders = await Promise.all(
      availableOrders.map(async (order) => {
        let customer = null;
        if (order.user_id) {
          const { data: userData } = await supabase
            .from('users')
            .select('id, username, email')
            .eq('id', order.user_id)
            .single();
          if (userData) customer = userData;
        }

        return {
          id: order.id,
          total_amount: parseFloat(order.total || 0),
          status: order.status,
          delivery_address: order.delivery_address,
          delivery_phone: order.delivery_phone,
          house_name: order.house_name,
          floor: order.floor,
          created_at: order.created_at,
          customer,
        };
      })
    );

    return res.status(200).json({ orders: formattedOrders });
  } catch (err) {
    console.error('getAvailableOrders error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// Delivery worker: Get my assignments
async function getMyAssignments(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    // Verify user is delivery worker
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (userError || !user || user.role !== 'delivery_worker') {
      return res.status(403).json({ message: 'Delivery worker access required' });
    }

    const { data: assignments, error } = await supabase
      .from('delivery_assignments')
      .select('*')
      .eq('delivery_worker_id', userId)
      .order('assigned_at', { ascending: false });

    if (error) {
      return res.status(500).json({ message: 'Failed to fetch assignments' });
    }

    const formattedAssignments = await Promise.all(
      (assignments || []).map(formatDeliveryAssignment)
    );

    return res.status(200).json({ assignments: formattedAssignments });
  } catch (err) {
    console.error('getMyAssignments error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// Delivery worker: Update delivery status
async function updateDeliveryStatus(req, res) {
  try {
    const userId = req.user?.id;
    const assignmentId = req.params.id;
    const { status, driver_feedback } = req.body;

    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!assignmentId) return res.status(400).json({ message: 'Assignment ID is required' });
    if (!status) return res.status(400).json({ message: 'Status is required' });

    const validStatuses = ['assigned', 'in_transit', 'delivered', 'failed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    // Verify user is delivery worker
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (userError || !user || user.role !== 'delivery_worker') {
      return res.status(403).json({ message: 'Delivery worker access required' });
    }

    // Verify assignment belongs to this worker
    const { data: assignment, error: assignmentError } = await supabase
      .from('delivery_assignments')
      .select('*')
      .eq('id', assignmentId)
      .eq('delivery_worker_id', userId)
      .single();

    if (assignmentError || !assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    // Prepare update data
    const updateData = { delivery_status: status };
    if (driver_feedback !== undefined) {
      updateData.driver_feedback = driver_feedback;
    }

    // Set timestamps based on status
    if (status === 'in_transit' && !assignment.started_at) {
      updateData.started_at = new Date().toISOString();
    }
    if (status === 'delivered' && !assignment.delivered_at) {
      updateData.delivered_at = new Date().toISOString();
      // Update order status to delivered
      await supabase
        .from('orders')
        .update({ status: 'delivered' })
        .eq('id', assignment.order_id);
    }

    const { data: updatedAssignment, error: updateError } = await supabase
      .from('delivery_assignments')
      .update(updateData)
      .eq('id', assignmentId)
      .select('*')
      .single();

    if (updateError) {
      return res.status(500).json({ message: 'Failed to update status' });
    }

    const formatted = await formatDeliveryAssignment(updatedAssignment);
    return res.status(200).json({
      message: 'Delivery status updated successfully',
      assignment: formatted,
    });
  } catch (err) {
    console.error('updateDeliveryStatus error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// Delivery worker or admin: Submit client feedback
async function submitClientFeedback(req, res) {
  try {
    const userId = req.user?.id;
    const assignmentId = req.params.id;
    const { client_feedback } = req.body;

    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!assignmentId) return res.status(400).json({ message: 'Assignment ID is required' });
    if (!client_feedback) return res.status(400).json({ message: 'Client feedback is required' });

    // Verify user is delivery worker or admin
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const isAdmin = user.role === 'admin';
    const isDeliveryWorker = user.role === 'delivery_worker';

    if (!isAdmin && !isDeliveryWorker) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Verify assignment exists
    let query = supabase
      .from('delivery_assignments')
      .select('*')
      .eq('id', assignmentId);

    if (isDeliveryWorker) {
      query = query.eq('delivery_worker_id', userId);
    }

    const { data: assignment, error: assignmentError } = await query.single();

    if (assignmentError || !assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    const { data: updatedAssignment, error: updateError } = await supabase
      .from('delivery_assignments')
      .update({ client_feedback })
      .eq('id', assignmentId)
      .select('*')
      .single();

    if (updateError) {
      return res.status(500).json({ message: 'Failed to update feedback' });
    }

    const formatted = await formatDeliveryAssignment(updatedAssignment);
    return res.status(200).json({
      message: 'Client feedback submitted successfully',
      assignment: formatted,
    });
  } catch (err) {
    console.error('submitClientFeedback error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// Admin: Get all assignments
async function getAllAssignments(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    // Check if user is admin
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (userError || !user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { data: assignments, error } = await supabase
      .from('delivery_assignments')
      .select('*')
      .order('assigned_at', { ascending: false });

    if (error) {
      return res.status(500).json({ message: 'Failed to fetch assignments' });
    }

    const formattedAssignments = await Promise.all(
      (assignments || []).map(formatDeliveryAssignment)
    );

    return res.status(200).json({ assignments: formattedAssignments });
  } catch (err) {
    console.error('getAllAssignments error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}
// Get deliveries for normal users
async function getAllAssignmentsForUser(userId) {
  try {
    // Fetch orders that belong to this user and need delivery
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id')
      .eq('user_id', userId)
      .eq('needs_delivery', true);

    if (ordersError) throw ordersError;

    const orderIds = orders.map(o => o.id);
    if (orderIds.length === 0) return [];

    // Fetch assignments for these orders
    const { data: assignments, error: assignmentsError } = await supabase
      .from('delivery_assignments')
      .select('*')
      .in('order_id', orderIds)
      .order('assigned_at', { ascending: false });

    if (assignmentsError) throw assignmentsError;

    // Format assignments for frontend
    const formatted = await Promise.all(assignments.map(formatDeliveryAssignment));
    return formatted;
  } catch (err) {
    console.error('getAllAssignmentsForUser error:', err);
    throw err;
  }
}

module.exports = {
  assignOrder,
  getDeliveryWorkers,
  getAvailableOrders,
  getMyAssignments,
  updateDeliveryStatus,
  submitClientFeedback,
  getAllAssignments,
  getAllAssignmentsForUser, // <-- export it
};

