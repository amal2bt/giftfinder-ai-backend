const axios = require("axios");
const chrono = require("chrono-node");
const scheduleDSReminder = require("./scheduleDSReminder");
const supabase = require("../config/supabaseClient");
const {
  ConversationState,
  QuestionType,
  getState,
  setState,
  setCurrentQuestion,
  updateData,
  clearState
} = require("../utils/conversationState");

// Helper function to check if message is a greeting
function isGreeting(message) {
  const lower = message.toLowerCase().trim();
  const greetings = ['hi', 'hello', 'hey', 'greetings', 'good morning', 'good afternoon', 'good evening'];
  return greetings.some(g => lower === g || lower.startsWith(g + ' ') || lower.startsWith(g + '!'));
}

// Helper function to detect user choice
function detectChoice(message) {
  const lower = message.toLowerCase().trim();
  if (lower.includes('gift suggestion') || lower.includes('gift') || lower === '1') return 'gift_suggestion';
  if (lower.includes('surprise plan') || lower.includes('surprise') || lower === '2') return 'surprise_plan';
  if (lower.includes('reminder') || lower.includes('remind') || lower === '3') return 'reminder';
  return null;
}

// Map interests to relevant categories
function mapInterestsToCategories(interests, relation, feelings) {
  const interestLower = (interests || '').toLowerCase();
  const relationLower = (relation || '').toLowerCase();
  const feelingsLower = (feelings || '').toLowerCase();
  
  const categoryMap = {
    // Hobbies & Interests
    'reading': ['book', 'literature', 'novel'],
    'books': ['book', 'literature', 'novel'],
    'music': ['music', 'audio', 'headphone', 'speaker', 'instrument'],
    'sports': ['sport', 'fitness', 'athletic', 'outdoor'],
    'fitness': ['sport', 'fitness', 'athletic', 'workout'],
    'gaming': ['game', 'gaming', 'console', 'tech'],
    'games': ['game', 'gaming', 'console', 'tech'],
    'tech': ['tech', 'technology', 'electronic', 'gadget'],
    'technology': ['tech', 'technology', 'electronic', 'gadget'],
    'cooking': ['kitchen', 'cook', 'culinary', 'food'],
    'art': ['art', 'craft', 'creative', 'drawing', 'painting'],
    'photography': ['camera', 'photo', 'photography'],
    'travel': ['travel', 'luggage', 'bag', 'outdoor'],
    'fashion': ['fashion', 'clothing', 'accessory', 'jewelry'],
    'beauty': ['beauty', 'cosmetic', 'skincare', 'makeup'],
    'gardening': ['garden', 'plant', 'outdoor'],
    'movies': ['movie', 'film', 'entertainment'],
    'anime': ['anime', 'manga', 'japanese'],
    'comics': ['comic', 'manga', 'book'],
    
    // Relation-based
    'family': ['family', 'home', 'personal'],
    'friend': ['fun', 'casual', 'entertainment'],
    
    // Feeling-based
    'love': ['romantic', 'sentimental', 'personal', 'jewelry', 'flower'],
    'apology': ['thoughtful', 'personal', 'card', 'gift'],
  };
  
  const matchedCategories = [];
  
  // Check interests
  for (const [key, categories] of Object.entries(categoryMap)) {
    if (interestLower.includes(key)) {
      matchedCategories.push(...categories);
    }
  }
  
  // Add relation-based categories
  if (relationLower.includes('family')) {
    matchedCategories.push('home', 'family', 'personal');
  }
  
  // Add feeling-based categories
  if (feelingsLower.includes('love')) {
    matchedCategories.push('romantic', 'sentimental', 'jewelry');
  }
  
  return [...new Set(matchedCategories)]; // Remove duplicates
}

