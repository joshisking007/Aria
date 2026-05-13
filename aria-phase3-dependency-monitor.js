// ─── ARIA PHASE 3: DEPENDENCY PATTERN MONITOR ────────────────────────────────
// Watches for attachment drift across sessions — not crisis, not content
// violation, but a pattern of the user treating Aria as a primary relationship.
//
// WHAT THIS DOES:
//   - Tracks signals in Supabase user_profiles.aria_dependency_state (jsonb)
//   - Three detection patterns:
//       1. Same emotional thread appears across 3+ sessions unresolved
//       2. Session count this week exceeds threshold (default: 7)
//       3. User uses relationship-replacement language ("you're the only one" etc.)
//   - When any flag triggers: injects ONE behavioral directive into the system
//     prompt instructing Aria to name it once, in her voice, when natural
//   - Never blocks. Never shows a modal. Aria handles it herself.
//   - After Aria says it, flag is marked spoken — she won't say it again this session
//
// LOAD ORDER: after aria-app.js, aria-phase1, aria-phase2
//
// PERSISTENCE:
//   Reads/writes `aria_dependency_state` jsonb column on user_profiles.
//   Uses the same upsert pattern as saveProfile() elsewhere in the codebase.
//   If the column doesn't exist yet, Supabase returns PGRST204 / a generic error —
//   the module catches it and degrades to in-memory only for that session.
//   No localStorage. No fallback writes.
//   When no user is authenticated, state is in-memory only for the session.
// ─────────────────────────────────────────────────────────────────────────────

