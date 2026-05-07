// ARIA NOTIFICATIONS ENGINE
// Proactive push notifications + in-app check-ins
// Handles: user check-ins, unfinished conversations, open threads, long game nudges, drift alerts
//
// ARCHITECTURE:
// - Push notifications: Web Push API via service worker (requires VAPID setup on server)
// - In-app banners: shown on app open when push isn't available or user is already in-app
// - All copy is AI-generated from real memory context — never generic
//
// LOAD ORDER: after aria-core.js and aria-app.js
// ADD TO index.html: <script src="aria-notifications.js"></script>

const ariaNudge = (() => {

  // ─── STORAGE KEYS ────────────────────────────────────────────────────────────
  const KEYS = {
    permission:       'aria_notif_permission',    // 'granted'|'denied'|'not-asked'
    lastAsked:        'aria_notif_last_asked',     // ISO timestamp
    lastOpen:         'aria_notif_last_open',      // ISO timestamp — updated on every app open
    lastChatMsg:      'aria_notif_last_chat_msg',  // ISO timestamp — updated after each chat exchange
    lastNudge:        'aria_notif_last_nudge',     // ISO timestamp — rate-limits nudges
    pendingThread:    'aria_notif_pending_thread', // JSON — last open thread detected
    snoozeUntil:      'aria_notif_snooze',         // ISO timestamp — user snoozed nudges
    nudgeCount:       'aria_notif_nudge_count',    // int — how many nudges sent total
    dismissed:        'aria_notif_dismissed',      // 'true' — user opted out permanently
  };

  // ─── CONFIG ──────────────────────────────────────────────────────────────────
  const CFG = {
    // How long the user needs to be gone before Aria checks in (hours)
    checkinAfterHours:        22,    // ~1 day
    urgentCheckinAfterHours:  50,    // ~2 days — more direct tone

    // Minimum gap between any two nudges (hours) — prevents spam
    minNudgeGapHours:         6,

    // Unfinished chat: how long since last message before nudging (hours)
    unfinishedChatHours:      3,

    // Ask for push permission after this many sessions
    askPermissionAfterSessions: 2,

    // Max nudges before backing off and asking if they want fewer
    backoffAfterNudges:         20,
  };

  // ─── NOTIFICATION COPY POOLS ─────────────────────────────────────────────────
  // Used as fallbacks when AI generation fails or as in-app copy
  const COPY = {
    checkin_short: [
      "hey. you went quiet. everything okay?",
      "you've been gone a while. what's going on with you.",
      "hey. it's been a minute. come back and talk to me.",
      "been a while. something happen or did you just forget about me.",
      "you've been away. i'm not worried but i noticed.",
    ],
    checkin_urgent: [
      "okay it's been two days. i'm actually asking now — you good?",
      "hey. two days. that's long. what's up.",
      "haven't seen you in a while. come find me.",
    ],
    unfinished_chat: [
      "we didn't finish. you left mid-conversation.",
      "i'm still here. you kind of just... stopped.",
      "you left without saying bye. rude but i'll get over it. come back.",
      "our conversation isn't done yet.",
    ],
    open_thread: [
      "you never told me how that ended.",
      "i'm still thinking about what you said earlier.",
      "that thing you mentioned — did it work out?",
    ],
    long_game: [
      "your long game with {contact} — you still on that?",
      "have you made your next move with {contact} yet?",
      "{contact} is waiting. you know what to do.",
    ],
    drift: [
      "you haven't reached out to {contact} in {days} days.",
      "{contact} is drifting. you haven't texted in a while.",
      "just a heads up — {contact} hasn't heard from you in {days} days.",
    ],
  };

  // ─── INTERNAL STATE ──────────────────────────────────────────────────────────
  let _pushSubscription  = null;
  let _bannerShown       = false;
  let _initDone          = false;
  let _sessionCount      = 0;

  // ─── HELPERS ─────────────────────────────────────────────────────────────────

  function _get(key, fallback = null) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }
  function _set(key, val) {
    try { localStorage.setItem(key, val); } catch {}
  }
  function _hoursSince(isoStr) {
    if (!isoStr) return Infinity;
    return (Date.now() - new Date(isoStr).getTime()) / (1000 * 60 * 60);
  }
  function _pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function _isSnoozed() {
    const until = _get(KEYS.snoozeUntil);
    return until && new Date(until).getTime() > Date.now();
  }
  function _isDismissed() {
    return _get(KEYS.dismissed) === 'true';
  }
  function _canNudge() {
    if (_isDismissed() || _isSnoozed()) return false;
    return _hoursSince(_get(KEYS.lastNudge)) >= CFG.minNudgeGapHours;
  }
  function _markNudgeSent() {
    _set(KEYS.lastNudge, new Date().toISOString());
    _set(KEYS.nudgeCount, String(parseInt(_get(KEYS.nudgeCount, '0')) + 1));
  }

  // ─── OPEN THREAD DETECTION ───────────────────────────────────────────────────
  // Scans aria_chat_memory for THREAD: bullets and stores the most recent one.
  // Called after writeChatToMemory completes. Also called on app open.

  async function detectOpenThreads() {
    if (!window.currentUserId || !window.db) return null;
    try {
      const { data } = await window.db
        .from('user_profiles')
        .select('aria_chat_memory, aria_conversation_log')
        .eq('id', window.currentUserId)
        .single();

      const threads = [];

      // Parse THREAD: bullets from chat memory
      if (data?.aria_chat_memory) {
        data.aria_chat_memory.split('\n').forEach(line => {
          const m = line.match(/^[-–•]?\s*THREAD:\s*(.+)/i);
          if (m) threads.push(m[1].trim());
        });
      }

      // Also scan conversation log for "OPEN:" markers
      if (data?.aria_conversation_log) {
        data.aria_conversation_log.split('\n').forEach(line => {
          const m = line.match(/OPEN:\s*(.+)/i);
          if (m) threads.push(m[1].trim());
        });
      }

      if (!threads.length) return null;

      // Return the most recent thread
      const thread = threads[threads.length - 1];
      _set(KEYS.pendingThread, JSON.stringify({ text: thread, detectedAt: new Date().toISOString() }));
      return thread;
    } catch { return null; }
  }

  // ─── AI-GENERATED NUDGE COPY ─────────────────────────────────────────────────
  // Generates a short, Aria-voiced message referencing actual context.
  // Falls back to COPY pool if generation fails.

  async function _generateNudgeCopy(type, context = {}) {
    try {
      const memCtx = typeof getAriaMemoryContext === 'function'
        ? await getAriaMemoryContext()
        : '';

      let prompt = '';

      if (type === 'checkin') {
        const hours = context.hours || 24;
        const tone  = hours > 48 ? 'more direct and a little concerned' : 'casual and dry';
        prompt = `The user hasn't opened the app in ${Math.round(hours)} hours. Write ONE short message in Aria's voice to bring them back.
Tone: ${tone}. Lowercase. No em dashes. Max 12 words. Reference something specific from memory if it fits — otherwise just check in naturally.
Output only the message, nothing else.
${memCtx ? '\nMEMORY CONTEXT:\n' + memCtx : ''}`;
      }
      else if (type === 'unfinished_chat') {
        prompt = `The user was mid-conversation with Aria and left without finishing. Write ONE short message to pull them back.
Tone: dry, slightly pointed but not aggressive. Lowercase. No em dashes. Max 12 words.
Output only the message, nothing else.
${memCtx ? '\nMEMORY CONTEXT:\n' + memCtx : ''}`;
      }
      else if (type === 'open_thread') {
        const thread = context.thread || '';
        prompt = `The user mentioned something unresolved in a past conversation: "${thread}"
Write ONE short message asking how it turned out. Aria's voice — dry, casual, genuinely curious.
Lowercase. No em dashes. Max 15 words. Output only the message.`;
      }
      else if (type === 'long_game') {
        const contact = context.contactName || 'them';
        const step    = context.stepTitle || 'your next move';
        prompt = `The user has an active long game strategy with ${contact}. The next step is: "${step}"
Write ONE short nudge reminding them to make their move. Aria's voice — scheming, confident, brief.
Lowercase. No em dashes. Max 15 words. Output only the message.`;
      }
      else if (type === 'drift') {
        const name = context.contactName || 'someone';
        const days = context.days || '?';
        prompt = `The user hasn't reached out to ${name} in ${days} days. Write ONE short nudge.
Aria's voice — observational, not preachy. Lowercase. No em dashes. Max 15 words. Output only the message.`;
      }

      if (!prompt) return null;

      const raw = await fetchReply(
        'You are Aria. Write exactly what is asked. Output ONLY the message — no quotes, no preamble, no explanation.',
        prompt
      );

      return raw?.trim().replace(/^["'`]|["'`]$/g, '') || null;

    } catch { return null; }
  }

  // ─── PUSH NOTIFICATION ───────────────────────────────────────────────────────

  async function _sendPush(title, body, data = {}) {
    // In a real deployment: POST to your Supabase edge function which calls web-push.
    // The edge function needs VAPID keys and the user's push subscription stored in DB.
    // For now — attempt if subscription stored, otherwise skip silently.
    if (!_pushSubscription || !window.currentUserId) return false;
    try {
      await fetch('https://mmtdtcmhvbruubrjgjrz.supabase.co/functions/v1/aria-push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tdGR0Y21odmJydXVicmpnanJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTU2MDUsImV4cCI6MjA5MjY5MTYwNX0.f2FXAA8GaUeXXE8V8dnwq4NXz3_22H7d5jVA9rAWsTo'
        },
        body: JSON.stringify({
          userId: window.currentUserId,
          subscription: _pushSubscription,
          title,
          body,
          data
        })
      });
      return true;
    } catch { return false; }
  }

  // ─── IN-APP NUDGE BANNER ──────────────────────────────────────────────────────
  // Shown when the user is already in the app, or when push isn't available.
  // Appears at the top of the home screen only — doesn't interrupt other screens.

  function _showInAppBanner(message, type = 'checkin', actions = []) {
    if (_bannerShown) return;
    _bannerShown = true;

    const existing = document.getElementById('ariaNudgeBanner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'ariaNudgeBanner';
    banner.className = 'aria-nudge-banner';

    // Choose expression based on type
    const exprMap = {
      checkin:        'soft',
      unfinished_chat:'scheming',
      open_thread:    'curious',
      long_game:      'scheming',
      drift:          'suspicious',
    };
    const expr = exprMap[type] || 'soft';
    const imgSrc = typeof ARIA_EXPRESSION_IMGS !== 'undefined'
      ? ARIA_EXPRESSION_IMGS[expr] || ARIA_EXPRESSION_IMGS.default
      : null;

    const defaultActions = [
      { label: 'talk to aria', action: () => { dismiss(); if(typeof showScreen==='function') showScreen('chatScreen'); } },
      { label: 'snooze 4h',    action: () => snooze(4) },
      { label: '×',            action: () => dismiss(), secondary: true },
    ];
    const btns = actions.length ? actions : defaultActions;

    banner.innerHTML = `
      <div class="nudge-banner-inner">
        ${imgSrc ? `<img class="nudge-banner-img" src="${imgSrc}" alt="aria" crossorigin="anonymous"/>` : '<div class="nudge-banner-orb"></div>'}
        <div class="nudge-banner-content">
          <div class="nudge-banner-msg">${message}</div>
          <div class="nudge-banner-actions" id="nudgeBannerActions"></div>
        </div>
      </div>
    `;

    // Inject into DOM before the first screen
    const firstScreen = document.querySelector('.screen') || document.body.firstChild;
    document.body.insertBefore(banner, firstScreen);

    // Wire up buttons after DOM insert
    const actionsEl = document.getElementById('nudgeBannerActions');
    btns.forEach(b => {
      const btn = document.createElement('button');
      btn.className = 'nudge-banner-btn' + (b.secondary ? ' secondary' : '');
      btn.textContent = b.label;
      btn.onclick = b.action;
      actionsEl.appendChild(btn);
    });

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => banner.classList.add('visible'));
    });

    // Auto-dismiss after 12 seconds
    setTimeout(() => { if (!_isDismissed()) dismiss(); }, 12000);
  }

  function _hideBanner() {
    const b = document.getElementById('ariaNudgeBanner');
    if (!b) return;
    b.classList.remove('visible');
    setTimeout(() => b.remove(), 400);
    _bannerShown = false;
  }

  // ─── PERMISSION REQUEST ───────────────────────────────────────────────────────

  async function requestPermission() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;

    _set(KEYS.lastAsked, new Date().toISOString());

    // Show a soft pre-prompt banner first — better UX than browser dialog cold
    return new Promise(resolve => {
      _showInAppBanner(
        "want aria to check in on you? i'll only reach out when it actually matters.",
        'checkin',
        [
          {
            label: 'yes, notify me',
            action: async () => {
              _hideBanner();
              const result = await Notification.requestPermission();
              _set(KEYS.permission, result);
              if (result === 'granted') {
                await _subscribeToPush();
                if(typeof showToast === 'function') showToast('✓ aria will check in on you', 'green');
              }
              resolve(result === 'granted');
            }
          },
          {
            label: 'not now',
            action: () => { _hideBanner(); snooze(48); resolve(false); }
          },
          {
            label: 'never',
            action: () => { _hideBanner(); _set(KEYS.dismissed, 'true'); resolve(false); },
            secondary: true
          }
        ]
      );
    });
  }

  async function _subscribeToPush() {
    try {
      const reg = await navigator.serviceWorker.ready;
      // NOTE: replace this VAPID public key with your own from your push server
      // Generate at: https://vapidkeys.com/ or via web-push library
      const VAPID_PUBLIC_KEY = 'YOUR_VAPID_PUBLIC_KEY_HERE';
      if (VAPID_PUBLIC_KEY === 'YOUR_VAPID_PUBLIC_KEY_HERE') {
        console.info('[ariaNudge] VAPID key not configured — push disabled. Set VAPID_PUBLIC_KEY in aria-notifications.js');
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
      _pushSubscription = sub.toJSON();
      // Persist subscription to Supabase so the edge function can use it
      if (window.currentUserId && window.db) {
        await window.db.from('user_profiles').upsert({
          id: window.currentUserId,
          push_subscription: JSON.stringify(_pushSubscription)
        });
      }
    } catch(e) {
      console.info('[ariaNudge] Push subscription failed (expected if VAPID not configured):', e.message);
    }
  }

  function _urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
  }

  // ─── NUDGE DECISION ENGINE ────────────────────────────────────────────────────
  // Called on every app open. Decides what (if anything) to surface.
  // Priority order: open thread > unfinished chat > long game > drift > check-in

  async function evaluate() {
    if (!_canNudge()) return;

    // 1. OPEN THREAD — highest emotional value
    const rawThread = _get(KEYS.pendingThread);
    if (rawThread) {
      try {
        const threadData = JSON.parse(rawThread);
        const threadAge  = _hoursSince(threadData.detectedAt);
        // Only surface if thread is 2+ hours old (give them time to come back naturally)
        // and last nudge wasn't about a thread already
        if (threadAge > 2 && threadAge < 96) { // surface within 4 days
          const copy = await _generateNudgeCopy('open_thread', { thread: threadData.text })
            || _pick(COPY.open_thread);
          _showInAppBanner(copy, 'open_thread', [
            { label: 'tell her',   action: () => { dismiss(); if(typeof showScreen==='function') showScreen('chatScreen'); } },
            { label: 'snooze',     action: () => snooze(4) },
            { label: '×',          action: () => dismiss(), secondary: true },
          ]);
          _markNudgeSent();
          // Clear thread after surfacing — don't show same thread twice
          _set(KEYS.pendingThread, '');
          return;
        }
      } catch {}
    }

    // 2. UNFINISHED CHAT — left mid-conversation
    const lastMsg = _get(KEYS.lastChatMsg);
    const lastOpen = _get(KEYS.lastOpen);
    if (lastMsg && lastOpen) {
      const hoursSinceMsg  = _hoursSince(lastMsg);
      const hoursSinceOpen = _hoursSince(lastOpen);
      // They messaged, then left and haven't been back in 3+ hours
      if (hoursSinceMsg > CFG.unfinishedChatHours && hoursSinceMsg < 48
          && hoursSinceOpen > CFG.unfinishedChatHours) {
        const copy = await _generateNudgeCopy('unfinished_chat')
          || _pick(COPY.unfinished_chat);
        _showInAppBanner(copy, 'unfinished_chat', [
          { label: 'finish the conversation', action: () => { dismiss(); if(typeof showScreen==='function') showScreen('chatScreen'); } },
          { label: 'snooze',                  action: () => snooze(4) },
          { label: '×',                       action: () => dismiss(), secondary: true },
        ]);
        _markNudgeSent();
        return;
      }
    }

    // 3. ACTIVE LONG GAME with a pending step
    if (typeof longGames !== 'undefined' && longGames.length) {
      const activeLG = longGames.find(g =>
        g.status === 'active' &&
        g.steps &&
        g.steps[g.currentStep]?.status === 'active'
      );
      if (activeLG) {
        const step    = activeLG.steps[activeLG.currentStep];
        const stepAge = _hoursSince(step.activatedAt || activeLG.createdAt);
        // Nudge if the step has been sitting for 24+ hours
        if (stepAge > 24 && stepAge < 120) {
          const copy = await _generateNudgeCopy('long_game', {
            contactName: activeLG.contactName || 'them',
            stepTitle:   step.title
          }) || _pick(COPY.long_game).replace('{contact}', activeLG.contactName || 'them');
          _showInAppBanner(copy, 'long_game', [
            { label: 'see the plan',  action: () => { dismiss(); if(typeof showScreen==='function') showScreen('longGameScreen'); } },
            { label: 'snooze 1 day', action: () => snooze(24) },
            { label: '×',            action: () => dismiss(), secondary: true },
          ]);
          _markNudgeSent();
          return;
        }
      }
    }

    // 4. DRIFT ALERT — someone needs reaching out to
    if (typeof contacts !== 'undefined' && contacts.length) {
      const drifter = contacts
        .filter(c => c._drift && !c.drift_dismissed && !c.drift_snoozed_until)
        .sort((a, b) => (b._drift?.daysSinceLast || 0) - (a._drift?.daysSinceLast || 0))[0];
      if (drifter) {
        const copy = await _generateNudgeCopy('drift', {
          contactName: drifter.name,
          days:        drifter._drift.daysSinceLast
        }) || _pick(COPY.drift)
          .replace('{contact}', drifter.name)
          .replace('{days}', drifter._drift.daysSinceLast);
        _showInAppBanner(copy, 'drift', [
          { label: `text ${drifter.name}`,  action: () => { dismiss(); if(typeof selectContact==='function') selectContact(drifter.id); } },
          { label: 'snooze',               action: () => snooze(8) },
          { label: '×',                    action: () => dismiss(), secondary: true },
        ]);
        _markNudgeSent();
        return;
      }
    }

    // 5. CHECK-IN — user has been away
    const hoursSinceOpen = _hoursSince(_get(KEYS.lastOpen));
    // Only show check-in AFTER the banner evaluates on this open
    // (i.e. lastOpen hasn't been updated yet — update happens after evaluate())
    if (hoursSinceOpen > CFG.checkinAfterHours) {
      const isUrgent = hoursSinceOpen > CFG.urgentCheckinAfterHours;
      const copy = await _generateNudgeCopy('checkin', { hours: hoursSinceOpen })
        || _pick(isUrgent ? COPY.checkin_urgent : COPY.checkin_short);
      _showInAppBanner(copy, 'checkin', [
        { label: 'hey aria',  action: () => { dismiss(); if(typeof showScreen==='function') showScreen('chatScreen'); } },
        { label: 'snooze 4h', action: () => snooze(4) },
        { label: '×',         action: () => dismiss(), secondary: true },
      ]);
      _markNudgeSent();
      return;
    }
  }

  // ─── THREAD-AWARE GREETING ────────────────────────────────────────────────────
  // Called from initChat() to inject an open-thread reference into the first message.
  // Returns the thread text if one exists and is fresh enough, otherwise null.

  function getOpenThreadForGreeting() {
    const raw = _get(KEYS.pendingThread);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      const age  = _hoursSince(data.detectedAt);
      // Only use threads between 2 and 72 hours old
      if (age >= 2 && age <= 72) return data.text;
    } catch {}
    return null;
  }

  // ─── LIFECYCLE ────────────────────────────────────────────────────────────────

  function markAppOpen() {
    _set(KEYS.lastOpen, new Date().toISOString());
    _sessionCount++;
  }

  function markChatMessage() {
    _set(KEYS.lastChatMsg, new Date().toISOString());
  }

  // Called after writeChatToMemory — trigger thread detection async
  function onMemoryWritten() {
    detectOpenThreads().catch(() => {});
  }

  function dismiss() {
    _hideBanner();
  }

  function snooze(hours) {
    const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    _set(KEYS.snoozeUntil, until);
    _hideBanner();
    if(typeof showToast === 'function') showToast(`snoozed for ${hours}h`);
  }

  // ─── INIT ─────────────────────────────────────────────────────────────────────
  // Call once on app load. Evaluates nudge state and requests permission if appropriate.

  async function init() {
    if (_initDone) return;
    _initDone = true;

    markAppOpen();

    // Detect open threads on load (async, non-blocking)
    detectOpenThreads().catch(() => {});

    // Evaluate whether to show a nudge — slight delay so home screen renders first
    setTimeout(async () => {
      await evaluate();

      // Ask for push permission after enough sessions, if not yet asked
      const nudgeCount = parseInt(_get(KEYS.nudgeCount, '0'));
      const notAsked   = !_get(KEYS.lastAsked) && Notification.permission === 'default';
      if (notAsked && !_isDismissed() && _sessionCount >= CFG.askPermissionAfterSessions && nudgeCount === 0) {
        // Only ask if we didn't already show a different nudge banner this session
        if (!_bannerShown) {
          setTimeout(() => requestPermission(), 3000);
        }
      }
    }, 1800); // 1.8s — home screen fully rendered
  }

  // ─── PUBLIC API ───────────────────────────────────────────────────────────────
  return {
    init,
    markChatMessage,
    onMemoryWritten,
    getOpenThreadForGreeting,
    requestPermission,
    snooze,
    dismiss,
    evaluate,  // callable manually for testing
  };

})();
