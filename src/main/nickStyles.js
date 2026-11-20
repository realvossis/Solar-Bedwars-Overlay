'use strict';
// Built-in nick styles for the nick roller: the shapes a rolled Hypixel nick can have, ranked by how
// much they read like a real (or even OG) account - plus the "tells" that make a nick obvious.
//
// Sources: Hypixel forum threads cataloguing the /nick random-name formats and how legit each looks
// (2021: "Snakeeeee" graded best, then Word_Word like "Nice_Night"; "TheLegitPyro", "im_esme265",
// "itsviolet661", "Rory417", "teddycastro2006", leetspeak "theluckysn4ke" called instantly obvious),
// the OG / semi-OG naming guide (a single word = OG; plural/suffix twists = semi-OG; "_x", "xXxX",
// "iName", "3x4mpl3" are not), and real nicks from the user's own games (Eagleeee, Fluffy_Kitty,
// FluffyTea, DeadlyKen, BlueBlueBlue). Pure, so test/nickStyles.test.js can check every example.
const { isWord, isName, segment } = require('./nickWords');

const lettersOnly = (n) => /^[A-Za-z]+$/.test(n);
const wordish = (s) => isWord(s) || isName(s);
// "FluffyTea" -> ["Fluffy","Tea"]; "Fluffy_Kitty" -> ["Fluffy","Kitty"]; lowercase runs are split by
// the dictionary ("fluffytea" -> ["fluffy","tea"]).
function parts(n) {
  if (n.includes('_')) return n.split('_');
  const camel = n.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])/g) || [n];
  if (camel.length > 1) return camel;
  return segment(n.toLowerCase()) || [n];
}
// A word with a "semi-OG" ending: Ravens, Glitching, Frosty, Hunter.
function semiBase(w) {
  const l = w.toLowerCase();
  for (const [suf, add] of [['ies', 'y'], ['es', ''], ['s', ''], ['ing', ''], ['ing', 'e'], ['er', ''], ['er', 'e'], ['ers', ''], ['y', ''], ['ie', ''], ['ey', '']]) {
    if (l.length > suf.length + 2 && l.endsWith(suf)) {
      let base = l.slice(0, -suf.length) + add;
      if (isWord(base)) return base;
      if (/(.)\1$/.test(base) && isWord(base.slice(0, -1))) return base.slice(0, -1); // glitching -> glitch, running -> run
    }
  }
  return null;
}

