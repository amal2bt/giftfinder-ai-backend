const supabase = require('../config/supabaseClient');
const { generateDeepSeekResponse } = require('./deepseekController');
const axios = require('axios');

// Generic activity logger
async function logActivity(userId, type, message) {
  try {
    await supabase.from('activity_logs').insert({ user_id: userId, type, message });
  } catch (err) {
    console.error(`Error logging activity (${type}):`, err);
  }
}

// Add gift to cart
async function addGiftToCart(userId, giftId, quantity = 1) {
  try {
    const { data: gift, error: giftError } = await supabase
      .from('gifts')
      .select('id, stock')
      .eq('id', giftId)
      .single();
    if (giftError || !gift) return { success: false, error: 'Gift not found' };

    const { data: existing } = await supabase
      .from('cart')
      .select('id, quantity')
      .eq('user_id', userId)
      .eq('gift_id', giftId)
      .single();

    if (existing) {
      const newQuantity = existing.quantity + Number(quantity);
      if (newQuantity > gift.stock) return { success: false, error: 'Insufficient stock' };

      const { error } = await supabase.from('cart').update({ quantity: newQuantity }).eq('id', existing.id);
      if (error) return { success: false, error: 'Failed to update cart' };

      await logActivity(userId, 'cart_update', `Updated quantity of gift ${giftId} to ${newQuantity}`);
      return { success: true, message: 'Cart updated' };
    } else {
      if (Number(quantity) > gift.stock) return { success: false, error: 'Insufficient stock' };

      const { error } = await supabase
        .from('cart')
        .insert([{ user_id: userId, gift_id: giftId, quantity: Number(quantity) }]);
      if (error) return { success: false, error: 'Failed to add to cart' };

      await logActivity(userId, 'cart_add', `Added gift ${giftId} to cart`);
      return { success: true, message: 'Added to cart' };
    }
  } catch (err) {
    console.error('addGiftToCart error:', err);
    return { success: false, error: 'Server error' };
  }
}

