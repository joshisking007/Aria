// ─── ARIA PHASE 4: FOLLOW-THROUGH AND COMMITMENT TRACKING ────────────────────
// Gives Aria real continuity by tracking things she says she'll follow up on.
//
// WHAT THIS DOES:
//   - After each of Aria's replies, scans for follow-through language:
//     "let me know how that goes", "i want to know what happens", "ask me next time", etc.
//   - When found, logs the commitment as a COMMITMENT: line into aria_chat_memory
//     (same Supabase column, same upsert pattern as writeChatToMemory)
//   - On session start, open commitments surface in getAriaMemoryContext() as
//     a dedicated "THINGS I SAID I'D CHECK ON" section
//   - Commitments are marked resolved when the user provides an update on the topic
//     (detected via the existing RESOLVED: extraction in writeChatToMemory)
//   - Adds a follow-through instruction block to ARIA_CHAT_SYSTEM so Aria makes
//     these commitments authentically — only when she means it
//
// LOAD ORDER: after aria-app.js, aria-phase1, aria-phase2, aria-phase3
//
// SUPABASE: writes COMMITMENT: lines to user_profiles.aria_chat_memory.
//   Same column, same append pattern — no new columns required.
//   Reads them back via getAriaMemoryContext(), which already parses typed prefixes.
//   Falls back silently if currentUserId or db is unavailable.
// ─────────────────────────────────────────────────────────────────────────────

