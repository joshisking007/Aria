
// aria games module — v2
// pattern recognition game — diagnostic read engine
// new: shape sequences (SVG), rule-breaking patterns, growing patterns, timer mode

const ariaGames = (() => {

  // state
  let activeGame     = null;
  let currentRound   = 0;
  let difficulty     = null;
  let roundData      = [];
  let stepData       = [];
  let roundPatterns  = [];
  let currentPattern = null;
  let awaitingAnswer = false;
  let sessionStartTime = null;
  let stepIndex      = 0;
  let stepStartTime  = null;
  let timerInterval  = null;
  let timeBonus      = 0;      // accumulated time bonus score

  // difficulty config
  const DIFFICULTY = {
    easy: {
      label: 'easy',
      desc:  'short sequences · clear rules · 20s per question',
      rounds: 3,
      stepsPerRound: [3, 4, 5],
      timeLimit: 20
    },
    medium: {
      label: 'medium',
      desc:  'mixed patterns · some surprises · 15s per question',
      rounds: 3,
      stepsPerRound: [4, 5, 6],
      timeLimit: 15
    },
    hard: {
      label: 'hard',
      desc:  'shifting rules · anomalies · 10s per question',
      rounds: 3,
      stepsPerRound: [5, 6, 7],
      timeLimit: 10
    }
  };

  // ─── SVG SHAPE HELPERS ────────────────────────────────────────────────────

  const SHAPES = {
    circle:   (fill, size=28) => `<svg width="${size}" height="${size}" viewBox="0 0 28 28"><circle cx="14" cy="14" r="11" fill="${fill}" stroke="none"/></svg>`,
    square:   (fill, size=28) => `<svg width="${size}" height="${size}" viewBox="0 0 28 28"><rect x="3" y="3" width="22" height="22" rx="3" fill="${fill}"/></svg>`,
    triangle: (fill, size=28) => `<svg width="${size}" height="${size}" viewBox="0 0 28 28"><polygon points="14,2 26,26 2,26" fill="${fill}"/></svg>`,
    diamond:  (fill, size=28) => `<svg width="${size}" height="${size}" viewBox="0 0 28 28"><polygon points="14,2 26,14 14,26 2,14" fill="${fill}"/></svg>`,
    star:     (fill, size=28) => `<svg width="${size}" height="${size}" viewBox="0 0 28 28"><polygon points="14,2 17,10 26,10 19,16 21,25 14,20 7,25 9,16 2,10 11,10" fill="${fill}"/></svg>`,
    cross:    (fill, size=28) => `<svg width="${size}" height="${size}" viewBox="0 0 28 28"><rect x="11" y="2" width="6" height="24" rx="2" fill="${fill}"/><rect x="2" y="11" width="24" height="6" rx="2" fill="${fill}"/></svg>`,
    pentagon: (fill, size=28) => `<svg width="${size}" height="${size}" viewBox="0 0 28 28"><polygon points="14,2 26,11 21,25 7,25 2,11" fill="${fill}"/></svg>`,
    hexagon:  (fill, size=28) => `<svg width="${size}" height="${size}" viewBox="0 0 28 28"><polygon points="14,2 25,8 25,20 14,26 3,20 3,8" fill="${fill}"/></svg>`,
  };

  const COLORS = {
    red:    '#ef4444',
    blue:   '#3b82f6',
    green:  '#22c55e',
    amber:  '#f59e0b',
    purple: '#a855f7',
    cyan:   '#06b6d4',
    rose:   '#f43f5e',
    lime:   '#84cc16',
  };

  function shapeEl(name, colorKey, size=28) {
    const fn = SHAPES[name] || SHAPES.circle;
    const col = COLORS[colorKey] || colorKey || '#888';
    return `<span class="g-shape-wrap">${fn(col, size)}</span>`;
  }

  function shapeLabel(name, colorKey) {
    return `${colorKey} ${name}`;
  }

  // ─── PATTERN GENERATORS ───────────────────────────────────────────────────

  const PATTERNS = {

    // ── numeric ──────────────────────────────────────────────
    numeric_add: (step, diff) => {
      const start = diff === 'hard' ? randomInt(7, 40) : randomInt(1, 10);
      const gap   = diff === 'easy' ? randomPick([1,2,3]) : diff === 'medium' ? randomPick([2,3,5,7]) : randomPick([3,5,7,11,13]);
      const len   = diff === 'easy' ? 4 : diff === 'medium' ? 5 : 6;
      const seq   = Array.from({length: len}, (_, i) => start + i * gap);
      return {
        sequence: seq.slice(0, -1),
        answer: String(seq[seq.length - 1]),
        rule: `+${gap} each step`,
        type: 'numeric', hint: 'numbers', render: 'text'
      };
    },

    numeric_mult: (step, diff) => {
      const start  = randomInt(1, 4);
      const factor = diff === 'easy' ? 2 : diff === 'medium' ? randomPick([2,3]) : randomPick([2,3,4]);
      const len    = diff === 'easy' ? 4 : 5;
      const seq    = Array.from({length: len}, (_, i) => start * Math.pow(factor, i));
      return {
        sequence: seq.slice(0, -1).map(n => Math.round(n)),
        answer: String(Math.round(seq[seq.length - 1])),
        rule: `×${factor} each step`,
        type: 'numeric', hint: 'numbers', render: 'text'
      };
    },

    numeric_fib: (step, diff) => {
      const a = randomInt(1, 5), b = randomInt(a, a + 4);
      const seq = [a, b];
      const len = diff === 'easy' ? 5 : diff === 'medium' ? 6 : 7;
      for (let i = 2; i < len; i++) seq.push(seq[i-1] + seq[i-2]);
      return {
        sequence: seq.slice(0, -1),
        answer: String(seq[seq.length - 1]),
        rule: 'each number = sum of the two before it',
        type: 'numeric', hint: 'numbers', render: 'text'
      };
    },

    numeric_skip: (step, diff) => {
      const a = randomPick([1,2,3,4]);
      const b = diff === 'easy' ? a + 1 : randomPick([2,3,5,7].filter(x => x !== a));
      const start = randomInt(1, 10);
      const len = diff === 'easy' ? 5 : 6;
      const seq = [start];
      for (let i = 1; i < len; i++) seq.push(seq[i-1] + (i % 2 === 1 ? a : b));
      return {
        sequence: seq.slice(0, -1),
        answer: String(seq[seq.length - 1]),
        rule: `alternating +${a} / +${b}`,
        type: 'numeric', hint: 'numbers', render: 'text'
      };
    },

    // ── alpha ─────────────────────────────────────────────────
    alpha_step: (step, diff) => {
      const startIdx = randomInt(0, 10);
      const gap = diff === 'easy' ? 1 : diff === 'medium' ? randomPick([2,3]) : randomPick([2,3,4,5]);
      const len = diff === 'easy' ? 4 : 5;
      const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const seq = Array.from({length: len}, (_, i) => alpha[(startIdx + i * gap) % 26]);
      return {
        sequence: seq.slice(0, -1),
        answer: seq[seq.length - 1],
        rule: `every ${gap === 1 ? '' : gap + ' '}letter${gap > 1 ? 's' : ''} forward`,
        type: 'alpha', hint: 'letters', render: 'text'
      };
    },

    alpha_zigzag: (step, diff) => {
      const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const startIdx = randomInt(5, 15);
      const up = randomPick([1,2,3]);
      const down = diff === 'easy' ? up : randomPick([1,2,3].filter(x => x !== up));
      const len = diff === 'easy' ? 5 : 6;
      const seq = [startIdx];
      for (let i = 1; i < len; i++) {
        const prev = seq[i-1];
        seq.push(i % 2 === 1 ? prev + up : prev - down);
      }
      return {
        sequence: seq.slice(0, -1).map(i => alpha[Math.max(0, Math.min(25, i))]),
        answer: alpha[Math.max(0, Math.min(25, seq[seq.length - 1]))],
        rule: `+${up} then -${down} alternating`,
        type: 'alpha', hint: 'letters', render: 'text'
      };
    },

    // ── word ──────────────────────────────────────────────────
    word_repeat: (step, diff) => {
      const sets = {
        easy:   [['cat','dog'],['red','blue'],['yes','no'],['sun','moon'],['up','down']],
        medium: [['circle','square','triangle'],['spring','summer','fall','winter'],['fast','slow','fast'],['north','south','east']],
        hard:   [['fire','water','earth','air'],['major','minor','major'],['loud','quiet','loud','silent'],['open','closed','open']]
      };
      const base = randomPick(sets[diff] || sets.medium);
      const len  = diff === 'easy' ? 5 : diff === 'medium' ? 6 : 7;
      const seq  = Array.from({length: len}, (_, i) => base[i % base.length]);
      return {
        sequence: seq.slice(0, -1),
        answer: seq[seq.length - 1],
        rule: `repeating: ${base.join(' → ')}`,
        type: 'word', hint: 'words', render: 'text'
      };
    },

    word_transform: (step, diff) => {
      const chains = {
        easy: [
          { seq: ['hot','warm','cool','cold','freezing'], rule: 'temperature: hottest → coldest' },
          { seq: ['tiny','small','medium','large','huge'], rule: 'size: smallest → largest' },
          { seq: ['day','dusk','night','dawn','day'], rule: 'time of day cycle' },
        ],
        medium: [
          { seq: ['whisper','talk','shout','scream','silence'], rule: 'volume ascending then resets' },
          { seq: ['walk','jog','run','sprint','crawl'], rule: 'speed up then collapse' },
          { seq: ['seed','sprout','plant','flower','seed'], rule: 'life cycle loops' },
        ],
        hard: [
          { seq: ['order','tension','conflict','chaos','order'], rule: 'narrative arc cycle' },
          { seq: ['question','search','discovery','answer','question'], rule: 'knowledge cycle' },
          { seq: ['silence','note','chord','melody','harmony'], rule: 'musical complexity ascending' },
        ]
      };
      const pool = chains[diff] || chains.medium;
      const choice = randomPick(pool);
      const len = diff === 'easy' ? 4 : 5;
      return {
        sequence: choice.seq.slice(0, len - 1),
        answer: choice.seq[len - 1],
        rule: choice.rule,
        type: 'word', hint: 'words', render: 'text'
      };
    },

    mixed_alternating: (step, diff) => {
      const nums  = [1,2,3,4,5,6,7,8];
      const words = randomPick([['A','B','C','D'],['X','Y','Z','X'],['red','blue','red','blue']]);
      const len   = diff === 'hard' ? 7 : 6;
      const seq   = Array.from({length: len}, (_, i) => i % 2 === 0 ? String(nums[Math.floor(i/2) % nums.length]) : words[Math.floor(i/2) % words.length]);
      return {
        sequence: seq.slice(0, -1),
        answer: seq[seq.length - 1],
        rule: 'alternating numbers and words',
        type: 'mixed', hint: 'could be a number or a word', render: 'text'
      };
    },

    // ── SHAPE SEQUENCES (SVG) ────────────────────────────────
    shape_color_cycle: (step, diff) => {
      const shapeList = Object.keys(SHAPES);
      const colorList = Object.keys(COLORS);
      const shape = randomPick(shapeList);
      const cols  = diff === 'easy' ? ['red','blue','green'] : diff === 'medium' ? ['red','blue','green','amber'] : ['red','blue','green','amber','purple'];
      const len   = diff === 'easy' ? 4 : diff === 'medium' ? 5 : 6;
      const seq   = Array.from({length: len}, (_, i) => ({ shape, color: cols[i % cols.length] }));
      return {
        sequence: seq.slice(0, -1),
        answer: seq[seq.length - 1].color + ' ' + seq[seq.length - 1].shape,
        rule: `${shape} cycling through colours`,
        type: 'shape', hint: 'shape colour',
        render: 'shape',
        renderSeq: seq.slice(0, -1),
        renderAnswer: seq[seq.length - 1],
        options: generateShapeOptions(seq[seq.length - 1], cols, shape, shapeList)
      };
    },

    shape_shape_cycle: (step, diff) => {
      const shapes  = diff === 'easy' ? ['circle','square','triangle'] : diff === 'medium' ? ['circle','square','triangle','diamond'] : ['circle','square','triangle','diamond','star'];
      const colorKey = randomPick(Object.keys(COLORS));
      const len  = diff === 'easy' ? 4 : 5;
      const seq  = Array.from({length: len}, (_, i) => ({ shape: shapes[i % shapes.length], color: colorKey }));
      return {
        sequence: seq.slice(0, -1),
        answer: seq[seq.length - 1].color + ' ' + seq[seq.length - 1].shape,
        rule: `${colorKey} shapes cycling`,
        type: 'shape', hint: 'shape name',
        render: 'shape',
        renderSeq: seq.slice(0, -1),
        renderAnswer: seq[seq.length - 1],
        options: generateShapeOptions(seq[seq.length - 1], [colorKey], shapes, Object.keys(SHAPES))
      };
    },

    shape_size_grow: (step, diff) => {
      const shape = randomPick(['circle','square','triangle','diamond']);
      const color = randomPick(Object.keys(COLORS));
      const sizes = diff === 'easy' ? [14,18,22,26] : [12,16,20,24,28,32];
      const len   = diff === 'easy' ? 4 : 5;
      const seq   = sizes.slice(0, len).map(s => ({ shape, color, size: s }));
      return {
        sequence: seq.slice(0, -1),
        answer: seq[seq.length - 1].color + ' ' + seq[seq.length - 1].shape,
        rule: `${shape} growing in size`,
        type: 'shape', hint: 'what comes next (shape grows)',
        render: 'shape-size',
        renderSeq: seq.slice(0, -1),
        renderAnswer: seq[seq.length - 1],
        options: generateShapeOptions(seq[seq.length - 1], [color], [shape], Object.keys(SHAPES))
      };
    },

    // ── RULE-BREAKING (anomaly detection) ────────────────────
    rule_break_numeric: (step, diff) => {
      // A sequence following a rule, but one item breaks it. Player must spot the ODD ONE OUT.
      const start = randomInt(2, 10);
      const gap   = randomPick([2, 3, 4, 5]);
      const len   = diff === 'easy' ? 5 : diff === 'medium' ? 6 : 7;
      const correct = Array.from({length: len}, (_, i) => start + i * gap);
      // inject anomaly at random non-last position
      const anomalyIdx = randomInt(1, len - 2);
      const broken = [...correct];
      broken[anomalyIdx] = correct[anomalyIdx] + randomPick([-3, -2, 2, 3, 7]);
      return {
        sequence: broken,
        answer: String(correct[anomalyIdx]),
        anomalyIdx,
        rule: `+${gap} each step — one number breaks the rule. what SHOULD it be?`,
        type: 'rule_break', hint: 'find the odd one out — type what it SHOULD be',
        render: 'rule-break',
        renderSeq: broken,
        correctSeq: correct,
        anomalyDisplay: broken[anomalyIdx]
      };
    },

    rule_break_shape: (step, diff) => {
      const shapes  = ['circle','square','triangle','diamond'];
      const mainColor = randomPick(Object.keys(COLORS));
      const oddColor  = randomPick(Object.keys(COLORS).filter(c => c !== mainColor));
      const shape   = randomPick(shapes);
      const len     = diff === 'easy' ? 4 : 5;
      const seq     = Array.from({length: len}, () => ({ shape, color: mainColor }));
      const anomalyIdx = randomInt(1, len - 2);
      const oddShape = randomPick(shapes.filter(s => s !== shape));
      seq[anomalyIdx] = { shape: oddShape, color: mainColor };
      return {
        sequence: seq,
        answer: mainColor + ' ' + shape,
        anomalyIdx,
        rule: `all ${mainColor} ${shape}s — one is different. type what it SHOULD be`,
        type: 'rule_break', hint: 'spot the odd one out',
        render: 'shape-break',
        renderSeq: seq,
        options: generateShapeOptions({ shape, color: mainColor }, [mainColor], [shape], shapes)
      };
    },

    // ── GROWING PATTERNS (rule shifts between rounds) ─────────
    // Used for round 2+ — the rule changes slightly each time
    growing_double_shift: (step, diff) => {
      // Round shifts: +n, then +n+1, then +n+2 — rule is "growing gap"
      const start = randomInt(1, 8);
      const baseGap = diff === 'easy' ? 1 : diff === 'medium' ? 2 : 3;
      const len = diff === 'easy' ? 5 : 6;
      const seq = [start];
      for (let i = 1; i < len; i++) seq.push(seq[i-1] + baseGap + (i - 1));
      return {
        sequence: seq.slice(0, -1),
        answer: String(seq[seq.length - 1]),
        rule: `gap grows by 1 each step (starts at ${baseGap})`,
        type: 'growing', hint: 'the gap itself is changing', render: 'text'
      };
    },

    growing_category_shift: (step, diff) => {
      const chains = [
        { seq: ['A','B','C','D','E','F','G'], label: 'alphabet forward' },
        { seq: ['Z','Y','X','W','V','U','T'], label: 'alphabet backward' },
        { seq: ['1','3','6','10','15','21','28'], label: 'triangle numbers' },
      ];
      const choice = randomPick(chains);
      const len = diff === 'easy' ? 4 : diff === 'medium' ? 5 : 6;
      return {
        sequence: choice.seq.slice(0, len - 1),
        answer: choice.seq[len - 1],
        rule: choice.label + ' — the rule itself is evolving',
        type: 'growing', hint: 'look for a shifting rule', render: 'text'
      };
    },

    growing_shape_morph: (step, diff) => {
      // Shape stays, colour AND size evolve together
      const shape = randomPick(['circle','square','diamond']);
      const colorSeq = ['red','amber','green','cyan','blue','purple'];
      const sizeSeq  = [14, 17, 20, 23, 26, 29];
      const len = diff === 'easy' ? 4 : 5;
      const seq = Array.from({length: len}, (_, i) => ({ shape, color: colorSeq[i], size: sizeSeq[i] }));
      return {
        sequence: seq.slice(0, -1),
        answer: seq[seq.length - 1].color + ' ' + seq[seq.length - 1].shape,
        rule: `${shape} — colour AND size shift each step`,
        type: 'growing', hint: 'both colour and size are changing',
        render: 'shape-size',
        renderSeq: seq.slice(0, -1),
        renderAnswer: seq[seq.length - 1],
        options: generateShapeOptions(seq[seq.length - 1], colorSeq, [shape], Object.keys(SHAPES))
      };
    },
  };

  function generateShapeOptions(correct, colorPool, shapePool, allShapes) {
    // Generate 4 multiple-choice shape options including the correct one
    const opts = new Set();
    opts.add(correct.color + ' ' + correct.shape);
    const attempts = 20;
    let i = 0;
    while (opts.size < 4 && i++ < attempts) {
      const c = randomPick(colorPool.length > 1 ? colorPool : Object.keys(COLORS));
      const s = randomPick(shapePool.length > 1 ? shapePool : allShapes);
      opts.add(c + ' ' + s);
    }
    return shuffleArr([...opts]);
  }

  function shuffleArr(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ─── POOL SELECTION ───────────────────────────────────────────────────────

  function getPatternPool(diff, round) {
    const base_text    = ['numeric_add', 'alpha_step', 'word_repeat'];
    const base_shape   = ['shape_color_cycle', 'shape_shape_cycle'];
    const medium_extra = ['numeric_skip', 'alpha_zigzag', 'word_transform', 'shape_size_grow'];
    const hard_extra   = ['numeric_fib', 'numeric_mult', 'mixed_alternating', 'word_transform'];
    const break_extra  = ['rule_break_numeric', 'rule_break_shape'];
    const grow_extra   = ['growing_double_shift', 'growing_category_shift', 'growing_shape_morph'];

    if (diff === 'easy') {
      if (round === 0) return [...base_text, ...base_shape];
      if (round === 1) return [...base_text, ...base_shape, ...medium_extra];
      return [...base_text, ...base_shape, ...medium_extra, ...break_extra];
    }
    if (diff === 'medium') {
      if (round === 0) return [...base_text, ...base_shape, ...medium_extra];
      if (round === 1) return [...medium_extra, ...base_shape, ...break_extra];
      return [...medium_extra, ...break_extra, ...grow_extra];
    }
    // hard
    if (round === 0) return [...medium_extra, ...base_shape, ...hard_extra];
    if (round === 1) return [...hard_extra, ...break_extra, ...grow_extra];
    return [...break_extra, ...grow_extra, ...hard_extra];
  }

  function generatePattern(diff, round) {
    const pool = getPatternPool(diff, round);
    const key  = randomPick(pool);
    return PATTERNS[key]?.(round, diff) || PATTERNS['numeric_add'](round, diff);
  }

  // ─── HELPERS ──────────────────────────────────────────────────────────────

  function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function randomPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function normalize(str) {
    return String(str).trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // ─── TIMER ────────────────────────────────────────────────────────────────

  function startStepTimer(timeLimit) {
    clearInterval(timerInterval);
    const bar = document.getElementById('gTimerBar');
    const lbl = document.getElementById('gTimerLabel');
    if (!bar || !lbl) return;

    let remaining = timeLimit;
    bar.style.width = '100%';
    bar.style.background = 'var(--green, #22c55e)';
    lbl.textContent = remaining + 's';

    timerInterval = setInterval(() => {
      remaining--;
      const pct = Math.max(0, (remaining / timeLimit) * 100);
      bar.style.width = pct + '%';
      lbl.textContent = remaining + 's';

      if (pct < 30) bar.style.background = '#ef4444';
      else if (pct < 60) bar.style.background = '#f59e0b';
      else bar.style.background = 'var(--green, #22c55e)';

      if (remaining <= 0) {
        clearInterval(timerInterval);
        if (awaitingAnswer) autoTimeOut();
      }
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
  }

  function autoTimeOut() {
    awaitingAnswer = false;
    stopTimer();

    const elapsed = Date.now() - (stepStartTime || Date.now());
    recordStep({ correct: false, responseTimeMs: elapsed, pattern: currentPattern, userAnswer: '(time out)', timedOut: true });

    const step = document.getElementById('gCurrentStep');
    if (step) {
      const seqHtml = renderSequenceHtml(currentPattern, true);
      step.innerHTML = `
        <div class="g-step-count">${stepIndex + 1} / ${DIFFICULTY[difficulty].stepsPerRound[currentRound]}</div>
        <div class="g-seq-row">${seqHtml}</div>
        <div class="g-result g-result-wrong">
          <span class="g-result-label">time's up</span>
          <span class="g-result-yours">answer was: ${currentPattern.answer}</span>
          <span class="g-result-rule">rule: ${currentPattern.rule}</span>
        </div>
      `;
    }

    setTimeout(() => advanceStep(), 2200);
  }

  // ─── DIAGNOSTIC DATA ──────────────────────────────────────────────────────

  function recordStep({ correct, responseTimeMs, pattern, userAnswer, timedOut }) {
    stepData.push({ correct, responseTimeMs, pattern, userAnswer, timedOut: !!timedOut, timestamp: Date.now() });
  }

  function finalizeRound() {
    const correct = stepData.filter(s => s.correct).length;
    const total   = stepData.length;
    const times   = stepData.map(s => s.responseTimeMs).filter(Boolean);
    const avgTime = times.length ? Math.round(times.reduce((a,b) => a+b,0) / times.length) : null;
    const types   = stepData.map(s => s.pattern?.type);
    roundData.push({ round: currentRound, correct, total, avgTime, types, steps: [...stepData], accuracy: total > 0 ? correct / total : 0 });
    stepData = [];
  }

  // ─── RENDERING HELPERS ────────────────────────────────────────────────────

  function renderShapeItem(item, size) {
    return shapeEl(item.shape, item.color, size || 28);
  }

  function renderSequenceHtml(pattern, showAnswer) {
    let seqItems = '';

    if (pattern.render === 'shape' || pattern.render === 'shape-break') {
      seqItems = (pattern.renderSeq || pattern.sequence).map((item, i) => {
        const isAnomaly = pattern.anomalyIdx === i;
        return `<div class="g-seq-item g-seq-shape${isAnomaly ? ' g-seq-anomaly' : ''}" style="animation-delay:${i*0.07}s">${renderShapeItem(item)}</div>`;
      }).join('');
    } else if (pattern.render === 'shape-size') {
      seqItems = (pattern.renderSeq || pattern.sequence).map((item, i) =>
        `<div class="g-seq-item g-seq-shape" style="animation-delay:${i*0.07}s">${renderShapeItem(item, item.size)}</div>`
      ).join('');
    } else if (pattern.render === 'rule-break') {
      seqItems = (pattern.renderSeq || pattern.sequence).map((item, i) => {
        const isAnomaly = pattern.anomalyIdx === i;
        return `<div class="g-seq-item${isAnomaly ? ' g-seq-anomaly' : ''}" style="animation-delay:${i*0.07}s">${item}</div>`;
      }).join('');
    } else {
      seqItems = pattern.sequence.map((item, i) =>
        `<div class="g-seq-item" style="animation-delay:${i*0.07}s">${item}</div>`
      ).join('');
    }

    if (showAnswer) {
      const isShape = pattern.render === 'shape' || pattern.render === 'shape-size' || pattern.render === 'shape-break';
      const answerEl = isShape && pattern.renderAnswer
        ? renderShapeItem(pattern.renderAnswer, pattern.renderAnswer.size || 28)
        : pattern.answer;
      seqItems += `<div class="g-seq-item g-seq-answer-correct" style="animation-delay:0s">${answerEl}</div>`;
    }

    return seqItems;
  }

  function renderAnswerUi(pattern) {
    // For shape patterns and rule_break_shape: show multiple choice buttons
    if ((pattern.render === 'shape' || pattern.render === 'shape-size' || pattern.render === 'shape-break') && pattern.options) {
      const opts = pattern.options.map(opt => {
        const [color, ...shapeParts] = opt.split(' ');
        const shapeName = shapeParts.join(' ');
        const svg = SHAPES[shapeName] ? shapeEl(shapeName, color, 26) : opt;
        return `<button class="g-choice-btn" onclick="ariaGames.submitChoice('${opt}')" title="${opt}">
          <span class="g-choice-shape">${svg}</span>
          <span class="g-choice-label">${opt}</span>
        </button>`;
      }).join('');
      return `<div class="g-choice-grid">${opts}</div>`;
    }

    // Text input for everything else
    return `
      <div class="g-input-row">
        <input
          class="g-answer-input"
          id="gAnswerInput"
          type="text"
          placeholder="what comes next"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          onkeydown="if(event.key==='Enter') ariaGames.submitAnswer()"
        />
        <button class="g-submit-btn" onclick="ariaGames.submitAnswer()">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 9H14M10 5L14 9L10 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    `;
  }

  // ─── UI: LOBBY ────────────────────────────────────────────────────────────

  function getContainer() { return document.getElementById('gamesScreen'); }

  function render(html) {
    const c = getContainer();
    if (c) c.innerHTML = html;
  }

  function showLobby() {
    activeGame    = null;
    currentRound  = 0;
    roundData     = [];
    stepData      = [];
    difficulty    = null;
    stopTimer();

    render(`
      <div class="g-screen">
        <div class="g-topbar">
          <button class="g-back" onclick="showScreen('introScreen')">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M11 14L6 9L11 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <span class="g-topbar-label">Games</span>
        </div>

        <div class="g-lobby">
          <div class="g-hero">
            <div class="g-hero-eyebrow">pattern recognition</div>
            <div class="g-hero-title">Se<span>qu</span>ence</div>
            <div class="g-hero-sub">
              i show you a sequence — numbers, letters, shapes, or hidden rules.
              you tell me what comes next. three rounds, escalating difficulty.
              <br><br>
              some patterns break their own rules. some rules change mid-game.
              at the end, i tell you what i noticed about how you think.
            </div>
            <div class="g-hero-tags">
              <span class="g-hero-tag">⬡ shapes</span>
              <span class="g-hero-tag">⚡ timed</span>
              <span class="g-hero-tag">⚑ anomalies</span>
              <span class="g-hero-tag">↗ growing rules</span>
            </div>
          </div>

          <div class="g-divider">
            <div class="g-divider-line"></div>
            <div class="g-divider-text">pick your level</div>
            <div class="g-divider-line"></div>
          </div>

          <div class="g-diff-grid">
            ${[
              { key: 'easy',   num: '01', label: 'Easy',   desc: 'short sequences · clear rules · 20s per question',     color: '#34d399' },
              { key: 'medium', num: '02', label: 'Medium', desc: 'mixed patterns · some surprises · 15s per question',   color: '#fbbf24' },
              { key: 'hard',   num: '03', label: 'Hard',   desc: 'shifting rules · anomalies · 10s per question',        color: '#f97316' },
            ].map(d => `
              <button class="g-diff-card" data-level="${d.key}" onclick="ariaGames.selectDifficulty('${d.key}')">
                <div class="g-diff-card-inner">
                  <div class="g-diff-num">${d.num}</div>
                  <div class="g-diff-content">
                    <div class="g-diff-name">${d.label}</div>
                    <div class="g-diff-desc">${d.desc}</div>
                  </div>
                  <div class="g-diff-arrow">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 9H14M10 5L14 9L10 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </div>
                </div>
                <div class="g-diff-accent"></div>
              </button>
            `).join('')}
          </div>

          <div class="g-rules">
            <div class="g-rule">three rounds</div>
            <div class="g-rule">mistakes stay in</div>
            <div class="g-rule">read at the end</div>
          </div>
        </div>
      </div>
    `);
  }

  // ─── UI: GAME FLOW ────────────────────────────────────────────────────────

  function selectDifficulty(diff) {
    difficulty = diff;
    currentRound = 0;
    roundData = [];
    stepData  = [];
    roundPatterns = [];
    timeBonus = 0;
    sessionStartTime = Date.now();
    startRound(0);
  }

  function startRound(roundIndex) {
    currentRound   = roundIndex;
    stepData       = [];
    awaitingAnswer = false;
    stopTimer();

    const cfg    = DIFFICULTY[difficulty];
    const steps  = cfg.stepsPerRound[roundIndex];
    const roundLabel = roundIndex === 0 ? 'warm up' : roundIndex === 1 ? 'getting harder' : 'the real test';

    currentPattern = null;
    roundPatterns  = Array.from({ length: steps }, () => generatePattern(difficulty, roundIndex));

    renderRound(roundIndex, roundLabel, steps);
  }

  function renderRound(roundIndex, roundLabel, totalSteps) {
    stepIndex = 0;
    render(`
      <div class="g-screen">
        <div class="g-topbar">
          <button class="g-back" onclick="ariaGames.showLobby()">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M11 14L6 9L11 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <span class="g-topbar-label">Round ${roundIndex + 1} of 3</span>
          <span class="g-round-tag">${roundLabel}</span>
        </div>

        <div class="g-round-body" id="gRoundBody">
          <div class="g-progress-bar">
            <div class="g-progress-fill" id="gProgressFill" style="width: 0%"></div>
          </div>
          <div class="g-timer-row">
            <div class="g-timer-bar-track">
              <div class="g-timer-bar" id="gTimerBar"></div>
            </div>
            <div class="g-timer-label" id="gTimerLabel">${DIFFICULTY[difficulty].timeLimit}s</div>
          </div>
          <div id="gStepArea"></div>
        </div>
      </div>
    `);
    showStep(0);
  }

  function showStep(idx) {
    stepIndex = idx;
    const pattern = roundPatterns[idx];
    currentPattern = pattern;
    awaitingAnswer = true;
    stepStartTime  = Date.now();

    const cfg   = DIFFICULTY[difficulty];
    const total = cfg.stepsPerRound[currentRound];
    const pct   = Math.round((idx / total) * 100);

    const fill = document.getElementById('gProgressFill');
    if (fill) fill.style.width = pct + '%';

    const area = document.getElementById('gStepArea');
    if (!area) return;

    const seqHtml   = renderSequenceHtml(pattern, false);
    const answerUi  = renderAnswerUi(pattern);

    // Type badge
    const typeBadge = {
      shape:      '⬡ shapes',
      rule_break: '⚑ spot the anomaly',
      growing:    '↗ shifting rule',
      numeric:    '# numbers',
      alpha:      'Aa letters',
      word:       '✦ words',
      mixed:      '∿ mixed',
    }[pattern.type] || pattern.hint;

    area.innerHTML = `
      <div class="g-step" id="gCurrentStep">
        <div class="g-step-meta">
          <div class="g-step-count">${idx + 1} / ${total}</div>
          <div class="g-type-badge">${typeBadge}</div>
        </div>
        <div class="g-step-hint">${pattern.hint}</div>
        <div class="g-seq-row">${seqHtml}
          <div class="g-seq-item g-seq-blank">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="2.5" fill="currentColor" opacity="0.5"/></svg>
          </div>
        </div>
        ${answerUi}
      </div>
    `;

    const input = document.getElementById('gAnswerInput');
    if (input) setTimeout(() => input.focus(), 120);

    startStepTimer(cfg.timeLimit);
  }

  function submitAnswer() {
    if (!awaitingAnswer) return;
    awaitingAnswer = false;
    stopTimer();

    const input = document.getElementById('gAnswerInput');
    if (!input) return;
    const userAnswer = input.value.trim();
    processAnswer(userAnswer);
  }

  function submitChoice(choice) {
    if (!awaitingAnswer) return;
    awaitingAnswer = false;
    stopTimer();
    processAnswer(choice);
  }

  function processAnswer(userAnswer) {
    const elapsed = Date.now() - (stepStartTime || Date.now());
    const correct = normalize(userAnswer) === normalize(currentPattern.answer);

    if (correct) {
      const cfg = DIFFICULTY[difficulty];
      const bonus = Math.max(0, cfg.timeLimit - Math.round(elapsed / 1000));
      timeBonus += bonus;
    }

    recordStep({ correct, responseTimeMs: elapsed, pattern: currentPattern, userAnswer });

    const step = document.getElementById('gCurrentStep');
    if (!step) { advanceStep(); return; }

    const resultClass = correct ? 'g-result-correct' : 'g-result-wrong';
    const resultLabel = correct ? 'correct' : 'not quite';

    const seqHtml = renderSequenceHtml(currentPattern, true);

    step.innerHTML = `
      <div class="g-step-meta">
        <div class="g-step-count">${stepIndex + 1} / ${DIFFICULTY[difficulty].stepsPerRound[currentRound]}</div>
      </div>
      <div class="g-seq-row">${seqHtml}</div>
      <div class="g-result ${resultClass}">
        <span class="g-result-label">${resultLabel}</span>
        ${!correct ? `<span class="g-result-yours">you said: ${userAnswer || '(blank)'}</span>` : ''}
        <span class="g-result-rule">rule: ${currentPattern.rule}</span>
      </div>
    `;

    setTimeout(advanceStep, correct ? 1400 : 2200);
  }

  function advanceStep() {
    const nextIdx  = stepIndex + 1;
    const total    = DIFFICULTY[difficulty].stepsPerRound[currentRound];
    if (nextIdx < total) {
      showStep(nextIdx);
    } else {
      finalizeRound();
      const nextRound = currentRound + 1;
      if (nextRound < DIFFICULTY[difficulty].rounds) {
        showRoundTransition(nextRound);
      } else {
        showReadScreen();
      }
    }
  }

  function showRoundTransition(nextRound) {
    const labels = ['warm up', 'getting harder', 'the real test'];
    const intros = [
      'round two. same idea, harder patterns.',
      'last round. this is the one that actually tells me something.'
    ];
    const container = getContainer();
    if (!container) return;
    container.innerHTML = `
      <div class="g-screen g-transition-screen">
        <div class="g-transition-body">
          <div class="g-transition-round">round ${nextRound + 1}</div>
          <div class="g-transition-label">${labels[nextRound]}</div>
          <div class="g-transition-note">${intros[nextRound - 1] || ''}</div>
          <button class="g-continue-btn" onclick="ariaGames.continueToRound(${nextRound})">
            continue
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 8H12M9 5L12 8L9 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
    `;
  }

  function continueToRound(roundIndex) { startRound(roundIndex); }

  // ─── UI: READ SCREEN ──────────────────────────────────────────────────────

  function showReadScreen() {
    stopTimer();
    const { observations, profileSnapshot } = generateRead();

    try {
      if (typeof ariaMemory !== 'undefined' && ariaMemory.storeGameRead) ariaMemory.storeGameRead(profileSnapshot);
    } catch(_) {}
    try {
      const existing = JSON.parse(localStorage.getItem('aria_game_reads') || '[]');
      existing.push(profileSnapshot);
      localStorage.setItem('aria_game_reads', JSON.stringify(existing.slice(-20)));
    } catch(_) {}

    const acc = Math.round((roundData.reduce((a,r) => a+r.correct,0) / roundData.reduce((a,r) => a+r.total,0)) * 100);

    const obsHtml = observations.map((obs, i) =>
      `<div class="g-obs" style="animation-delay:${0.3 + i * 0.12}s">${obs}</div>`
    ).join('');

    const container = getContainer();
    if (!container) return;
    container.innerHTML = `
      <div class="g-screen">
        <div class="g-topbar">
          <span class="g-topbar-label">The Read</span>
        </div>
        <div class="g-read-body">
          <div class="g-read-header">
            <div class="g-read-score">${acc}<span class="g-read-pct">%</span></div>
            <div class="g-read-score-label">accuracy · ${roundData.reduce((a,r)=>a+r.total,0)} patterns · +${timeBonus}s bonus</div>
          </div>
          <div class="g-round-summary">
            ${roundData.map((r, i) => `
              <div class="g-round-pill">
                <span class="g-round-pill-label">r${i+1}</span>
                <span class="g-round-pill-score">${r.correct}/${r.total}</span>
              </div>
            `).join('')}
          </div>
          <div class="g-obs-section">
            <div class="g-obs-label">what i noticed</div>
            ${obsHtml}
          </div>
          <div class="g-read-footer">
            <div class="g-read-stored">filed to your profile.</div>
            <button class="g-play-again-btn" onclick="ariaGames.showLobby()">play again</button>
            <button class="g-done-btn" onclick="showScreen('introScreen')">done</button>
          </div>
        </div>
      </div>
    `;
  }

  // ─── DIAGNOSTIC READ ──────────────────────────────────────────────────────

  function generateRead() {
    const allSteps     = roundData.flatMap(r => r.steps);
    const totalCorrect = roundData.reduce((a, r) => a + r.correct, 0);
    const totalSteps   = roundData.reduce((a, r) => a + r.total, 0);
    const overallAcc   = totalSteps > 0 ? totalCorrect / totalSteps : 0;

    const times    = allSteps.map(s => s.responseTimeMs).filter(Boolean);
    const avgTime  = times.length ? times.reduce((a,b)=>a+b,0)/times.length : 0;
    const firstHalf  = times.slice(0, Math.floor(times.length/2));
    const secondHalf = times.slice(Math.floor(times.length/2));
    const avgFirst   = firstHalf.length  ? firstHalf.reduce((a,b)=>a+b,0)/firstHalf.length  : 0;
    const avgSecond  = secondHalf.length ? secondHalf.reduce((a,b)=>a+b,0)/secondHalf.length : 0;
    const gotFaster  = avgSecond < avgFirst * 0.85;
    const gotSlower  = avgSecond > avgFirst * 1.2;

    const byType = {};
    allSteps.forEach(s => {
      const t = s.pattern?.type || 'unknown';
      if (!byType[t]) byType[t] = { correct: 0, total: 0 };
      byType[t].total++;
      if (s.correct) byType[t].correct++;
    });

    const typeScores = Object.entries(byType).map(([t, d]) => ({
      type: t, acc: d.total > 0 ? d.correct / d.total : 0, total: d.total
    })).sort((a,b) => b.acc - a.acc);

    const bestType  = typeScores[0];
    const worstType = typeScores[typeScores.length - 1];

    const timedOut    = allSteps.filter(s => s.timedOut).length;
    let recoveries = 0, errorStreak = 0, maxErrorStreak = 0;
    allSteps.forEach(s => {
      if (!s.correct) { errorStreak++; maxErrorStreak = Math.max(maxErrorStreak, errorStreak); }
      else { if (errorStreak > 0) recoveries++; errorStreak = 0; }
    });

    const r1acc    = roundData[0]?.accuracy || 0;
    const r3acc    = roundData[2]?.accuracy || 0;
    const improved = r3acc > r1acc + 0.15;
    const declined = r3acc < r1acc - 0.15;

    const obs = [];

    if (overallAcc >= 0.85) obs.push('your pattern recognition is sharp. you locked in early and stayed there.');
    else if (overallAcc >= 0.6) obs.push('you got most of it. the misses weren\'t random — they happened at specific types, which tells me something.');
    else obs.push('a lot of misses here. that\'s not a bad thing. it tells me how you process uncertainty, which is the interesting part.');

    if (timedOut > 0) obs.push(`you ran out of time on ${timedOut} question${timedOut > 1 ? 's' : ''}. that means you were sitting in uncertainty instead of committing. interesting decision.`);

    if (avgTime < 4000) obs.push('you respond fast. either you see it immediately or you trust your gut and commit. both are valid.');
    else if (avgTime > 12000) obs.push('you take your time. you\'re not guessing — you\'re checking. that\'s deliberate thinking, not hesitation.');
    else obs.push('your response time was steady. no panic, no rushing.');

    if (gotFaster) obs.push('you got faster as you went. you were calibrating, not just answering. by the end you\'d figured out how to read me.');
    else if (gotSlower) obs.push('you slowed down as the rounds got harder. you stopped guessing and started thinking. that\'s the right adjustment.');

    // shape-specific
    const shapePrf = byType['shape'];
    if (shapePrf) {
      if (shapePrf.acc >= 0.8) obs.push('visual patterns came naturally to you. you read shape sequences differently than text ones — faster, more instinctively.');
      else if (shapePrf.acc < 0.4) obs.push('shape sequences tripped you up. you\'re wired for symbolic logic more than spatial pattern reading.');
    }

    // anomaly detection
    const breakPrf = byType['rule_break'];
    if (breakPrf) {
      if (breakPrf.acc >= 0.75) obs.push('you caught the anomalies. you weren\'t just completing patterns — you were auditing them. that\'s a different kind of attention.');
      else obs.push('the rule-breaking patterns got you. you were solving, not questioning. most people do the same.');
    }

    // growing patterns
    const growPrf = byType['growing'];
    if (growPrf) {
      if (growPrf.acc >= 0.6) obs.push('you adapted when the rules shifted. that\'s not easy — most people anchor to the first rule they learned.');
      else obs.push('the shifting-rule patterns were hard for you. your brain found a rule and held it even when it changed.');
    }

    if (bestType && worstType && bestType.type !== worstType.type && typeScores.length > 1) {
      const typeNames = { numeric:'number patterns', alpha:'letter sequences', word:'word patterns', mixed:'mixed patterns', shape:'shape sequences', rule_break:'anomaly patterns', growing:'growing patterns' };
      if (bestType.acc > 0.8) obs.push(`${typeNames[bestType.type] || bestType.type} came naturally. ${typeNames[worstType.type] || worstType.type} were harder — your brain doesn\'t default to that structure.`);
    }

    if (maxErrorStreak >= 2) obs.push('when you got stuck you stayed stuck for a bit. you didn\'t reset quickly. worth knowing about yourself under pressure.');
    else if (recoveries > 0) obs.push('you bounced back from mistakes without losing your rhythm. that\'s not nothing.');

    if (improved) obs.push('you got better across rounds. you were learning the game while playing it. that\'s adaptive thinking.');
    else if (declined) obs.push('you peaked early and faded. could be fatigue, could be the escalation hit a ceiling in how you process this type of logic.');

    const fastCorrect = allSteps.filter(s => s.correct && s.responseTimeMs < 5000).length;
    const slowCorrect = allSteps.filter(s => s.correct && s.responseTimeMs >= 5000).length;
    if (fastCorrect > slowCorrect && overallAcc > 0.6) obs.push('most of your correct answers came fast. you\'re running on pattern recognition, not deliberate reasoning. intuitive.');
    else if (slowCorrect > fastCorrect) obs.push('your correct answers took longer. you\'re working it out, not sensing it. logical processor.');

    const meta = [
      improved && overallAcc > 0.7 ? 'overall: you learn fast and you don\'t let early mistakes define the session. that tracks beyond pattern games.' : null,
      overallAcc < 0.5 ? 'overall: you struggled with the patterns but you kept going. most people quit when they\'re not winning. you didn\'t.' : null,
      maxErrorStreak === 0 ? 'overall: you didn\'t string mistakes together once. you processed each step clean.' : null,
      gotFaster && improved ? 'overall: you accelerated under pressure. that\'s a specific kind of mental toughness.' : null
    ].filter(Boolean);
    if (meta.length) obs.push(meta[0]);

    const profileSnapshot = {
      accuracy: Math.round(overallAcc * 100),
      avgResponseMs: Math.round(avgTime),
      trend: gotFaster ? 'accelerating' : gotSlower ? 'decelerating' : 'stable',
      strongType: bestType?.type || null,
      weakType: typeScores.length > 1 ? worstType?.type : null,
      errorRecovery: maxErrorStreak >= 2 ? 'slow' : recoveries > 0 ? 'good' : 'none-needed',
      learningCurve: improved ? 'rising' : declined ? 'declining' : 'flat',
      processingStyle: (fastCorrect > slowCorrect && overallAcc > 0.6) ? 'intuitive' : 'deliberate',
      timedOutCount: timedOut,
      timeBonus,
      playedAt: new Date().toISOString(),
      difficulty
    };

    return { observations: obs, profileSnapshot };
  }

  // ─── PUBLIC API ───────────────────────────────────────────────────────────

  return {
    init: showLobby,
    showLobby,
    selectDifficulty,
    submitAnswer,
    submitChoice,
    continueToRound,
  };

})();