const STYLES = [
  {
    id: 'og', name: 'OG word', tier: 'S', examples: ['Frost', 'Raven', 'Glacier'],
    desc: 'One real word and nothing else - the textbook OG name.',
    test: (n) => lettersOnly(n) && n.length >= 3 && isWord(n),
  },
  {
    id: 'stretched', name: 'Stretched word', tier: 'S', examples: ['Eagleeee', 'Snakeeeee', 'Frostttt'],
    desc: 'A real word with its last letter held. The rarest random-nick format and the one players rate most legit.',
    test: (n) => {
      const m = n.match(/^([A-Za-z]*?)([A-Za-z])\2{2,}$/);
      return !!m && m[1].length >= 2 && (wordish(m[1] + m[2]) || wordish(m[1] + m[2] + m[2]));
    },
  },
  {
    id: 'short', name: 'Short', tier: 'S', examples: ['Cube', 'Zyx', 'Mako'],
    desc: '3-4 letters, letters only. Short names are the most wanted names on the game.',
    test: (n) => /^[A-Za-z]{3,4}$/.test(n),
  },
  {
    id: 'echo', name: 'Echo', tier: 'A', examples: ['BlueBlueBlue', 'ByeBye', 'Toto'],
    desc: 'One short word said two or three times - reads like a real early account.',
    test: (n) => /^([A-Za-z]{2,6})\1{1,3}$/i.test(n),
  },
  {
    id: 'word_word', name: 'Word_Word', tier: 'A', examples: ['Nice_Night', 'Fluffy_Kitty', 'Lazy_Panda'],
    desc: 'Two real words joined by an underscore - the cleanest of the common formats.',
    test: (n) => { const p = n.split('_'); return p.length === 2 && p.every((x) => x.length >= 2 && lettersOnly(x) && wordish(x)); },
  },
  {
    id: 'two_words', name: 'TwoWords', tier: 'A', examples: ['FluffyTea', 'DeadlyKen', 'CoolBoy'],
    desc: 'Two real words (or a word and a first name) run together, no numbers.',
    test: (n) => { if (!lettersOnly(n)) return false; const p = parts(n); return p.length === 2 && p.every((x) => x.length >= 2 && wordish(x)); },
  },
  {
    id: 'semi_og', name: 'Semi-OG', tier: 'A', examples: ['Ravens', 'Glitching', 'Frosty'],
    desc: 'A real word with a small twist: plural, -ing, -er or -y. Still clean, still rare.',
    test: (n) => lettersOnly(n) && n.length >= 4 && !isWord(n) && !!semiBase(n),
  },
  {
    id: 'wrapped', name: '__wrapped__', tier: 'B', examples: ['__kfir__', '_oCats_', '__Frost__'],
    desc: 'A name wrapped in matching underscores.',
    test: (n) => /^(_{1,2})[A-Za-z][A-Za-z0-9]{1,11}\1$/.test(n),
  },
  {
    id: 'short_digit', name: 'Short + digit', tier: 'B', examples: ['Tony9', 'ruby8', 'Kai7'],
    desc: 'A short name and a single digit - looks like someone who really wanted that name.',
    test: (n) => /^[A-Za-z]{3,6}\d$/.test(n),
  },
  {
    id: 'xx', name: 'xX classic Xx', tier: 'B', examples: ['xXPsychoKidXx', 'xXFrostXx'],
    desc: 'The 2013 style. Cringe to some, a throwback to others.',
    test: (n) => /^xX[A-Za-z0-9]{2,12}Xx$/.test(n),
  },
  {
    id: 'name_year', name: 'NameYear', tier: 'C', examples: ['Jake2009', 'EdwardG2008', 'Lily_2011'],
    desc: 'A name and a birth year. Real kids use it - but experienced players read it as a nick.',
    test: (n) => /^[A-Za-z]{3,11}_?(?:19[89]\d|20[0-2]\d)$/.test(n),
  },
  {
    id: 'name_num', name: 'Name + numbers', tier: 'C', examples: ['Rory417', 'Max_22'],
    desc: 'A name and 2-3 numbers: the most common random-nick shape, so the easiest to spot.',
    test: (n) => /^[A-Za-z]{3,12}_?\d{2,3}$/.test(n),
  },
];
const BY_ID = new Map(STYLES.map((s) => [s.id, s]));

// Substrings that make a name read as offensive (kept short and generic on purpose).
const OFFENSIVE = /f[a4]n?gg?[o0]t|fag|nigg|n1gg|retard|rape|nazi|hitler|kys|porn|slut|whore|pussy|cock|dick|cum(?!b)|sex/i;

// Shapes that make experienced players (and snipers) think "nick" at a glance.
const TELLS = [
  { id: 'the', label: 'starts with "The"', example: 'TheLegitPyro', test: (n) => /^the(?:[A-Z_]|[a-z]{5,})/i.test(n) && !isWord(n) && !isName(n) },
  { id: 'im_its', label: 'starts with "Im"/"Its"', example: 'im_esme265', test: (n) => /^(?:i_?m|its|iam)(?:_|[A-Z]|[a-z]{3,}\d)/i.test(n) && !isWord(n) },
  { id: 'leet', label: 'numbers in place of letters', example: 'theluckysn4ke', test: (n) => /[A-Za-z][0-9]+[A-Za-z]/.test(n) },
  { id: 'many_digits', label: 'ends in 3+ digits', example: 'Rory417', test: (n) => /\d{3,}$/.test(n), unless: ['name_year', 'name_num'] },
  { id: 'full_name_year', label: 'firstname+lastname+year', example: 'teddycastro2006', test: (n) => /^[a-z]{8,}(?:19|20)\d\d$/.test(n) },
  // Hypixel's generator really has produced names that read as slurs when run together.
  { id: 'offensive', label: 'reads as offensive', example: '', test: (n) => OFFENSIVE.test(n) },
];

// The enabled styles a name has, as [{ id, name, tier }].
function stylesOf(name, enabled) {
  const n = String(name || '');
  const ids = Array.isArray(enabled) ? enabled : STYLES.map((s) => s.id);
  return ids.map((id) => BY_ID.get(id)).filter((s) => s && s.test(n)).map(({ id, name: nm, tier }) => ({ id, name: nm, tier }));
}
// The tells a name shows, ignoring ones that come with a style you explicitly chose.
function tellsOf(name, matchedStyleIds = []) {
  const n = String(name || '');
  return TELLS.filter((t) => t.test(n) && !(t.unless || []).some((id) => matchedStyleIds.includes(id)));
}

module.exports = { STYLES, TELLS, stylesOf, tellsOf, parts, semiBase };
