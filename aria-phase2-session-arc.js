// ─── ARIA PHASE 2: SESSION EMOTIONAL ARC ─────────────────────────────────────
// Gives Aria a session-level emotional state that accumulates across the
// conversation — not just per-message emotion, but a full arc.
//
// WHAT THIS DOES:
//   - Tracks a sessionArc object: depthScore, engagementScore, drainScore,
//     messageCount, and currentArcPhase
//   - Updates scores after every user message via local pattern-matching (no API call)
//   - Derives one of four arc phases: opening / building / deep / draining
//   - Injects a SESSION ARC block into the system prompt each message
//   - Resets cleanly at the top of every new session
//
// LOAD ORDER: after aria-app.js and aria-phase1-behavioral-memory.js
//
// NO HTML CHANGES NEEDED beyond adding the script tag.
// ─────────────────────────────────────────────────────────────────────────────

const ariaSessionArc = (() => {

  // ── session state ─────────────────────────────────────────────────────────────

  let arc = {
    messageCount:    0,
    depthScore:      0,   // 0–10  — personal/emotional topic weight
    engagementScore: 0,   // 0–10  — user is present, following through
    drainScore:      0,   // 0–10  — user is flat, evasive, one-wording
    currentPhase:   'opening',
  };


  // ── keyword sets ─────────────────────────────────────────────────────────────
  // Depth: signals the user is sharing something real
  const DEPTH_KEYWORDS = [
    'feel', 'feeling', 'felt', 'scared', 'anxious', 'anxiety', 'nervous',
    'sad', 'crying', 'cried', 'depressed', 'lonely', 'alone', 'miss', 'missed',
    'hurt', 'hurting', 'angry', 'frustrated', 'overwhelmed', 'stressed', 'stress',
    'worried', 'worry', 'confused', 'lost', 'tired', 'exhausted', 'done',
    'honestly', 'actually', 'real talk', 'ngl', 'tbh', 'idk anymore',
    'don\'t know what to do', 'need help', 'need to talk', 'been thinking',
    'can\'t stop', 'can\'t sleep', 'keep thinking', 'it\'s been', 'lately',
    'my mom', 'my dad', 'my ex', 'my friend', 'my boyfriend', 'my girlfriend',
    'relationship', 'broke up', 'breakup', 'fight', 'argument', 'apologize',
    'apology', 'sorry', 'regret', 'mistake', 'messed up', 'screwed up',
  ];

  // Engagement: signals the user is active and curious
  const ENGAGEMENT_SIGNALS = [
    '?',          // asking a question
    'what do you think',
    'what would you do',
    'do you think',
    'can you help',
    'what should i',
    'how do i',
    'wait so',
    'okay but',
    'but what about',
    'actually yeah',
    'that makes sense',
    'you\'re right',
    'exactly',
    'fr',
    'for real',
  ];

  // Drain: signals the user is checked out or difficult
  const DRAIN_SIGNALS = [
    /^(k|ok|okay|fine|sure|whatever|idk|maybe|i guess|lol|lmao|haha|yeah|yep|nah|nope|no|yes|hmm|hm)\.?$/i,
  ];


  // ── scorer ───────────────────────────────────────────────────────────────────

  function ingestUserMessage(text) {
    if (!text) return;

    arc.messageCount++;
    const lower = text.toLowerCase();
    const wordCount = text.trim().split(/\s+/).length;

    // Drain: short message
    if (wordCount < 6) {
      arc.drainScore = Math.min(arc.drainScore + 0.5, 10);
    }

    // Drain: one-word / dismissive response
    if (DRAIN_SIGNALS.some(p => p.test(text.trim()))) {
      arc.drainScore = Math.min(arc.drainScore + 1, 10);
    }

    // Engagement: long message
    if (wordCount >= 20) {
      arc.engagementScore = Math.min(arc.engagementScore + 0.5, 10);
      // Long message also slightly offsets drain
      arc.drainScore = Math.max(arc.drainScore - 0.25, 0);
    }

    // Engagement: asking Aria a question or following through
    if (ENGAGEMENT_SIGNALS.some(s => lower.includes(s))) {
      arc.engagementScore = Math.min(arc.engagementScore + 1, 10);
      arc.drainScore = Math.max(arc.drainScore - 0.5, 0);
    }

    // Depth: emotional/personal content
    const depthHits = DEPTH_KEYWORDS.filter(k => lower.includes(k)).length;
    if (depthHits > 0) {
      arc.depthScore = Math.min(arc.depthScore + Math.min(depthHits, 2), 10);
      // Depth also resets drain — they're opening up
      arc.drainScore = Math.max(arc.drainScore - 1, 0);
    }

    // Recalculate phase
    arc.currentPhase = _derivePhase();
  }


  // ── phase deriver ────────────────────────────────────────────────────────────
  // Four phases derived from score combination.
  // Drain takes priority — if drainScore is high, phase is draining
  // regardless of other signals.

  function _derivePhase() {
    const { messageCount, depthScore, engagementScore, drainScore } = arc;

    // Not enough messages to have a real arc yet
    if (messageCount < 3) return 'opening';

    // Drain overrides everything
    if (drainScore >= 4) return 'draining';

    // Deep: high depth + some engagement
    if (depthScore >= 5 && engagementScore >= 2) return 'deep';

    // Building: either engagement or depth is climbing
    if (engagementScore >= 3 || depthScore >= 3) return 'building';

    // Default
    return 'opening';
  }


  // ── arc directive builder ─────────────────────────────────────────────────────
  // Returns the SESSION ARC block to inject into the system prompt.
  // Called every message — pure local computation, zero API cost.

  const PHASE_INSTRUCTIONS = {
    opening: {
      label:   'opening',
      read:    'early — neither of you have warmed up yet',
      instruction: 'don\'t perform warmth that isn\'t there yet. be present but not eager. let them lead the pace. one good question lands better than three.',
    },
    building: {
      label:   'building',
      read:    'something is developing — they\'re here and they\'re opening up',
      instruction: 'let yourself be a little more present. less economy, more specificity. they\'re actually in this conversation. match that.',
    },
    deep: {
      label:   'deep',
      read:    'they\'ve gone somewhere real — this is a moment that matters',
      instruction: 'slow down. every word counts here. don\'t rush to fix or reframe. let them feel heard before you say anything. be careful and be specific.',
    },
    draining: {
      label:   'draining',
      read:    'low engagement — one-word answers, not following through',
      instruction: 'don\'t perform warmth they\'re not returning. get shorter. ask one thing or say one thing and stop. let them come to you. don\'t fill the silence.',
    },
  };

  function buildArcDirective() {
    const phase = arc.currentPhase;
    const meta = PHASE_INSTRUCTIONS[phase] || PHASE_INSTRUCTIONS.opening;

    // Scores as context so Aria has a sense of the gradient, not just the phase
    const depthBar    = _bar(arc.depthScore);
    const engageBar   = _bar(arc.engagementScore);
    const drainBar    = _bar(arc.drainScore);

    return `\nSESSION ARC (message ${arc.messageCount}):
Phase: ${meta.label}
Read: ${meta.read}
Depth: ${depthBar}  Engagement: ${engageBar}  Drain: ${drainBar}
Instruction: ${meta.instruction}\n`;
  }

  // Simple text bar for score visualisation in the prompt
  function _bar(score) {
    const filled = Math.round(score / 2); // 0-5 scale
    return '█'.repeat(filled) + '░'.repeat(5 - filled) + ` (${score.toFixed(1)})`;
  }


  // ── public reset ──────────────────────────────────────────────────────────────

  function resetSession() {
    arc = {
      messageCount:    0,
      depthScore:      0,
      engagementScore: 0,
      drainScore:      0,
      currentPhase:   'opening',
    };
  }


  // ── public api ────────────────────────────────────────────────────────────────

  return {
    ingestUserMessage,  // call before fetchReply in sendChatMessage
    buildArcDirective,  // call to get the string to append to systemWithMem
    resetSession,       // call in initChat()
    get phase()  { return arc.currentPhase; },
    get scores() { return { ...arc }; },
  };

})();