// Calculate relevance score for a gift
function calculateRelevanceScore(gift, filters) {
  const { interests, relation, feelings, age, budget } = filters;
  let score = 0;
  
  const giftName = (gift.name || '').toLowerCase();
  const giftCategory = (gift.category || '').toLowerCase();
  const interestLower = (interests || '').toLowerCase();
  const relationLower = (relation || '').toLowerCase();
  const feelingsLower = (feelings || '').toLowerCase();
  
  // Interest matching (highest weight)
  if (interests) {
    const interestWords = interestLower.split(/\s+/).filter(w => w.length > 2);
    interestWords.forEach(word => {
      if (giftName.includes(word)) score += 10;
      if (giftCategory.includes(word)) score += 8;
    });
    
    // Check mapped categories
    const mappedCategories = mapInterestsToCategories(interests, relation, feelings);
    mappedCategories.forEach(cat => {
      if (giftCategory.includes(cat)) score += 7;
      if (giftName.includes(cat)) score += 5;
    });
  }
  
  // Budget relevance (prefer gifts closer to budget but not over)
  if (budget && !isNaN(budget)) {
    const budgetNum = parseFloat(budget);
    const price = parseFloat(gift.price) || 0;
    if (price <= budgetNum && budgetNum > 0) {
      // Prefer gifts that use 50-90% of budget (good value)
      const budgetUsage = price / budgetNum;
      if (budgetUsage >= 0.5 && budgetUsage <= 0.9) {
        score += 5;
      } else if (budgetUsage > 0.9) {
        score += 3; // Still good but less ideal
      } else {
        score += 1; // Lower price, less ideal
      }
    }
  }
  
  // Age appropriateness
  if (age && !isNaN(age)) {
    const ageNum = parseInt(age);
    const category = giftCategory;
    
    if (ageNum < 13) {
      // Children
      if (category.includes('toy') || category.includes('game') || category.includes('kid') || category.includes('child')) {
        score += 5;
      }
    } else if (ageNum < 18) {
      // Teens
      if (category.includes('teen') || category.includes('game') || category.includes('tech') || category.includes('sport')) {
        score += 5;
      }
    } else {
      // Adults - no penalty, but prefer non-kid items
      if (!category.includes('toy') && !category.includes('kid') && !category.includes('child')) {
        score += 2;
      }
    }
  }
  
  // Relation and feelings (lower weight but still relevant)
  if (relationLower.includes('family')) {
    if (giftCategory.includes('home') || giftCategory.includes('family') || giftCategory.includes('personal')) {
      score += 2;
    }
  }
  
  if (feelingsLower.includes('love')) {
    if (giftCategory.includes('romantic') || giftCategory.includes('jewelry') || giftCategory.includes('flower')) {
      score += 3;
    }
  }
  
  return score;
}

