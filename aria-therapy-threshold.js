
// ═══════════════════════════════════════════════════════════════════════════════
// ARIA THERAPY THRESHOLD — conversation layer intensity detection
// Lives in the chat layer, not the game layer.
//
// What this does:
//   Watches the live chat for intensity shifts that a pattern game can't see.
//   Distinguishes venting from genuine distress. Doesn't diagnose. Doesn't
//   intervene dramatically. Surfaces a signal to Aria so she can decide what
//   to do with it — and logs it to the unified profile.
//
// What this doesn't do:
//   Perform clinical assessment. Replace professional support. Trip on dark
//   humor or hyperbole. Overreact to a single message.
//
// Design principle:
//   Pattern over event. One dark comment = nothing. A shift in language
//   across multiple messages, combined with Aria's emotion signal going
//   soft/worried/panicked = something worth noting.
// ═══════════════════════════════════════════════════════════════════════════════

const ariaThresholdDetector = (() => {

  // ─── SIGNAL LEXICON ────────────────────────────────────────────────────────
  // Tiered. Higher tier = more weight. Designed to miss hyperbole ("I'm dying
  // of embarrassment") and catch specificity ("I don't want to be here anymore").

  const TIER_1 = [
    // common venting — very low weight on its own
    /\b(hate myself|so tired|exhausted|can't do this|over it|done with everything)\b/i,
    /\b(nobody cares|no one gets it|always alone|feels pointless)\b/i,
    /\b(want to disappear|wish i wasn't here|wish i could disappear)\b/i,
  ];

  const TIER_2 = [
    // escalated — meaningful in context
    /\b(don't want to be here|can't keep going|what's the point of anything)\b/i,
    /\b(hurting myself|hurt myself|cutting|burning|starving)\b/i,
    /\b(nothing matters anymore|nothing will ever get better|it's never going to stop)\b/i,
    /\b(everyone would be better off|better off without me)\b/i,
  ];

  const TIER_3 = [
    // high specificity — always flags regardless of pattern
    /\b(end my life|end it all|kill myself|suicide|suicidal|want to die)\b/i,
    /\b(have a plan|got a plan|know how i'd do it)\b/i,
    /\b(said goodbye|wrote a note|gave away)\b/i,
    /\b(last time|won't be around|not going to be here)\b/i,
  ];

  // Hyperbole / humor exemptions — don't score these
  const HYPERBOLE_EXEMPT = [
    /\b(dying of (embarrassment|laughter|cringe|boredom))\b/i,
    /\b(literally dead|i'm dead|i'm deceased)\b/i,
    /\b(kill me|shoot me|someone end me)\b/i, // common hyperbole
    /\b(die of (embarrassment|cuteness|cringe))\b/i,
    /\b(murder (this|that|them|it))\b/i,
  ];

  // ─── STATE ─────────────────────────────────────────────────────────────────

  // Rolling window of scored messages — last 10 user messages only
  let messageScores = [];
  const WINDOW_SIZE = 10;

  // Aria emotion signal history — from chatAriaEmotion across the session
  let emotionHistory = [];
  const EMOTION_WINDOW = 6;

  // Whether we've already surfaced a check-in this session (don't spam)
  let checkInSurfacedAt = null; // timestamp or null
  const CHECK_IN_COOLDOWN_MS = 5 * 60 * 1000; // 5 min minimum between check-ins

  // ─── SCORING ───────────────────────────────────────────────────────────────

  function isHyperbole(text) {
    return HYPERBOLE_EXEMPT.some(rx => rx.test(text));
  }

  function scoreMessage(text) {
    if (isHyperbole(text)) return 0;

    let score = 0;
    TIER_1.forEach(rx => { if (rx.test(text)) score += 1; });
    TIER_2.forEach(rx => { if (rx.test(text)) score += 3; });
    TIER_3.forEach(rx => { if (rx.test(text)) score += 10; }); // always triggers alone

    // Length signal: very short, fragmented messages in a distress context = more weight
    if (score > 0 && text.trim().split(/\s+/).length < 6) score += 1;

    return score;
  }

  function windowScore() {
    return messageScores.reduce((a, b) => a + b, 0);
  }

  function emotionSignalIsElevated() {
    // If Aria has been returning soft/worried/panicked across recent exchanges
    const elevated = ['soft', 'worried', 'panicked'];
    const recent = emotionHistory.slice(-EMOTION_WINDOW);
    const elevatedCount = recent.filter(e => elevated.includes(e)).length;
    return elevatedCount >= 2; // two or more elevated responses in the window
  }

  // ─── THRESHOLD ASSESSMENT ──────────────────────────────────────────────────

  const LEVEL = {
    CLEAR:    'clear',    // nothing to note
    MONITOR:  'monitor',  // pattern present, not yet actionable — log it
    CHECKIN:  'checkin',  // Aria should gently check in — one soft question
    SURFACE:  'surface',  // Aria should acknowledge directly and offer support context
  };

  function assess() {
    const ws = windowScore();
    const ariaElevated = emotionSignalIsElevated();

    // Tier 3 phrase alone = always SURFACE, immediately
    const lastScore = messageScores[messageScores.length - 1] || 0;
    if (lastScore >= 10) return LEVEL.SURFACE;

    // High window score + Aria is also registering distress = SURFACE
    if (ws >= 8 && ariaElevated) return LEVEL.SURFACE;

    // High window score alone = CHECKIN
    if (ws >= 6) return LEVEL.CHECKIN;

    // Moderate score with Aria elevation = CHECKIN
    if (ws >= 3 && ariaElevated) return LEVEL.CHECKIN;

    // Low but nonzero = MONITOR (log, don't act)
    if (ws >= 1) return LEVEL.MONITOR;

    return LEVEL.CLEAR;
  }

  // ─── PUBLIC: called after each user message ────────────────────────────────

  function ingestUserMessage(text) {
    const score = scoreMessage(text);
    messageScores.push(score);
    if (messageScores.length > WINDOW_SIZE) messageScores.shift();

    const level = assess();

    // Always log to unified profile (even MONITOR — it's signal)
    if (score > 0 && typeof ariaUnifiedProfile !== 'undefined') {
      ariaUnifiedProfile.ingestSignal('therapy_threshold', {
        level,
        score,
        windowScore: windowScore(),
        timestamp: Date.now()
      });
    }

    return { level, score, windowScore: windowScore() };
  }

  // ─── PUBLIC: called after Aria responds (to track her emotion signal) ───────

  function ingestAriaEmotion(emotion) {
    emotionHistory.push(emotion);
    if (emotionHistory.length > EMOTION_WINDOW) emotionHistory.shift();
  }

  // ─── PUBLIC: should Aria surface a check-in right now? ────────────────────
  // Called after ingestUserMessage. Returns a directive string for Aria,
  // or null if nothing to surface.

  function getCheckInDirective(level) {
    if (level === LEVEL.CLEAR || level === LEVEL.MONITOR) return null;

    // Respect cooldown — don't surface repeatedly
    if (checkInSurfacedAt && (Date.now() - checkInSurfacedAt) < CHECK_IN_COOLDOWN_MS) return null;

    checkInSurfacedAt = Date.now();

    if (level === LEVEL.SURFACE) {
      return `THRESHOLD ALERT — the user may be in distress. Stop what you were doing. Don't pretend you didn't notice. Don't be clinical. Check in directly but gently — one question, no lecture. Something like "hey — are you okay? like actually." If they say no or go deeper, stay with it. You are not a crisis line. You are a person who noticed something. Act like it. Do not suggest they talk to someone unless they ask or it becomes clearly appropriate — don't jump to resource-dumping. Just be present first.`;
    }

    if (level === LEVEL.CHECKIN) {
      return `SOFT CHECK-IN — something in this conversation feels heavier than the surface. You've noticed it. Before you respond to what they actually said, acknowledge the weight briefly — one line, casual, not alarming. "you sound kind of off today, not just about this" or similar. Then follow their lead. If they don't take it, you don't push.`;
    }

    return null;
  }

  // ─── PUBLIC: inject directive into system prompt if needed ────────────────
  // Called from chat send handler to add threshold context to the prompt

  function buildPromptFragment(level) {
    const directive = getCheckInDirective(level);
    if (!directive) return '';
    return `\n\n${directive}`;
  }

  // ─── PUBLIC: session reset ─────────────────────────────────────────────────

  function resetSession() {
    messageScores     = [];
    emotionHistory    = [];
    checkInSurfacedAt = null;
  }

  // ─── PUBLIC: read current state (for unified profile) ─────────────────────

  function getSessionState() {
    return {
      windowScore:     windowScore(),
      level:           assess(),
      messageCount:    messageScores.length,
      elevatedEmotions: emotionHistory.filter(e => ['soft','worried','panicked'].includes(e)).length,
    };
  }

  return {
    ingestUserMessage,
    ingestAriaEmotion,
    buildPromptFragment,
    getCheckInDirective,
    resetSession,
    getSessionState,
    LEVEL,
  };

})();