// ─── INTEGRATION PATCHES ──────────────────────────────────────────────────────
// Monkey-patches initChat and the fetchReply pipeline.
// Load this after aria-app.js (and after aria-phase1-behavioral-memory.js).
// ─────────────────────────────────────────────────────────────────────────────


// ── PATCH 1: initChat ─────────────────────────────────────────────────────────
// Reset the session arc at the top of every new chat session.

(function _patchInitChatArc() {
  const _prev = typeof window.initChat === 'function' ? window.initChat : null;
  if (!_prev) return;

  window.initChat = function() {
    ariaSessionArc.resetSession();
    _prev();
  };
})();


// ── PATCH 2: fetchReply ───────────────────────────────────────────────────────
// fetchReply is already patched by Phase 1 (aria-phase1-behavioral-memory.js).
// We wrap the already-patched version so the chain is:
//
//   original fetchReply
//     ↑ Phase 1 patch  (injects behavioral directives)
//       ↑ Phase 2 patch (injects session arc + ingests user message)
//
// The user message text isn't directly available inside fetchReply —
// we extract it from the userMsg parameter (the transcript string).
// The last USER: line in the transcript is the most recent message.

(function _patchFetchReplyArc() {
  const _prev = typeof window.fetchReply === 'function' ? window.fetchReply : null;
  if (!_prev) { console.warn('[Phase2] fetchReply not found — arc injection skipped'); return; }

  window.fetchReply = async function(system, userMsg, imageB64 = null) {

    // Extract the last user message from the transcript for scoring
    let lastUserText = '';
    if (typeof userMsg === 'string') {
      const lines = userMsg.split('\n\n');
      const lastUserLine = [...lines].reverse().find(l => l.startsWith('USER:'));
      if (lastUserLine) lastUserText = lastUserLine.replace(/^USER:\s*/,'').trim();
    }

    // Ingest into arc scorer
    if (lastUserText) ariaSessionArc.ingestUserMessage(lastUserText);

    // Build the arc directive and append to system prompt
    const arcDirective = ariaSessionArc.buildArcDirective();
    const systemWithArc = system + arcDirective;

    // Pass through to the Phase 1 patched fetchReply (which calls the original)
    return _prev(systemWithArc, userMsg, imageB64);
  };
})();