// Search gifts with filters - improved version
async function searchGiftsWithFilters(filters) {
  const { recipientName, relation, feelings, interests, age, budget } = filters;
  
  try {
    // Step 1: Get all in-stock gifts within budget
    let baseQuery = supabase
      .from("gifts")
      .select("id, name, category, price, image, stock")
      .gt("stock", 0);

    // Apply budget filter
    const budgetNum = budget && !isNaN(budget) ? parseFloat(budget) : null;
    if (budgetNum) {
      baseQuery = baseQuery.lte("price", budgetNum);
    }

    // Step 2: Try multiple search strategies
    let results = [];
    
    // Strategy 1: Full-text search on name if interests provided
    if (interests && interests.trim()) {
      try {
        const { data: textSearchResults, error: textError } = await supabase
          .from("gifts")
          .select("id, name, category, price, image, stock")
          .gt("stock", 0)
          .textSearch('name', interests, { type: 'plain', config: 'simple' });
        
        if (!textError && textSearchResults && textSearchResults.length > 0) {
          // Apply budget filter to text search results
          let filtered = textSearchResults;
          if (budgetNum) {
            filtered = textSearchResults.filter(g => parseFloat(g.price || 0) <= budgetNum);
          }
          results.push(...filtered);
        }
      } catch (textSearchErr) {
        console.log('Text search not available, using ilike fallback');
      }
    }
    
    // Strategy 2: Category and name matching with flexible OR logic
    if (interests && interests.trim()) {
      const interestWords = interests.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const mappedCategories = mapInterestsToCategories(interests, relation, feelings);
      
      // Build flexible search: match ANY interest word in name OR category
      const searchTerms = [...interestWords, ...mappedCategories];
      if (searchTerms.length > 0) {
        const orConditions = [];
        searchTerms.forEach(term => {
          orConditions.push(`name.ilike.%${term}%`);
          orConditions.push(`category.ilike.%${term}%`);
        });
        
        if (orConditions.length > 0) {
          const { data: interestResults, error: interestError } = await baseQuery
            .or(orConditions.join(','))
            .limit(20);
          
          if (!interestError && interestResults) {
            results.push(...interestResults);
          }
        }
      }
    }
    
    // Strategy 3: Age-based category filtering
    if (age && !isNaN(age)) {
      const ageNum = parseInt(age);
      let ageCategories = [];
      
      if (ageNum < 13) {
        ageCategories = ['toy', 'game', 'kid', 'child'];
      } else if (ageNum < 18) {
        ageCategories = ['teen', 'game', 'tech', 'sport'];
      }
      
      if (ageCategories.length > 0) {
        const ageOrConditions = ageCategories.map(cat => `category.ilike.%${cat}%`).join(',');
        const { data: ageResults, error: ageError } = await baseQuery
          .or(ageOrConditions)
          .limit(15);
        
        if (!ageError && ageResults) {
          results.push(...ageResults);
        }
      }
    }
    
    // Step 3: If we have results, score and rank them
    if (results.length > 0) {
      // Remove duplicates based on id
      const uniqueResults = [];
      const seenIds = new Set();
      results.forEach(gift => {
        if (!seenIds.has(gift.id)) {
          seenIds.add(gift.id);
          uniqueResults.push(gift);
        }
      });
      
      // Calculate relevance scores
      const scoredGifts = uniqueResults.map(gift => ({
        ...gift,
        relevanceScore: calculateRelevanceScore(gift, filters)
      }));
      
      // Sort by relevance score (descending), then by price (ascending)
      scoredGifts.sort((a, b) => {
        if (b.relevanceScore !== a.relevanceScore) {
          return b.relevanceScore - a.relevanceScore;
        }
        return parseFloat(a.price || 0) - parseFloat(b.price || 0);
      });
      
      // Return top results (prioritize high relevance)
      const topResults = scoredGifts.filter(g => g.relevanceScore > 0).slice(0, 10);
      
      // If we have good matches, return them
      if (topResults.length >= 3) {
        return topResults.map(({ relevanceScore, ...gift }) => gift);
      }
      
      // If we have some matches but not enough, add some from the rest
      if (topResults.length > 0) {
        const remaining = scoredGifts.filter(g => g.relevanceScore === 0).slice(0, 10 - topResults.length);
        return [...topResults, ...remaining].map(({ relevanceScore, ...gift }) => gift);
      }
    }
    
    // Step 4: Fallback - still respect budget and try to match some criteria
    let fallbackQuery = supabase
      .from("gifts")
      .select("id, name, category, price, image, stock")
      .gt("stock", 0);
    
    if (budgetNum) {
      fallbackQuery = fallbackQuery.lte("price", budgetNum);
    }
    
    // Try to get gifts that at least match budget, ordered by price (best value)
    const { data: fallbackData, error: fallbackError } = await fallbackQuery
      .order("price", { ascending: true })
      .limit(10);
    
    if (!fallbackError && fallbackData && fallbackData.length > 0) {
      return fallbackData;
    }
    
    // Final fallback - just get any in-stock gifts
    const { data: finalFallback } = await supabase
      .from("gifts")
      .select("id, name, category, price, image, stock")
      .gt("stock", 0)
      .order("price", { ascending: true })
      .limit(10);
    
    return finalFallback || [];
    
  } catch (error) {
    console.error("Error searching gifts:", error);
    return [];
  }
}

// Parse reminder date from message
function parseReminderDate(message) {
  const results = chrono.parse(message);
  if (results.length > 0) {
    const date = results[0].start.date();
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0]; // Return date in YYYY-MM-DD format
    }
  }
  return null;
}

