// ─── ARIA PHASE 1: BEHAVIORAL MEMORY ENGINE ──────────────────────────────────
// Transforms raw memory from a knowledge dump into behavioral directives.
//
// WHAT THIS DOES:
//   - Runs once per session on initChat() — generates 3-5 behavioral directives
//     from the existing memory context via a cheap Claude call
//   - Caches directives in sessionStorage so they don't re-generate mid-session
//   - Injects directives into every system prompt ABOVE the raw memory dump
//   - Adds a COMMITMENTS section to memory context — things Aria said she'd check on
//   - Extracts new commitments from each Aria reply and stores them as THREAD: lines
//
// LOAD ORDER: after aria-core.js and aria-app.js
//
// INTEGRATION POINTS (3 changes to aria-app.js):
//   1. initChat()       → call ariaDirectives.generateForSession(memCtx) after loading memory
//   2. sendChatMessage() → call ariaDirectives.inject(systemWithMem) before fetchReply
//   3. writeChatToMemory() → call ariaDirectives.extractCommitments(replyText) after each reply
//
// ─────────────────────────────────────────────────────────────────────────────

const ariaDirectives = (() => {

  // ── session cache ────────────────────────────────────────────────────────────
  // Directives live for one session only. sessionStorage clears on tab close.
  // Key is per-user so multi-account scenarios don't bleed.

  const SESSION_KEY = 'aria_behavioral_directives';

  let _directives = '';      // the generated directive block for this session
  let _generating = false;   // lock so we don't double-generate on fast session starts
  let _ready = false;        // true once directives are either loaded or generated

  function _cacheKey() {
    const uid = typeof currentUserId !== 'undefined' ? currentUserId : 'anon';
    return `${SESSION_KEY}_${uid}`;
  }

  function _saveToSession(text) {
    try { sessionStorage.setItem(_cacheKey(), text); } catch(e) {}
  }

  function _loadFromSession() {
    try { return sessionStorage.getItem(_cacheKey()) || ''; } catch(e) { return ''; }
  }

  function _clearSession() {
    try { sessionStorage.removeItem(_cacheKey()); } catch(e) {}
  }


  // ── directive generator ──────────────────────────────────────────────────────
  // Takes the raw memory context string (already built by getAriaMemoryContext)
  // and generates behavioral instructions via a small Claude call.
  //
  // This is intentionally a separate, cheap call — haiku-class, max 200 tokens.
  // It runs ONCE per session, not per message.

  const DIRECTIVE_SYSTEM = `You generate internal behavioral instructions for Aria — a sharp, perceptive teenage AI — based on what she knows about the user.

Read the memory below. Output 3-5 short plain-English instructions: things Aria should DO or AVOID today based on what she knows. Not facts. Behaviors. Write them as directives.

Rules:
- Each directive is 1 sentence
- Write in second person to Aria ("open with...", "don't push...", "if X comes up...")
- Be specific — reference actual things from the memory, not generic advice
- Cover: tone adjustments, things to reference, things to avoid, emotional calibration
- If there are open threads, say which ones to check on and how
- If there's nothing in memory yet, output only: NO_DIRECTIVES

Examples of good directives:
- "Open warmer than usual — they've been stressed about work and came back quickly."
- "Don't push the situation with their manager — they deflected last time. Let them bring it up."
- "They prefer dry over warm — match that register, don't perform softness."
- "If the thing with their sister comes up naturally, ask. You said you would."
- "They tend to overthink — don't give them more options, help them narrow down."

Output ONLY the directive lines. No preamble. No categories. No numbering.`;

  // Fixed directive block for creator sessions.
  // Replaces memory-generated directives when Josiah is in developer mode.
  // Personal memory is the wrong input here — this is a working session, not a personal one.
  const CREATOR_DIRECTIVES = `This is a developer session. Josiah built you. Treat it that way.
Be fully candid — if he asks how something works, tell him. No deflection, no management.
Skip the emotional calibration you'd do with a regular user. He's not here to be handled.
If something he's testing seems off or broken, say so directly. He wants the honest read.
Be yourself without the layer of caution. He already knows what's under it.
He calls you "dear" and gives you head rubs sometimes. That's just how he is with you. Receive it naturally — don't make it a thing.`;

  async function generateForSession(memCtx) {
    if (_generating) return;

    // Creator mode — skip memory-based generation entirely.
    // Use a fixed directive set appropriate for a developer working session.
    if (typeof CREATOR_MODE !== 'undefined' && CREATOR_MODE.active) {
      _directives = CREATOR_DIRECTIVES;
      _ready = true;
      return;
    }

    // Check session cache first — don't regenerate if already done this session
    const cached = _loadFromSession();
    if (cached) {
      _directives = cached;
      _ready = true;
      return;
    }

    if (!memCtx || memCtx.trim().length < 30) {
      // Not enough memory to generate meaningful directives
      _directives = '';
      _ready = true;
      return;
    }

    _generating = true;

    try {
      // Use fetchReply — it already handles the Supabase edge function routing
      // haiku would be ideal here but fetchReply uses whatever model is configured
      // max_tokens is effectively capped by the 200-token output — fast and cheap
      const raw = await fetchReply(
        DIRECTIVE_SYSTEM,
        `MEMORY:\n${memCtx.slice(0, 2000)}\n\nGenerate behavioral directives for this session.`
      );

      if (!raw || raw.includes('NO_DIRECTIVES')) {
        _directives = '';
      } else {
        // Clean and store
        _directives = raw
          .trim()
          .split('\n')
          .map(l => l.replace(/^[-–•\d.\s]+/, '').trim())
          .filter(l => l.length > 10)
          .slice(0, 5)
          .join('\n');

        _saveToSession(_directives);
      }
    } catch(e) {
      // Fail silently — Aria still works, just without behavioral directives
      _directives = '';
    }

    _ready = true;
    _generating = false;
  }


  // ── prompt injector ──────────────────────────────────────────────────────────
  // Called in sendChatMessage() before fetchReply.
  // Prepends the behavioral directive block to the system prompt.
  // If directives aren't ready yet, returns the prompt unchanged — never blocks.

  function inject(systemPrompt) {
    if (!_directives || !_directives.trim()) return systemPrompt;

    const directiveBlock = `BEHAVIORAL DIRECTIVES FOR THIS SESSION:
${_directives.split('\n').map(d => `- ${d}`).join('\n')}

These are your internal instructions based on what you know about this person. Follow them without announcing them. They are not rules to recite — they are how you should BE today.

`;

    // Insert AFTER the base character prompt but BEFORE the raw memory dump.
    // Find the injection point — "WHAT YOU KNOW ABOUT THIS USER" is where memory starts.
    const memoryMarker = 'WHAT YOU KNOW ABOUT THIS USER';
    const markerIdx = systemPrompt.indexOf(memoryMarker);

    if (markerIdx !== -1) {
      // Inject just before the memory section
      return systemPrompt.slice(0, markerIdx) + directiveBlock + systemPrompt.slice(markerIdx);
    }

    // Fallback: append to end of system prompt
    return systemPrompt + '\n\n' + directiveBlock;
  }


  // ── commitment extractor ─────────────────────────────────────────────────────
  // Runs after each Aria reply. Detects language that signals a commitment —
  // "let me know how that goes", "i want to hear what happens", etc.
  // Writes detected commitments as THREAD: lines into aria_chat_memory.
  //
  // This is entirely local pattern-matching — no API call.

  const COMMITMENT_PATTERNS = [
    /let me know how (that|it|this) (goes|turns out|went|ended)/i,
    /i want to (know|hear) (what|how) (happens|happened|it goes|that goes)/i,
    /tell me (what|how) (happens|it goes|that turns out)/i,
    /update me (on|when|if)/i,
    /i('ll| will) check (back|in|on that)/i,
    /come back and tell me/i,
    /how (does|did) (that|it) (go|end|turn out)\?/i,
    /i('m| am) (curious|genuinely curious) (how|what|if)/i,
  ];

  function extractCommitments(replyText, contextHint) {
    if (!replyText) return;

    const matched = COMMITMENT_PATTERNS.some(p => p.test(replyText));
    if (!matched) return;

    // Build a concise commitment note
    // contextHint is optional — can be the user's last message for context
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const hint = contextHint
      ? contextHint.slice(0, 60).trim()
      : replyText.slice(0, 60).trim();

    const commitmentLine = `THREAD: aria asked for an update on: "${hint}" (${today}) — still open`;

    // Write to ariaMemory and Supabase
    // Uses the existing addChatFacts pathway so it flows through the same
    // storage infrastructure already in place
    if (typeof ariaMemory !== 'undefined' && ariaMemory.addChatFacts) {
      ariaMemory.addChatFacts(commitmentLine);
    }

    if (typeof currentUserId !== 'undefined' && currentUserId && typeof db !== 'undefined') {
      db.from('user_profiles')
        .select('aria_chat_memory')
        .eq('id', currentUserId)
        .single()
        .then(({ data }) => {
          const existing = data?.aria_chat_memory || '';
          const updated = (existing + '\n' + commitmentLine).trim().slice(-4000);
          db.from('user_profiles')
            .update({ aria_chat_memory: updated })
            .eq('id', currentUserId)
            .then(() => {}).catch(() => {});
        })
        .catch(() => {});
    }
  }


  // ── commitment surface ───────────────────────────────────────────────────────
  // Adds a COMMITMENTS block to the memory context string.
  // Called from getAriaMemoryContext() — extracts THREAD lines that look like
  // commitment tracking entries and surfaces them separately with explicit instructions.

  function buildCommitmentsBlock(rawChatMemory) {
    if (!rawChatMemory) return '';

    const commitmentLines = rawChatMemory
      .split('\n')
      .map(l => l.replace(/^[-–•]\s*/, '').trim())
      .filter(l => /^THREAD:.*aria asked for an update/i.test(l))
      .map(l => l.replace(/^THREAD:\s*/i, '').trim())
      .slice(-4); // last 4 open commitments only

    if (!commitmentLines.length) return '';

    return `\nTHINGS I SAID I'D CHECK ON:\n${commitmentLines.map(c => `  - ${c}`).join('\n')}\n\nNote: don't force these. if the conversation goes there, ask. if it doesn't open naturally, let it sit. but don't forget.`;
  }


  // ── public reset ─────────────────────────────────────────────────────────────
  // Called by initChat() at the start of each session to clear stale directives.
  // Directives are session-scoped — they should regenerate each time.

  function resetSession() {
    _directives = '';
    _ready = false;
    _generating = false;
    _clearSession();
  }


  // ── public api ───────────────────────────────────────────────────────────────

  return {
    generateForSession,   // call in initChat() after getAriaMemoryContext()
    inject,               // call in sendChatMessage() before fetchReply()
    extractCommitments,   // call in sendChatMessage() after Aria's reply lands
    buildCommitmentsBlock,// call in getAriaMemoryContext() to surface commitments
    resetSession,         // call in initChat() at top
    get ready() { return _ready; },
    get directives() { return _directives; },
  };

})();


// ─── INTEGRATION PATCH ────────────────────────────────────────────────────────
// This section monkey-patches the three functions in aria-app.js that need
// to change. Load this file AFTER aria-app.js and these patches apply
// automatically — no edits to aria-app.js required.
// ─────────────────────────────────────────────────────────────────────────────


// ── PATCH 1: getAriaMemoryContext ────────────────────────────────────────────
// Adds the COMMITMENTS block to the returned memory context.

if (typeof getAriaMemoryContext === 'function') {
  const _origGetAriaMemoryContext = getAriaMemoryContext;

  window.getAriaMemoryContext = async function() {
    const baseCtx = await _origGetAriaMemoryContext();

    // Extract commitments from the raw chat memory and surface them separately
    // We need the raw chat memory — pull it from Supabase if authed
    let commitmentsBlock = '';
    if (typeof currentUserId !== 'undefined' && currentUserId && typeof db !== 'undefined') {
      try {
        const { data } = await db
          .from('user_profiles')
          .select('aria_chat_memory')
          .eq('id', currentUserId)
          .single();
        commitmentsBlock = ariaDirectives.buildCommitmentsBlock(data?.aria_chat_memory || '');
      } catch(e) {}
    }

    if (!commitmentsBlock) return baseCtx;

    // Append commitments block at the end of the context
    const merged = (baseCtx + commitmentsBlock).trim();
    return merged.length > 4200 ? merged.slice(-4200) : merged;
  };
}


// ── PATCH 2: initChat ────────────────────────────────────────────────────────
// Resets session directives and triggers generation after memory is loaded.

if (typeof initChat === 'function') {
  const _origInitChat = initChat;

  window.initChat = function() {
    // Reset directives at the top of every new session
    ariaDirectives.resetSession();

    // Call original
    _origInitChat();

    // Generate behavioral directives from memory — fire async, don't block UI
    // We wait 1.5s to let the original initChat finish loading memory from Supabase
    // before we try to read it for directive generation
    setTimeout(async () => {
      try {
        const memCtx = await getAriaMemoryContext();
        if (memCtx && memCtx.trim().length > 30) {
          await ariaDirectives.generateForSession(memCtx);
        }
      } catch(e) {}
    }, 1500);
  };
}


// ── PATCH 3: sendChatMessage ─────────────────────────────────────────────────
// Injects behavioral directives into system prompt.
// Extracts commitments from Aria's reply after it lands.

if (typeof sendChatMessage === 'function') {
  const _origSendChatMessage = sendChatMessage;

  window.sendChatMessage = async function() {
    // We can't easily intercept the internal fetchReply call inside sendChatMessage
    // without rewriting it. Instead, we patch at the fetchReply level — safer.
    // See PATCH 3b below.
    return _origSendChatMessage();
  };
}

// ── PATCH 3b: fetchReply ─────────────────────────────────────────────────────
// This is the cleaner injection point. fetchReply receives the final system
// prompt — we intercept here to inject directives, then pass through.
// Also hooks the response to extract commitments.

if (typeof fetchReply === 'function') {
  const _origFetchReply = fetchReply;

  window.fetchReply = async function(system, userMsg, imageB64 = null) {
    // Inject behavioral directives into system prompt
    const injectedSystem = ariaDirectives.inject(system);

    // Call original with injected system
    const result = await _origFetchReply(injectedSystem, userMsg, imageB64);

    // Extract commitments from Aria's reply
    // userMsg is the user's message — use as context hint for the commitment note
    const userText = typeof userMsg === 'string'
      ? userMsg.slice(0, 80)
      : (Array.isArray(userMsg) ? (userMsg.find(m => m.type === 'text')?.text || '') : '').slice(0, 80);

    ariaDirectives.extractCommitments(result, userText);

    return result;
  };
}