// Generate AI description for reminder
async function generateReminderDescription(person, remind_date, plan = '') {
  try {
    const OPENROUTER_KEY = process.env.CHATKEY;
    if (!OPENROUTER_KEY) {
      console.warn('OpenRouter API key not set, skipping description generation');
      return null;
    }

    const prompt = `Create a brief, warm, and personalized description (2-3 sentences maximum) for a reminder about "${person}" on ${remind_date}. ${plan ? `The reminder is related to: ${plan}` : ''} Make it thoughtful and meaningful.`;

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "tngtech/deepseek-r1t2-chimera:free",
        messages: [
          { role: "system", content: "You are a helpful assistant that creates warm, personalized reminder descriptions." },
          { role: "user", content: prompt }
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('Error generating reminder description:', err.response?.data || err.message || err);
    return null;
  }
}

// Save reminder
async function saveReminder(userId, reminderData) {
  try {
    const { person, remind_date, plan } = reminderData;
    if (!person || !remind_date) return { success: false, error: 'Person and date are required' };

    const { data, error } = await supabase
      .from('reminders')
      .insert([{ 
        user_id: userId, 
        person, 
        remind_date, 
        pref: 'app',
        reminder_type: 'ai' // Mark as AI-generated reminder
      }])
      .select('id')
      .single();
    if (error) return { success: false, error: 'Failed to save reminder' };

    // Generate AI description after insertion
    let description = null;
    try {
      description = await generateReminderDescription(person, remind_date, plan);
      if (description) {
        await supabase
          .from('reminders')
          .update({ description })
          .eq('id', data.id);
      }
    } catch (descError) {
      console.error('Error generating or saving description:', descError);
      // Don't fail the reminder creation if description generation fails
    }

    await logActivity(userId, 'reminder_create', `Saved reminder for ${person} at ${remind_date}`);

    try {
      const scheduleDSReminder = require('./scheduleDSReminder');
      await scheduleDSReminder({
        user_id: userId,
        title: person,
        reminder_time: new Date(remind_date).toISOString(),
      });
    } catch (scheduleError) {
      console.error('Error scheduling reminder:', scheduleError);
    }

    return { success: true, reminderId: data.id };
  } catch (err) {
    console.error('saveReminder error:', err);
    return { success: false, error: 'Server error' };
  }
}

// Wishlist helpers
async function addToWishlist(userId, giftId) {
  try {
    const { data: gift, error: giftError } = await supabase
      .from('gifts')
      .select('id')
      .eq('id', giftId)
      .single();
    if (giftError || !gift) return { success: false, error: 'Gift not found' };

    const { data: existing } = await supabase
      .from('wishlist')
      .select('id')
      .eq('user_id', userId)
      .eq('gift_id', giftId)
      .single();
    if (existing) return { success: true, message: 'Already in wishlist' };

    const { error } = await supabase.from('wishlist').insert([{ user_id: userId, gift_id: giftId }]);
    if (error) return { success: false, error: 'Failed to add to wishlist' };

    await logActivity(userId, 'wishlist_add', `Added gift ${giftId} to wishlist`);
    return { success: true, message: 'Added to wishlist' };
  } catch (err) {
    console.error('addToWishlist error:', err);
    return { success: false, error: 'Server error' };
  }
}

async function removeFromWishlist(userId, giftId) {
  try {
    const { error } = await supabase
      .from('wishlist')
      .delete()
      .eq('user_id', userId)
      .eq('gift_id', giftId);
    if (error) return { success: false, error: 'Failed to remove from wishlist' };

    await logActivity(userId, 'wishlist_remove', `Removed gift ${giftId} from wishlist`);
    return { success: true, message: 'Removed from wishlist' };
  } catch (err) {
    console.error('removeFromWishlist error:', err);
    return { success: false, error: 'Server error' };
  }
}

// Main chat handler
async function sendMessage(req, res) {
  let savedResponse = null;
  
  try {
    const userId = req.user?.id || req.user?.userId;
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ message: 'Message is required' });
    if (!userId) return res.status(401).json({ message: 'User not authenticated' });

    const prompt = message.trim();
    let result;
    
    try {
      result = await generateDeepSeekResponse(prompt, userId);
    } catch (error) {
      console.error('Error generating response:', error);
      
      // If it's a timeout or AI error, provide a fallback response
      const fallbackResponse = error.message?.includes('timeout') 
        ? "I'm taking a bit longer than usual to generate your surprise plan. Please wait a moment and refresh the chat, or try asking again!"
        : "I'm having trouble generating a response right now. Please try again in a moment!";
      
      // Save the fallback response to chat log so user can see it after refresh
      try {
        await supabase.from('chat_logs').insert([
          { user_id: userId, user_message: prompt, bot_response: fallbackResponse, created_at: new Date().toISOString() },
        ]);
      } catch (logError) {
        console.error('Error saving fallback chat log:', logError);
      }
      
      return res.status(200).json({
        response: fallbackResponse,
        type: "error",
        gifts: [],
        timestamp: new Date().toISOString(),
      });
    }

    // Handle actions
    if (result.action === 'add_to_cart' && result.giftId) {
      const cartResult = await addGiftToCart(userId, result.giftId);
      result.output += cartResult.success ? `\n\n✅ ${cartResult.message}!` : `\n\n⚠️ Note: ${cartResult.error}`;
    }

    if (result.action === 'save_reminder' && result.reminder) {
      const reminderResult = await saveReminder(userId, result.reminder);
      if (!reminderResult.success) result.output += `\n\n⚠️ Note: ${reminderResult.error}`;
    }

    if (result.action === 'add_to_wishlist' && result.giftId) {
      const wishlistResult = await addToWishlist(userId, result.giftId);
      result.output += wishlistResult.success
        ? `\n\n✅ ${wishlistResult.message}!`
        : `\n\n⚠️ Note: ${wishlistResult.error}`;
    }

    if (result.action === 'remove_from_wishlist' && result.giftId) {
      const wishlistResult = await removeFromWishlist(userId, result.giftId);
      result.output += wishlistResult.success
        ? `\n\n✅ ${wishlistResult.message}!`
        : `\n\n⚠️ Note: ${wishlistResult.error}`;
    }

    // Prepare response object
    savedResponse = {
      response: result.output,
      type: result.type,
      gifts: result.gifts || [],
      options: result.options || undefined,
      state: result.state,
      currentQuestion: result.currentQuestion,
      timestamp: new Date().toISOString(),
    };

    // Save chat log BEFORE sending response (so it's saved even if client disconnects)
    try {
      await supabase.from('chat_logs').insert([
        { user_id: userId, user_message: prompt, bot_response: result.output, created_at: new Date().toISOString() },
      ]);
    } catch (logError) {
      console.error('Error saving chat log:', logError);
      // Continue even if log save fails
    }

    // Send response
    return res.status(200).json(savedResponse);
  } catch (error) {
    console.error('sendMessage error:', error);
    
    // If we have a saved response, try to save it to chat log
    if (savedResponse) {
      try {
        const userId = req.user?.id || req.user?.userId;
        const prompt = req.body?.message?.trim();
        if (userId && prompt) {
          await supabase.from('chat_logs').insert([
            { user_id: userId, user_message: prompt, bot_response: savedResponse.response, created_at: new Date().toISOString() },
          ]);
        }
      } catch (logError) {
        console.error('Error saving chat log in error handler:', logError);
      }
    }
    
    return res.status(500).json({ message: 'Failed to process message', error: error.message });
  }
}

// Chat history
async function getHistory(req, res) {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return res.status(401).json({ message: 'User not authenticated' });

    const { data, error } = await supabase
      .from('chat_logs')
      .select('id, user_message, bot_response, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) return res.status(500).json({ message: 'Failed to fetch chat history' });

    const messages = [];
    data.forEach((log) => {
      messages.push({ id: `user-${log.id}`, role: 'user', content: log.user_message, timestamp: log.created_at });
      messages.push({ id: `bot-${log.id}`, role: 'assistant', content: log.bot_response, timestamp: log.created_at });
    });

    return res.status(200).json(messages);
  } catch (error) {
    console.error('getHistory error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
}

// Clear chat history
async function clearHistory(req, res) {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return res.status(401).json({ message: 'User not authenticated' });

    const { error } = await supabase
      .from('chat_logs')
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.error('Error clearing chat history:', error);
      return res.status(500).json({ message: 'Failed to clear chat history' });
    }

    await logActivity(userId, 'chat_clear', 'Cleared all chat history');

    return res.status(200).json({ message: 'Chat history cleared successfully' });
  } catch (error) {
    console.error('clearHistory error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
}

module.exports = {
  sendMessage,
  getHistory,
  clearHistory,
};