// Generate AI response using DeepSeek
async function generateAIResponse(prompt, context = {}) {
  const OPENROUTER_KEY = process.env.CHATKEY;
  if (!OPENROUTER_KEY) throw new Error("OpenRouter API key (CHATKEY) not set");

  try {
    const systemPrompt = `You are GiftBot, a friendly and helpful AI assistant for a gift shop. 
You help customers find perfect gifts, plan surprises, and set reminders for special occasions.
Be warm, conversational, and helpful. Keep responses concise and engaging.`;

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "tngtech/deepseek-r1t2-chimera:free",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 45000, // 45 second timeout (less than frontend's 60s to allow for network overhead)
      }
    );

    return response.data.choices?.[0]?.message?.content || 
           "I couldn't generate a response right now. Please try again shortly.";
  } catch (err) {
    console.error("DeepSeek API error:", err.response?.data || err.message || err);
    
    // Check if it's a timeout error
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      throw new Error("AI response is taking longer than expected. Please try again or refresh the chat.");
    }
    
    throw new Error("AI service is unavailable right now. Please try again later.");
  }
}

// Main response generation function
const generateDeepSeekResponse = async (prompt, userId) => {
  if (!prompt || !prompt.trim()) {
    throw new Error("Prompt is required");
  }
  if (!userId) {
    throw new Error("UserId is required");
  }

  const message = prompt.trim();
  const state = getState(userId);
  const choice = detectChoice(message);

  // Handle greeting - show choices
  // We ONLY want to show this when the user actually sends a greeting,
  // or when it's the very first message with no detected choice.
  if (
    isGreeting(message) ||
    (!choice && state.state === ConversationState.INITIAL && !state.currentQuestion)
  ) {
    setState(userId, ConversationState.INITIAL);
    return {
      output: "Hi! 👋 I'm GiftBot, your personal gift assistant! How can I help you today?\n\nPlease choose one:\n1️⃣ Gift Suggestion\n2️⃣ Surprise Plan\n3️⃣ Reminder",
      type: "greeting",
      options: [
        { label: "Gift Suggestion", value: "gift_suggestion" },
        { label: "Surprise Plan", value: "surprise_plan" },
        { label: "Reminder", value: "reminder" }
      ],
      gifts: [],
      state: ConversationState.INITIAL
    };
  }

  // Handle choice selection
  if (choice && state.state === ConversationState.INITIAL) {
    if (choice === 'gift_suggestion') {
      setState(userId, ConversationState.GIFT_QUESTIONS, {});
      setCurrentQuestion(userId, QuestionType.RECIPIENT_NAME);
      return {
        output: "Great! Let's find the perfect gift! 🎁\n\nFirst, what's the name of the recipient?",
        type: "gift_questions",
        gifts: [],
        state: ConversationState.GIFT_QUESTIONS,
        currentQuestion: QuestionType.RECIPIENT_NAME
      };
    } else if (choice === 'surprise_plan') {
      setState(userId, ConversationState.SURPRISE_PLAN, {});
      return {
        output: "Great! Let's create an amazing surprise plan! 🎉\n\nWhat gift would you like to present? (You can describe the gift or tell me about the recipient)",
        type: "surprise_plan",
        gifts: [],
        state: ConversationState.SURPRISE_PLAN
      };
    } else if (choice === 'reminder') {
      setState(userId, ConversationState.REMINDER, {});
      return {
        output: "I'd be happy to help you set a reminder! 📅\n\nWhat's the event or occasion? (e.g., 'Birthday on March 15th' or 'Anniversary on December 20th')",
        type: "reminder",
        gifts: [],
        state: ConversationState.REMINDER
      };
    }
  }

  // Handle gift suggestion questions flow
  if (state.state === ConversationState.GIFT_QUESTIONS) {
    const currentQ = state.currentQuestion;
    const data = state.data || {};

    if (currentQ === QuestionType.RECIPIENT_NAME) {
      updateData(userId, { recipientName: message });
      setCurrentQuestion(userId, QuestionType.RELATION);
      return {
        output: `Nice! What's your relation with ${message}? (Family or Friend?)`,
        type: "gift_questions",
        gifts: [],
        state: ConversationState.GIFT_QUESTIONS,
        currentQuestion: QuestionType.RELATION
      };
    }

    if (currentQ === QuestionType.RELATION) {
      const relation = message.toLowerCase().includes('family') ? 'family' : 'friend';
      updateData(userId, { relation });
      setCurrentQuestion(userId, QuestionType.FEELINGS);
      return {
        output: "Got it! What's the feeling behind this gift? (Love or Apology?)",
        type: "gift_questions",
        gifts: [],
        state: ConversationState.GIFT_QUESTIONS,
        currentQuestion: QuestionType.FEELINGS
      };
    }

    if (currentQ === QuestionType.FEELINGS) {
      const feelings = message.toLowerCase().includes('love') ? 'love' : 'apology';
      updateData(userId, { feelings });
      setCurrentQuestion(userId, QuestionType.INTERESTS);
      return {
        output: "Perfect! What are their interests or hobbies?",
        type: "gift_questions",
        gifts: [],
        state: ConversationState.GIFT_QUESTIONS,
        currentQuestion: QuestionType.INTERESTS
      };
    }

    if (currentQ === QuestionType.INTERESTS) {
      updateData(userId, { interests: message });
      setCurrentQuestion(userId, QuestionType.AGE);
      return {
        output: "Great! How old are they?",
        type: "gift_questions",
        gifts: [],
        state: ConversationState.GIFT_QUESTIONS,
        currentQuestion: QuestionType.AGE
      };
    }

    if (currentQ === QuestionType.AGE) {
      updateData(userId, { age: message });
      setCurrentQuestion(userId, QuestionType.BUDGET);
      return {
        output: "Almost done! What's your budget? (Enter a number, e.g., 50 or 100)",
        type: "gift_questions",
        gifts: [],
        state: ConversationState.GIFT_QUESTIONS,
        currentQuestion: QuestionType.BUDGET
      };
    }

    if (currentQ === QuestionType.BUDGET) {
      const budget = parseFloat(message.replace(/[^0-9.]/g, '')) || 1000;
      updateData(userId, { budget: budget.toString() });
      
      // Search for gifts
      const allData = { ...data, budget: budget.toString() };
      const giftResults = await searchGiftsWithFilters(allData);
      
      if (giftResults.length === 0) {
        clearState(userId);
        return {
          output: "I couldn't find any gifts matching your criteria. Let's start over! Say 'hi' to begin again.",
          type: "error",
          gifts: [],
          state: ConversationState.INITIAL
        };
      }

      // Get top 3 gifts
      const topGifts = giftResults.slice(0, 3);
      
      setState(userId, ConversationState.GIFT_SELECTION, { ...allData, suggestedGifts: topGifts });
      
      let giftList = topGifts.map((g, i) => 
        `${i + 1}. ${g.name} - $${g.price} (${g.category})`
      ).join('\n');

      return {
        output: `Perfect! Based on your preferences, here are my top 3 gift suggestions:\n\n${giftList}\n\nWhich gift would you like? (Reply with the number 1, 2, or 3)`,
        type: "gift_selection",
        gifts: topGifts,
        state: ConversationState.GIFT_SELECTION
      };
    }
  }

  // Handle gift selection
  if (state.state === ConversationState.GIFT_SELECTION) {
    const giftNum = parseInt(message.trim());
    if (isNaN(giftNum) || giftNum < 1 || giftNum > 3) {
      return {
        output: "Please choose a valid option (1, 2, or 3)",
        type: "gift_selection",
        gifts: state.data.suggestedGifts || [],
        state: ConversationState.GIFT_SELECTION
      };
    }

    const selectedGift = state.data.suggestedGifts[giftNum - 1];
    if (!selectedGift) {
      return {
        output: "Sorry, I couldn't find that gift. Please try again.",
        type: "error",
        gifts: [],
        state: ConversationState.GIFT_SELECTION
      };
    }

    // Store selected gift for cart addition (will be handled in chatController)
    updateData(userId, { selectedGiftId: selectedGift.id, selectedGift });
    
    // Get updated state after updateData to ensure selectedGift is included
    const updatedState = getState(userId);
    setState(userId, ConversationState.SURPRISE_PLAN, updatedState.data);
    
    return {
      output: `Great choice! ${selectedGift.name} has been selected. 🎉\n\nWould you like help creating a surprise plan to present this gift? (Yes/No)`,
      type: "surprise_plan_question",
      gifts: [selectedGift],
      state: ConversationState.SURPRISE_PLAN,
      action: "add_to_cart",
      giftId: selectedGift.id
    };
  }

  // Handle surprise plan question after gift selection
  // Get fresh state to ensure selectedGift is available
  // Check this BEFORE other handlers to catch "yes" responses
  // This must come BEFORE the reminder handler and standalone surprise plan handler
  const currentState = getState(userId);
  const isSurprisePlanState = currentState && currentState.state === ConversationState.SURPRISE_PLAN;
  const hasSelectedGift = currentState && currentState.data && currentState.data.selectedGift;
  
  // Debug logging (can be removed in production)
  if (isSurprisePlanState) {
    console.log('[DEBUG] Surprise plan state detected. Has selectedGift:', !!hasSelectedGift, 'Message:', message, 'State data keys:', currentState.data ? Object.keys(currentState.data) : 'no data');
  }
  
  if (isSurprisePlanState && hasSelectedGift) {
    const wantsPlan = message.toLowerCase().trim().includes('yes') || 
                      message.toLowerCase().trim() === 'y' ||
                      message.toLowerCase().trim().startsWith('yes');
    
    if (wantsPlan) {
      try {
        const selectedGift = currentState.data.selectedGift;
        const recipientName = currentState.data.recipientName || 'the recipient';
        const relation = currentState.data.relation || 'friend';
        const feelings = currentState.data.feelings || 'love';
        
      const aiResponse = await generateAIResponse(
          `Help the user create a creative surprise plan to present the gift "${selectedGift.name}" to ${recipientName}. 
          The relation is ${relation}, feeling is ${feelings}. 
        Suggest creative and memorable ways to present this gift.`
      );
      
        // Store the plan
        updateData(userId, { surprisePlan: aiResponse });
        const stateWithPlan = getState(userId);
        setState(userId, ConversationState.REMINDER, stateWithPlan.data);
        
      return {
        output: `${aiResponse}\n\nWould you like me to set a reminder for this plan? (Yes/No)`,
        type: "reminder_question",
        gifts: [],
        state: ConversationState.REMINDER
      };
      } catch (error) {
        console.error('Error generating surprise plan:', error);
        // Fallback response if AI fails - use fresh state to get selectedGift
        const fallbackState = getState(userId);
        const fallbackGift = fallbackState.data?.selectedGift || currentState.data.selectedGift;
        const fallbackRecipient = fallbackState.data?.recipientName || currentState.data.recipientName || 'the recipient';
        
        setState(userId, ConversationState.REMINDER, fallbackState.data);
        return {
          output: `Here's a simple surprise plan for presenting ${fallbackGift.name}:\n\n1. Choose a special moment when ${fallbackRecipient} least expects it\n2. Wrap the gift beautifully\n3. Add a personal note or card\n4. Present it with a warm smile and explanation of why you chose it\n\nWould you like me to set a reminder for this plan? (Yes/No)`,
          type: "reminder_question",
          gifts: [],
          state: ConversationState.REMINDER
        };
      }
    } else {
      // User said no to surprise plan - ask about reminder directly
      setState(userId, ConversationState.REMINDER, currentState.data);
      return {
        output: "No problem! Would you like me to set a reminder for this gift? (Yes/No)",
        type: "reminder_question",
        gifts: [],
        state: ConversationState.REMINDER
      };
    }
  }

  // Handle reminder flow
  if (state.state === ConversationState.REMINDER) {
    // Check if user wants to set reminder
    if (message.toLowerCase().includes('yes') || message.toLowerCase().includes('y')) {
      return {
        output: "Great! When should I remind you? (Please include the date, e.g., 'March 15th' or 'December 20th, 2024')",
        type: "reminder_date",
        gifts: [],
        state: ConversationState.REMINDER
      };
    }
    
    if (message.toLowerCase().includes('no') || message.toLowerCase().includes('n')) {
      clearState(userId);
      return {
        output: "All set! Your gift is ready. Is there anything else I can help you with? Say 'hi' to start over!",
        type: "completed",
        gifts: [],
        state: ConversationState.COMPLETED
      };
    }

    // Try to parse reminder date and event name from message
    const reminderDate = parseReminderDate(message);
    
    // Extract event/person name (everything before date keywords or the date itself)
    let eventName = message;
    const dateKeywords = ['on', 'for', 'birthday', 'anniversary', 'event', 'occasion'];
    for (const keyword of dateKeywords) {
      const index = message.toLowerCase().indexOf(keyword);
      if (index > 0) {
        eventName = message.substring(0, index).trim();
        break;
      }
    }
    
    if (reminderDate) {
      const person = state.data.recipientName || eventName || state.data.person || "Special Event";
      const plan = state.data.surprisePlan || "";
      
      // Save reminder to database (will be handled in chatController)
      updateData(userId, { 
        reminderDate, 
        reminderPerson: person,
        reminderPlan: plan
      });
      
      clearState(userId);
      
      return {
        output: `✅ Perfect! I've saved your reminder for ${reminderDate} (${person}). You'll be notified when it's time! 🎉\n\nIs there anything else I can help you with? Say 'hi' to start over!`,
        type: "reminder_saved",
        gifts: [],
        state: ConversationState.COMPLETED,
        action: "save_reminder",
        reminder: {
          person,
          remind_date: reminderDate,
          plan
        }
      };
    } else {
      // If no date found, ask for date
      updateData(userId, { reminderEventName: eventName });
      return {
        output: "I couldn't find a date in your message. Please provide a date, e.g., 'March 15th' or 'December 20th, 2024'",
        type: "reminder_date",
        gifts: [],
        state: ConversationState.REMINDER
      };
    }
  }

  // Handle standalone surprise plan flow (when user starts with surprise plan, not after gift selection)
  const freshState = getState(userId);
  if (freshState.state === ConversationState.SURPRISE_PLAN && (!freshState.data || !freshState.data.selectedGift)) {
    // Store the gift/recipient info
    updateData(userId, { surpriseGiftInfo: message });
    
    try {
    const aiResponse = await generateAIResponse(
      `The user wants help creating a surprise plan to present: "${message}". 
      Help them create a creative, memorable, and thoughtful surprise plan. Be specific with ideas like timing, location, presentation style, etc.`
    );
    
    // Store the plan
    updateData(userId, { surprisePlan: aiResponse });
      const stateWithPlan = getState(userId);
      setState(userId, ConversationState.REMINDER, stateWithPlan.data);
    
    return {
      output: `${aiResponse}\n\nWould you like me to set a reminder for this surprise plan? (Yes/No)`,
      type: "reminder_question",
      gifts: [],
      state: ConversationState.REMINDER
    };
    } catch (error) {
      console.error('Error generating standalone surprise plan:', error);
      // Fallback response
      const fallbackState = getState(userId);
      setState(userId, ConversationState.REMINDER, fallbackState.data);
      return {
        output: `Here's a simple surprise plan for presenting "${message}":\n\n1. Choose a special moment when the recipient least expects it\n2. Wrap the gift beautifully\n3. Add a personal note or card\n4. Present it with a warm smile and explanation\n\nWould you like me to set a reminder for this plan? (Yes/No)`,
        type: "reminder_question",
        gifts: [],
        state: ConversationState.REMINDER
      };
    }
  }

  // Fallback: use AI for general responses
  try {
  const aiResponse = await generateAIResponse(
    `The user said: "${message}". Respond helpfully and guide them back to the main options if needed.`
  );

  return {
    output: aiResponse,
    type: "general",
    gifts: [],
      state: freshState.state
  };
  } catch (error) {
    console.error('Error in fallback AI response:', error);
    // Final fallback - return a helpful message
    return {
      output: "I'm having trouble processing that right now. Please try saying 'hi' to start over, or choose one of the options: Gift Suggestion, Surprise Plan, or Reminder.",
      type: "error",
      gifts: [],
      state: freshState.state
    };
  }
};

// Main handler
exports.getDeepSeekResponse = async (req, res) => {
  const { prompt, userId } = req.body;

  try {
    const result = await generateDeepSeekResponse(prompt, userId);
    return res.json(result);
  } catch (err) {
    console.error("DeepSeek handler error:", err.response?.data || err.message || err);
    return res.status(500).json({ error: err.message || "Request failed" });
  }
};

exports.generateDeepSeekResponse = generateDeepSeekResponse;
