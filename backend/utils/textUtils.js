/**
 * Calculates the similarity between two strings using the Sørensen-Dice coefficient.
 * This method is effective at finding similarities even with minor differences in wording.
 * @param {string} str1 - The first string.
 * @param {string} str2 - The second string.
 * @returns {number} A similarity score between 0 and 1.
 */
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) {
    return 0;
  }

  str1 = str1.toLowerCase();
  str2 = str2.toLowerCase();

  if (str1 === str2) {
    return 1;
  }

  const bigrams1 = getBigrams(str1);
  const bigrams2 = getBigrams(str2);

  const intersection = new Set([...bigrams1].filter(x => bigrams2.has(x)));
  const score = (2 * intersection.size) / (bigrams1.size + bigrams2.size);

  return score;
}

/**
 * Generates a set of bigrams from a string.
 * Bigrams are pairs of consecutive characters, useful for string comparison.
 * @param {string} str - The string to process.
 * @returns {Set<string>} A set of bigrams.
 */
function getBigrams(str) {
  const bigrams = new Set();
  if (str.length <= 1) {
    bigrams.add(str);
    return bigrams;
  }

  for (let i = 0; i < str.length - 1; i++) {
    bigrams.add(str.substring(i, i + 2));
  }
  return bigrams;
}


/**
 * Normalizes and cleans text to improve consistency.
 * - Trims whitespace
 * - Converts to lowercase
 * - Removes common filler words
 * - Standardizes spacing around punctuation
 * @param {string} text - The text to normalize.
 * @returns {string} The normalized text.
 */
function normalizeText(text) {
  if (!text) {
    return '';
  }

  let normalized = text.trim().toLowerCase();

  // Remove filler words that don't add much meaning
  const fillerWords = /\b(um|uh|hmm|ah|er|like|you know|i mean)\b/g;
  normalized = normalized.replace(fillerWords, '');

  // Standardize spacing around punctuation
  normalized = normalized.replace(/\s*([,.?!;:])\s*/g, '$1 ');

  // Remove extra whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}


module.exports = {
  calculateSimilarity,
  normalizeText,
}; 