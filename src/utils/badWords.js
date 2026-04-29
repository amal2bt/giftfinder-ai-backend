// Comprehensive list of inappropriate words and phrases
// This list includes common profanity, offensive terms, and inappropriate content

const BAD_WORDS = [
  // Explicit profanity
  'fuck', 'fucking', 'fucked', 'fucker', 'fucks',
  'shit', 'shitting', 'shitted', 'shitter', 'shits',
  'damn', 'damned', 'damnit',
  'hell', 'hells',
  'ass', 'asses', 'asshole', 'assholes',
  'bitch', 'bitches', 'bitching', 'bitched',
  'bastard', 'bastards',
  'crap', 'craps', 'crappy',
  'piss', 'pissing', 'pissed', 'pisser',
  'dick', 'dicks', 'dickhead', 'dickheads',
  'cock', 'cocks', 'cocksucker', 'cocksuckers',
  'pussy', 'pussies',
  'tits', 'titties', 'boobs', 'boobies',
  'slut', 'sluts', 'slutty',
  'whore', 'whores',
  'nigger', 'niggers', 'nigga', 'niggas',
  'retard', 'retarded', 'retards',
  'gay', 'gays', // Context-dependent, but included for filtering
  'lesbian', 'lesbians',
  'homo', 'homos', 'homosexual',
  
  // Offensive terms
  'idiot', 'idiots', 'idiotic',
  'stupid', 'stupidity', 'stupidly',
  'moron', 'morons', 'moronic',
  'dumb', 'dumber', 'dumbest', 'dumbass', 'dumbasses',
  'loser', 'losers',
  'freak', 'freaks', 'freaky',
  'weirdo', 'weirdos',
  'creep', 'creeps', 'creepy',
  'psycho', 'psychos', 'psychotic','hate',
  
  // Violence and threats
  'kill', 'killing', 'killed', 'killer', 'kills',
  'murder', 'murdering', 'murdered', 'murderer', 'murders',
  'die', 'dying', 'died', 'death', 'deaths',
  'suicide', 'suicidal', 'suicides',
  'bomb', 'bombs', 'bombing', 'bombed',
  'terrorist', 'terrorists', 'terrorism',
  'shoot', 'shooting', 'shot', 'shooter', 'shots',
  'gun', 'guns', 'gunman',
  'knife', 'knives', 'stabbing', 'stabbed',
  'rape', 'raping', 'raped', 'rapist', 'rapes',
  'torture', 'torturing', 'tortured',
  
  // Drugs and alcohol (context-dependent)
  'drug', 'drugs', 'drug dealer', 'drug dealers',
  'cocaine', 'coke',
  'heroin', 'heroine',
  'marijuana', 'weed', 'pot',
  'alcohol', 'drunk', 'drunken', 'drinking',
  'beer', 'wine', 'whiskey', 'vodka',
  
  // Sexual content
  'sex', 'sexual', 'sexually',
  'porn', 'porno', 'pornography', 'pornographic',
  'nude', 'nudes', 'nudity',
  'naked', 'nakedness',
  'orgasm', 'orgasms', 'orgasmic',
  'masturbate', 'masturbating', 'masturbated', 'masturbation',
  'ejaculate', 'ejaculating', 'ejaculated', 'ejaculation',
  'penis', 'penises',
  'vagina', 'vaginas',
  'breast', 'breasts',
  
  // Hate speech and discrimination
  'hate', 'hating', 'hated', 'hater', 'haters',
  'racist', 'racism', 'racists',
  'nazi', 'nazis', 'nazism',
  'kkk', 'ku klux klan',
  'terrorist', 'terrorists',
  
  // Scams and illegal activities
  'scam', 'scams', 'scamming', 'scammed', 'scammer',
  'fraud', 'frauds', 'fraudulent',
  'steal', 'stealing', 'stole', 'stolen', 'steals', 'thief', 'thieves',
  'rob', 'robbing', 'robbed', 'robber', 'robbers', 'robbery',
  'hack', 'hacking', 'hacked', 'hacker', 'hackers',
  'pirate', 'pirates', 'piracy', 'pirated',
  
  // Spam and unwanted content
  'spam', 'spamming', 'spammed', 'spammer',
  'clickbait', 'clickbaits',
  'scam', 'scams',
  
  // Common variations and leetspeak
  'f*ck', 'f**k', 'f***', 'f****',
  'sh*t', 's**t', 's***',
  'a$$', 'a**',
  'b*tch', 'b**ch', 'b***h',
  'd*ck', 'd**k',
  'p*ssy', 'p**sy', 'p***y',
  
  // Numbers used to replace letters
  'f4ck', 'sh1t', 'a55', 'b1tch', 'd1ck',
];

// Function to check if text contains bad words
function containsBadWords(text) {
  if (!text || typeof text !== 'string') return false;
  
  const lowerText = text.toLowerCase();
  const words = lowerText.split(/\s+/);
  const normalizedText = lowerText.replace(/[^a-z0-9\s]/g, ' '); // Remove special chars for better matching
  
  // Check for exact word matches
  for (const badWord of BAD_WORDS) {
    // Check if bad word appears as a whole word (not part of another word)
    const regex = new RegExp(`\\b${badWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(normalizedText)) {
      return true;
    }
    
    // Also check if it's part of the text (for leetspeak and variations)
    if (normalizedText.includes(badWord)) {
      return true;
    }
  }
  
  return false;
}

// Function to get list of bad words found in text (for debugging/admin purposes)
function getBadWordsFound(text) {
  if (!text || typeof text !== 'string') return [];
  
  const found = [];
  const lowerText = text.toLowerCase();
  const normalizedText = lowerText.replace(/[^a-z0-9\s]/g, ' ');
  
  for (const badWord of BAD_WORDS) {
    const regex = new RegExp(`\\b${badWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(normalizedText) || normalizedText.includes(badWord)) {
      found.push(badWord);
    }
  }
  
  return [...new Set(found)]; // Remove duplicates
}

module.exports = {
  BAD_WORDS,
  containsBadWords,
  getBadWordsFound,
};

