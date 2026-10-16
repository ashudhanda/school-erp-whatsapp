// Intent classification runs in two passes:
// 1. Exact pass: multi-word phrases are matched against the normalized text; single-word
//    keywords must appear as whole words (so "present" matches but "presentable" doesn't).
// 2. Fuzzy pass: ASCII words (4-16 letters, /[a-z]{4,16}/) are compared by Levenshtein
//    distance to single-word keywords that share the first letter (allowed edits:
//    1 for short words, 2 for long). Non-ASCII words skip fuzzy matching entirely.
//    Common parent misspellings (e.g. "attendence") are also listed as exact-pass
//    keywords above — that's intentional, not a typo to "fix".
// PERSONAL intents require the sender to be linked to a student before answering.
const GROUPS={attendance:['attendance','attendence','present','absent','hajri','haazri','उपस्थिति','हाजिरी'],marks:['marks','result','results','अंक','परिणाम'],fees:['fees','fee','dues','फीस'],homework:['homework','होमवर्क','गृहकार्य'],datesheet:['date sheet','datesheet','timetable','test dates','डेट शीट','परीक्षा तिथि'],leave:['leave','sick leave','अवकाश','छुट्टी आवेदन'],admission:['admission','admissions','प्रवेश'],holidays:['holidays','holiday','छुट्टियां','छुट्टियाँ'],timings:['timings','timing','school time','समय'],notices:['notices','notice','सूचनाएं','सूचना']};
const PERSONAL=new Set(['attendance','marks','fees','homework','datesheet','leave']);
/**
 * Levenshtein edit distance between two strings (single-row DP, O(b) memory).
 * Used only by the fuzzy pass of classify() to tolerate parent typos.
 */
function distance(a,b){const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let diagonal=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,diagonal+(a[i-1]===b[j-1]?0:1));diagonal=old;}}return row[b.length];}
/**
 * Classify a parent's raw message text into an intent.
 * Pure function: no I/O, no state, so it is safe to unit-test with arbitrary strings.
 * Confidence scale: 1 = exact keyword or multi-word phrase match, 0.8 = fuzzy
 * Levenshtein typo match, 0 = no keyword matched (caller routes at >= 0.7).
 * @param {*} input - anything stringifiable; non-strings are coerced via String()
 * @returns {{intent: string|null, confidence: number, personal: boolean}} `intent` is null when
 * no keyword matched; `personal` is true only for intents that require the sender to be
 * linked to a student before the bot may answer (see PERSONAL).
 */
export function classify(input) {
  const text=String(input||'').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();const words=text.split(' ');
  for(const [intent,terms]of Object.entries(GROUPS))if(terms.some(term=>term.includes(' ')?text.includes(term):words.includes(term)))return {intent,confidence:1,personal:PERSONAL.has(intent)};
  for(const word of words)if(/^[a-z]{4,16}$/.test(word))for(const [intent,terms]of Object.entries(GROUPS))if(terms.some(term=>term[0]===word[0]&&!term.includes(' ')&&distance(word,term)<=(word.length<7?1:2)))return {intent,confidence:0.8,personal:PERSONAL.has(intent)};
  return {intent:null,confidence:0,personal:false};
}
