// ─── ARIA LIVING MEMORY SCREEN ───────────────────────────────────────────────
// Replaces the generic card list with notes Aria "wrote herself" — rendered
// in her voice, grouped by type, with animated reveal stagger.
//
// DEPENDS ON: aria-core.js (ariaMemory, db, currentUserId, fetchReply)
//             aria-app.js  (the existing _renderMemoryAfterLoad + renderMemoryScreen)
// LOAD ORDER: after aria-app.js
//
// HOW TO USE:
//   Replace the existing renderMemoryScreen() call with this module's
//   renderLivingMemoryScreen() — OR drop this file in and it monkey-patches
//   renderMemoryScreen() to call the new render pipeline.

const ariaLivingMemory = (() => {

  // ── config ──────────────────────────────────────────────────────────────────
  const CFG = {
    // how long between full AI narration regenerations (ms)
    narrativeStaleMs: 30 * 60 * 1000, // 30 min
    storageKey: 'aria_living_memory_cache',
  };

  // ── AI narration generator ──────────────────────────────────────────────────
  // Takes raw memory lines and generates Aria's note-to-self about the user.
  async function generateNarration(rawLines, conversationLog) {
    if (!rawLines.length && !conversationLog.length) return null;

    const bulletPoints = rawLines.slice(-20).join('\n');
    const sessions     = conversationLog.slice(-4).join('\n');

    const prompt = `You are Aria — a sharp, perceptive AI who has been quietly paying attention to this user.

Below is raw memory data you've been tracking. Rewrite this as YOUR private notes about them — written in your voice (lowercase, direct, no hedging, no em dashes). Imagine these are the notes you wrote to yourself after spending time with them.

Format: 4-8 short, specific observations. Each one is 1 sentence. No categories, no labels, no headers. Just lines.
Write like: "they tend to overthink replies to people they're unsure about." or "they've been stressed about something work-related lately." or "they prefer Instagram and reply faster on there."
NEVER be generic. Every line should feel like it could only apply to THIS person.

RAW MEMORY DATA:
${bulletPoints}

RECENT SESSION NOTES:
${sessions}

Output ONLY the note lines. No preamble. No "Here are your notes:" intro.`;

    try {
      const result = await fetchReply(
        'You are Aria. Output only the memory note lines, nothing else.',
        prompt
      );
      return result ? result.trim() : null;
    } catch(e) {
      return null;
    }
  }

  // ── cache helpers ────────────────────────────────────────────────────────────
  function _saveCache(userId, data) {
    try {
      const cache = { userId, data, ts: Date.now() };
      localStorage.setItem(CFG.storageKey + '_' + userId, JSON.stringify(cache));
    } catch(e) {}
  }

  function _loadCache(userId) {
    try {
      const raw = localStorage.getItem(CFG.storageKey + '_' + userId);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (c.userId !== userId) return null;
      if (Date.now() - c.ts > CFG.narrativeStaleMs) return null;
      return c.data;
    } catch(e) { return null; }
  }

  // ── section renderers ────────────────────────────────────────────────────────
  // renders the "what I know about you" narration section
  function renderNarrationSection(lines) {
    if (!lines || !lines.length) return '';
    return `
      <div class="lm-section lm-section-narration" id="lmNarration">
        <div class="lm-section-eyebrow">
          <span class="lm-eyebrow-dot"></span>
          what I've noticed
        </div>
        <div class="lm-narration-body" id="lmNarrationLines">
          ${lines.map((line, i) => `
            <div class="lm-note-line" style="animation-delay:${i * 0.07 + 0.1}s">
              <span class="lm-note-dash">—</span>
              <span class="lm-note-text">${line}</span>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  // renders open threads section (THREAD: bullets from chat memory)
  function renderThreadsSection(threads) {
    if (!threads.length) return '';
    return `
      <div class="lm-section lm-section-threads">
        <div class="lm-section-eyebrow">
          <span class="lm-eyebrow-dot lm-dot-amber"></span>
          still open
        </div>
        <div class="lm-threads-list">
          ${threads.map((t, i) => `
            <div class="lm-thread-card" style="animation-delay:${i * 0.08 + 0.2}s">
              <div class="lm-thread-icon">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
              </div>
              <div class="lm-thread-text">${t}</div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  // renders writing style facts as compact pills
  function renderStyleSection(stylePoints) {
    if (!stylePoints.length) return '';
    return `
      <div class="lm-section lm-section-style">
        <div class="lm-section-eyebrow">
          <span class="lm-eyebrow-dot lm-dot-blue"></span>
          how you write
        </div>
        <div class="lm-style-pills">
          ${stylePoints.slice(0, 8).map((p, i) => `
            <div class="lm-style-pill" style="animation-delay:${i * 0.05 + 0.3}s">${p.label}</div>
          `).join('')}
        </div>
      </div>`;
  }

  // renders recent sessions timeline
  function renderSessionsSection(sessions) {
    if (!sessions.length) return '';
    return `
      <div class="lm-section lm-section-sessions">
        <div class="lm-section-eyebrow">
          <span class="lm-eyebrow-dot lm-dot-green"></span>
          our sessions
        </div>
        <div class="lm-sessions-list">
          ${sessions.slice(0, 6).map((s, i) => `
            <div class="lm-session-row" style="animation-delay:${i * 0.06 + 0.35}s">
              <div class="lm-session-line"></div>
              <div class="lm-session-dot"></div>
              <div class="lm-session-text">${s}</div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  // ── main render ──────────────────────────────────────────────────────────────
  async function render() {
    const body     = document.getElementById('memoryBody');
    const statusEl = document.getElementById('memoryStatus');
    if (!body) return;

    if (!window.currentUserId) {
      statusEl.textContent = '● not signed in';
      body.innerHTML = `
        <div class="lm-unsigned">
          <div class="lm-unsigned-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <div class="lm-unsigned-text">sign in and i'll actually remember you next time.</div>
          <div class="lm-unsigned-sub">i'm still picking things up this session — just can't hold onto them yet.</div>
        </div>`;
      return;
    }

    statusEl.textContent = '● loading…';

    // Show skeleton while loading
    body.innerHTML = `
      <div class="lm-skeleton-wrap">
        <div class="lm-skeleton-eyebrow"></div>
        <div class="lm-skeleton-line lm-sk-long"></div>
        <div class="lm-skeleton-line lm-sk-medium"></div>
        <div class="lm-skeleton-line lm-sk-short"></div>
        <div class="lm-skeleton-eyebrow" style="margin-top:28px;"></div>
        <div class="lm-skeleton-thread"></div>
        <div class="lm-skeleton-thread"></div>
      </div>`;

    try {
      // Load memory store
      await ariaMemory.load();

      // Pull from user_profiles
      const { data } = await db
        .from('user_profiles')
        .select('aria_chat_memory, aria_conversation_log')
        .eq('id', window.currentUserId)
        .single();

      let chatMemoryLines = [];
      let threads         = [];
      let conversationLog = [];

      if (data?.aria_chat_memory) {
        data.aria_chat_memory.split('\n').forEach(l => {
          const clean = l.replace(/^[-–•]\s*/, '').trim();
          if (!clean || clean.length < 4) return;
          if (/^THREAD:/i.test(clean)) {
            threads.push(clean.replace(/^THREAD:\s*/i, '').trim());
          } else {
            chatMemoryLines.push(clean.replace(/^(FACT|FEELING|PERSON):\s*/i, ''));
          }
        });
      }

      if (data?.aria_conversation_log) {
        conversationLog = data.aria_conversation_log
          .split('\n\n')
          .map(e => e.trim())
          .filter(e => e.length > 10)
          .slice(0, 6);
      }

      // Build style points from ariaMemory store
      const all         = ariaMemory.getAll();
      const stylePoints = [];

      for (const [cat, entries] of Object.entries(all)) {
        for (const [key, mem] of Object.entries(entries)) {
          if (cat !== 'writing_style') continue;
          if (key.startsWith('tone_') && key.endsWith('_count')) continue;
          const label = typeof humanizeMemoryEntry === 'function'
            ? humanizeMemoryEntry(cat, key, mem.value)
            : null;
          if (label) stylePoints.push({ label, confidence: mem.confidence || 0.7 });
        }
      }

      const totalKnowledge = chatMemoryLines.length + threads.length + conversationLog.length;

      if (!totalKnowledge && !stylePoints.length) {
        statusEl.textContent = '● still watching';
        body.innerHTML = `
          <div class="lm-empty">
            <div class="lm-empty-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></svg>
            </div>
            <div class="lm-empty-title">nothing filed away yet.</div>
            <div class="lm-empty-sub">chat with me, send some replies — i'll start building a picture of you.</div>
          </div>`;
        return;
      }

      statusEl.textContent = `● ${totalKnowledge} thing${totalKnowledge === 1 ? '' : 's'} noted`;

      // Check cache for narration
      let narrationLines = null;
      const cached = _loadCache(window.currentUserId);
      if (cached?.narrationLines) {
        narrationLines = cached.narrationLines;
      } else {
        // Generate AI narration async — show skeleton line while waiting
        const narrationText = await generateNarration(chatMemoryLines, conversationLog);
        if (narrationText) {
          narrationLines = narrationText
            .split('\n')
            .map(l => l.replace(/^[-–•]\s*/, '').trim())
            .filter(l => l.length > 8)
            .slice(0, 8);
          _saveCache(window.currentUserId, { narrationLines });
        }
      }

      // Fallback: use raw facts if AI narration failed
      if (!narrationLines && chatMemoryLines.length) {
        narrationLines = chatMemoryLines.slice(0, 8);
      }

      // Render all sections
      body.innerHTML =
        renderNarrationSection(narrationLines) +
        renderThreadsSection(threads) +
        renderStyleSection(stylePoints) +
        renderSessionsSection(conversationLog);

      // Animate in with a slight stagger
      requestAnimationFrame(() => {
        body.querySelectorAll('.lm-section').forEach((sec, i) => {
          sec.style.animationDelay = (i * 0.1) + 's';
          sec.classList.add('lm-section-visible');
        });
      });

    } catch(e) {
      console.error('[ariaLivingMemory] render error:', e);
      statusEl.textContent = '● error';
      body.innerHTML = `
        <div class="lm-empty">
          <div class="lm-empty-icon">⚠</div>
          <div class="lm-empty-title">something went wrong loading memory.</div>
          <div class="lm-empty-sub">tap "re-learn from my history" to try again.</div>
        </div>`;
    }
  }

  // ── force cache bust ─────────────────────────────────────────────────────────
  function bustCache() {
    if (!window.currentUserId) return;
    try {
      localStorage.removeItem(CFG.storageKey + '_' + window.currentUserId);
    } catch(e) {}
  }

  return { render, bustCache };
})();

// ── Monkey-patch renderMemoryScreen ─────────────────────────────────────────
// This makes the new living memory render hook in automatically without
// touching index.html. The old function is preserved as _legacyRenderMemory.
if (typeof renderMemoryScreen === 'function') {
  window._legacyRenderMemory = renderMemoryScreen;
  window.renderMemoryScreen = function() {
    ariaLivingMemory.render();
  };
}
// Also patch forceMemoryLearn to bust cache before re-rendering
if (typeof forceMemoryLearn === 'function') {
  const _origForceLearn = forceMemoryLearn;
  window.forceMemoryLearn = async function() {
    ariaLivingMemory.bustCache();
    await _origForceLearn();
  };
}