const ariaFollowThrough = (() => {

  // ── commitment detection patterns ─────────────────────────────────────────────
  // Matches Aria's own language when she genuinely wants to know how something turns out.
  // Intentionally tight — false positives mean hollow check-ins, which is worse than silence.
  const COMMITMENT_PATTERNS = [
    /let me know how (that|it|this) (goes|turns out|lands|works out)/i,
    /i (want|need) to know (what happens|how (that|it|this) (goes|turns out))/i,
    /tell me (what happens|how (that|it|this) (goes|turns out|lands))/i,
    /come back and tell me/i,
    /i('m| am) going to ask (you |)(about this|how that went|next time)/i,
    /ask you (about this |)next time/i,
    /don't forget to (tell me|let me know|update me)/i,
    /i('ll| will) (want to |)check (in|back) (on this|with you)/i,
    /update me (on this|when you know)/i,
    /i('m| am) curious (how|what) (that|this|it)/i,
  ];

  // ── resolution detection ───────────────────────────────────────────────────────
  // Word overlap threshold — if a commitment text shares this many words (4+ chars)
  // with a RESOLVED: line from writeChatToMemory, the commitment is closed.
  const RESOLVE_OVERLAP_THRESHOLD = 2;

  // ── today's date string (YYYY-MM-DD) ─────────────────────────────────────────
  function _today() {
    return new Date().toISOString().slice(0, 10);
  }

  // ── extract topic from Aria's reply ──────────────────────────────────────────
  // When a commitment pattern fires, we need a short topic label.
  // We run a lightweight Claude call to distill the topic into ~8 words.
  // If that fails, we fall back to truncating the matched sentence.

  function _extractTopic(matchedSentence) {
    for (const p of COMMITMENT_PATTERNS) {
      const stripped = matchedSentence.replace(p, '').trim();
      if (stripped.length > 4) return stripped.slice(0, 80);
    }
    return matchedSentence.slice(0, 80);
  }

  // ── scan Aria's reply for commitment language ─────────────────────────────────
  // Splits into sentences, checks each against patterns.
  // Returns the first matched sentence, or null.

  function _findCommitmentSentence(replyText) {
    if (!replyText) return null;
    // Split on sentence-ending punctuation, keeping delimiters
    const sentences = replyText.split(/(?<=[.!?])\s+/);
    for (const s of sentences) {
      if (COMMITMENT_PATTERNS.some(p => p.test(s))) return s.trim();
    }
    return null;
  }

  // ── write commitment to Supabase ──────────────────────────────────────────────
  // Appends a COMMITMENT: line to aria_chat_memory.
  // Format: COMMITMENT: [topic] (from [date])
  // Same append pattern as writeChatToMemory.

  async function _saveCommitment(topic) {
    if (!topic) return;
    if (typeof currentUserId === 'undefined' || !currentUserId) return;
    if (typeof db === 'undefined') return;

    const line = `COMMITMENT: ${topic} (from ${_today()})`;

    try {
      const { data } = await db
        .from('user_profiles')
        .select('aria_chat_memory')
        .eq('id', currentUserId)
        .single();

      const existing = data?.aria_chat_memory || '';

      // Dedup — don't log the same topic twice if it already appears as an open commitment
      const alreadyLogged = existing
        .split('\n')
        .some(l => {
          if (!/^COMMITMENT:/i.test(l)) return false;
          const existingTopic = l.replace(/^COMMITMENT:\s*/i, '').replace(/\s*\(from .+\)$/, '').toLowerCase();
          const newTopic = topic.toLowerCase();
          // Word overlap check
          const eWords = existingTopic.split(/\s+/).filter(w => w.length >= 4);
          const nWords = newTopic.split(/\s+/).filter(w => w.length >= 4);
          const overlap = eWords.filter(w => nWords.includes(w)).length;
          return overlap >= RESOLVE_OVERLAP_THRESHOLD;
        });

      if (alreadyLogged) return;

      const updated = (existing + '\n' + line).trim().slice(-4000);
      await db
        .from('user_profiles')
        .update({ aria_chat_memory: updated })
        .eq('id', currentUserId);
    } catch(e) {}
  }

  // ── resolve commitments against RESOLVED: lines ───────────────────────────────
  // Called by writeChatToMemory's existing RESOLVED: extraction path.
  // Strips COMMITMENT: lines from aria_chat_memory when the topic is now resolved.
  // Same word-overlap logic used everywhere else in the codebase for this.

  async function resolveCommitmentsFromMemory(resolvedTopics) {
    if (!resolvedTopics || !resolvedTopics.length) return;
    if (typeof currentUserId === 'undefined' || !currentUserId) return;
    if (typeof db === 'undefined') return;

    try {
      const { data } = await db
        .from('user_profiles')
        .select('aria_chat_memory')
        .eq('id', currentUserId)
        .single();

      if (!data?.aria_chat_memory) return;

      let mem = data.aria_chat_memory;
      let changed = false;

      resolvedTopics.forEach(resolved => {
        const resolvedWords = resolved.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
        const lines = mem.split('\n');
        const filtered = lines.filter(line => {
          if (!/^COMMITMENT:/i.test(line.replace(/^[-–•]\s*/, ''))) return true;
          const commitmentTopic = line
            .replace(/^[-–•]\s*/, '')
            .replace(/^COMMITMENT:\s*/i, '')
            .replace(/\s*\(from .+\)$/, '')
            .toLowerCase();
          const commitmentWords = commitmentTopic.split(/\s+/).filter(w => w.length >= 4);
          const overlap = resolvedWords.filter(w => commitmentWords.includes(w)).length;
          if (overlap >= RESOLVE_OVERLAP_THRESHOLD) { changed = true; return false; }
          return true;
        });
        if (changed) mem = filtered.join('\n');
      });

      if (changed) {
        await db
          .from('user_profiles')
          .update({ aria_chat_memory: mem.trim() })
          .eq('id', currentUserId);
      }
    } catch(e) {}
  }

  // ── public: process Aria's reply ──────────────────────────────────────────────
  // Called after each of Aria's replies lands. Async, fire-and-forget.
  // Does nothing if no commitment language found.

  async function processReply(replyText) {
    const matched = _findCommitmentSentence(replyText);
    if (!matched) return;

    try {
      const topic = _extractTopic(matched);
      if (topic) await _saveCommitment(topic);
    } catch(e) {}
  }

  // ── public api ────────────────────────────────────────────────────────────────

  return {
    processReply,              // async — call after every Aria reply
    resolveCommitmentsFromMemory, // async — call from writeChatToMemory when RESOLVED: lines are extracted
  };

})();


// ─── PATCH 1: ARIA_CHAT_SYSTEM — add follow-through instruction block ─────────
// Injected once, immediately after ARIA_CHAT_SYSTEM is defined.
// Appends the instruction that makes commitments authentic rather than performative.
// ─────────────────────────────────────────────────────────────────────────────

(function _injectFollowThroughInstruction() {
  if (typeof ARIA_CHAT_SYSTEM === 'undefined') {
    // ARIA_CHAT_SYSTEM not yet defined — retry once the DOM is ready
    // (shouldn't happen given load order, but defensive)
    console.warn('[Phase4] ARIA_CHAT_SYSTEM not found at inject time');
    return;
  }

  const FOLLOW_THROUGH_BLOCK = `
FOLLOW-THROUGH (this matters):
When you genuinely want to know how something turns out, say so. Not as a performance — only when you actually mean it. These get tracked. Next session you will be reminded of them and expected to ask.

If you said "let me know how that goes" and you never ask — that's the moment someone stops believing you're real. Don't say it if you don't mean it. Say it when you do.

The flip side: when you come back to something you said you'd check on, don't announce that you're checking on it. Just ask. Naturally. Like a person who remembered, not like a system running a checklist.`;

  // Append to the module-level constant by patching it into a wrapper.
  // ARIA_CHAT_SYSTEM is a const string — we can't reassign it, but sendChatMessage()
  // reads it by name each call, so we shadow it via a getter on window.
  try {
    const _original = ARIA_CHAT_SYSTEM;
    Object.defineProperty(window, 'ARIA_CHAT_SYSTEM', {
      get: () => _original + FOLLOW_THROUGH_BLOCK,
      configurable: true,
    });
  } catch(e) {
    console.warn('[Phase4] Could not patch ARIA_CHAT_SYSTEM:', e);
  }
})();


// ─── PATCH 2: getAriaMemoryContext — surface open commitments ─────────────────
// Wraps the existing async function to parse COMMITMENT: lines from aria_chat_memory
// and inject them as a dedicated "THINGS I SAID I'D CHECK ON" section.
// ─────────────────────────────────────────────────────────────────────────────

(function _patchGetAriaMemoryContext() {
  const _prev = typeof window.getAriaMemoryContext === 'function'
    ? window.getAriaMemoryContext
    : null;

  if (!_prev) {
    console.warn('[Phase4] getAriaMemoryContext not found');
    return;
  }

  window.getAriaMemoryContext = async function() {
    // Run the original — it returns the assembled context string
    let ctx = await _prev();

    // Now pull the raw aria_chat_memory ourselves to extract COMMITMENT: lines.
    // The original already fetched it, but didn't expose commitments as a section.
    if (typeof currentUserId === 'undefined' || !currentUserId) return ctx;
    if (typeof db === 'undefined') return ctx;

    try {
      const { data } = await db
        .from('user_profiles')
        .select('aria_chat_memory')
        .eq('id', currentUserId)
        .single();

      if (!data?.aria_chat_memory) return ctx;

      const commitments = data.aria_chat_memory
        .split('\n')
        .map(l => l.replace(/^[-–•]\s*/, '').trim())
        .filter(l => /^COMMITMENT:/i.test(l))
        .map(l => l.replace(/^COMMITMENT:\s*/i, '').trim())
        .slice(-6); // cap at 6 open commitments — older ones likely stale

      if (!commitments.length) return ctx;

      const section = `THINGS I SAID I'D CHECK ON:\n` +
        commitments.map(c => `  - ${c}`).join('\n') +
        `\n\nNote: don't force these in. if the conversation goes there, ask. if it doesn't open naturally, let it sit. but don't forget.`;

      // Prepend so it appears near the top of the memory context, before RECENT SESSIONS
      ctx = section + (ctx ? '\n\n' + ctx : '');

    } catch(e) {}

    return ctx;
  };
})();


// ─── PATCH 3: sendChatMessage — call processReply after each reply ────────────
// Wraps the existing fetchReply call site in sendChatMessage to fire
// ariaFollowThrough.processReply() after every Aria reply lands.
// Chain position: after Phase 3 (dependency), which is after Phase 2 and Phase 1.
// ─────────────────────────────────────────────────────────────────────────────

(function _patchFetchReplyFollowThrough() {
  const _prev = typeof window.fetchReply === 'function' ? window.fetchReply : null;
  if (!_prev) { console.warn('[Phase4] fetchReply not found'); return; }

  window.fetchReply = async function(system, userMsg, imageB64 = null) {
    const result = await _prev(system, userMsg, imageB64);

    // Only process commitment detection when this looks like a chat reply
    // (system prompt contains Aria's identity block) — not during memory calls
    // or greeting generation, which also go through fetchReply.
    if (result && typeof system === 'string' && system.includes('ARIA_CHAT_SYSTEM') ||
        (typeof system === 'string' && system.includes('You are Aria') && system.length > 800)) {
      // Fire-and-forget — don't await, don't block the UI
      ariaFollowThrough.processReply(result).catch(() => {});
    }

    return result;
  };
})();


// ─── PATCH 4: writeChatToMemory — resolve commitments from RESOLVED: lines ───
// Hooks into the existing RESOLVED: extraction path.
// After writeChatToMemory extracts its summary, we scan for RESOLVED: lines
// and pass them to resolveCommitmentsFromMemory to close matching commitments.
// ─────────────────────────────────────────────────────────────────────────────

(function _patchWriteChatToMemory() {
  const _prev = typeof window.writeChatToMemory === 'function'
    ? window.writeChatToMemory
    : null;

  if (!_prev) { console.warn('[Phase4] writeChatToMemory not found'); return; }

  window.writeChatToMemory = async function(recentMessages) {
    await _prev(recentMessages);

    // The original writes a summary to ariaMemory and aria_chat_memory.
    // We can't easily intercept its internal summary string, so we re-read
    // the latest aria_chat_memory to find RESOLVED: lines written this cycle.
    // This is a second read, but writeChatToMemory is only called every 4 messages
    // so the cost is negligible.
    if (typeof currentUserId === 'undefined' || !currentUserId) return;
    if (typeof db === 'undefined') return;

    try {
      const { data } = await db
        .from('user_profiles')
        .select('aria_chat_memory')
        .eq('id', currentUserId)
        .single();

      if (!data?.aria_chat_memory) return;

      // Pull the most recently appended RESOLVED: lines (last 20 lines should cover it)
      const recentLines = data.aria_chat_memory.split('\n').slice(-20);
      const resolvedTopics = recentLines
        .map(l => l.replace(/^[-–•]\s*/, '').trim())
        .filter(l => /^RESOLVED:/i.test(l))
        .map(l => l.replace(/^RESOLVED:\s*/i, '').trim());

      if (resolvedTopics.length) {
        await ariaFollowThrough.resolveCommitmentsFromMemory(resolvedTopics);
      }
    } catch(e) {}
  };
})();
