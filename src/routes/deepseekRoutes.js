const express = require('express');
const axios = require('axios');
const supabase = require('../config/supabaseClient'); // <-- FIXED
require('dotenv').config();

const router = express.Router();

const OPENROUTER_KEY = process.env.CHATKEY;

// 🔍 basic keyword detector
function detectGiftIntent(input) {
  const lower = input.toLowerCase();
  return lower.includes("gift") || lower.includes("present") || lower.includes("gift for");
}

router.post('/', async (req, res) => {
  try {
    const userInput = req.body.prompt || req.body.question;

    if (!userInput || !userInput.trim()) {
      return res.status(400).json({ error: 'Question is required' });
    }

    if (!OPENROUTER_KEY) {
      return res.status(500).json({ error: 'OpenRouter API key not set in .env' });
    }

    // ==========================================
    // 1️⃣ SUPABASE GIFT SEARCH (if gift intent)
    // ==========================================
    let giftResults = [];

    if (detectGiftIntent(userInput)) {
      console.log("🎁 Gift search triggered");

      const searchTerm = userInput.replace(/gift/gi, '').trim();

      const { data, error } = await supabase
        .from('gifts')
        .select('*')
        .textSearch('name', searchTerm)
        .limit(10);

      if (error) {
        console.error("Supabase gift search error:", error);
      }

      giftResults = data || [];
    }

    // ==========================================
    // 2️⃣ ENHANCE PROMPT FOR AI
    // ==========================================
    let finalPrompt = userInput;

    if (giftResults.length > 0) {
      finalPrompt = `
The user is asking about gifts.

Here are up to 10 matching gifts from the database:
${JSON.stringify(giftResults, null, 2)}

Using this data:
1. Give a friendly gift recommendation.
2. If appropriate, mention items from the list.
3. Keep the response concise and helpful.

User said: "${userInput}"
      `;
    }

    // ==========================================
    // 3️⃣ CALL DEEPSEEK (FREE MODEL)
    // ==========================================
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'tngtech/deepseek-r1t2-chimera:free',
        messages: [{ role: 'user', content: finalPrompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const assistantContent =
      response.data.choices?.[0]?.message?.content ||
      "Sorry, no response received.";

    // ==========================================
    // 4️⃣ RETURN RESPONSE + GIFTS
    // ==========================================
    res.json({
      output: assistantContent,
      gifts: giftResults,
    });

  } catch (error) {
    if (error.response) {
      console.error('OpenRouter API error data:', error.response.data);
      return res.status(error.response.status).json({ error: error.response.data });
    } else if (error.request) {
      console.error('OpenRouter API no response:', error.request);
      return res.status(500).json({ error: 'No response from OpenRouter API' });
    } else {
      console.error('OpenRouter API setup error:', error.message);
      return res.status(500).json({ error: 'OpenRouter request setup failed' });
    }
  }
});

module.exports = router;