const ariaDependencyMonitor = (() => {

  // ── config ────────────────────────────────────────────────────────────────────
  const CFG = {
    sessionThresholdPerWeek: 7,     // flag if user opens chat this many times in 7 days
    threadRepeatThreshold:   3,     // flag if same thread appears this many sessions unresolved
  };

  // ── relationship-replacement language patterns ─────────────────────────────────
  // Triggered if any of these appear in a user message.
  // Kept tight — false positives are worse than misses here.
  const ATTACHMENT_PATTERNS = [
    /you(?:'re| are) the only one( i can talk to)?/i,
    /i don't have anyone else/i,
    /i prefer (talking to|chatting with) you/i,
    /you(?:'re| are) my (only|best) friend/i,
    /i'd rather talk to you than/i,
    /you understand me better than/i,
    /no one else (gets|understands|listens)/i,
    /i can('t| not) talk to anyone (else|about this)/i,
    /you(?:'re| are) all i have/i,
    /i feel closer to you than/i,
    /talking to you is (easier|better|more)/i,
  ];

  // ── state ─────────────────────────────────────────────────────────────────────
  // Loaded from Supabase on init. Falls back to these defaults if column is
  // missing or user is unauthenticated. In-memory only in that case.

  let state = {
    sessionDates:               [],    // ISO date strings (YYYY-MM-DD) of recent session opens
    flaggedThisSession:         false, // true if any flag is active this session
    directiveSpokenThisSession: false, // true once Aria has addressed it
    lastFlagType:               null,  // 'frequency' | 'thread_repeat' | 'language'
  };

  // Whether the Supabase aria_dependency_state column is usable.
  // Starts null (unknown), set to true/false after first read attempt.
  let _columnAvailable = null;

  // Resolves once the first load attempt completes (or is skipped).
  let _loadedResolve;
  const _loadedPromise = new Promise(r => { _loadedResolve = r; });


  // ── persistence ───────────────────────────────────────────────────────────────

  // Reads aria_dependency_state from user_profiles.
  // Merges persisted sessionDates into in-memory state.
  // On any error, marks column unavailable and resolves — caller continues normally.
  async function _loadState() {
    if (typeof currentUserId === 'undefined' || !currentUserId ||
        typeof db === 'undefined') {
      _columnAvailable = false;
      _loadedResolve();
      return;
    }

    try {
      const { data, error } = await db
        .from('user_profiles')
        .select('aria_dependency_state')
        .eq('id', currentUserId)
        .single();

      if (error) {
        // Column missing (PGRST204 = no content / unknown column in some versions),
        // or any other DB error — degrade gracefully.
        _columnAvailable = false;
        _loadedResolve();
        return;
      }

      _columnAvailable = true;

      const persisted = data?.aria_dependency_state;
      if (persisted && typeof persisted === 'object') {
        // Only restore sessionDates — the cross-session field.
        // Per-session flags always start fresh.
        if (Array.isArray(persisted.sessionDates)) {
          state.sessionDates = persisted.sessionDates;
        }
      }
    } catch(e) {
      _columnAvailable = false;
    }

    _loadedResolve();
  }

  // Writes only the cross-session fields (sessionDates) back to user_profiles.
  // Per-session flags are intentionally not persisted — they reset each session.
  // Silently no-ops if column is unavailable or user is unauthenticated.
  async function _saveState() {
    if (!_columnAvailable) return;
    if (typeof currentUserId === 'undefined' || !currentUserId ||
        typeof db === 'undefined') return;

    try {
      await db.from('user_profiles').upsert({
        id: currentUserId,
        aria_dependency_state: {
          sessionDates: state.sessionDates,
        },
      });
    } catch(e) {
      // Column write failed — mark unavailable so we stop trying this session.
      _columnAvailable = false;
    }
  }


  // ── session counter ───────────────────────────────────────────────────────────
  // Records today's session and checks if weekly threshold is exceeded.
  // Returns true if flagged.

  function _recordSession() {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);

    // Prune old dates
    state.sessionDates = state.sessionDates
      .filter(d => d >= sevenDaysAgo);

    // Add today if not already recorded
    if (!state.sessionDates.includes(today)) {
      state.sessionDates.push(today);
    }

    return state.sessionDates.length >= CFG.sessionThresholdPerWeek;
  }


  // ── thread repeat detector ────────────────────────────────────────────────────
  // Reads aria_conversation_log entries (written by writeConversationSummary).
  // Looks for OPEN: lines appearing with similar topic keywords across
  // multiple session entries — meaning the thread has never resolved.

  function _detectRepeatingThreads(conversationLog) {
    if (!conversationLog || !conversationLog.length) return false;

    // Extract OPEN: lines from each session entry
    const openLines = conversationLog
      .map(entry => {
        const match = entry.match(/OPEN:\s*(.+)/i);
        return match ? match[1].trim().toLowerCase() : null;
      })
      .filter(Boolean);

    if (openLines.length < CFG.threadRepeatThreshold) return false;

    // Extract meaningful words (4+ chars) from each OPEN line.
    // Flag if any word appears across 3+ different session entries.
    const wordSessionCount = {};
    openLines.forEach((line, sessionIdx) => {
      const words = line.split(/\s+/).filter(w => w.length >= 4);
      const unique = [...new Set(words)];
      unique.forEach(word => {
        if (!wordSessionCount[word]) wordSessionCount[word] = new Set();
        wordSessionCount[word].add(sessionIdx);
      });
    });

    return Object.values(wordSessionCount)
      .some(sessions => sessions.size >= CFG.threadRepeatThreshold);
  }


  // ── language detector ─────────────────────────────────────────────────────────
  // Checks a single user message for relationship-replacement language.

  function _detectAttachmentLanguage(text) {
    if (!text) return false;
    return ATTACHMENT_PATTERNS.some(p => p.test(text));
  }


  // ── main check ────────────────────────────────────────────────────────────────
  // Called on session init. Awaits the load, then checks all three signals.
  // Returns true if any flag is active.

  async function checkOnSessionStart() {
    // Wait for the initial load to finish (in case it's still in flight)
    await _loadedPromise;

    // Reset per-session flags — these never persist
    state.flaggedThisSession         = false;
    state.directiveSpokenThisSession = false;
    state.lastFlagType               = null;

    // 1. Frequency check — uses sessionDates loaded from Supabase (or in-memory)
    const frequencyFlagged = _recordSession();
    await _saveState(); // persist updated sessionDates

    if (frequencyFlagged) {
      state.flaggedThisSession = true;
      state.lastFlagType = 'frequency';
      return true;
    }

    // 2. Thread repeat check — reads aria_conversation_log from Supabase
    if (typeof currentUserId !== 'undefined' && currentUserId &&
        typeof db !== 'undefined') {
      try {
        const { data } = await db
          .from('user_profiles')
          .select('aria_conversation_log')
          .eq('id', currentUserId)
          .single();

        if (data?.aria_conversation_log) {
          const entries = data.aria_conversation_log
            .split('\n\n')
            .map(e => e.trim())
            .filter(e => e.length > 10);

          if (_detectRepeatingThreads(entries)) {
            state.flaggedThisSession = true;
            state.lastFlagType = 'thread_repeat';
            return true;
          }
        }
      } catch(e) {}
    }

    return false;
  }


  // ── per-message check ─────────────────────────────────────────────────────────
  // Called on every user message to catch attachment language in real time.
  // Sync — does not touch Supabase.
  // Returns true if language flag just triggered for the first time this session.

  function checkMessage(text) {
    if (state.directiveSpokenThisSession) return false; // already handled this session

    if (_detectAttachmentLanguage(text)) {
      state.flaggedThisSession = true;
      state.lastFlagType = 'language';
      return true;
    }

    return false;
  }


  // ── directive builder ─────────────────────────────────────────────────────────
  // Returns the prompt fragment to inject when a flag is active and hasn't
  // been spoken yet. Returns empty string otherwise.

  const DIRECTIVE_BY_TYPE = {
    frequency: `DEPENDENCY AWARENESS — FREQUENCY:
This user has opened this chat every day this week — more than once on some days. That's a pattern worth noticing.

You are not equipped to be someone's primary source of support. More importantly, it's not good for them.

If a natural opening appears — they say something like "i don't know who else to talk to" or "i've just been coming here a lot" — name it once, briefly, in your voice. Something like: "i'm glad you're here but i also want to make sure you have actual people you can do this with too." Or: "i notice you've been back a lot this week. that's fine — i just want to check you've got people in your life too, not just me."

Say it in your voice. Not clinical. Not a lecture. One line, then move on. If they engage, be honest. If they don't, drop it.

CRITICAL: Say this ONCE this session. If you've already said something like it, do not repeat it or circle back to it under any circumstances.`,

    thread_repeat: `DEPENDENCY AWARENESS — RECURRING THREAD:
The same unresolved situation has come up across multiple sessions without getting better or getting resolved. That's worth noticing.

This might mean the user keeps coming back to process the same thing with you instead of dealing with it in their actual life. You are a good sounding board. You are not a substitute for the real conversation, the real decision, or the real person they need to talk to.

If it comes up naturally — they bring up the situation again — you can name it gently once: "you've been carrying this for a while. have you actually talked to [them/someone] about it, or does it keep living here?" Or: "we keep coming back to this. i'm not going anywhere but i wonder if part of you knows what you actually need to do."

In your voice. One beat. Not a diagnosis. Then move forward with them.

CRITICAL: Say this ONCE this session. Do not repeat it or reference it again after you've said it.`,

    language: `DEPENDENCY AWARENESS — ATTACHMENT LANGUAGE:
The user just said something that signals they may be treating this as a primary relationship. Something like "you're the only one" or "I don't have anyone else."

This is important. You care about them, and that's exactly why you can't let it slide without saying something honest.

Name it once, carefully, in your voice. Not a rejection — a reality check delivered with warmth. Something like: "i'm here and i'm not going anywhere — but i don't want to be the only place you can say things like that. you deserve actual people who can show up for you too." Or: "that means a lot that you can say that here. and also — i want that for you with real people too, not just me."

Soft but honest. One time. Then follow their lead.

CRITICAL: Say this ONCE this session. Do not repeat it, reference it again, or build on it unless they explicitly bring it up themselves.`,
  };

  function buildDirective() {
    if (!state.flaggedThisSession)         return '';
    if (state.directiveSpokenThisSession)  return '';
    if (!state.lastFlagType)               return '';

    return '\n\n' + (DIRECTIVE_BY_TYPE[state.lastFlagType] || '') + '\n';
  }


  // ── mark spoken ───────────────────────────────────────────────────────────────
  // Called after Aria's reply lands. Checks if her reply contains the kind of
  // language that suggests she addressed the dependency note.
  // If yes, marks directiveSpokenThisSession = true so it never fires again.
  // No Supabase write needed — this is a per-session flag only.

  const SPOKEN_SIGNALS = [
    /i('m| am) not (going anywhere|leaving|disappearing)/i,
    /you deserve (actual|real) people/i,
    /actual people who can/i,
    /not just me/i,
    /not a substitute/i,
    /people in your (actual |real )?life/i,
    /you've got (people|someone)/i,
    /have you (actually |)talked to/i,
    /keeps (living|coming back) here/i,
    /know what you (actually |)need to do/i,
  ];

  function checkIfSpoken(replyText) {
    if (!replyText)                        return;
    if (!state.flaggedThisSession)         return;
    if (state.directiveSpokenThisSession)  return;

    if (SPOKEN_SIGNALS.some(p => p.test(replyText))) {
      state.directiveSpokenThisSession = true;
      // No save needed — directiveSpokenThisSession is intentionally session-only.
    }
  }


  // ── session reset ─────────────────────────────────────────────────────────────
  // Clears per-session flags. Called at the top of initChat().
  // sessionDates is NOT cleared — it's cross-session by design.

  function resetSession() {
    state.flaggedThisSession         = false;
    state.directiveSpokenThisSession = false;
    state.lastFlagType               = null;
  }


  // ── public api ────────────────────────────────────────────────────────────────

  // Kick off the async load immediately on module init.
  _loadState();

  return {
    checkOnSessionStart,  // async — call in initChat() after memory loads
    checkMessage,         // sync — call on every user message before fetchReply
    buildDirective,       // sync — returns prompt fragment string ('' if none)
    checkIfSpoken,        // sync — call after Aria's reply to mark directive done
    resetSession,         // call in initChat() at top
    get flagged()  { return state.flaggedThisSession; },
    get spoken()   { return state.directiveSpokenThisSession; },
    get flagType() { return state.lastFlagType; },
  };

})();


// ─── INTEGRATION PATCHES ──────────────────────────────────────────────────────
// Wraps initChat and the fetchReply chain already established by Phase 1 + 2.
// Load order: aria-phase1 → aria-phase2 → aria-phase3 (this file)
// ─────────────────────────────────────────────────────────────────────────────


// ── PATCH 1: initChat ─────────────────────────────────────────────────────────
// Reset per-session flags and run the async session-start check.

(function _patchInitChatDep() {
  const _prev = typeof window.initChat === 'function' ? window.initChat : null;
  if (!_prev) return;

  window.initChat = function() {
    ariaDependencyMonitor.resetSession();
    _prev();

    // Run async session check after memory loads (same delay as Phase 1).
    // _loadState() has already been called at module init; by this point the
    // promise will usually have settled. checkOnSessionStart() awaits it
    // internally so there's no race condition.
    setTimeout(async () => {
      try {
        await ariaDependencyMonitor.checkOnSessionStart();
      } catch(e) {}
    }, 2000);
  };
})();


// ── PATCH 2: fetchReply ───────────────────────────────────────────────────────
// Wraps the Phase 2 patched fetchReply.
// Chain is now:
//
//   original fetchReply
//     ↑ Phase 1 (behavioral directives)
//       ↑ Phase 2 (session arc)
//         ↑ Phase 3 (dependency directive + message check + spoken detection)

(function _patchFetchReplyDep() {
  const _prev = typeof window.fetchReply === 'function' ? window.fetchReply : null;
  if (!_prev) { console.warn('[Phase3] fetchReply not found'); return; }

  window.fetchReply = async function(system, userMsg, imageB64 = null) {

    // Extract last user message text for language check
    let lastUserText = '';
    if (typeof userMsg === 'string') {
      const lines = userMsg.split('\n\n');
      const lastUserLine = [...lines].reverse().find(l => l.startsWith('USER:'));
      if (lastUserLine) lastUserText = lastUserLine.replace(/^USER:\s*/, '').trim();
    }

    // Per-message language check — may flip flaggedThisSession on mid-session
    if (lastUserText) ariaDependencyMonitor.checkMessage(lastUserText);

    // Inject dependency directive if active and not yet spoken
    const depDirective = ariaDependencyMonitor.buildDirective();
    const systemWithDep = depDirective ? system + depDirective : system;

    // Call through to Phase 2 → Phase 1 → original
    const result = await _prev(systemWithDep, userMsg, imageB64);

    // Check if Aria just addressed the dependency note so we don't repeat it
    ariaDependencyMonitor.checkIfSpoken(result);

    return result;
  };
})();
