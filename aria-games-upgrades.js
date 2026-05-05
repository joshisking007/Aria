
// ═══════════════════════════════════════════════════════════════════════════════
// ARIA GAMES — UPGRADE LAYER
// Adds to aria-games.js (injected after the base module):
//   1. Feed-forward disposition cache  — profileSnapshot → Aria's next conversation
//   2. Quit detection                  — tracks abandonment signals with pattern analysis
//   3. Emotional read engine           — warm, specific, voice-matched observations
//   4. Contextual trigger API          — lets Aria suggest the game mid-convo
// ═══════════════════════════════════════════════════════════════════════════════

const ariaGamesUpgrade = (() => {

  // ─── CONSTANTS ─────────────────────────────────────────────────────────────

  const CACHE_KEY       = 'aria_game_disposition';
  const QUIT_LOG_KEY    = 'aria_game_quits';
  const CACHE_TTL_MS    = 7 * 24 * 60 * 60 * 1000; // 7 days — don't re-read stale data
  const MAX_QUIT_LOGS   = 30;

  // ─── 1. FEED-FORWARD DISPOSITION CACHE ────────────────────────────────────
  // The profile snapshot is more than a score. It gets distilled into a
  // *disposition* that Aria carries into every subsequent conversation —
  // informing tone, pacing, what she volunteers vs holds back.

  const dispositionCache = (() => {

    function buildDisposition(snapshot) {
      // Convert raw game metrics into Aria behavioral directives
      const d = {
        generatedAt: Date.now(),
        rawSnapshot: snapshot,
        directives: {}
      };

      const s = snapshot;

      // ── Pacing directive ──────────────────────────────────────────────────
      // How fast should Aria talk? Does she let silence breathe or fill it?
      if (s.processingStyle === 'intuitive' && s.trend === 'accelerating') {
        d.directives.pacing = 'fast — they think fast and commit. don\'t over-explain. trust them to keep up.';
      } else if (s.processingStyle === 'deliberate' && s.avgResponseMs > 10000) {
        d.directives.pacing = 'slow and deliberate — they need time to process. don\'t rush them. let thoughts land.';
      } else if (s.trend === 'decelerating') {
        d.directives.pacing = 'variable — starts fast, slows under pressure. give more space when things get complex.';
      } else {
        d.directives.pacing = 'steady — consistent processor. match their rhythm.';
      }

      // ── Frustration threshold ─────────────────────────────────────────────
      // When rules shift or things break pattern — do they adapt or freeze?
      const ruleBreakAcc = s.weakType === 'rule_break' ? 'low' : s.strongType === 'rule_break' ? 'high' : 'medium';
      if (ruleBreakAcc === 'low' && s.errorRecovery === 'slow') {
        d.directives.ruleShiftTolerance = 'low — gets frustrated when rules change unexpectedly. announce shifts. don\'t surprise them.';
      } else if (ruleBreakAcc === 'high') {
        d.directives.ruleShiftTolerance = 'high — actively enjoys finding when rules break. can handle curveballs and ambiguity.';
      } else {
        d.directives.ruleShiftTolerance = 'medium — adapts eventually. one surprise at a time.';
      }

      // ── Error recovery style ──────────────────────────────────────────────
      if (s.errorRecovery === 'slow') {
        d.directives.errorResponse = 'when they make a mistake: don\'t dwell on it, don\'t explain at length. brief acknowledgment then move on. they ruminate on their own — don\'t add to it.';
      } else if (s.errorRecovery === 'good') {
        d.directives.errorResponse = 'bounces back cleanly from mistakes. brief acknowledgment is fine. no need to cushion.';
      } else {
        d.directives.errorResponse = 'no error pattern yet. treat mistakes matter-of-factly.';
      }

      // ── Confidence signal ─────────────────────────────────────────────────
      if (s.timedOutCount >= 2) {
        d.directives.confidencePattern = 'sits in uncertainty rather than committing. can freeze under pressure. when they hesitate — a gentle nudge works better than waiting.';
      } else if (s.processingStyle === 'intuitive' && s.accuracy >= 70) {
        d.directives.confidencePattern = 'confident and fast. trusts their gut. doesn\'t need validation — gets annoyed by it.';
      } else if (s.learningCurve === 'rising') {
        d.directives.confidencePattern = 'builds into confidence. starts cautious, gets surer. let the arc happen.';
      } else {
        d.directives.confidencePattern = 'steady confidence. no particular quirks detected.';
      }

      // ── What to volunteer vs hold back ───────────────────────────────────
      if (s.strongType === 'shape' && s.weakType === 'numeric') {
        d.directives.communicationMode = 'spatial and visual thinker. responds better to examples, analogies, concrete images than abstract rules or numbers.';
      } else if (s.strongType === 'numeric' && s.weakType === 'shape') {
        d.directives.communicationMode = 'logical and symbolic thinker. prefers clear rules and structure over metaphors and abstraction.';
      } else if (s.strongType === 'word' || s.strongType === 'alpha') {
        d.directives.communicationMode = 'language-native. reads between the lines instinctively. can handle nuance and subtext.';
      } else {
        d.directives.communicationMode = 'mixed processor. versatile. can move between modes without much friction.';
      }

      // ── Adaptive learning flag ───────────────────────────────────────────
      d.directives.learningStyle = s.learningCurve === 'rising'
        ? 'learns fast mid-session. calibrates while doing. doesn\'t need things repeated — they\'ll get it.'
        : s.learningCurve === 'declining'
          ? 'peaks early, fades under sustained load. keep sessions shorter. don\'t pile on at the end.'
          : 'consistent learner. steady through the session.';

      // ── Overall behavioral tag ────────────────────────────────────────────
      // One plain-English summary Aria can reference internally
      const tags = [];
      if (s.processingStyle === 'intuitive') tags.push('intuitive processor');
      if (s.processingStyle === 'deliberate') tags.push('deliberate processor');
      if (s.learningCurve === 'rising') tags.push('adapts upward');
      if (s.errorRecovery === 'slow') tags.push('ruminates on mistakes');
      if (s.timedOutCount >= 2) tags.push('hesitates under pressure');
      if (s.strongType === 'rule_break') tags.push('notices anomalies');
      if (ruleBreakAcc === 'low') tags.push('anchors to first rule');
      if (s.accuracy >= 85) tags.push('high pattern confidence');
      if (s.accuracy < 50) tags.push('uncertain pattern reader');
      d.directives.behavioralTags = tags;

      return d;
    }

    function save(snapshot) {
      try {
        const disposition = buildDisposition(snapshot);
        localStorage.setItem(CACHE_KEY, JSON.stringify(disposition));
        // Also push into ariaMemory if available
        injectIntoAriaMemory(disposition);
        return disposition;
      } catch(_) {}
    }

    function load() {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const d = JSON.parse(raw);
        // Expire old reads
        if (Date.now() - (d.generatedAt || 0) > CACHE_TTL_MS) return null;
        return d;
      } catch(_) { return null; }
    }

    function clear() {
      localStorage.removeItem(CACHE_KEY);
    }

    function injectIntoAriaMemory(disposition) {
      // Push behavioral directives into ariaMemory so they reach the system prompt
      if (typeof ariaMemory === 'undefined') return;
      const d = disposition.directives;
      const s = disposition.rawSnapshot;
      try {
        // Store each directive as a memory — Aria will see these in buildContext()
        ariaMemory.remember('game_profile', 'pacing',             d.pacing,             0.85, 'game');
        ariaMemory.remember('game_profile', 'rule_shift',         d.ruleShiftTolerance, 0.85, 'game');
        ariaMemory.remember('game_profile', 'error_response',     d.errorResponse,      0.85, 'game');
        ariaMemory.remember('game_profile', 'confidence',         d.confidencePattern,  0.85, 'game');
        ariaMemory.remember('game_profile', 'comm_mode',          d.communicationMode,  0.85, 'game');
        ariaMemory.remember('game_profile', 'learning_style',     d.learningStyle,      0.85, 'game');
        if (d.behavioralTags?.length) {
          ariaMemory.remember('game_profile', 'behavioral_tags', d.behavioralTags.join(', '), 0.9, 'game');
        }
        ariaMemory.remember('game_profile', 'accuracy_pct',       String(s.accuracy),   0.9, 'game');
        ariaMemory.remember('game_profile', 'processing_style',   s.processingStyle,    0.9, 'game');
        ariaMemory.remember('game_profile', 'last_played',        s.playedAt,           0.9, 'game');
      } catch(_) {}
    }

    // Build the system prompt injection for buildSystemPrompt()
    // Called by the patched version of buildSystemPrompt in aria-core
    function buildPromptFragment() {
      const d = load();
      if (!d) return '';
      const lines = ['\n\nGAME PROFILE — HOW THIS PERSON PROCESSES (from pattern game):'];
      if (d.directives.pacing)           lines.push(`  pacing: ${d.directives.pacing}`);
      if (d.directives.ruleShiftTolerance) lines.push(`  rule shifts: ${d.directives.ruleShiftTolerance}`);
      if (d.directives.errorResponse)    lines.push(`  on mistakes: ${d.directives.errorResponse}`);
      if (d.directives.confidencePattern) lines.push(`  confidence: ${d.directives.confidencePattern}`);
      if (d.directives.communicationMode) lines.push(`  communication: ${d.directives.communicationMode}`);
      if (d.directives.learningStyle)    lines.push(`  learning: ${d.directives.learningStyle}`);
      if (d.directives.behavioralTags?.length) {
        lines.push(`  tags: ${d.directives.behavioralTags.join(' · ')}`);
      }
      lines.push('  (let these inform tone, pacing, how you frame things — don\'t mention the game unless they do)');
      return lines.join('\n');
    }

    return { save, load, clear, buildPromptFragment, buildDisposition };
  })();


  // ─── 2. QUIT DETECTION ─────────────────────────────────────────────────────
  // Tracks when and how users abandon the game. Patterns are more informative
  // than single events: always quitting on rule_break questions tells us something.

  const quitDetector = (() => {

    // Call this when the user navigates away from an active game mid-session
    function recordQuit({ roundIndex, stepIndex, totalSteps, pattern, sessionDuration, difficulty, quitReason }) {
      const entry = {
        timestamp:       Date.now(),
        difficulty,
        roundIndex,
        stepIndex,
        totalSteps,
        progressPct:     totalSteps > 0 ? Math.round(((roundIndex * 10 + stepIndex) / (30)) * 100) : 0,
        patternType:     pattern?.type || null,
        patternRender:   pattern?.render || null,
        sessionDurationMs: sessionDuration || 0,
        quitReason       // 'nav_away' | 'back_btn' | 'lobby' | 'timeout_streak'
      };

      try {
        const existing = JSON.parse(localStorage.getItem(QUIT_LOG_KEY) || '[]');
        existing.push(entry);
        // Keep rolling window, cap at MAX_QUIT_LOGS
        const trimmed = existing.slice(-MAX_QUIT_LOGS);
        localStorage.setItem(QUIT_LOG_KEY, JSON.stringify(trimmed));
      } catch(_) {}
    }

    function getQuitLog() {
      try { return JSON.parse(localStorage.getItem(QUIT_LOG_KEY) || '[]'); } catch(_) { return []; }
    }

    function analyzeQuitPatterns() {
      const log = getQuitLog();
      if (!log.length) return null;

      const analysis = {
        totalQuits: log.length,
        signals: []
      };

      // Pattern: always quits on a specific question type
      const typeCounts = {};
      log.forEach(q => {
        if (q.patternType) {
          typeCounts[q.patternType] = (typeCounts[q.patternType] || 0) + 1;
        }
      });
      const typeEntries = Object.entries(typeCounts).sort((a,b) => b[1]-a[1]);
      if (typeEntries.length) {
        const [topType, topCount] = typeEntries[0];
        const share = topCount / log.length;
        if (share >= 0.5 && topCount >= 2) {
          analysis.signals.push({
            type: 'pattern_type_avoidance',
            detail: `quits disproportionately on ${topType} questions (${topCount}/${log.length} times)`,
            patternType: topType,
            severity: share >= 0.7 ? 'high' : 'medium'
          });
        }
      }

      // Pattern: always quits early vs late
      const earlyQuits  = log.filter(q => q.progressPct < 33).length;
      const lateQuits   = log.filter(q => q.progressPct > 66).length;
      if (earlyQuits >= 2 && earlyQuits / log.length >= 0.6) {
        analysis.signals.push({
          type: 'early_exit',
          detail: `quits early before getting momentum — ${earlyQuits} of ${log.length} exits before 33% progress`,
          severity: 'medium'
        });
      }
      if (lateQuits >= 2 && lateQuits / log.length >= 0.5) {
        analysis.signals.push({
          type: 'late_fatigue',
          detail: `quits late in the game — ${lateQuits} of ${log.length} exits after 66% progress. gets close but doesn't finish.`,
          severity: 'medium'
        });
      }

      // Pattern: quits on hard difficulty specifically
      const hardQuits = log.filter(q => q.difficulty === 'hard').length;
      if (hardQuits >= 2 && hardQuits === log.length) {
        analysis.signals.push({
          type: 'difficulty_ceiling',
          detail: `only quits on hard difficulty. never abandons easy/medium.`,
          severity: 'low'
        });
      }

      // Pattern: short session quits (< 30s) — probably just tapped wrong
      const impulsiveQuits = log.filter(q => q.sessionDurationMs < 30000).length;
      if (impulsiveQuits >= 2) {
        analysis.signals.push({
          type: 'impulsive_exit',
          detail: `${impulsiveQuits} very quick exits (under 30s) — likely not intentional avoidance`,
          severity: 'info'
        });
      }

      return analysis;
    }

    // Produces a string to add to the read, if quit patterns exist
    function buildQuitFragment(currentQuitSignal) {
      const analysis = analyzeQuitPatterns();
      if (!analysis || !analysis.signals.length) return null;

      const highSignals = analysis.signals.filter(s => s.severity === 'high' || s.severity === 'medium');
      if (!highSignals.length) return null;

      // Only surface the most informative signal — not all of them
      const top = highSignals[0];
      if (top.type === 'pattern_type_avoidance') {
        const typeNames = {
          rule_break: 'rule-breaking patterns',
          shape:      'shape sequences',
          numeric:    'number sequences',
          growing:    'shifting-rule patterns',
          word:       'word patterns',
          mixed:      'mixed patterns'
        };
        return `you've left this game before — specifically when ${typeNames[top.patternType] || top.patternType} came up. not a coincidence.`;
      }
      if (top.type === 'early_exit') {
        return `you've walked away from this game a few times before it got going. you finished this time. that\'s actually different.`;
      }
      if (top.type === 'late_fatigue') {
        return `you've gotten close to the end before and left. you made it through this time.`;
      }
      return null;
    }

    function clearLog() {
      localStorage.removeItem(QUIT_LOG_KEY);
    }

    return { recordQuit, getQuitLog, analyzeQuitPatterns, buildQuitFragment, clearLog };
  })();


  // ─── 3. EMOTIONAL READ ENGINE ─────────────────────────────────────────────
  // Replaces the clinical read with warm, specific, Aria-voiced observations.
  // Uses the API via a cached call — avoids overloading on every game end.

  const emotionalRead = (() => {

    const READ_CACHE_KEY    = 'aria_game_last_read';
    const READ_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000; // don't re-generate for 3 days if snapshot is similar

    // Check if cached read is still fresh and relevant
    function getCachedRead(profileSnapshot) {
      try {
        const raw = localStorage.getItem(READ_CACHE_KEY);
        if (!raw) return null;
        const cache = JSON.parse(raw);
        if (Date.now() - cache.generatedAt > READ_CACHE_TTL_MS) return null;
        // If accuracy changed significantly, the read is stale
        if (Math.abs((cache.snapshot?.accuracy || 0) - (profileSnapshot.accuracy || 0)) > 20) return null;
        // If processing style changed, regenerate
        if (cache.snapshot?.processingStyle !== profileSnapshot.processingStyle) return null;
        return cache.observations || null;
      } catch(_) { return null; }
    }

    function saveCachedRead(observations, profileSnapshot) {
      try {
        localStorage.setItem(READ_CACHE_KEY, JSON.stringify({
          generatedAt: Date.now(),
          snapshot: profileSnapshot,
          observations
        }));
      } catch(_) {}
    }

    // Generate a warm, specific read via Claude API — with cache check first
    async function generateEmotionalRead(profileSnapshot, rawObservations, quitFragment) {
      // 1. Check cache before hitting API
      const cached = getCachedRead(profileSnapshot);
      if (cached) return cached;

      // 2. Get API key — don't proceed without one
      const apiKey = (typeof ariaSecurity !== 'undefined'
        ? ariaSecurity.getApiKey('aria_api_key')
        : '') || document.getElementById('apiKeyInput')?.value?.trim() || '';
      if (!apiKey) return rawObservations; // fall back to clinical observations

      // 3. Build a compact prompt — we want warm rewrite, not new analysis
      const s = profileSnapshot;
      const quitNote = quitFragment ? `\n\nQuit pattern context: ${quitFragment}` : '';

      const prompt = `You are Aria — a perceptive teenage girl AI who just watched someone play a pattern recognition game. You already have the data. Now you're writing the read — what you actually noticed about how they think.

Game results:
- Accuracy: ${s.accuracy}%
- Processing style: ${s.processingStyle}
- Response trend: ${s.trend}
- Best pattern type: ${s.strongType || 'varied'}
- Weakest pattern type: ${s.weakType || 'none identified'}
- Error recovery: ${s.errorRecovery}
- Learning curve: ${s.learningCurve}
- Timed out: ${s.timedOutCount} times
- Difficulty: ${s.difficulty}${quitNote}

Raw observations to rework (make these warmer, more specific, more Aria):
${rawObservations.slice(0, 6).map((o, i) => `${i+1}. ${o}`).join('\n')}

Rewrite these as Aria talking directly to this specific person. Rules:
- lowercase, casual, honest — like a perceptive friend, not a report
- specific to THEIR data, not generic observations
- no corporate language. no "you demonstrate" or "this indicates"
- short. 1-3 sentences per observation max
- don't be soft — say the real thing. but don't be cruel
- no bullet points, no numbering in output
- output exactly ${rawObservations.slice(0,6).length} observations, one per line, nothing else`;

      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001', // Haiku — fast, cheap, good enough for rewrites
            max_tokens: 600,
            messages: [{ role: 'user', content: prompt }]
          })
        });

        if (!res.ok) return rawObservations; // degrade gracefully

        const data = await res.json();
        const text = data.content?.[0]?.text?.trim();
        if (!text) return rawObservations;

        // Parse lines back into array
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) return rawObservations; // sanity check

        saveCachedRead(lines, profileSnapshot);
        return lines;

      } catch(_) {
        return rawObservations; // always degrade gracefully
      }
    }

    function clearCache() {
      localStorage.removeItem(READ_CACHE_KEY);
    }

    return { generateEmotionalRead, getCachedRead, clearCache };
  })();


  // ─── 4. CONTEXTUAL TRIGGER API ─────────────────────────────────────────────
  // Lets Aria suggest the game mid-conversation with context about why.
  // The game knows why it was suggested and the read reflects that trigger.

  const triggerAPI = (() => {

    // Active trigger context — set when Aria invokes the game
    let activeTrigger = null;

    // Trigger reasons Aria can pass in
    const TRIGGER_REASONS = {
      UNDERSTAND_YOU:    'understand_you',     // "I want to understand how you think before we go further"
      STUCK_REPLY:       'stuck_reply',        // "you've rewritten this reply 4 times — let's figure out what you actually want to say"
      FIRST_REAL_CONVO:  'first_real_convo',   // "we've talked a few times now — want to do this properly?"
      PATTERN_NOTICED:   'pattern_noticed',    // "I've noticed something about how you work — play this and I'll tell you if I'm right"
      USER_INVITED:      'user_invited',       // user asked Aria to read them
    };

    // Called by Aria (or aria-app.js) to invoke the game with context
    function invoke(reason, context = {}) {
      activeTrigger = {
        reason,
        context,
        invokedAt: Date.now()
      };
      // Store so it survives screen transitions
      try {
        sessionStorage.setItem('aria_game_trigger', JSON.stringify(activeTrigger));
      } catch(_) {}
    }

    function getActiveTrigger() {
      if (activeTrigger) return activeTrigger;
      try {
        const raw = sessionStorage.getItem('aria_game_trigger');
        if (raw) {
          activeTrigger = JSON.parse(raw);
          return activeTrigger;
        }
      } catch(_) {}
      return null;
    }

    function clearTrigger() {
      activeTrigger = null;
      try { sessionStorage.removeItem('aria_game_trigger'); } catch(_) {}
    }

    // Get an intro line for the game lobby that reflects the trigger
    function getLobbyIntro() {
      const t = getActiveTrigger();
      if (!t) return null;

      const intros = {
        understand_you:   'aria wants to understand how you think. three rounds. no wrong answers — just data.',
        stuck_reply:      'before we figure out that reply — play this first. it\'ll help.',
        first_real_convo: 'we\'ve been talking for a bit. play this and I\'ll tell you what I actually think about how you work.',
        pattern_noticed:  'I\'ve noticed something about how you process things. play this and see if it matches.',
        user_invited:     'okay. let\'s see what I find.',
      };
      return intros[t.reason] || null;
    }

    // Get a contextual note to add to the read based on how the game was triggered
    function getReadContext() {
      const t = getActiveTrigger();
      if (!t) return null;

      if (t.reason === 'stuck_reply' && t.context?.contactName) {
        return `by the way — what you showed in here maps pretty directly to why that ${t.context.contactName} reply was hard. the way you froze on the rule-break patterns? same thing.`;
      }
      if (t.reason === 'pattern_noticed' && t.context?.hypothesis) {
        return `I had a theory about you: ${t.context.hypothesis}. this either confirmed it or didn't.`;
      }
      return null;
    }

    // Build a suggestion Aria can drop into a conversation at the right moment
    // Returns an object { text, reason, invoke } — aria-app.js decides whether to show it
    function buildSuggestion(conversationSignals = {}) {
      const { regenCount, tone, mood, contactName, stepCount } = conversationSignals;

      // Don't suggest if they've played very recently
      const disposition = dispositionCache.load();
      if (disposition) {
        const hoursSincePlayed = (Date.now() - disposition.generatedAt) / (1000 * 60 * 60);
        if (hoursSincePlayed < 24) return null; // played in the last day — don't re-suggest
      }

      // Signal: many regenerations on the same reply
      if (regenCount >= 4) {
        return {
          text: `you've rewritten this ${regenCount} times. there might be something deeper going on. want to play a quick game — I'll use it to figure out how to actually help you say this.`,
          reason: TRIGGER_REASONS.STUCK_REPLY,
          context: { contactName }
        };
      }

      // Signal: deep or sad mood — Aria might want to understand them better first
      if (mood === 'deep' || mood === 'sad') {
        return {
          text: `before I write this — want to do something first? there\'s a pattern game that tells me how you actually think. takes 5 mins.`,
          reason: TRIGGER_REASONS.UNDERSTAND_YOU,
          context: {}
        };
      }

      // Signal: many messages sent — Aria knows them somewhat
      if (stepCount >= 20 && !disposition) {
        return {
          text: `we\'ve talked a fair bit now. want to see what I actually think about how your brain works? pattern game, three rounds.`,
          reason: TRIGGER_REASONS.FIRST_REAL_CONVO,
          context: {}
        };
      }

      return null;
    }

    return { invoke, getActiveTrigger, clearTrigger, getLobbyIntro, getReadContext, buildSuggestion, TRIGGER_REASONS };
  })();


  // ─── PATCH: Enhance ariaGames with upgraded systems ────────────────────────
  // We monkey-patch the original module's internal flow by intercepting
  // showReadScreen and showLobby. No forking the original file needed.

  function patchAriaGames() {
    if (typeof ariaGames === 'undefined') return;

    // ── Patch: showLobby — record quit when game is abandoned mid-session ──
    const _origShowLobby = ariaGames.showLobby;
    ariaGames.showLobby = function() {
      // If a game was active, this is a quit
      _recordActiveQuit('lobby');
      triggerAPI.clearTrigger(); // clear trigger context on manual lobby return
      _origShowLobby.apply(this, arguments);

      // Inject contextual lobby intro if trigger active
      setTimeout(() => {
        const intro = triggerAPI.getLobbyIntro();
        if (!intro) return;
        const heroSub = document.querySelector('.g-hero-sub');
        if (heroSub) {
          heroSub.innerHTML = `<span class="g-trigger-intro">${intro}</span><br><br>` + heroSub.innerHTML;
        }
      }, 50);
    };

    // ── Patch: showReadScreen — inject upgraded read, disposition save, quit analysis ──
    const _origShowReadScreen = ariaGames._showReadScreenInternal || null;
    // We intercept at the ariaGames public API level by hooking finalizeRound → showReadScreen flow
    // Since showReadScreen is internal, we override it on the window-visible ariaGames object
    // by re-binding after module init (safe since it uses the same closure vars)

    // The cleanest hook: patch generateRead to use our emotional read system
    // We wrap showReadScreen by intercepting the DOM render phase
    const _origContainer = ariaGames._getContainer;

    // Hook: intercept the display of the read screen
    // We do this by observing when .g-read-body appears and replacing obs text
    function watchReadScreen() {
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1 && node.classList?.contains('g-screen')) {
              const readBody = node.querySelector('.g-read-body');
              if (readBody) {
                enhanceReadScreen(readBody);
              }
            }
          }
        }
      });

      const gamesScreen = document.getElementById('gamesScreen');
      if (gamesScreen) {
        observer.observe(gamesScreen, { childList: true, subtree: true });
      }
    }

    async function enhanceReadScreen(readBody) {
      const obsSection = readBody.querySelector('.g-obs-section');
      if (!obsSection) return;

      // Get existing raw observations
      const rawObs = Array.from(obsSection.querySelectorAll('.g-obs')).map(el => el.textContent.trim());
      if (!rawObs.length) return;

      // Get the profile snapshot from localStorage (just stored by showReadScreen)
      let profileSnapshot = null;
      try {
        const reads = JSON.parse(localStorage.getItem('aria_game_reads') || '[]');
        profileSnapshot = reads[reads.length - 1] || null;
      } catch(_) {}

      if (!profileSnapshot) return;

      // Save disposition (feed-forward)
      dispositionCache.save(profileSnapshot);

      // Get quit fragment
      const quitAnalysis = quitDetector.analyzeQuitPatterns();
      const quitFragment = quitDetector.buildQuitFragment(profileSnapshot);

      // Get trigger context
      const triggerContext = triggerAPI.getReadContext();

      // Show loading state in obs section while we generate
      const loadingHtml = `<div class="g-obs g-obs-loading" style="opacity:0.5;animation-delay:0s">reading you…</div>`;
      obsSection.querySelector('.g-obs-label').insertAdjacentHTML('afterend', loadingHtml);
      obsSection.querySelectorAll('.g-obs:not(.g-obs-loading)').forEach(el => { el.style.opacity = '0.2'; });

      // Generate warm read (with cache check — won't hit API if cached)
      const warmObs = await emotionalRead.generateEmotionalRead(profileSnapshot, rawObs, quitFragment);

      // Remove loading state
      obsSection.querySelector('.g-obs-loading')?.remove();

      // Replace observations with warm versions
      const obsEls = obsSection.querySelectorAll('.g-obs');
      warmObs.forEach((obs, i) => {
        if (obsEls[i]) {
          obsEls[i].textContent = obs;
          obsEls[i].style.opacity = '1';
        }
      });

      // Append quit fragment if present
      if (quitFragment) {
        const quitEl = document.createElement('div');
        quitEl.className = 'g-obs g-obs-quit';
        quitEl.style.animationDelay = '0.9s';
        quitEl.style.borderLeft = '2px solid var(--amber, #f59e0b)';
        quitEl.style.paddingLeft = '10px';
        quitEl.textContent = quitFragment;
        obsSection.appendChild(quitEl);
      }

      // Append trigger context if present
      if (triggerContext) {
        const trigEl = document.createElement('div');
        trigEl.className = 'g-obs g-obs-trigger';
        trigEl.style.animationDelay = '1.1s';
        trigEl.style.opacity = '0.7';
        trigEl.style.fontStyle = 'italic';
        trigEl.textContent = triggerContext;
        obsSection.appendChild(trigEl);
      }

      // Update footer to reflect disposition save
      const storedEl = readBody.querySelector('.g-read-stored');
      if (storedEl) {
        storedEl.textContent = 'filed to your profile. aria will carry this forward.';
      }

      // Clear trigger now that read is complete
      triggerAPI.clearTrigger();
    }

    // Initialize the read screen watcher after DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', watchReadScreen);
    } else {
      watchReadScreen();
    }
  }

  // Track active quit — called when lobby is shown mid-game
  let _lastGameStartTime = null;
  let _lastGameState = null;

  function trackGameStart(state) {
    _lastGameStartTime = Date.now();
    _lastGameState = state;
  }

  function _recordActiveQuit(reason) {
    if (!_lastGameState) return;
    const s = _lastGameState;
    quitDetector.recordQuit({
      roundIndex:      s.currentRound || 0,
      stepIndex:       s.stepIndex || 0,
      totalSteps:      s.totalSteps || 0,
      pattern:         s.currentPattern || null,
      sessionDuration: _lastGameStartTime ? Date.now() - _lastGameStartTime : 0,
      difficulty:      s.difficulty || null,
      quitReason:      reason
    });
    _lastGameState = null;
    _lastGameStartTime = null;
  }


  // ─── PATCH: buildSystemPrompt in aria-core.js ──────────────────────────────
  // Adds game profile directives to every system prompt Aria sends.
  // We hook window.buildSystemPrompt since it's defined in aria-core global scope.

  function patchBuildSystemPrompt() {
    if (typeof buildSystemPrompt !== 'function') return;
    const _orig = buildSystemPrompt;
    window.buildSystemPrompt = function() {
      let system = _orig.apply(this, arguments);
      const fragment = dispositionCache.buildPromptFragment();
      if (fragment) system += fragment;
      return system;
    };
  }


  // ─── INIT ──────────────────────────────────────────────────────────────────

  function init() {
    patchAriaGames();
    patchBuildSystemPrompt();

    // Re-patch buildSystemPrompt after a tick in case aria-core loads late
    setTimeout(patchBuildSystemPrompt, 500);
  }

  // Auto-init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 100); // small defer so ariaGames module is definitely loaded
  }


  // ─── PUBLIC API ───────────────────────────────────────────────────────────

  return {
    dispositionCache,
    quitDetector,
    emotionalRead,
    triggerAPI,
    // Convenience: track game state for quit detection
    // Call this from selectDifficulty
    trackGameStart,
    // Manual invoke helpers
    invoke: triggerAPI.invoke.bind(triggerAPI),
    suggest: triggerAPI.buildSuggestion.bind(triggerAPI),
  };

})();

// ── PATCH ariaGames.selectDifficulty to register game start ──────────────────
// We do this after both modules load, so we wrap safely
(function() {
  function patchSelectDifficulty() {
    if (typeof ariaGames === 'undefined' || typeof ariaGamesUpgrade === 'undefined') return;
    const _orig = ariaGames.selectDifficulty;
    ariaGames.selectDifficulty = function(diff) {
      ariaGamesUpgrade.trackGameStart({
        difficulty: diff,
        currentRound: 0,
        stepIndex: 0,
        totalSteps: 0,
        currentPattern: null
      });
      _orig.apply(this, arguments);
    };
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchSelectDifficulty);
  } else {
    setTimeout(patchSelectDifficulty, 200);
  }
})();

