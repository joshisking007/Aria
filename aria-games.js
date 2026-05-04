
// aria games module
// pattern recognition game — diagnostic read engine
// standalone feature, not contact-tied

const ariaGames = (() => {

  // state
  let activeGame    = null;
  let currentRound  = 0;
  let difficulty    = null;
  let roundData     = [];   // per-round diagnostic data
  let stepData      = [];   // per-step data within current round
  let roundPatterns = [];   // generated patterns for this session
  let currentPattern = null;
  let awaitingAnswer = false;
  let sessionStartTime = null;

  // difficulty config
  const DIFFICULTY = {
    easy: {
      label: 'easy',
      desc:  'short sequences, clear rules',
      rounds: 3,
      stepsPerRound: [3, 4, 5]   // answers per round
    },
    medium: {
      label: 'medium',
      desc:  'longer sequences, mixed types',
      rounds: 3,
      stepsPerRound: [4, 5, 6]
    },
    hard: {
      label: 'hard',
      desc:  'complex rules, ambiguous patterns',
      rounds: 3,
      stepsPerRound: [5, 6, 7]
    }
  };

  // pattern generators
  // each returns { sequence: [], answer, rule, type, hint }

  const PATTERNS = {

    // numeric arithmetic
    numeric_add: (step, diff) => {
      const start = diff === 'hard' ? randomInt(7, 40) : randomInt(1, 10);
      const gap   = diff === 'easy' ? randomPick([1,2,3]) : diff === 'medium' ? randomPick([2,3,5,7]) : randomPick([3,5,7,11,13]);
      const len   = diff === 'easy' ? 4 : diff === 'medium' ? 5 : 6;
      const seq   = Array.from({length: len}, (_, i) => start + i * gap);
      return {
        sequence: seq.slice(0, -1),
        answer: String(seq[seq.length - 1]),
        rule: `+${gap} each time`,
        type: 'numeric',
        hint: 'numbers'
      };
    },

    numeric_mult: (step, diff) => {
      const start = randomInt(1, 4);
      const factor = diff === 'easy' ? 2 : diff === 'medium' ? randomPick([2,3]) : randomPick([2,3,4]);
      const len = diff === 'easy' ? 4 : 5;
      const seq = Array.from({length: len}, (_, i) => start * Math.pow(factor, i));
      return {
        sequence: seq.slice(0, -1).map(n => Math.round(n)),
        answer: String(Math.round(seq[seq.length - 1])),
        rule: `x${factor} each time`,
        type: 'numeric',
        hint: 'numbers'
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
        rule: 'each number is the sum of the two before it',
        type: 'numeric',
        hint: 'numbers'
      };
    },

    numeric_skip: (step, diff) => {
      // alternating adds: +a +b +a +b
      const a = randomPick([1,2,3,4]);
      const b = diff === 'easy' ? a + 1 : randomPick([2,3,5,7].filter(x => x !== a));
      const start = randomInt(1, 10);
      const len = diff === 'easy' ? 5 : 6;
      const seq = [start];
      for (let i = 1; i < len; i++) seq.push(seq[i-1] + (i % 2 === 1 ? a : b));
      return {
        sequence: seq.slice(0, -1),
        answer: String(seq[seq.length - 1]),
        rule: `alternating +${a} and +${b}`,
        type: 'numeric',
        hint: 'numbers'
      };
    },

    // alphabetic
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
        type: 'alpha',
        hint: 'letters'
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
        type: 'alpha',
        hint: 'letters'
      };
    },

    // word-based
    word_repeat: (step, diff) => {
      const sets = {
        easy: [
          ['cat', 'dog'],
          ['red', 'blue'],
          ['yes', 'no'],
          ['sun', 'moon'],
          ['up', 'down'],
        ],
        medium: [
          ['circle', 'square', 'triangle'],
          ['spring', 'summer', 'fall', 'winter'],
          ['fast', 'slow', 'fast'],
          ['north', 'south', 'east'],
        ],
        hard: [
          ['fire', 'water', 'earth', 'air'],
          ['major', 'minor', 'major'],
          ['loud', 'quiet', 'loud', 'silent'],
          ['open', 'closed', 'open'],
        ]
      };
      const pool = sets[diff] || sets.medium;
      const base = randomPick(pool);
      const len  = diff === 'easy' ? 5 : diff === 'medium' ? 6 : 7;
      const seq  = Array.from({length: len}, (_, i) => base[i % base.length]);
      return {
        sequence: seq.slice(0, -1),
        answer: seq[seq.length - 1],
        rule: `repeating: ${base.join(', ')}`,
        type: 'word',
        hint: 'words'
      };
    },

    word_transform: (step, diff) => {
      // categories that cycle
      const chains = {
        easy: [
          { seq: ['hot', 'warm', 'cool', 'cold', 'freezing'], rule: 'temperature descending' },
          { seq: ['tiny', 'small', 'medium', 'large', 'huge'], rule: 'size ascending' },
          { seq: ['day', 'dusk', 'night', 'dawn', 'day'], rule: 'time of day cycle' },
        ],
        medium: [
          { seq: ['whisper', 'talk', 'shout', 'scream', 'silence'], rule: 'volume then reset' },
          { seq: ['walk', 'jog', 'run', 'sprint', 'crawl'], rule: 'speed ascending then reset' },
          { seq: ['seed', 'sprout', 'plant', 'flower', 'seed'], rule: 'life cycle' },
        ],
        hard: [
          { seq: ['order', 'tension', 'conflict', 'chaos', 'order'], rule: 'narrative arc cycle' },
          { seq: ['question', 'search', 'discovery', 'answer', 'question'], rule: 'knowledge cycle' },
          { seq: ['silence', 'note', 'chord', 'melody', 'harmony'], rule: 'musical complexity ascending' },
        ]
      };
      const pool = chains[diff] || chains.medium;
      const choice = randomPick(pool);
      const len = diff === 'easy' ? 4 : diff === 'medium' ? 5 : 5;
      return {
        sequence: choice.seq.slice(0, len - 1),
        answer: choice.seq[len - 1],
        rule: choice.rule,
        type: 'word',
        hint: 'words'
      };
    },

    // mixed (medium/hard only)
    mixed_alternating: (step, diff) => {
      const nums  = [1, 2, 3, 4, 5, 6, 7, 8];
      const words = randomPick([['A','B','C','D'], ['X','Y','Z','X'], ['red','blue','red','blue']]);
      const len   = diff === 'hard' ? 7 : 6;
      const seq   = Array.from({length: len}, (_, i) => i % 2 === 0 ? String(nums[Math.floor(i/2) % nums.length]) : words[Math.floor(i/2) % words.length]);
      return {
        sequence: seq.slice(0, -1),
        answer: seq[seq.length - 1],
        rule: 'alternating numbers and words',
        type: 'mixed',
        hint: 'could be a number or a word'
      };
    }
  };

  // pool selection per round/difficulty
  function getPatternPool(diff, round) {
    const base = ['numeric_add', 'alpha_step', 'word_repeat'];
    const medium_extra = ['numeric_skip', 'alpha_zigzag', 'word_transform'];
    const hard_extra   = ['numeric_fib', 'numeric_mult', 'mixed_alternating', 'word_transform'];

    if (diff === 'easy') return base;
    if (diff === 'medium') return round === 2 ? [...base, ...medium_extra] : medium_extra;
    return round === 2 ? hard_extra : [...medium_extra, ...hard_extra];
  }

  function generatePattern(diff, round) {
    const pool = getPatternPool(diff, round);
    const key  = randomPick(pool);
    return PATTERNS[key]?.(round, diff) || PATTERNS['numeric_add'](round, diff);
  }

  // helpers
  function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function randomPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // normalize answer for comparison
  function normalize(str) {
    return String(str).trim().toLowerCase().replace(/\s+/g, '');
  }

  // diagnostic data accumulation
  function recordStep({ correct, responseTimeMs, pattern, userAnswer }) {
    stepData.push({ correct, responseTimeMs, pattern, userAnswer, timestamp: Date.now() });
  }

  function finalizeRound() {
    const correct = stepData.filter(s => s.correct).length;
    const total   = stepData.length;
    const times   = stepData.map(s => s.responseTimeMs).filter(Boolean);
    const avgTime = times.length ? Math.round(times.reduce((a,b) => a+b, 0) / times.length) : null;
    const types   = stepData.map(s => s.pattern?.type);

    roundData.push({
      round:     currentRound,
      correct,
      total,
      avgTime,
      types,
      steps:     [...stepData],
      accuracy:  total > 0 ? correct / total : 0
    });
    stepData = [];
  }

  // diagnostic read generation
  function generateRead() {
    const allSteps = roundData.flatMap(r => r.steps);
    const totalCorrect = roundData.reduce((a, r) => a + r.correct, 0);
    const totalSteps   = roundData.reduce((a, r) => a + r.total, 0);
    const overallAcc   = totalSteps > 0 ? totalCorrect / totalSteps : 0;

    const times = allSteps.map(s => s.responseTimeMs).filter(Boolean);
    const avgTime = times.length ? times.reduce((a,b) => a+b,0) / times.length : 0;

    // trend: did they get faster or slower?
    const firstHalfTimes  = times.slice(0, Math.floor(times.length / 2));
    const secondHalfTimes = times.slice(Math.floor(times.length / 2));
    const avgFirst  = firstHalfTimes.length  ? firstHalfTimes.reduce((a,b)=>a+b,0)/firstHalfTimes.length  : 0;
    const avgSecond = secondHalfTimes.length ? secondHalfTimes.reduce((a,b)=>a+b,0)/secondHalfTimes.length : 0;
    const gotFaster = avgSecond < avgFirst * 0.85;
    const gotSlower = avgSecond > avgFirst * 1.2;

    // type performance
    const byType = {};
    allSteps.forEach(s => {
      const t = s.pattern?.type || 'unknown';
      if (!byType[t]) byType[t] = { correct: 0, total: 0 };
      byType[t].total++;
      if (s.correct) byType[t].correct++;
    });

    const typeScores = Object.entries(byType).map(([t, d]) => ({
      type: t,
      acc: d.total > 0 ? d.correct / d.total : 0,
      total: d.total
    })).sort((a,b) => b.acc - a.acc);

    const bestType  = typeScores[0];
    const worstType = typeScores[typeScores.length - 1];

    // error recovery: did they correct after a wrong answer
    let recoveries = 0, errorStreak = 0, maxErrorStreak = 0;
    allSteps.forEach((s, i) => {
      if (!s.correct) {
        errorStreak++;
        maxErrorStreak = Math.max(maxErrorStreak, errorStreak);
      } else {
        if (errorStreak > 0) recoveries++;
        errorStreak = 0;
      }
    });

    // round progression
    const r1acc = roundData[0]?.accuracy || 0;
    const r3acc = roundData[2]?.accuracy || 0;
    const improved = r3acc > r1acc + 0.15;
    const declined = r3acc < r1acc - 0.15;

    // build the read
    const observations = [];

    // accuracy read
    if (overallAcc >= 0.85) {
      observations.push('your pattern recognition is sharp. you locked in early and stayed there.');
    } else if (overallAcc >= 0.6) {
      observations.push('you got most of it. the misses weren\'t random — they happened at specific types, which tells me something.');
    } else {
      observations.push('a lot of misses here. that\'s not a bad thing. it tells me how you process uncertainty, which is the interesting part.');
    }

    // speed read
    if (avgTime < 4000) {
      observations.push('you respond fast. either you see it immediately or you trust your gut and commit. both are valid. both carry risk.');
    } else if (avgTime > 12000) {
      observations.push('you take your time. you\'re not guessing — you\'re checking. that\'s deliberate thinking, not hesitation.');
    } else {
      observations.push('your response time was steady. no panic, no rushing. you moved at your own pace even when the pressure was on.');
    }

    // trend read
    if (gotFaster) {
      observations.push('you got faster as you went. you were calibrating, not just answering. by the end you\'d figured out how to read me.');
    } else if (gotSlower) {
      observations.push('you slowed down as the rounds got harder. you stopped guessing and started thinking. that\'s the right adjustment.');
    }

    // type performance
    if (bestType && worstType && bestType.type !== worstType.type && typeScores.length > 1) {
      const typeNames = { numeric: 'number patterns', alpha: 'letter sequences', word: 'word patterns', mixed: 'mixed patterns' };
      const best  = typeNames[bestType.type]  || bestType.type;
      const worst = typeNames[worstType.type] || worstType.type;
      if (bestType.acc > 0.8) {
        observations.push(`${best} came naturally to you. ${worst} were harder — your brain doesn\'t default to that kind of structure.`);
      }
    }

    // recovery read
    if (maxErrorStreak >= 2) {
      observations.push('when you got stuck you stayed stuck for a bit. you didn\'t reset quickly. that\'s worth knowing about yourself under pressure.');
    } else if (recoveries > 0) {
      observations.push('you bounced back from mistakes without losing your rhythm. that\'s not nothing.');
    }

    // progression read
    if (improved) {
      observations.push('you got better across rounds. you were learning the game while playing it. that\'s adaptive thinking.');
    } else if (declined) {
      observations.push('you peaked early and faded. could be fatigue, could be the escalation hit a ceiling in how you process this type of logic.');
    }

    // intuition vs logic
    const fastCorrect = allSteps.filter(s => s.correct && s.responseTimeMs < 5000).length;
    const slowCorrect = allSteps.filter(s => s.correct && s.responseTimeMs >= 5000).length;
    if (fastCorrect > slowCorrect && overallAcc > 0.6) {
      observations.push('most of your correct answers came fast. you\'re running on pattern recognition, not deliberate reasoning. intuitive.');
    } else if (slowCorrect > fastCorrect) {
      observations.push('your correct answers took longer. you\'re working it out, not sensing it. logical processor.');
    }

    // the meta read — what this means
    const metaReads = [
      improved && overallAcc > 0.7 ? 'overall: you learn fast and you don\'t let early mistakes define the session. that tracks beyond pattern games.' : null,
      overallAcc < 0.5 ? 'overall: you struggled with the patterns but you kept going. most people quit when they\'re not winning. you didn\'t.' : null,
      maxErrorStreak === 0 ? 'overall: you didn\'t string mistakes together once. you processed each step clean.' : null,
      gotFaster && improved ? 'overall: you accelerated under pressure. that\'s a specific kind of mental toughness.' : null
    ].filter(Boolean);

    if (metaReads.length) observations.push(metaReads[0]);

    // build profile snapshot for silent storage
    const profileSnapshot = {
      accuracy: Math.round(overallAcc * 100),
      avgResponseMs: Math.round(avgTime),
      trend: gotFaster ? 'accelerating' : gotSlower ? 'decelerating' : 'stable',
      strongType: bestType?.type || null,
      weakType: (typeScores.length > 1 ? worstType?.type : null),
      errorRecovery: maxErrorStreak >= 2 ? 'slow' : recoveries > 0 ? 'good' : 'none-needed',
      learningCurve: improved ? 'rising' : declined ? 'declining' : 'flat',
      processingStyle: (fastCorrect > slowCorrect && overallAcc > 0.6) ? 'intuitive' : 'deliberate',
      playedAt: new Date().toISOString(),
      difficulty
    };

    return { observations, profileSnapshot };
  }


  // ui rendering
  function getContainer() {
    return document.getElementById('gamesScreen');
  }

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

    render(`
      <div class="g-screen">
        <div class="g-topbar">
          <button class="g-back" onclick="showScreen('introScreen')">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M11 14L6 9L11 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <span class="g-topbar-label">// games</span>
        </div>

        <div class="g-lobby">
          <div class="g-hero">
            <div class="g-hero-label">pattern</div>
            <div class="g-hero-title">sequence</div>
            <div class="g-hero-sub">i show you a sequence. you tell me what comes next. three rounds, escalating difficulty. at the end i tell you what i noticed.</div>
          </div>

          <div class="g-diff-label">// pick your level</div>
          <div class="g-diff-grid">
            ${Object.entries(DIFFICULTY).map(([key, d]) => `
              <button class="g-diff-card" onclick="ariaGames.selectDifficulty('${key}')">
                <div class="g-diff-name">${d.label}</div>
                <div class="g-diff-desc">${d.desc}</div>
                <div class="g-diff-arrow">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 8H12M9 5L12 8L9 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
              </button>
            `).join('')}
          </div>

          <div class="g-rules">
            <div class="g-rule">three rounds per session</div>
            <div class="g-rule">wrong answers stay in the data</div>
            <div class="g-rule">you get a read at the end</div>
          </div>
        </div>
      </div>
    `);
  }

  function selectDifficulty(diff) {
    difficulty = diff;
    currentRound = 0;
    roundData = [];
    stepData  = [];
    roundPatterns = [];
    sessionStartTime = Date.now();

    const cfg = DIFFICULTY[diff];
    startRound(0);
  }

  function startRound(roundIndex) {
    currentRound  = roundIndex;
    stepData      = [];
    awaitingAnswer = false;

    const cfg    = DIFFICULTY[difficulty];
    const steps  = cfg.stepsPerRound[roundIndex];
    const roundLabel = roundIndex === 0 ? 'warm up' : roundIndex === 1 ? 'getting harder' : 'the real test';

    // generate patterns for this round
    currentPattern = null;
    roundPatterns  = Array.from({ length: steps }, () => generatePattern(difficulty, roundIndex));

    renderRound(roundIndex, roundLabel, steps);
  }

  let stepIndex = 0;
  let stepStartTime = null;

  function renderRound(roundIndex, roundLabel, totalSteps) {
    stepIndex = 0;
    render(`
      <div class="g-screen">
        <div class="g-topbar">
          <button class="g-back" onclick="ariaGames.showLobby()">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M11 14L6 9L11 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <span class="g-topbar-label">// round ${roundIndex + 1} of 3</span>
          <span class="g-round-tag">${roundLabel}</span>
        </div>

        <div class="g-round-body" id="gRoundBody">
          <div class="g-progress-bar">
            <div class="g-progress-fill" id="gProgressFill" style="width: 0%"></div>
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

    const cfg = DIFFICULTY[difficulty];
    const total = cfg.stepsPerRound[currentRound];
    const pct   = Math.round((idx / total) * 100);

    const fill = document.getElementById('gProgressFill');
    if (fill) fill.style.width = pct + '%';

    const area = document.getElementById('gStepArea');
    if (!area) return;

    const seqItems = pattern.sequence.map((item, i) =>
      `<div class="g-seq-item" style="animation-delay: ${i * 0.06}s">${item}</div>`
    ).join('');

    area.innerHTML = `
      <div class="g-step" id="gCurrentStep">
        <div class="g-step-count">${idx + 1} / ${total}</div>
        <div class="g-step-hint">// ${pattern.hint}</div>
        <div class="g-seq-row">
          ${seqItems}
          <div class="g-seq-item g-seq-blank">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="2.5" fill="currentColor" opacity="0.5"/></svg>
          </div>
        </div>
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
      </div>
    `;

    const input = document.getElementById('gAnswerInput');
    if (input) setTimeout(() => input.focus(), 120);
  }

  function submitAnswer() {
    if (!awaitingAnswer) return;
    awaitingAnswer = false;

    const input = document.getElementById('gAnswerInput');
    if (!input) return;
    const userAnswer = input.value.trim();
    const elapsed    = Date.now() - (stepStartTime || Date.now());

    const correct = normalize(userAnswer) === normalize(currentPattern.answer);

    recordStep({
      correct,
      responseTimeMs: elapsed,
      pattern: currentPattern,
      userAnswer
    });

    const area = document.getElementById('gStepArea');
    const step = document.getElementById('gCurrentStep');

    // show result
    const resultClass = correct ? 'g-result-correct' : 'g-result-wrong';
    const resultLabel = correct ? 'correct' : 'not quite';

    const seqItems = currentPattern.sequence.map((item, i) =>
      `<div class="g-seq-item">${item}</div>`
    ).join('');

    if (step) {
      step.innerHTML = `
        <div class="g-step-count">${stepIndex + 1} / ${DIFFICULTY[difficulty].stepsPerRound[currentRound]}</div>
        <div class="g-step-hint">// ${currentPattern.hint}</div>
        <div class="g-seq-row">
          ${seqItems}
          <div class="g-seq-item ${correct ? 'g-seq-answer-correct' : 'g-seq-answer-wrong'}">${currentPattern.answer}</div>
        </div>
        <div class="g-result ${resultClass}">
          <span class="g-result-label">${resultLabel}</span>
          ${!correct ? `<span class="g-result-yours">you said: ${userAnswer || '(blank)'}</span>` : ''}
          <span class="g-result-rule">rule: ${currentPattern.rule}</span>
        </div>
      `;
    }

    // advance after pause
    setTimeout(() => {
      const nextIdx = stepIndex + 1;
      const total   = DIFFICULTY[difficulty].stepsPerRound[currentRound];

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
    }, correct ? 1400 : 2200);
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

  function continueToRound(roundIndex) {
    startRound(roundIndex);
  }

  function showReadScreen() {
    const { observations, profileSnapshot } = generateRead();

    // silently store profile data if available
    if (typeof ariaMemory !== 'undefined' && ariaMemory.storeGameRead) {
      ariaMemory.storeGameRead(profileSnapshot);
    }
    // also store in localStorage as fallback
    try {
      const existing = JSON.parse(localStorage.getItem('aria_game_reads') || '[]');
      existing.push(profileSnapshot);
      localStorage.setItem('aria_game_reads', JSON.stringify(existing.slice(-20)));
    } catch(_) {}

    const acc = Math.round((roundData.reduce((a,r)=>a+r.correct,0) / roundData.reduce((a,r)=>a+r.total,0)) * 100);

    const obsHtml = observations.map((obs, i) =>
      `<div class="g-obs" style="animation-delay: ${0.3 + i * 0.12}s">${obs}</div>`
    ).join('');

    const container = getContainer();
    if (!container) return;

    container.innerHTML = `
      <div class="g-screen">
        <div class="g-topbar">
          <span class="g-topbar-label">// the read</span>
        </div>

        <div class="g-read-body">
          <div class="g-read-header">
            <div class="g-read-score">${acc}<span class="g-read-pct">%</span></div>
            <div class="g-read-score-label">accuracy across ${roundData.reduce((a,r)=>a+r.total,0)} patterns</div>
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
            <div class="g-obs-label">// what i noticed</div>
            ${obsHtml}
          </div>

          <div class="g-read-footer">
            <div class="g-read-stored">filed to your profile.</div>
            <button class="g-play-again-btn" onclick="ariaGames.showLobby()">
              play again
            </button>
            <button class="g-done-btn" onclick="showScreen('introScreen')">
              done
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // public api
  return {
    init: showLobby,
    showLobby,
    selectDifficulty,
    submitAnswer,
    continueToRound,
  };

})();
