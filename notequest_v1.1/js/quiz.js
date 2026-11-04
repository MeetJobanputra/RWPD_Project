/* ==========================================================
   quiz.js — turns a mind map into multiple-choice questions.

   Rule: we never invent facts. Every question is built ONLY from
     1. how topics are connected in the map,
     2. the optional "extra info" text on a topic,
     3. question-and-answer pairs the user wrote.
   Wrong answer choices are always taken from the user's own saved
   content (other topics or other answers), never made up.
   ========================================================== */
const QuizBuilder = (() => {
  const norm = text => String(text).trim().toLowerCase();

  function shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /** Remove duplicates (ignoring upper/lower case) and anything in `exclude`. */
  function uniqueTexts(list, exclude) {
    const seen = new Set(exclude.map(norm));
    const result = [];
    list.forEach(text => {
      const key = norm(text);
      if (!key || seen.has(key)) return;
      seen.add(key);
      result.push(text);
    });
    return result;
  }

  /**
   * Build one question object.
   * Picks up to 3 wrong choices from `pool` (4 choices total when possible).
   * Returns null if there is no wrong choice available (a question needs at least 2 choices).
   */
  function makeQuestion(kind, prompt, correct, pool, explain, alsoExclude) {
    const wrongChoices = shuffle(uniqueTexts(pool, [correct].concat(alsoExclude || []))).slice(0, 3);
    if (wrongChoices.length === 0) return null;
    const options = shuffle([correct].concat(wrongChoices));
    return { kind, prompt, options, answerIndex: options.indexOf(correct), explain };
  }

  /** Build the question for one custom question-and-answer pair. */
  function questionFromPair(map, pair) {
    // Prefer the user's own wrong answers, then other saved answers, then topic names.
    const pool = []
      .concat(pair.wrong || [])
      .concat(map.qa.filter(other => other.id !== pair.id).map(other => other.a))
      .concat(map.nodes.map(node => node.text));
    // Keep the user's own wrong answers first, but still random among the pool.
    const own = uniqueTexts(pair.wrong || [], [pair.a]);
    const rest = shuffle(uniqueTexts(pool, [pair.a].concat(own)));
    const wrongChoices = own.concat(rest).slice(0, 3);
    if (wrongChoices.length === 0) return null;
    const options = shuffle([pair.a].concat(wrongChoices));
    return {
      kind: 'custom',
      prompt: pair.q,
      options,
      answerIndex: options.indexOf(pair.a),
      explain: 'Your saved answer: “' + pair.a + '”.'
    };
  }

  /** Build every question this map can produce. */
  function build(map) {
    const questions = [];
    if (!map || !Array.isArray(map.nodes)) return questions;

    const byId = new Map(map.nodes.map(n => [n.id, n]));
    const childrenOf = id => map.nodes.filter(n => n.parentId === id);

    // 1) "Which topic is directly connected under <parent>?"
    map.nodes.forEach(parent => {
      const kids = childrenOf(parent.id);
      if (!kids.length) return;
      const kidTexts = kids.map(k => k.text);
      const pool = map.nodes.filter(n => n.id !== parent.id && n.parentId !== parent.id).map(n => n.text);
      kids.forEach(kid => {
        const q = makeQuestion('child',
          'Which topic is directly connected under “' + parent.text + '”?',
          kid.text, pool,
          'In your mind map, “' + kid.text + '” is a sub-topic of “' + parent.text + '”.',
          kidTexts.concat(parent.text));
        if (q) questions.push(q);
      });
    });

    // 2) "Which topic is <node> connected under?"
    map.nodes.forEach(node => {
      const parent = byId.get(node.parentId);
      if (!parent) return;
      const pool = map.nodes.filter(n => n.id !== node.id && n.id !== parent.id).map(n => n.text);
      const q = makeQuestion('parent',
        'Which topic is “' + node.text + '” connected under?',
        parent.text, pool,
        'In your mind map, “' + node.text + '” sits directly under “' + parent.text + '”.',
        [node.text]);
      if (q) questions.push(q);
    });

    // 3) "Which topic matches this description?" (uses the node's extra info)
    map.nodes.forEach(node => {
      if (!node.info) return;
      const pool = map.nodes.filter(n => n.id !== node.id).map(n => n.text);
      const q = makeQuestion('info',
        'Which topic matches this description?\n“' + node.info + '”',
        node.text, pool,
        'Your note for “' + node.text + '” says: “' + node.info + '”',
        []);
      if (q) questions.push(q);
    });

    // 4) The user's own question-and-answer pairs
    map.qa.forEach(pair => {
      const q = questionFromPair(map, pair);
      if (q) questions.push(q);
    });

    // Drop exact duplicates (same prompt and same correct answer)
    const seen = new Set();
    return questions.filter(q => {
      const key = norm(q.prompt) + '|' + norm(q.options[q.answerIndex]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Can this custom pair become a question? (Used for warnings in the editor.) */
  function pairIsUsable(map, pair) {
    return !!questionFromPair(map, pair);
  }

  return { build, shuffle, pairIsUsable };
})();
