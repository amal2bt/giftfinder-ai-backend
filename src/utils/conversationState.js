// Conversation state management for chatbot flow
// Stores conversation state in memory (can be migrated to database later)

const conversationStates = new Map();

const ConversationState = {
  INITIAL: 'initial',
  GIFT_SUGGESTION: 'gift_suggestion',
  GIFT_QUESTIONS: 'gift_questions',
  GIFT_SELECTION: 'gift_selection',
  SURPRISE_PLAN: 'surprise_plan',
  REMINDER: 'reminder',
  COMPLETED: 'completed'
};

const QuestionType = {
  RECIPIENT_NAME: 'recipient_name',
  RELATION: 'relation',
  FEELINGS: 'feelings',
  INTERESTS: 'interests',
  AGE: 'age',
  BUDGET: 'budget'
};

function getState(userId) {
  return conversationStates.get(userId) || {
    state: ConversationState.INITIAL,
    data: {},
    currentQuestion: null
  };
}

function setState(userId, state, data = {}) {
  const currentState = getState(userId);
  conversationStates.set(userId, {
    state,
    data: { ...currentState.data, ...data },
    currentQuestion: currentState.currentQuestion
  });
}

function setCurrentQuestion(userId, questionType) {
  const currentState = getState(userId);
  conversationStates.set(userId, {
    ...currentState,
    currentQuestion: questionType
  });
}

function clearState(userId) {
  conversationStates.delete(userId);
}

function updateData(userId, updates) {
  const currentState = getState(userId);
  conversationStates.set(userId, {
    ...currentState,
    data: { ...currentState.data, ...updates }
  });
}

module.exports = {
  ConversationState,
  QuestionType,
  getState,
  setState,
  setCurrentQuestion,
  clearState,
  updateData
};


