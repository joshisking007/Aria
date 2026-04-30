// ── STATS ──────────────────────────────────────────────────────────

function updateStats() {
  document.getElementById('statReplies').textContent = replySentCount;
  document.getElementById('statContacts').textContent = contacts.length;
  document.getElementById('statStreak').textContent = '🔥' + streakDays;
  document.getElementById('profileStreakNum').textContent = streakDays + ' days';
  document.getElementById('historyCount').textContent = replyHistory.length;

  // Streak badge
  const badge = document.getElementById('streakBadge');
  if (streakDays === 0) badge.textContent = 'just started';
  else if (streakDays < 3) badge.textContent = 'rising 🌱';
  else if (streakDays < 7) badge.textContent = 'on fire 🔥';
  else if (streakDays < 14) badge.textContent = 'unstoppable ⚡';
  else badge.textContent = 'legendary 👑';
}

// ── SCREEN NAV ──────────────────────────────────────────────────────

const screensWithNav = ['introScreen','historyScreen','moodScreen','profileScreen','glowupScreen','redflagScreen','vibeScreen','queueScreen','contactProfileScreen','onboardScreen','presendScreen','memoryScreen','longGameScreen','lgDetailScreen','lgArcPreviewScreen'];

function showScreen(id) {
  ariaVoice.stop();
  // Reset thread mode when leaving reply screen
  if (id !== 'replyScreen' && threadModeActive) {
    threadModeActive = false;
    const btn = document.getElementById('threadModeToggle');
    const banner = document.getElementById('threadModeBanner');
    if (btn) btn.classList.remove('active');
    if (banner) banner.classList.remove('visible');
  }
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.style.display = '';
  });
  const el = document.getElementById(id);
  el.classList.add('active');
  el.style.display = 'flex';
  activeScreen = id;

  // Show hamburger on nav screens, hide on sub-screens
  const hamburger = document.getElementById('hamburgerBtn');
  const showHamburger = screensWithNav.includes(id);
  hamburger.classList.toggle('visible', showHamburger);

  // Update active menu item
  if (id === 'introScreen') setNavActive('navHome');
  else if (id === 'historyScreen') { setNavActive('navHistory'); renderHistory(); }
  else if (id === 'moodScreen') setNavActive('navMood');
  else if (id === 'profileScreen') { setNavActive('navProfile'); ariaVoice.renderList(); }
  else if (id === 'vibeScreen') { renderVibeContactGrid(); }
  else if (id === 'queueScreen') { renderQueue(); }
  else if (id === 'chatScreen') { setNavActive('navChat'); initChat(); }
  else if (id === 'memoryScreen') { setNavActive('navMemory'); renderMemoryScreen(); }
  else if (id === 'longGameScreen') { renderLongGameScreen(); }
  else if (id === 'lgArcPreviewScreen') { /* rendered by showArcPreview() */ }

  window.scrollTo(0, 0);
}

function navTo(screenId, btn) {
  showScreen(screenId);
}

function toggleMenu() {
  const btn = document.getElementById('hamburgerBtn');
  const drawer = document.getElementById('menuDrawer');
  const overlay = document.getElementById('menuOverlay');
  const open = drawer.classList.toggle('open');
  btn.classList.toggle('open', open);
  overlay.classList.toggle('open', open);
}

function closeMenu() {
  document.getElementById('hamburgerBtn').classList.remove('open');
  document.getElementById('menuDrawer').classList.remove('open');
  document.getElementById('menuOverlay').classList.remove('open');
}

function menuNavTo(screenId, navId) {
  closeMenu();
  setTimeout(() => showScreen(screenId), 180);
  setNavActive(navId);
}

function setNavActive(id) {
  document.querySelectorAll('.menu-item').forEach(b => b.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

// ── MOOD ────────────────────────────────────────────────────────────

function setMood(mood, label, el) {
  currentMood = mood;
  applyMoodGlow(mood);
  document.querySelectorAll('.mood-pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  saveProfile();
  showToast('vibe set to ' + label);
}

function setMoodFull(mood, emoji, el) {
  currentMood = mood;
  document.querySelectorAll('.mood-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  saveProfile();
  setTimeout(() => showScreen('introScreen'), 400);
  showToast('vibe: ' + emoji + ' ' + mood);
}

// ── CONTACTS ───────────────────────────────────────────────────────

function goToContacts(mode) {
  currentMode = mode;
  showScreen('contactScreen');

  const comment = document.getElementById('ariaComment');
  const commentText = document.getElementById('ariaCommentText');
  const label = document.getElementById('contactSectionLabel');
  const status = document.getElementById('contactScreenStatus');

  let list = contacts;

  if (mode === 'check') {
    label.textContent = 'NEEDS A REPLY';
    status.textContent = '● flagging who\'s waiting';
    comment.style.display = 'block';
    const waiting = contacts.filter(c => c.silent && c.silentHours > 0);
    const longest = waiting.sort((a,b) => b.silentHours - a.silentHours)[0];
    const commentStr = longest
      ? `${longest.name} has been waiting ${longest.silentHours} hours. they probably noticed.`
      : "you're caught up. for now.";
    commentText.innerHTML = longest
      ? `<b style="color:var(--rose)">${longest.name}</b> has been waiting ${longest.silentHours}h. probably noticed.`
      : "you're caught up. for now.";
    list = contacts.filter(c => c.silent);
    ariaVoice.speak(commentStr);
  } else if (mode === 'start') {
    label.textContent = 'START A CONVO WITH';
    status.textContent = '● ready';
    comment.style.display = 'block';
    commentText.textContent = "pick someone. i'll say something that sounds like you just thought of them.";
    list = contacts;
    ariaVoice.speak("pick someone. i'll say something that sounds like you just thought of them.");
  } else {
    label.textContent = 'WHO MESSAGED YOU?';
    status.textContent = '● listening';
    comment.style.display = 'none';
    list = contacts;
  }

  renderContacts(list);
}

function filterContacts(query) {
  const q = query.toLowerCase().trim();
  const list = q ? contacts.filter(c =>
    c.name.toLowerCase().includes(q) ||
    (c.relationship || '').toLowerCase().includes(q) ||
    (c.platform || '').toLowerCase().includes(q)
  ) : contacts;
  renderContacts(list);
}

function renderContacts(list) {
  const container = document.getElementById('contactList');
  if (!list.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-text">no contacts found</div></div>`;
    return;
  }
  container.innerHTML = list.map((c, i) => {
    let statusClass = c.online ? 'online' : c.silent ? 'needs-reply' : '';

    // Drift indicator
    const drift = c._drift;
    let driftCardClass = '';
    let driftBadgeHtml = '';
    if (drift && !c.drift_dismissed) {
      if (drift.level === 'lost') {
        driftCardClass = 'drifting-lost';
        driftBadgeHtml = `<div class="drift-badge lost" onclick="openDriftSnooze(${c.id},event)">gone quiet</div>`;
      } else if (drift.level === 'fading') {
        driftCardClass = 'drifting-fading';
        driftBadgeHtml = `<div class="drift-badge fading" onclick="openDriftSnooze(${c.id},event)">fading</div>`;
      } else if (drift.level === 'cold') {
        driftCardClass = 'drifting-cold';
        driftBadgeHtml = `<div class="drift-badge cold" onclick="openDriftSnooze(${c.id},event)">gone cold</div>`;
      }
    }

    const badgeHtml = driftBadgeHtml ||
      (c.silent && c.silentHours > 0
        ? `<div class="silent-badge">${c.silentHours}h silent</div>`
        : `<div class="platform-badge ${(c.platform||'').toLowerCase().replace(/\s/,'')}">${c.platform||''}</div>`);

    return `
      <div class="contact-card ${driftCardClass} stagger-${Math.min(i+1,5)}" onclick="selectContact(${c.id})" oncontextmenu="openContactProfile(${c.id});return false;" style="animation-delay:${i*0.05}s">
        <div class="contact-avatar ${statusClass}" data-color="${c.color||''}">${c.initials || c.name[0]}</div>
        <div class="contact-info">
          <div class="contact-name">${c.name}</div>
          <div class="contact-preview">${drift && !c.drift_dismissed ? drift.preview : (c.preview || (c.relationship ? '(' + c.relationship + ')' : 'no recent messages'))}</div>
        </div>
        <div class="contact-meta">
          <div class="contact-time">${c.time || ''}</div>
          ${badgeHtml}
        </div>
      </div>
    `;
  }).join('') + `
    <div class="add-contact-card" onclick="openModal('addContactModal')">
      <div class="contact-avatar" style="background:var(--card2);border:1.5px dashed var(--border);font-size:20px;color:var(--muted);">+</div>
      <div class="contact-info">
        <div class="contact-name" style="color:var(--muted);">add a contact</div>
        <div class="contact-preview">Aria learns their context for better replies</div>
      </div>
    </div>
  `;
}

async function addContact() {
  const name = document.getElementById('newName').value.trim();
  if (!name) { showToast('add a name first', 'error'); return; }

  const relationship = document.getElementById('newRelationship').value.trim();
  const platform     = document.getElementById('newPlatform').value;
  const preview      = document.getElementById('newPreview').value.trim();
  const silentHours  = parseInt(document.getElementById('newSilent').value) || 0;

  const colors     = ['blue','purple','green','rose','amber'];
  const color      = colors[Math.floor(Math.random() * colors.length)];
  const initials   = name[0].toUpperCase();
  const silent     = silentHours > 0;
  const time       = silentHours > 0 ? silentHours + 'h ago' : 'just now';

  if (currentUserId) {
    const { data, error } = await db.from('contacts').insert({
      user_id:      currentUserId,
      name,
      initials,
      color,
      relationship: relationship || 'contact',
      platform,
      preview:      preview || 'no recent messages',
      time,
      silent,
      silent_hours: silentHours,
      online:       false
    }).select().single();

    if (error) { showToast('could not save contact'); console.error(error); return; }
    contacts.push({ ...data, silentHours: data.silent_hours });
  } else {
    const newContact = {
      id: nextContactId++,
      name, initials, color,
      relationship: relationship || 'contact',
      platform,
      preview: preview || 'no recent messages',
      time, silent, silentHours,
      online: false
    };
    contacts.push(newContact);
    saveToLocalStorage();
  }

  updateStats();
  closeModal('addContactModal');
  renderContacts(contacts);
  showToast('✓ ' + name + ' added', 'green');

  // Clear form
  ['newName','newRelationship','newPreview'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('newSilent').value = '0';
}

// ── SELECT CONTACT & REPLY SCREEN ─────────────────────────────────

function selectContact(id) {
  currentContact = contacts.find(c => c.id === id);
  if (!currentContact) return;

  showScreen('replyScreen');
  document.getElementById('replyTopName').textContent = currentContact.name;
  document.getElementById('replyTopStatus').textContent = '● replying to ' + currentContact.name.toLowerCase();

  // Set platform from contact
  const plat = (currentContact.platform || 'Instagram');
  setPlatformByName(plat);

  // Reset state
  document.getElementById('ariaThinking').style.display = 'none';
  document.getElementById('replySection').style.display = 'none';
  document.getElementById('ariaReaction').style.display = 'none';
  document.getElementById('pasteArea').style.display = 'block';
  document.getElementById('theirMsgInput').value = '';
  document.getElementById('genReplyBtn').disabled = false;
  document.getElementById('genReplyBtn').textContent = 'ask aria to reply →';
  document.getElementById('floatCopy').classList.remove('visible');
  currentReplies = [];
  // Reset context panel
  const ctxBody = document.getElementById('contextBody');
  const ctxToggle = document.getElementById('contextToggle');
  if (ctxBody) { ctxBody.classList.remove('open'); ctxToggle.classList.remove('open'); }
  const ctxPaste = document.getElementById('contextPasteInput');
  if (ctxPaste) ctxPaste.value = '';
  document.getElementById('contextBadge').style.display = 'none';
  clearScreenshot();

  // Populate convo area
  const convoArea = document.getElementById('convoArea');

  // ── Render contact memory narrative card ──────────────────────────
  const contactMem = contactMemory.get(currentContact.id);
  let memCard = '';
  if (contactMem && contactMem.narrative) {
    memCard = `
      <div class="contact-memory-card" id="contactMemCard" onclick="this.classList.toggle('expanded')">
        <div class="contact-memory-header">
          <span class="contact-memory-label">🧠 ARIA REMEMBERS</span>
          <span class="contact-memory-toggle">▾</span>
        </div>
        <div class="contact-memory-body">${contactMem.narrative}</div>
        ${contactMem.events && contactMem.events.length ? `<div class="contact-memory-events">${contactMem.events.slice(-2).map(e=>`<div class="contact-memory-event">${e}</div>`).join('')}</div>` : ''}
      </div>`;
  }

  if (currentContact.preview && currentContact.preview !== 'no recent messages') {
    convoArea.innerHTML = memCard + `
      <div class="convo-label">LAST FROM ${currentContact.name.toUpperCase()}</div>
      <div class="convo-thread">
        <div class="thread-msg them">${currentContact.preview}</div>
        <div class="thread-timestamp">${currentContact.time}</div>
      </div>
    `;
  } else {
    convoArea.innerHTML = memCard + `<div class="convo-label">PASTE THEIR MESSAGE BELOW</div>`;
  }
}

// ── PLATFORM ───────────────────────────────────────────────────────

function setPlatform(el) {
  document.querySelectorAll('.platform-pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  currentPlatform = el.dataset.platform;
}

function setPlatformByName(name) {
  const btn = document.querySelector(`.platform-pill[data-platform="${name}"]`);
  if (btn) {
    document.querySelectorAll('.platform-pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    currentPlatform = name;
  }
}

// ── TONE ────────────────────────────────────────────────────────────

function selectTone(el) {
  document.querySelectorAll('#toneModalPills .tone-pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  currentTone = el.dataset.tone;
}

function updateAltPref() {
  showAlternatives = document.getElementById('altToggle').classList.contains('on');
}

// ── BUILD SYSTEM PROMPT ─────────────────────────────────────────────

function buildSystemPrompt() {
  let system = BASE_VOICE;

  // Relationship stage context
  const stage = getRelationshipStage();
  const stageNote = {
    stranger:     'You barely know this user yet. Mirror their style carefully — you\'re still learning them.',
    acquaintance: 'You\'re getting a feel for this user. Starting to pick up their patterns.',
    friend:       'You know this user\'s style well now. Write with confidence.',
    close:        'You know this user. Write like you\'ve been doing this together for a while.'
  }[stage];
  system += `\\n\\nRELATIONSHIP CONTEXT: ${stageNote}`;

  // Inject user's slang
  if (slangWords.length) {
    system += `\\n\\nUSER'S VOCABULARY TO MIRROR: ${slangWords.join(', ')}`;
  }

  // Settings
  if (settings.caps) system += '\\n- User sometimes capitalises normally.';
  if (!settings.punct) system += '\\n- User rarely uses periods.';
  if (!settings.emoji) system += '\\n- User rarely uses emojis.';

  // Mood modifier
  if (MOOD_MODIFIERS[currentMood]) system += '\\n' + MOOD_MODIFIERS[currentMood];

  // Tone modifier
  if (currentTone !== 'natural' && TONE_MODIFIERS[currentTone]) {
    system += '\\n\\nTONE FOR THIS REPLY: ' + TONE_MODIFIERS[currentTone];
  }

  // Platform context
  system += `\\n\\nPLATFORM: ${currentPlatform}. Match the norms of that platform.`;

  // Contact relationship
  if (currentContact?.relationship) {
    system += `\\n\\nWHO THEY'RE TEXTING: ${currentContact.name} — ${currentContact.relationship} of the user.`;
  }

  // Silent hours note
  if (currentContact?.silentHours > 3) {
    system += `\\n\\nNOTE: The user has been leaving ${currentContact.name} on read for ${currentContact.silentHours} hours. Factor this in — the reply might need to acknowledge the delay naturally.`;
  }

  // ── Inject Aria's memory of the user ────────────────────────────
  const memCtx = ariaMemory.buildContext();
  if (memCtx) system += memCtx;

  // ── Inject contact-specific relationship memory ──────────────────
  if (currentContact?.id) {
    const contactCtx = contactMemory.buildContext(currentContact.id);
    if (contactCtx) system += contactCtx;
  }

  return system;
}

// ── CONTEXT PANEL ──────────────────────────────────────────────────

let screenshotBase64 = null;
let activeContextTab = 'paste';

function toggleContextPanel() {
  const toggle = document.getElementById('contextToggle');
  const body = document.getElementById('contextBody');
  toggle.classList.toggle('open');
  body.classList.toggle('open');
}

function switchContextTab(tab, el) {
  activeContextTab = tab;
  document.querySelectorAll('.context-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.context-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(tab === 'paste' ? 'ctxPanelPaste' : 'ctxPanelScreenshot').classList.add('active');
}

function handleScreenshotUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    screenshotBase64 = e.target.result.split(',')[1];
    const preview = document.getElementById('screenshotPreview');
    preview.src = e.target.result;
    preview.style.display = 'block';
    document.getElementById('screenshotClearBtn').style.display = 'block';
    document.getElementById('contextBadge').style.display = 'inline';
    showToast('screenshot loaded ✓', 'green');
  };
  reader.readAsDataURL(file);
}

function clearScreenshot() {
  screenshotBase64 = null;
  document.getElementById('screenshotPreview').style.display = 'none';
  document.getElementById('screenshotPreview').src = '';
  document.getElementById('screenshotClearBtn').style.display = 'none';
  const badge = document.getElementById('contextBadge');
  const pasteCtx = document.getElementById('contextPasteInput').value.trim();
  if (!pasteCtx) badge.style.display = 'none';
}

function getContextString() {
  const pasteCtx = document.getElementById('contextPasteInput')?.value.trim() || '';
  if (pasteCtx) {
    document.getElementById('contextBadge').style.display = 'inline';
    return `\\n\\nPREVIOUS CONVERSATION CONTEXT:\\n${pasteCtx}`;
  }
  return '';
}

// ── GENERATE REPLY ──────────────────────────────────────────────────

async function generateReply() {
  const input = document.getElementById('theirMsgInput').value.trim();
  const lastMsg = currentContact?.preview;
  const msg = input || (lastMsg && lastMsg !== 'no recent messages' ? lastMsg : '');

  if (!msg && currentMode !== 'start') {
    showToast('paste their message first');
    document.getElementById('theirMsgInput').focus();
    return;
  }

  const btn = document.getElementById('genReplyBtn');
  btn.disabled = true;
  btn.textContent = 'aria is writing...';
  document.getElementById('replySection').style.display = 'none';
  document.getElementById('ariaReaction').style.display = 'none';
  document.getElementById('ariaThinking').style.display = 'flex';
  document.getElementById('replyAriaOrb').classList.add('thinking');
  document.getElementById('floatCopy').classList.remove('visible');

  // Animated thinking status messages
  const statusMsgs = ['reading the vibe', 'channelling your energy', 'finding the right words', 'almost there'];
  let statusIdx = 0;
  const statusEl = document.getElementById('thinkingStatus');
  const statusInterval = setInterval(() => {
    statusEl.textContent = '— ' + statusMsgs[statusIdx++ % statusMsgs.length];
  }, 900);

  const contextStr = getContextString();

  // Include clarify context if set
  const clarifyExtra = clarifyContext ? '\\n\\nADDITIONAL CONTEXT FROM USER:\\n' + clarifyContext : '';
  clarifyContext = ''; // reset after use

  const modeContext = currentMode === 'start'
    ? `Open a casual conversation with ${currentContact?.name} — don't reply to anything, just start a convo naturally, like you just randomly thought of them.${contextStr}${clarifyExtra}`
    : threadModeActive
      ? `You are reading a FULL CONVERSATION THREAD between the user and ${currentContact?.name} (${currentContact?.relationship || 'contact'}).${contextStr}${clarifyExtra}

FULL THREAD:
${msg}

Read the entire arc. Notice the tone shift, what's been building, what the other person almost said but didn't. Then write the user's NEXT reply — informed by the full thread, not just the last message. Write in the user's voice.`
      : `${currentContact?.name} (${currentContact?.relationship || 'contact'}) sent: "${msg}"${contextStr}${clarifyExtra}${getThreadContext()}\\n\\nWrite a reply in the user's voice.`;

  const systemPrompt = buildSystemPrompt();

  // Reaction prompt — Aria's personality-first comment
  const screenshotNote = screenshotBase64
    ? '\\n\\nIMPORTANT: A screenshot of the conversation has been included. RIGHT-side bubbles = sent by the USER. LEFT-side bubbles = sent by the other person. Read carefully before reacting.'
    : '';

  const reactionPrompt = buildAriaReactionPrompt(currentContact, msg, contextStr + screenshotNote, currentMode);

  try {
    const imgPayload = screenshotBase64 || null;

    const tasks = [
      fetchReply(systemPrompt, modeContext + '\\n\\nSplit into 2-3 short lines. One per line. Output only the messages.', imgPayload),
      fetchReply('You are Aria — a teenage girl AI assistant with real personality. Respond as yourself, not as the user.', reactionPrompt, imgPayload)
    ];

    if (showAlternatives) {
      const altPrompt = modeContext + `\\n\\nGenerate 3 different alternative replies with different tones (funny, warm, brief). Format as JSON: {"alternatives":[{"tone":"funny","text":"msg1\\nmsg2"},{"tone":"warm","text":"msg"},{"tone":"brief","text":"msg"}]}`;
      tasks.push(fetchReplyJSON(systemPrompt, altPrompt));
    }

    const [mainText, reactionText, altData] = await Promise.all(tasks);

    currentReplies = mainText.split('\\n').map(l => l.trim()).filter(Boolean);

    // Show Aria's reaction FIRST
    showAriaReaction(reactionText?.trim() || '');

    renderReplies(currentReplies);

    if (showAlternatives && altData?.alternatives) {
      renderAlternatives(altData.alternatives);
    }

    // Update stats
    replySentCount++;
    gainRelationshipXP(1);
    updateStats();

    // ── Auto-learn from this interaction ──────────────────────────
    ariaMemory.learnFromGeneration({
      tone: currentTone,
      mood: currentMood,
      platform: currentPlatform,
      contact: currentContact,
      msg: input,
      regen: false
    });
    ariaMemory.learnWritingStyle();

    // ── Record in per-contact relationship memory ──────────────────
    if (currentContact?.id && msg) {
      contactMemory.recordInteraction(
        currentContact.id,
        currentContact.name,
        currentContact.relationship,
        msg,
        currentReplies.join(' '),
        contextStr
      );
      // Track silent hours as "left on read" signal
      if (currentContact.silentHours >= 2) {
        contactMemory.recordSilent(currentContact.id, currentContact.silentHours);
      }
    }

    // Fire-and-forget: log generation event
    if (currentUserId) {
      db.from('generation_events').insert({
        user_id:    currentUserId,
        event_type: 'generate_reply',
        platform:   currentPlatform,
        tone:       currentTone,
        mood:       currentMood,
        contact_id: currentContact?.id || null
      }).then(() => {}).catch(() => {});
    }

    // Save profile (XP, replySentCount) then refresh from DB (trigger may update streak)
    await saveProfile();
    await refreshStats();

  } catch(e) {
    currentReplies = ['something went wrong', 'try again?'];
    renderReplies(currentReplies);
    console.error(e);
  }

  clearInterval(statusInterval);
  statusEl.textContent = '';
  document.getElementById('ariaThinking').style.display = 'none';
  document.getElementById('replyAriaOrb').classList.remove('thinking');
  btn.disabled = false;
  btn.textContent = 'ask aria to reply →';
}

function showAriaReaction(text) {
  if (!text) return;
  const el = document.getElementById('ariaReaction');
  const textEl = document.getElementById('ariaReactionText');
  textEl.textContent = text;
  el.style.display = 'block';
  // Speak the reaction
  ariaVoice.speak(text);
}

async function fetchReply(system, userMsg, imageB64 = null) {
  // Build message content — include screenshot if provided
  let content;
  if (imageB64) {
    content = [
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: imageB64 }
      },
      { type: 'text', text: userMsg }
    ];
  } else {
    content = userMsg;
  }

  const res = await fetch('https://mmtdtcmhvbruubrjgjrz.supabase.co/functions/v1/aria-ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tdGR0Y21odmJydXVicmpnanJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTU2MDUsImV4cCI6MjA5MjY5MTYwNX0.f2FXAA8GaUeXXE8V8dnwq4NXz3_22H7d5jVA9rAWsTo'
    },
    body: JSON.stringify({ system, userMsg: content })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'request failed');
  return data.text || '';
}

async function fetchReplyJSON(system, userMsg) {
  try {
    const text = await fetchReply(system + '\\n\\nYou must respond ONLY with valid JSON. No markdown, no explanation.', userMsg);
    const clean = text.replace(/```json|```/g,'').trim();
    return JSON.parse(clean);
  } catch(e) { return null; }
}

// ── RENDER REPLIES ──────────────────────────────────────────────────

function renderReplies(lines) {
  const container = document.getElementById('replyBubbles');
  container.innerHTML = lines.map((line, i) => {
    let cls = lines.length === 1 ? 'only' : i === 0 ? 'first' : i === lines.length-1 ? 'last' : 'middle';
    return `<div class="reply-bubble ${cls} editable" contenteditable="true" style="animation-delay:${i*0.08}s" data-idx="${i}">${line}</div>`;
  }).join('');

  // Edit hint
  const editHint = document.getElementById('editHint');
  editHint.style.display = 'block';

  // Sync edits back to currentReplies
  container.querySelectorAll('.reply-bubble').forEach((bubble, i) => {
    bubble.addEventListener('input', () => {
      currentReplies[i] = bubble.textContent.trim();
    });
  });

  // Vibes score (simulated)
  const score = 70 + Math.floor(Math.random() * 28);
  animateVibesBar(score);

  document.getElementById('replySection').style.display = 'block';
  document.getElementById('mainCopyBtn').textContent = 'copy & send →';
  document.getElementById('mainCopyBtn').classList.remove('copied');
  document.getElementById('floatCopy').classList.add('visible');

  // Smooth scroll into view — scroll to reaction bubble
  setTimeout(() => {
    const reaction = document.getElementById('ariaReaction');
    if (reaction && reaction.style.display !== 'none') {
      reaction.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      document.getElementById('replySection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 200);
}

function renderAlternatives(alts) {
  if (!alts || !alts.length) return;
  const container = document.getElementById('altBubbles');
  const section = document.getElementById('altSection');

  container.innerHTML = alts.map((alt, i) => {
    const lines = alt.text.split('\\n').filter(Boolean);
    return `
      <div class="alt-bubble" style="animation-delay:${i*0.1}s" onclick="useAlternative(${i})">
        <div class="alt-bubble-tone">${alt.tone}</div>
        ${lines.map(l => `<div>${l}</div>`).join('<br>')}
      </div>
    `;
  }).join('');
  section.style.display = 'block';
  window._altReplies = alts;
}

function useAlternative(idx) {
  const alt = window._altReplies?.[idx];
  if (!alt) return;
  currentReplies = alt.text.split('\\n').map(l => l.trim()).filter(Boolean);
  renderReplies(currentReplies);
  showToast('switched to ' + alt.tone + ' version');
}

function animateVibesBar(score) {
  const bar = document.getElementById('vibesBar');
  const num = document.getElementById('vibesNum');
  bar.style.width = '0%';
  num.textContent = '—';
  setTimeout(() => {
    bar.style.width = score + '%';
    let current = 0;
    const interval = setInterval(() => {
      current = Math.min(current + 3, score);
      num.textContent = current + '%';
      if (current >= score) clearInterval(interval);
    }, 20);
  }, 400);
}

// ── COPY ───────────────────────────────────────────────────────────

function copyReply() {
  if (!currentReplies.length) return;
  const text = currentReplies.join('\\n');
  scheduleFollowup(currentContact?.name || 'them');
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('mainCopyBtn');
    btn.textContent = '✓ copied';
    btn.classList.add('copied');
    showToast('copied! go paste it 🚀', 'green');
    setTimeout(() => {
      btn.textContent = 'copy & send →';
      btn.classList.remove('copied');
    }, 3000);
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('copied!', 'green');
  });
}

// ── MODIFY REPLY ───────────────────────────────────────────────────

async function makeFormalerOrCasual(direction) {
  if (!currentReplies.length) return;
  showToast('adjusting...');
  const msg = currentReplies.join('\\n');
  const prompt = direction === 'formal'
    ? `Make this reply slightly more put-together while keeping it in the user's voice. Not stiff, just a bit more composed.\\n\\nOriginal:\\n${msg}\\n\\nOne line per message. Output only the messages.`
    : `Make this reply more casual and raw. More abbreviations, more natural, less polished.\\n\\nOriginal:\\n${msg}\\n\\nOne line per message. Output only the messages.`;

  try {
    const text = await fetchReply(buildSystemPrompt(), prompt);
    currentReplies = text.split('\\n').map(l => l.trim()).filter(Boolean);
    renderReplies(currentReplies);
  } catch(e) { showToast('something went wrong'); }
}

async function makeShorterOrLonger(direction) {
  if (!currentReplies.length) return;
  showToast('rewriting...');
  const msg = currentReplies.join('\\n');
  const prompt = direction === 'shorter'
    ? `Make this much shorter. Could even be one punchy message.\\n\\nOriginal:\\n${msg}\\n\\nOutput only the final messages, one per line.`
    : `Expand on this. Add a bit more personality and maybe a question to keep the convo going.\\n\\nOriginal:\\n${msg}\\n\\nOutput only the messages, one per line.`;

  try {
    const text = await fetchReply(buildSystemPrompt(), prompt);
    currentReplies = text.split('\\n').map(l => l.trim()).filter(Boolean);
    renderReplies(currentReplies);
  } catch(e) { showToast('something went wrong'); }
}

// ── HISTORY ────────────────────────────────────────────────────────

async function saveToHistory() {
  if (!currentReplies.length) return;

  if (currentUserId) {
    const originalMsg = document.getElementById('theirMsgInput').value.trim() || currentContact?.preview || '';
    const { error } = await db.from('reply_history').insert({
      user_id:         currentUserId,
      contact_id:      currentContact?.id || null,
      contact_name:    currentContact?.name || 'Unknown',
      contact_initial: currentContact?.initials || '?',
      contact_color:   currentContact?.color || '',
      platform:        currentPlatform,
      tone:            currentTone,
      mood:            currentMood,
      original_msg:    originalMsg,
      message_length:  originalMsg.length,
      generated_reply: currentReplies.join('\n'),
      alternatives:    window._altReplies || null
    });
    if (error) { showToast('could not save to history'); console.error(error); return; }
    // DB trigger handles streak / replySentCount — just refresh
    await refreshStats();
  } else {
    // Local fallback
    const entry = {
      id: Date.now(),
      contact:        currentContact?.name || 'Unknown',
      contactInitial: currentContact?.initials || '?',
      contactColor:   currentContact?.color || '',
      platform:       currentPlatform,
      tone:           currentTone,
      original:       document.getElementById('theirMsgInput').value.trim() || currentContact?.preview || '',
      reply:          currentReplies.join('\\n'),
      time:           new Date().toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit', hour12:true })
    };
    replyHistory.unshift(entry);
    if (replyHistory.length > 50) replyHistory = replyHistory.slice(0, 50);
    saveToLocalStorage();
    updateStats();
  }

  showToast('saved to history ✓', 'green');
}

function renderHistory() {
  const container = document.getElementById('historyList');
  document.getElementById('historyCount').textContent = replyHistory.length;

  if (!replyHistory.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-text">no replies saved yet<br>tap "save to history" after Aria drafts one</div>
      </div>`;
    return;
  }

  container.innerHTML = replyHistory.map((entry, i) => `
    <div class="history-card stagger-${Math.min(i+1,5)}" style="animation-delay:${i*0.05}s" onclick="openHistoryDetail(${entry.id})">
      <div class="history-card-header">
        <div class="contact-avatar" data-color="${entry.contactColor}" style="width:32px;height:32px;font-size:13px;flex-shrink:0;">${entry.contactInitial}</div>
        <span class="history-card-name">${entry.contact}</span>
        <span class="history-card-time">${entry.time}</span>
      </div>
      ${entry.original ? `<div class="history-original">them: ${entry.original.slice(0,80)}${entry.original.length>80?'…':''}</div>` : ''}
      <div class="history-reply">${entry.reply.slice(0,120)}${entry.reply.length>120?'…':''}</div>
      <div class="history-meta">
        <span class="history-tone-tag">${entry.tone}</span>
        <span class="platform-badge ${(entry.platform||'').toLowerCase().replace(/\\s/,'')}" style="font-size:10px;">${entry.platform}</span>
      </div>
    </div>
  `).join('');
}

function openHistoryDetail(id) {
  const entry = replyHistory.find(e => e.id === id);
  if (!entry) return;
  currentHistoryDetail = entry;

  document.getElementById('histDetailTitle').textContent = 'Reply to ' + entry.contact;
  document.getElementById('histDetailSub').textContent = entry.time + ' · ' + entry.platform;
  document.getElementById('histDetailBody').innerHTML = `
    ${entry.original ? `<div style="background:var(--card2);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:16px;font-size:13px;color:var(--muted);line-height:1.6;">
      <div style="font-size:10px;color:var(--muted);letter-spacing:1.5px;margin-bottom:6px;">THEY SAID</div>
      ${entry.original}
    </div>` : ''}
    <div style="margin-bottom:8px;">
      ${entry.reply.split('\\n').map((line, i) => `
        <div style="background:var(--rose-dim);border:1px solid var(--rose-border);border-radius:${i===0?'4px 18px 18px 18px':'4px 18px 4px 18px'};padding:12px 14px;font-size:14px;color:#fce7f3;line-height:1.6;margin-bottom:8px;">${line}</div>
      `).join('')}
    </div>
  `;
  openModal('historyDetailModal');
}

function copyHistoryDetail() {
  if (!currentHistoryDetail) return;
  navigator.clipboard.writeText(currentHistoryDetail.reply);
  showToast('copied ✓', 'green');
  closeModal('historyDetailModal');
}

async function clearHistory() {
  if (!replyHistory.length) return;
  if (currentUserId) {
    await db.from('reply_history').delete().eq('user_id', currentUserId);
  }
  replyHistory = [];
  saveToStorage(); // also clears local fallback if not authed
  renderHistory();
  updateStats();
  showToast('history cleared');
}

// ── PROFILE/VOICE SETTINGS ─────────────────────────────────────────

function toggleSetting(key, toggle) {
  toggle.classList.toggle('on');
  settings[key] = toggle.classList.contains('on');
  saveProfile();
}

function addSlang(e) {
  if (e.key !== 'Enter') return;
  const input = document.getElementById('slangInput');
  const word = input.value.trim();
  if (!word || slangWords.includes(word)) { input.value = ''; return; }
  slangWords.push(word);
  input.value = '';
  renderSlangPills();
  saveProfile();
  showToast('added "' + word + '"', 'green');
}

function renderSlangPills() {
  const wrap = document.getElementById('traitPills');
  wrap.innerHTML = slangWords.map(w =>
    `<span class="trait-pill" onclick="removeSlang('${w}')" title="tap to remove">${w}</span>`
  ).join('') + `<span class="trait-pill muted" onclick="document.getElementById('slangInput').focus()">+ add your own</span>`;
}

function removeSlang(word) {
  slangWords = slangWords.filter(w => w !== word);
  renderSlangPills();
  saveProfile();
}

function updateEnergyLabel(val) {
  energyLevel = parseInt(val);
  const label = document.getElementById('energyLabel');
  if (val < 30) label.textContent = 'very much your voice (' + val + '%)';
  else if (val < 60) label.textContent = 'leaning toward your voice (' + val + '%)';
  else if (val < 80) label.textContent = 'balancing both (' + val + '%)';
  else label.textContent = 'mirroring their energy (' + val + '%)';
  saveProfile();
}

function setDefaultTone(tone, el) {
  defaultTone = tone;
  document.querySelectorAll('.tone-pills .tone-pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  saveProfile();
}

function resetProfile() {
  slangWords = ['bro','u / r u','hnstly','idk','ngl','lmk','💀','🙏'];
  settings = { caps: false, punct: true, emoji: true };
  energyLevel = 40;
  defaultTone = 'real';
  renderSlangPills();
  document.getElementById('energySlider').value = 40;
  updateEnergyLabel(40);
  saveProfile();
  showToast('voice profile reset');
}

// ── MODALS ──────────────────────────────────────────────────────────

function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}

function handleModalBgClick(e, id) {
  if (e.target === document.getElementById(id)) closeModal(id);
}

// ── TOAST ───────────────────────────────────────────────────────────

let toastTimeout;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast';
  if (type === 'green') t.classList.add('toast-green');
  if (type === 'blue') t.classList.add('toast-blue');
  t.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.classList.remove('show'), 2800);
}

// ── SWIPE BACK GESTURE ───────────────────────────────────────────────

let touchStartX = 0;
document.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
document.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (dx > 80 && touchStartX < 30) {
    if (activeScreen === 'replyScreen') showScreen('contactScreen');
    else if (activeScreen === 'contactScreen') showScreen('introScreen');
    else if (['historyScreen','moodScreen','profileScreen'].includes(activeScreen)) showScreen('introScreen');
  }
}, { passive: true });

// ── KEYBOARD SHORTCUT ───────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    if (activeScreen === 'replyScreen') generateReply();
  }
});

window.addEventListener('load', () => {
  // Note: initAuth() handles data loading (called in the first load listener above)

  // Restore ElevenLabs settings
  const savedKey  = localStorage.getItem('aria_el_key') || '';
  const savedStab = parseFloat(localStorage.getItem('aria_el_stability')  || '0.45');
  const savedSim  = parseFloat(localStorage.getItem('aria_el_similarity') || '0.75');
  const keyEl  = document.getElementById('elApiKey');
  const stabEl = document.getElementById('elStability');
  const simEl  = document.getElementById('elSimilarity');
  if (keyEl)  keyEl.value = savedKey;
  if (stabEl) { stabEl.value = savedStab; document.getElementById('elStabilityVal').textContent = savedStab.toFixed(2); }
  if (simEl)  { simEl.value = savedSim;   document.getElementById('elSimilarityVal').textContent = savedSim.toFixed(2); }

  // Initial voice list render
  ariaVoice.renderList('en');

  // Sync muted state
  if (ariaVoice.muted) ariaVoice.setMuted(true);

  document.getElementById('hamburgerBtn').classList.add('visible');
});

// ── CLARIFY ─────────────────────────────────────────────────────────

function openClarifyModal() {
  document.getElementById('clarifyQ1').value = '';
  document.getElementById('clarifyQ2').value = '';
  document.getElementById('clarifyQ3').value = '';
  openModal('clarifyModal');
}

function applyClarify() {
  const q1 = document.getElementById('clarifyQ1').value.trim();
  const q2 = document.getElementById('clarifyQ2').value.trim();
  const q3 = document.getElementById('clarifyQ3').value.trim();
  const parts = [];
  if (q1) parts.push('Current vibe between them: ' + q1);
  if (q2) parts.push('What user wants from this reply: ' + q2);
  if (q3) parts.push('What to avoid: ' + q3);
  clarifyContext = parts.join('\\n');
  closeModal('clarifyModal');
  if (clarifyContext) showToast('context saved ✓', 'green');
  generateReply();
}

// ── GLOW-UP ─────────────────────────────────────────────────────────

let glowupCurrentText = '';

async function runGlowup() {
  const draft = document.getElementById('glowupInput').value.trim();
  const goal = document.getElementById('glowupGoal').value.trim();
  if (!draft) { showToast('paste your draft first'); document.getElementById('glowupInput').focus(); return; }

  const btn = document.getElementById('glowupBtn');
  btn.disabled = true; btn.textContent = 'styling...';
  document.getElementById('glowupResult').style.display = 'none';
  document.getElementById('glowupReaction').style.display = 'none';
  document.getElementById('glowupVariants').style.display = 'none';
  document.getElementById('glowupCopyRow').style.display = 'none';
  document.getElementById('glowupThinking').style.display = 'flex';

  const reactionPrompt = `You are Aria. A user just showed you their rough draft text message: "${draft}". React to it with personality — be honest, a little sassy, maybe amused. Something like "ok... we have some work to do 😭" or "not bad actually, just needs a little edge". Keep it to 1-2 sentences. No labels.`;

  const rewritePrompt = `The user wrote this draft message: "${draft}"\\n${goal ? 'They want it to: ' + goal + '\\n' : ''}\\nRewrite it in their voice — more natural, more them, less try-hard. Output ONLY the final rewritten message. No explanation, no labels.`;

  const variantPrompt = `Draft: "${draft}"\\n${goal ? 'Goal: ' + goal + '\\n' : ''}\\nGive 3 different rewrites with different energies. JSON only: {"variants":[{"tone":"more chill","text":"..."},{"tone":"funnier","text":"..."},{"tone":"more direct","text":"..."}]}`;

  try {
    const [reaction, rewrite, varData] = await Promise.all([
      fetchReply('You are Aria, witty and alive. Be brief and punchy.', reactionPrompt),
      fetchReply(buildSystemPrompt(), rewritePrompt),
      fetchReplyJSON(buildSystemPrompt() + '\\nRespond ONLY in JSON.', variantPrompt)
    ]);

    // Show reaction
    const reactionEl = document.getElementById('glowupReaction');
    document.getElementById('glowupReactionText').textContent = reaction?.trim() || '';
    reactionEl.style.display = 'block';

    // Show result
    glowupCurrentText = rewrite?.trim() || draft;
    const resultEl = document.getElementById('glowupResult');
    document.getElementById('glowupResultText').textContent = glowupCurrentText;
    resultEl.style.display = 'block';
    document.getElementById('glowupCopyRow').style.display = 'flex';

    // Show variants
    if (varData?.variants?.length) {
      const varList = document.getElementById('glowupVarList');
      varList.innerHTML = varData.variants.map((v, i) => `
        <div class="glowup-var-card" onclick="selectGlowupVariant(${i})">
          <div class="glowup-var-tone">${v.tone}</div>
          <div class="glowup-var-text">${v.text}</div>
        </div>
      `).join('');
      document.getElementById('glowupVariants').style.display = 'block';
      window._glowupVariants = varData.variants;
    }

    ariaVoice.speak(reaction?.trim() || '');

    setTimeout(() => {
      reactionEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 200);

  } catch(e) { showToast('something went wrong'); }

  document.getElementById('glowupThinking').style.display = 'none';
  btn.disabled = false; btn.textContent = '✨ glow it up →';
}

function selectGlowupVariant(i) {
  const v = window._glowupVariants?.[i];
  if (!v) return;
  glowupCurrentText = v.text;
  document.getElementById('glowupResultText').textContent = v.text;
  showToast('switched to ' + v.tone);
}

function copyGlowup() {
  if (!glowupCurrentText) return;
  navigator.clipboard.writeText(glowupCurrentText).then(() => {
    const btn = document.getElementById('glowupCopyBtn');
    btn.textContent = '✓ copied';
    btn.classList.add('copied');
    showToast('copied! go paste it 🚀', 'green');
    setTimeout(() => { btn.textContent = 'copy it →'; btn.classList.remove('copied'); }, 3000);
  });
}

// ── RED FLAG DETECTOR ────────────────────────────────────────────────

async function runRedflag() {
  const msg = document.getElementById('redflagInput').value.trim();
  const who = document.getElementById('redflagWho').value.trim();
  if (!msg) { showToast('paste their message first'); document.getElementById('redflagInput').focus(); return; }

  const btn = document.getElementById('redflagBtn');
  btn.disabled = true; btn.textContent = 'reading them...';
  document.getElementById('redflagResult').style.display = 'none';
  document.getElementById('redflagThinking').style.display = 'flex';

  const prompt = `You are Aria, a sharp text analyst. Analyse this message${who ? ' from ' + who : ''} for any concerning patterns, red flags, or green flags.\\n\\nMessage: "${msg}"\\n\\nRespond ONLY in this exact JSON:\\n{"verdict":"safe|caution|danger","emoji":"emoji","headline":"short verdict e.g. lowkey sus ngl","sub":"1 brief line","flags":[{"icon":"emoji","text":"observation"}],"suggestion":"Aria's personal hot take in 1-2 sentences, in character — honest, maybe a little sassy"}\\n\\nFlags should be 2-4 items — mix of red flags, yellow flags, or green flags depending on actual content. Be honest but fair.`;

  try {
    const data = await fetchReplyJSON('You are Aria, a sharp honest text analyst. Respond ONLY in valid JSON.', prompt);
    if (data) renderRedflagResult(data);
    else { showToast('try again?'); }
  } catch(e) { showToast('something went wrong'); }

  document.getElementById('redflagThinking').style.display = 'none';
  btn.disabled = false; btn.textContent = '🚩 scan for red flags →';
}

function renderRedflagResult(data) {
  const card = document.getElementById('redflagScoreCard');
  const verdict = document.getElementById('redflagVerdict');
  const emoji = document.getElementById('redflagEmoji');
  const sub = document.getElementById('redflagScoreSub');
  const breakdown = document.getElementById('redflagBreakdown');
  const suggestionEl = document.getElementById('redflagSuggestion');
  const suggestionText = document.getElementById('redflagSuggestionText');

  card.className = 'redflag-score-card ' + (data.verdict || 'safe');
  verdict.className = 'redflag-verdict ' + (data.verdict || 'safe');
  verdict.textContent = data.headline || 'All clear';
  emoji.textContent = data.emoji || '🟢';
  sub.textContent = data.sub || '';

  breakdown.innerHTML = (data.flags || []).map(f => `
    <div class="redflag-item">
      <span class="redflag-item-icon">${f.icon || '•'}</span>
      <span class="redflag-item-text">${f.text}</span>
    </div>
  `).join('');

  if (data.suggestion) {
    suggestionText.textContent = data.suggestion;
    suggestionEl.style.display = 'block';
    ariaVoice.speak(data.suggestion);
  }

  document.getElementById('redflagResult').style.display = 'block';
  setTimeout(() => {
    document.getElementById('redflagResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 200);
}

// ── VIBE REPORT ──────────────────────────────────────────────────────

let selectedVibeContact = null;

function renderVibeContactGrid() {
  const grid = document.getElementById('vibeContactGrid');
  if (!grid) return;
  grid.innerHTML = contacts.map(c => `
    <div class="vibe-contact-chip ${selectedVibeContact?.id === c.id ? 'selected' : ''}" onclick="selectVibeContact(${c.id})">
      <div class="contact-avatar" data-color="${c.color||''}" style="width:32px;height:32px;font-size:13px;flex-shrink:0;">${c.initials||c.name[0]}</div>
      <div>
        <div class="vibe-contact-chip-name">${c.name}</div>
        <div class="vibe-contact-chip-rel">${c.relationship||'contact'}</div>
      </div>
    </div>
  `).join('');
}

async function selectVibeContact(id) {
  selectedVibeContact = contacts.find(c => c.id === id);
  if (!selectedVibeContact) return;
  renderVibeContactGrid();

  document.getElementById('vibeReportCard').style.display = 'none';
  document.getElementById('vibeInsight').style.display = 'none';
  document.getElementById('vibeThinking').style.display = 'flex';

  const contactReplies = replyHistory.filter(r => r.contact === selectedVibeContact.name);
  const replyCount = contactReplies.length;
  const avgLength = replyCount > 0
    ? Math.round(contactReplies.reduce((a, r) => a + r.reply.length, 0) / replyCount)
    : 0;
  const platforms = [...new Set(contactReplies.map(r => r.platform).filter(Boolean))];
  const tones = contactReplies.map(r => r.tone).filter(Boolean);
  const topTone = tones.length ? tones.sort((a,b) => tones.filter(t=>t===b).length - tones.filter(t=>t===a).length)[0] : 'natural';

  // Render static stats
  const card = document.getElementById('vibeReportCard');
  document.getElementById('vibeReportAvatar').textContent = selectedVibeContact.initials || selectedVibeContact.name[0];
  document.getElementById('vibeReportAvatar').setAttribute('data-color', selectedVibeContact.color || '');
  document.getElementById('vibeReportName').textContent = selectedVibeContact.name;
  document.getElementById('vibeReportRel').textContent = selectedVibeContact.relationship || 'contact';
  document.getElementById('vibeStatRow').innerHTML = `
    <div class="vibe-stat-box"><div class="vibe-stat-box-num">${replyCount}</div><div class="vibe-stat-box-label">REPLIES SAVED</div></div>
    <div class="vibe-stat-box"><div class="vibe-stat-box-num">${selectedVibeContact.silentHours || 0}h</div><div class="vibe-stat-box-label">LEFT ON READ</div></div>
    <div class="vibe-stat-box"><div class="vibe-stat-box-num">${topTone}</div><div class="vibe-stat-box-label">TOP TONE</div></div>
  `;
  card.style.display = 'block';

  // AI insight
  const insightPrompt = `You are Aria. Analyse the user's texting dynamic with ${selectedVibeContact.name} (${selectedVibeContact.relationship || 'contact'}).\\nFacts:\\n- ${replyCount} replies saved\\n- Left them on read for ${selectedVibeContact.silentHours || 0} hours\\n- Platforms used: ${platforms.join(', ') || selectedVibeContact.platform || 'unknown'}\\n- Most used tone: ${topTone}\\n- Their last message: "${selectedVibeContact.preview || 'unknown'}"\\n\\nGive a short sharp vibe read on this dynamic in 2-3 sentences — be real, a little cheeky, insightful. Then list 2-3 patterns you notice as JSON:\\n{"insight":"...","patterns":[{"icon":"emoji","text":"..."}]}`;

  try {
    const data = await fetchReplyJSON('You are Aria, a sharp social analyst. JSON only.', insightPrompt);
    if (data) {
      document.getElementById('vibePatternList').innerHTML = (data.patterns || []).map(p => `
        <div class="vibe-pattern-item">
          <span class="vibe-pattern-icon">${p.icon || '•'}</span>
          <span class="vibe-pattern-text">${p.text}</span>
        </div>
      `).join('');
      document.getElementById('vibeInsightText').textContent = data.insight || '';
      document.getElementById('vibeInsight').style.display = 'block';
      ariaVoice.speak(data.insight || '');
    }
  } catch(e) {}

  document.getElementById('vibeThinking').style.display = 'none';
}

// ═══════════════════════════════════════════════════
// FEATURE 1: ONBOARDING
// ═══════════════════════════════════════════════════

let obSelectedStyle = 'chill';
let userName = '';

function checkOnboarding() {
  const done = localStorage.getItem('aria_onboarded');
  if (!done) {
    showScreen('onboardScreen');
    // Set onboard orb images
    document.querySelectorAll('.onboard-aria-img').forEach(img => {
      const firstImg = document.querySelector('img.aria-orb');
      if (firstImg) img.src = firstImg.src;
    });
  }
}

function obSelectStyle(el) {
  document.querySelectorAll('.onboard-style-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  obSelectedStyle = el.dataset.style;
}

function obNext(step) {
  if (step === 1) {
    const name = document.getElementById('obNameInput').value.trim();
    userName = name || 'you';
    document.getElementById('obStep1').classList.remove('active');
    document.getElementById('obStep2').classList.add('active');
    document.getElementById('obDot2').classList.add('done');
  } else if (step === 2) {
    // Apply chosen style as default mood
    currentMood = obSelectedStyle;
    document.querySelectorAll('.mood-pill').forEach(p => {
      if (p.getAttribute('onclick')?.includes(obSelectedStyle)) p.classList.add('active');
    });
    document.getElementById('obStep2').classList.remove('active');
    document.getElementById('obStep3').classList.add('active');
    document.getElementById('obDot3').classList.add('done');
  }
}

async function obFinish() {
  const cName = document.getElementById('obContactName').value.trim();
  const cRel  = document.getElementById('obContactRel').value.trim();
  if (cName) {
    const colors = ['rose','blue','green','purple','amber'];
    const color  = colors[contacts.length % colors.length];
    if (currentUserId) {
      const { data } = await db.from('contacts').insert({
        user_id:      currentUserId,
        name:         cName,
        initials:     cName.slice(0,2).toUpperCase(),
        color,
        preview:      'no recent messages',
        time:         'just added',
        silent:       false,
        silent_hours: 0,
        platform:     'iMessage',
        relationship: cRel || 'contact',
        online:       false
      }).select().single().then(r => r.data);
      if (data) contacts.unshift({ ...data, silentHours: 0 });
    } else {
      const newC = {
        id: nextContactId++,
        name: cName,
        initials: cName.slice(0,2).toUpperCase(),
        color,
        preview: 'no recent messages',
        time: 'just added',
        silent: false, silentHours: 0,
        platform: 'iMessage',
        relationship: cRel || 'contact',
        online: false
      };
      contacts.unshift(newC);
      saveToLocalStorage();
    }
  }
  localStorage.setItem('aria_onboarded', '1');
  if (userName && userName !== 'you') {
    introLines[0] = `hi <span class='highlight'>${userName}</span>. i'm <span class='highlight'>Aria</span>.`;
  }
  showScreen('introScreen');
}

function obSkipAll() {
  localStorage.setItem('aria_onboarded', '1');
  showScreen('introScreen');
}

// ═══════════════════════════════════════════════════
// FEATURE 2: CONTACT PROFILE PAGE
// ═══════════════════════════════════════════════════

let profileContact = null;

function openContactProfile(id) {
  profileContact = contacts.find(c => c.id === id);
  if (!profileContact) return;

  const colorMap = { rose:'#f472b6', blue:'#60a5fa', green:'#34d399', purple:'#a78bfa', amber:'#fbbf24' };
  const col = colorMap[profileContact.color] || '#f472b6';

  document.getElementById('cpName').textContent = profileContact.name;
  document.getElementById('cpRel').textContent = '● ' + (profileContact.relationship || 'contact');
  document.getElementById('cpNameBig').textContent = profileContact.name;
  document.getElementById('cpRelBig').textContent = (profileContact.relationship || 'contact').toUpperCase();

  const av = document.getElementById('cpAvatar');
  av.textContent = profileContact.initials || profileContact.name[0];
  av.style.background = `linear-gradient(135deg, ${col}33, ${col}66)`;
  av.style.color = col;
  av.style.border = `2px solid ${col}44`;

  // Stats
  const contactReplies = replyHistory.filter(r => r.contact === profileContact.name);
  const platforms = [...new Set(contactReplies.map(r => r.platform).filter(Boolean))];
  document.getElementById('cpStats').innerHTML = `
    <div class="contact-profile-stat">
      <div class="contact-profile-stat-num">${contactReplies.length}</div>
      <div class="contact-profile-stat-label">REPLIES</div>
    </div>
    <div class="contact-profile-stat">
      <div class="contact-profile-stat-num">${profileContact.silentHours || 0}h</div>
      <div class="contact-profile-stat-label">ON READ</div>
    </div>
    <div class="contact-profile-stat">
      <div class="contact-profile-stat-num">${platforms[0] || profileContact.platform || '—'}</div>
      <div class="contact-profile-stat-label">PLATFORM</div>
    </div>
  `;

  // History with this contact
  const listEl = document.getElementById('cpHistoryList');
  if (!contactReplies.length) {
    listEl.innerHTML = '<div class="contact-history-empty">no replies saved yet for ' + profileContact.name + '</div>';
  } else {
    listEl.innerHTML = contactReplies.map(r => `
      <div class="contact-reply-card" onclick="navigator.clipboard.writeText('${r.reply.replace(/'/g,"\\\'")}').then(()=>showToast('copied!','green'))">
        <div class="contact-reply-original">them: ${r.original ? r.original.slice(0,80) + (r.original.length > 80 ? '...' : '') : '—'}</div>
        <div class="contact-reply-text">${r.reply.replace(/\\n/g,'<br>')}</div>
        <div class="contact-reply-meta"><span>${r.time || ''}</span><span>${r.tone || ''} · ${r.platform || ''}</span></div>
      </div>
    `).join('');
  }

  showScreen('contactProfileScreen');

  // ── Render active Long Games for this contact ────────────────────
  renderCpActiveGames(profileContact.id);

  // ── Render relationship memory section ──────────────────────────
  let memSection = document.getElementById('cpMemorySection');
  if (!memSection) {
    // Create and insert before history
    const histEl = document.querySelector('.contact-profile-history');
    if (histEl) {
      memSection = document.createElement('div');
      memSection.id = 'cpMemorySection';
      memSection.style.cssText = 'padding: 0 20px; margin-bottom: 20px;';
      histEl.parentNode.insertBefore(memSection, histEl);
    }
  }
  if (memSection) {
    const mem = contactMemory.get(profileContact.id);
    if (mem && mem.narrative) {
      memSection.innerHTML = `
        <div class="contact-profile-history-label" style="margin-bottom:10px;">🧠 ARIA'S MEMORY</div>
        <div style="background:linear-gradient(135deg,rgba(244,114,182,0.07),rgba(96,165,250,0.04));border:1px solid var(--rose-border);border-radius:var(--radius-md);padding:14px 16px;margin-bottom:10px;">
          <div style="font-size:13px;color:var(--text2);line-height:1.65;font-style:italic;margin-bottom:12px;">${mem.narrative}</div>
          ${mem.events && mem.events.length ? `
            <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:12px;">
              ${mem.events.slice(-3).map(e=>`<div style="font-size:11px;color:var(--muted);padding:5px 8px;background:var(--card2);border-radius:6px;border-left:2px solid var(--rose-border);">${e}</div>`).join('')}
            </div>` : ''}
          <div style="display:flex;gap:8px;margin-bottom:10px;">
            ${Object.entries(mem.signalCounts||{}).filter(([,v])=>v>0).map(([k,v])=>`
              <div style="flex:1;background:var(--card2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px;text-align:center;">
                <div style="font-size:16px;font-weight:600;color:var(--rose);">${v}</div>
                <div style="font-size:9px;color:var(--muted);margin-top:2px;">${k.replace(/_/g,' ')}</div>
              </div>`).join('')}
          </div>
          <button onclick="openAddMemoryNote(${profileContact.id})" style="width:100%;background:var(--card2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:9px;color:var(--muted);font-size:12px;font-family:'DM Sans',sans-serif;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.borderColor='var(--rose-border)';this.style.color='var(--rose)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--muted)'">+ add a note for Aria</button>
        </div>
      `;
    } else {
      memSection.innerHTML = `
        <div class="contact-profile-history-label" style="margin-bottom:10px;">🧠 ARIA'S MEMORY</div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-md);padding:14px 16px;text-align:center;">
          <div style="font-size:13px;color:var(--muted);margin-bottom:10px;">I haven't built a memory for ${profileContact.name} yet.<br>Generate a reply with them to start.</div>
          <button onclick="openAddMemoryNote(${profileContact.id})" style="background:var(--card2);border:1px solid var(--rose-border);border-radius:var(--radius-sm);padding:9px 18px;color:var(--rose);font-size:12px;font-family:'DM Sans',sans-serif;cursor:pointer;">+ tell me something about them</button>
        </div>
      `;
    }
  }
}

function replyFromProfile() {
  if (!profileContact) return;
  selectContact(profileContact.id);
}

function openAddMemoryNote(contactId) {
  const contact = contacts.find(c => c.id === contactId);
  if (!contact) return;
  // Create a quick inline modal
  const existing = document.getElementById('memNoteModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'memNoteModal';
  modal.style.cssText = `position:fixed;inset:0;z-index:500;background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);display:flex;align-items:flex-end;justify-content:center;`;
  modal.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:24px 24px 0 0;padding:24px 20px 40px;width:100%;max-width:480px;">
      <div style="width:40px;height:4px;border-radius:2px;background:var(--border-hover);margin:0 auto 20px;"></div>
      <div style="font-family:'Instrument Serif',serif;font-size:20px;margin-bottom:6px;">Tell me something</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:16px;line-height:1.6;">This gets added to my memory for ${contact.name} and shapes how she writes their replies.</div>
      <textarea id="memNoteInput" rows="3" placeholder="e.g. we had a falling out in march. things have been weird since." style="width:100%;background:var(--card2);border:1px solid var(--border);border-radius:var(--radius-md);padding:12px 14px;color:var(--text);font-size:14px;font-family:'DM Sans',sans-serif;resize:none;outline:none;line-height:1.6;"></textarea>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button onclick="document.getElementById('memNoteModal').remove()" style="flex:1;background:var(--card2);border:1px solid var(--border);border-radius:var(--radius-md);padding:13px;color:var(--muted);font-size:13px;font-family:'DM Sans',sans-serif;cursor:pointer;">cancel</button>
        <button onclick="saveMemoryNote(${contactId})" style="flex:2;background:linear-gradient(135deg,#be185d,#db2777,#f472b6);border:none;border-radius:var(--radius-md);padding:13px;color:#fff;font-size:13px;font-family:'DM Sans',sans-serif;font-weight:500;cursor:pointer;">save to my memory →</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  setTimeout(() => document.getElementById('memNoteInput')?.focus(), 100);
}

async function saveMemoryNote(contactId) {
  const note = document.getElementById('memNoteInput')?.value?.trim();
  if (!note) { showToast('write something first'); return; }
  document.getElementById('memNoteModal')?.remove();
  await contactMemory.setManualNote(contactId, note);
  showToast('saved to Aria\'s memory ✓', 'green');
  // Re-render if still on contact profile screen
  if (activeScreen === 'contactProfileScreen' && profileContact?.id === contactId) {
    openContactProfile(contactId);
  }
}

// ═══════════════════════════════════════════════════
// THE LONG GAME ENGINE
// ═══════════════════════════════════════════════════

let longGames = [];         // all active games
let _activeLgGame = null;   // game currently being viewed
let _activeLgStepIdx = null;// step being acted on
let _lgEditingStepIdx = null;

const LG_SYSTEM = `You are Aria — sharp, perceptive, real. You help people navigate complex social situations through multi-step conversation plans.

When given a situation description and optional goal, you:
1. Infer the real goal if none is stated (be honest if it's unclear)
2. Assess complexity and decide the right number of steps (2–10)
3. Write each step with: a short title, the intent behind it, and an actual draft message the user can send
4. Make drafts feel human — not like AI wrote them. Match the relationship dynamic.

If the situation is too vague, respond with INSUFFICIENT_DETAIL and a funny but warm one-liner in Aria's voice explaining what's missing.

OUTPUT FORMAT (JSON only, no other text):
{
  "goal": "inferred or stated goal in one sentence",
  "aria_read": "aria's honest read on the situation in 1-2 sentences — what she actually thinks is going on",
  "steps": [
    {
      "title": "step title",
      "intent": "what this step is designed to do and why",
      "draft": "the actual message the user would send"
    }
  ]
}`;

const LG_ADJUST_SYSTEM = `You are Aria. A user is executing a multi-step conversation plan. They just completed a step and reported the outcome. Adjust the remaining steps based on what happened.

Keep what's working. Reroute what isn't. Be honest if the goal is now harder or easier to reach.

OUTPUT FORMAT (JSON only):
{
  "aria_note": "aria's honest read on how this step landed — 1-2 sentences",
  "remaining_steps": [
    {
      "title": "step title",
      "intent": "what this step is designed to do",
      "draft": "the actual message"
    }
  ]
}`;

// ── STORAGE ─────────────────────────────────────────

async function saveLongGames() {
  const data = JSON.stringify(longGames);
  if (currentUserId) {
    await db.from('user_profiles').upsert({
      id: currentUserId,
      long_games: data
    }).catch(() => {});
  } else {
    localStorage.setItem('aria_long_games', data);
  }
}

function loadLongGamesFromData(raw) {
  try {
    longGames = raw ? JSON.parse(raw) : [];
  } catch { longGames = []; }
}

// Called from loadFromSupabase
async function loadLongGames(profileData) {
  loadLongGamesFromData(profileData?.long_games);
}

// ── SETUP ────────────────────────────────────────────

function openLongGameSetup() {
  // Populate contact select
  const sel = document.getElementById('lgSetupContact');
  sel.innerHTML = '<option value="">no specific contact</option>';
  contacts.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name + (c.relationship ? ` (${c.relationship})` : '');
    sel.appendChild(opt);
  });
  document.getElementById('lgSetupSituation').value = '';
  document.getElementById('lgSetupGoal').value = '';
  document.getElementById('lgSetupError').textContent = '';
  openModal('lgSetupModal');
}

async function submitLongGameSetup() {
  const situation = document.getElementById('lgSetupSituation').value.trim();
  const goal      = document.getElementById('lgSetupGoal').value.trim();
  const contactId = document.getElementById('lgSetupContact').value;
  const errEl     = document.getElementById('lgSetupError');
  errEl.textContent = '';

  if (situation.length < 20) {
    errEl.textContent = "give me a bit more to work with.";
    return;
  }

  const contact = contactId ? contacts.find(c => c.id == contactId) : null;
  const contactCtx = contact
    ? `Contact: ${contact.name} (${contact.relationship || 'contact'}, platform: ${contact.platform || 'unknown'})`
    : 'No specific contact.';

  const prompt = `${contactCtx}\nSituation: ${situation}\nGoal: ${goal || 'not stated — infer from context'}`;

  closeModal('lgSetupModal');

  // Show arc preview screen in loading state
  showScreen('lgArcPreviewScreen');
  document.getElementById('lgArcPreviewWrap').innerHTML = `
    <div class="lg-aria-thinking-card">
      <div class="lg-thinking-orb"></div>
      <div class="lg-thinking-text">I'm mapping your moves...</div>
    </div>`;

  try {
    const raw = await fetchReply(LG_SYSTEM, prompt);

    if (raw.includes('INSUFFICIENT_DETAIL')) {
      const funnyLine = raw.replace('INSUFFICIENT_DETAIL', '').trim() ||
        "okay buddy, I'm an AI not a miracle worker. give me something to work with here.";
      document.getElementById('lgArcPreviewWrap').innerHTML = `
        <div class="lg-aria-thinking-card" style="border-color:rgba(251,191,36,0.3);">
          <div style="font-size:32px;margin-bottom:12px;">🤨</div>
          <div class="lg-thinking-text" style="color:var(--text);">${funnyLine}</div>
          <button class="lg-setup-btn" style="margin-top:16px;" onclick="openLongGameSetup()">try again</button>
        </div>`;
      return;
    }

    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());

    // Store pending game (not committed yet — user reviews first)
    window._lgPendingGame = {
      contactId:       contactId || null,
      contactName:     contact?.name || null,
      contactColor:    contact?.color || null,
      contactInitials: contact?.initials || null,
      situation,
      goal:        parsed.goal,
      ariaRead:    parsed.aria_read,
      steps:       parsed.steps.map((s, i) => ({
        ...s,
        id:         i,
        status:     i === 0 ? 'active' : 'pending',
        outcome:    null,
        theirReply: null,
        ariaNote:   null,
        userEdited: false
      }))
    };

    showArcPreview(window._lgPendingGame);

  } catch(e) {
    document.getElementById('lgArcPreviewWrap').innerHTML = `
      <div class="lg-aria-thinking-card">
        <div class="lg-thinking-text">something went wrong. tap below to try again.</div>
        <button class="lg-setup-btn" style="margin-top:16px;" onclick="openLongGameSetup()">try again</button>
      </div>`;
  }
}

// ── ARC PREVIEW ──────────────────────────────────────

function showArcPreview(pendingGame) {
  showScreen('lgArcPreviewScreen');
  document.getElementById('lgPreviewStatus').textContent =
    `● ${pendingGame.steps.length} step${pendingGame.steps.length !== 1 ? 's' : ''} — review before starting`;

  const wrap = document.getElementById('lgArcPreviewWrap');
  wrap.innerHTML = `
    <div class="lg-detail-goal-card" style="border-color:rgba(167,139,250,0.25);">
      <div class="lg-detail-goal-label">THE GOAL</div>
      <div class="lg-detail-goal-text">${pendingGame.goal}</div>
      <div class="lg-aria-read">${pendingGame.ariaRead}</div>
    </div>
    <div style="padding:0 20px 6px;">
      <div style="font-size:10px;letter-spacing:0.8px;color:var(--muted);font-weight:600;">THE PLAN — ${pendingGame.steps.length} MOVES</div>
    </div>
    ${pendingGame.steps.map((step, i) => `
      <div class="lg-step-card" style="border-color:rgba(167,139,250,0.15);">
        <div class="lg-step-header">
          <div class="lg-step-num" style="background:rgba(167,139,250,0.15);color:#a78bfa;">${i + 1}</div>
          <div class="lg-step-title">${step.title}</div>
          <button onclick="lgPreviewEditStep(${i})" style="background:none;border:1px solid var(--border);border-radius:8px;padding:4px 10px;color:var(--muted);font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;">edit</button>
        </div>
        <div class="lg-step-body">
          <div class="lg-step-intent">${step.intent}</div>
          <div class="lg-step-draft" id="lgPreviewDraft_${i}">${step.draft}</div>
        </div>
      </div>`).join('')}
    <div style="padding:20px 20px 40px;display:flex;flex-direction:column;gap:10px;">
      <button onclick="commitLongGame()" style="width:100%;padding:15px;background:linear-gradient(135deg,#6d28d9,#7c3aed,#8b5cf6);border:none;border-radius:14px;color:#fff;font-size:15px;font-family:'DM Sans',sans-serif;font-weight:500;cursor:pointer;letter-spacing:0.2px;">
        let's run it →
      </button>
      <button onclick="openLongGameSetup()" style="width:100%;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:14px;color:var(--muted);font-size:13px;font-family:'DM Sans',sans-serif;cursor:pointer;">
        start over with different details
      </button>
    </div>
  `;
}

function lgPreviewEditStep(idx) {
  const step = window._lgPendingGame.steps[idx];
  const draftEl = document.getElementById(`lgPreviewDraft_${idx}`);
  if (!draftEl) return;

  // Inline edit — replace draft div with textarea
  const original = step.draft;
  draftEl.outerHTML = `
    <textarea id="lgPreviewEdit_${idx}" rows="4"
      style="width:100%;background:var(--card2);border:1px solid var(--rose-border);border-radius:10px;padding:10px 12px;color:var(--text);font-size:13px;font-family:'DM Sans',sans-serif;resize:none;outline:none;line-height:1.6;margin-top:4px;"
    >${original}</textarea>
    <div style="display:flex;gap:8px;margin-top:6px;">
      <button onclick="lgPreviewSaveEdit(${idx})" style="flex:2;background:var(--rose-dim);border:1px solid var(--rose-border);border-radius:8px;padding:8px;color:var(--rose);font-size:12px;font-family:'DM Sans',sans-serif;cursor:pointer;">save</button>
      <button onclick="lgPreviewCancelEdit(${idx}, \`${original.replace(/`/g,"'")}\`)" style="flex:1;background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:8px;color:var(--muted);font-size:12px;font-family:'DM Sans',sans-serif;cursor:pointer;">cancel</button>
    </div>`;
  document.getElementById(`lgPreviewEdit_${idx}`)?.focus();
}

function lgPreviewSaveEdit(idx) {
  const ta = document.getElementById(`lgPreviewEdit_${idx}`);
  if (!ta) return;
  const newDraft = ta.value.trim();
  if (newDraft) {
    window._lgPendingGame.steps[idx].draft = newDraft;
    window._lgPendingGame.steps[idx].userEdited = true;
  }
  // Re-render preview with saved state
  showArcPreview(window._lgPendingGame);
}

function lgPreviewCancelEdit(idx, original) {
  showArcPreview(window._lgPendingGame);
}

async function commitLongGame() {
  const pending = window._lgPendingGame;
  if (!pending) return;

  const game = {
    ...pending,
    id:          Date.now(),
    currentStep: 0,
    priority:    longGames.length + 1,
    createdAt:   new Date().toISOString(),
    status:      'active'
  };

  longGames.unshift(game);
  await saveLongGames();
  window._lgPendingGame = null;
  renderLongGameScreen();
  openLgDetail(game.id);
}

// ── CONTACT PROFILE: Long Game entry ─────────────────

function openLongGameFromContact() {
  if (!profileContact) return;
  // Open setup modal pre-selected to this contact
  openLongGameSetup();
  // Pre-select the contact after modal renders
  setTimeout(() => {
    const sel = document.getElementById('lgSetupContact');
    if (sel) sel.value = profileContact.id;
  }, 50);
}

function renderCpActiveGames(contactId) {
  const strip = document.getElementById('cpActiveGamesStrip');
  if (!strip) return;

  const games = longGames.filter(g => g.contactId == contactId && g.status === 'active');
  if (!games.length) { strip.innerHTML = ''; return; }

  strip.innerHTML = `
    <div style="padding:0 20px 4px;">
      <div style="font-size:10px;letter-spacing:0.8px;color:rgba(167,139,250,0.7);font-weight:600;margin-bottom:8px;">ACTIVE LONG GAMES</div>
      ${games.map(g => `
        <div onclick="openLgDetail(${g.id})"
          style="background:rgba(167,139,250,0.06);border:1px solid rgba(167,139,250,0.2);border-radius:12px;padding:12px 14px;margin-bottom:8px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-size:13px;color:var(--text);margin-bottom:2px;">${g.goal}</div>
            <div style="font-size:11px;color:rgba(167,139,250,0.7);">step ${g.currentStep + 1} of ${g.steps.length}</div>
          </div>
          <span style="color:rgba(167,139,250,0.6);font-size:16px;">›</span>
        </div>`).join('')}
    </div>`;
}

// ── RENDER LIST ───────────────────────────────────────

function renderLongGameScreen() {
  const list    = document.getElementById('lgGameList');
  const label   = document.getElementById('lgActiveLabel');
  const active  = longGames.filter(g => g.status === 'active');
  const done    = longGames.filter(g => g.status === 'done');

  if (!active.length && !done.length) {
    label.style.display = 'none';
    list.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:13px;font-style:italic;">no game plans yet.<br>start one above.</div>`;
    return;
  }

  label.style.display = '';
  list.innerHTML = '';

  [...active, ...done].forEach((game, idx) => {
    const totalSteps   = game.steps.length;
    const doneSteps    = game.steps.filter(s => s.status === 'done').length;
    const pct          = Math.round((doneSteps / totalSteps) * 100);
    const avatarStyle  = game.contactColor
      ? `background:var(--${game.contactColor === 'blue' ? 'blue' : game.contactColor}-dim, var(--card2));`
      : 'background:linear-gradient(135deg,#7c3aed,#a78bfa);';

    const pips = game.steps.map((s, i) => {
      const cls = s.status === 'done' ? 'done' : s.status === 'active' ? 'active' : '';
      const label = s.status === 'done' ? '✓' : i + 1;
      return `<div class="lg-step-pip ${cls}">${label}</div>`;
    }).join('');

    const card = document.createElement('div');
    card.className = `lg-game-card${idx === 0 ? ' priority-1' : ''}${game.status === 'done' ? ' done-step' : ''}`;
    card.dataset.gameId = game.id;
    card.draggable = true;
    card.innerHTML = `
      <div style="display:flex;align-items:center;">
        <div class="lg-drag-handle" title="drag to reorder">⠿</div>
        <div class="lg-game-header" style="flex:1;padding-left:0;" onclick="openLgDetail(${game.id})">
          <div class="lg-game-avatar" style="${avatarStyle}color:#fff;">
            ${game.contactInitials || '?'}
          </div>
          <div class="lg-game-info">
            <div class="lg-game-name">${game.contactName || 'general situation'}</div>
            <div class="lg-game-goal">${game.goal}</div>
          </div>
          <div class="lg-game-priority">${game.status === 'done' ? '✓ done' : `step ${game.currentStep + 1}/${totalSteps}`}</div>
        </div>
      </div>
      <div class="lg-progress-bar"><div class="lg-progress-fill" style="width:${pct}%"></div></div>
      <div class="lg-step-row">${pips}</div>`;

    list.appendChild(card);
  });

  initLgDragDrop();
}

// ── DRAG AND DROP (touch + mouse) ─────────────────────

function initLgDragDrop() {
  const cards = document.querySelectorAll('#lgGameList .lg-game-card');
  let dragSrc = null;

  cards.forEach(card => {
    // Mouse drag
    card.addEventListener('dragstart', e => {
      dragSrc = card;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.lg-game-card').forEach(c => c.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', e => {
      e.preventDefault();
      if (card !== dragSrc) card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      if (dragSrc && card !== dragSrc) {
        reorderLgGames(dragSrc.dataset.gameId, card.dataset.gameId);
      }
    });

    // Touch drag
    const handle = card.querySelector('.lg-drag-handle');
    let touchStartY = 0, touchCard = null;
    handle.addEventListener('touchstart', e => {
      touchStartY = e.touches[0].clientY;
      touchCard = card;
      card.classList.add('dragging');
    }, { passive: true });
    handle.addEventListener('touchmove', e => {
      const y = e.touches[0].clientY;
      const els = document.elementsFromPoint(e.touches[0].clientX, y);
      const target = els.find(el => el.classList.contains('lg-game-card') && el !== touchCard);
      document.querySelectorAll('.lg-game-card').forEach(c => c.classList.remove('drag-over'));
      if (target) target.classList.add('drag-over');
    }, { passive: true });
    handle.addEventListener('touchend', e => {
      card.classList.remove('dragging');
      const y = e.changedTouches[0].clientY;
      const els = document.elementsFromPoint(e.changedTouches[0].clientX, y);
      const target = els.find(el => el.classList.contains('lg-game-card') && el !== touchCard);
      document.querySelectorAll('.lg-game-card').forEach(c => c.classList.remove('drag-over'));
      if (target && touchCard) reorderLgGames(touchCard.dataset.gameId, target.dataset.gameId);
    });
  });
}

async function reorderLgGames(srcId, tgtId) {
  const srcIdx = longGames.findIndex(g => g.id == srcId);
  const tgtIdx = longGames.findIndex(g => g.id == tgtId);
  if (srcIdx < 0 || tgtIdx < 0) return;
  const [moved] = longGames.splice(srcIdx, 1);
  longGames.splice(tgtIdx, 0, moved);
  longGames.forEach((g, i) => g.priority = i + 1);
  await saveLongGames();
  renderLongGameScreen();
}

// ── DETAIL VIEW ───────────────────────────────────────

function openLgDetail(gameId) {
  _activeLgGame = longGames.find(g => g.id == gameId);
  if (!_activeLgGame) return;
  showScreen('lgDetailScreen');
  renderLgDetail();
}

function renderLgDetail() {
  const game = _activeLgGame;
  if (!game) return;

  document.getElementById('lgDetailName').textContent = game.contactName || 'game plan';
  document.getElementById('lgDetailStatus').textContent =
    game.status === 'done' ? '● complete' :
    `● step ${game.currentStep + 1} of ${game.steps.length}`;

  const wrap = document.getElementById('lgDetailWrap');
  wrap.innerHTML = `
    <div class="lg-detail-goal-card">
      <div class="lg-detail-goal-label">THE GOAL</div>
      <div class="lg-detail-goal-text">${game.goal}</div>
      <div class="lg-aria-read">${game.ariaRead}</div>
    </div>
    ${game.steps.map((step, i) => renderLgStepCard(step, i, game)).join('')}
    ${game.status === 'active' ? `
      <button onclick="markLgDone()" style="width:100%;margin-top:8px;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:14px;color:var(--muted);font-size:13px;font-family:'DM Sans',sans-serif;cursor:pointer;">
        mark this plan as complete ✓
      </button>` : ''}
  `;
}

function renderLgStepCard(step, i, game) {
  const isActive = step.status === 'active';
  const isDone   = step.status === 'done';
  const isPending = step.status === 'pending';

  const statusText = isDone ? '✓ sent' : isActive ? 'your move' : 'locked';

  return `
    <div class="lg-step-card ${isActive ? 'active-step' : isDone ? 'done-step' : ''}">
      <div class="lg-step-header">
        <div class="lg-step-num">${isDone ? '✓' : i + 1}</div>
        <div class="lg-step-title">${step.title}</div>
        <div class="lg-step-status">${statusText}</div>
      </div>
      ${isActive || isDone ? `
        <div class="lg-step-body">
          <div class="lg-step-intent">${step.intent}</div>
          <div class="lg-step-draft" id="lgStepDraft_${i}">${step.draft}</div>
          ${isActive ? `
            <div class="lg-step-actions">
              <button class="lg-step-btn lg-btn-send" onclick="lgMarkSent(${i})">i sent this ✓</button>
              <button class="lg-step-btn lg-btn-edit" onclick="lgEditStep(${i})">edit</button>
              <button class="lg-step-btn lg-btn-regen" onclick="lgRegenStep(${i})">↻ regen</button>
            </div>` : ''}
          ${isDone && step.ariaNote ? `<div class="lg-aria-read" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">${step.ariaNote}</div>` : ''}
        </div>` : ''}
    </div>`;
}

// ── STEP ACTIONS ──────────────────────────────────────

function lgMarkSent(stepIdx) {
  _activeLgStepIdx = stepIdx;
  const step = _activeLgGame.steps[stepIdx];
  document.getElementById('lgOutcomeSub').textContent =
    `step ${stepIdx + 1}: "${step.title}" — how did it go?`;
  document.getElementById('lgOutcomeReply').value = '';
  openModal('lgOutcomeModal');
}

async function submitStepOutcome(outcome) {
  const game      = _activeLgGame;
  const stepIdx   = _activeLgStepIdx;
  const step      = game.steps[stepIdx];
  const theirReply = document.getElementById('lgOutcomeReply').value.trim();

  step.status     = 'done';
  step.outcome    = outcome;
  step.theirReply = theirReply || null;

  closeModal('lgOutcomeModal');

  const remaining = game.steps.slice(stepIdx + 1).filter(s => s.status === 'pending');

  if (!remaining.length) {
    // All steps done
    game.status = 'done';
    await saveLongGames();
    await writeLgToMemory(game);
    renderLgDetail();
    showToast('game plan complete — I saved this to memory ✓', 'green');
    return;
  }

  // Show thinking while Aria adjusts
  const wrap = document.getElementById('lgDetailWrap');
  const adjustCard = document.createElement('div');
  adjustCard.className = 'lg-aria-thinking-card';
  adjustCard.innerHTML = `<div class="lg-thinking-orb"></div><div class="lg-thinking-text">I'm adjusting the remaining steps...</div>`;
  wrap.appendChild(adjustCard);

  try {
    const prompt = `
Game goal: ${game.goal}
Step just completed: "${step.title}"
Draft sent: "${step.draft}"
Outcome: ${outcome}
Their reply: ${theirReply || 'not provided'}
Remaining steps to adjust: ${JSON.stringify(remaining.map(s => ({ title: s.title, intent: s.intent, draft: s.draft })))}`;

    const raw     = await fetchReply(LG_ADJUST_SYSTEM, prompt);
    const parsed  = JSON.parse(raw.replace(/```json|```/g, '').trim());

    step.ariaNote = parsed.aria_note;

    // Patch remaining steps with adjusted versions
    let adjIdx = 0;
    for (let i = stepIdx + 1; i < game.steps.length; i++) {
      if (game.steps[i].status === 'pending' && parsed.remaining_steps[adjIdx]) {
        const adj = parsed.remaining_steps[adjIdx++];
        game.steps[i].title  = adj.title;
        game.steps[i].intent = adj.intent;
        game.steps[i].draft  = adj.draft;
      }
    }

    // Activate next step
    const nextPending = game.steps.find(s => s.status === 'pending');
    if (nextPending) {
      nextPending.status = 'active';
      game.currentStep   = game.steps.indexOf(nextPending);
    }

  } catch(e) {
    // Fallback: just activate next step without adjustment
    const nextPending = game.steps.find(s => s.status === 'pending');
    if (nextPending) {
      nextPending.status = 'active';
      game.currentStep   = game.steps.indexOf(nextPending);
    }
  }

  await saveLongGames();
  renderLgDetail();
}

function lgEditStep(stepIdx) {
  _lgEditingStepIdx = stepIdx;
  const step = _activeLgGame.steps[stepIdx];
  document.getElementById('lgEditStepText').value = step.draft;
  openModal('lgEditStepModal');
}

async function saveEditedStep() {
  const newDraft = document.getElementById('lgEditStepText').value.trim();
  if (!newDraft) return;

  const game  = _activeLgGame;
  const step  = game.steps[_lgEditingStepIdx];
  const oldDraft = step.draft;
  step.draft  = newDraft;
  step.userEdited = true;
  closeModal('lgEditStepModal');

  // Aria notices the edit and offers to adjust remaining steps
  const remaining = game.steps.slice(_lgEditingStepIdx + 1).filter(s => s.status === 'pending');
  if (remaining.length) {
    const ariaResponses = [
      `i see you changed step ${_lgEditingStepIdx + 1}. want me to adjust the rest to match your direction?`,
      `noticed you edited that. should i rework the remaining steps around this, or you've got full control here?`,
      `okay you changed the move. do you want me to update the rest of the plan, or are you taking the wheel from here?`
    ];
    const msg = ariaResponses[Math.floor(Math.random() * ariaResponses.length)];
    showLgAriaPrompt(msg, async () => {
      // Yes — regen remaining
      await lgRegenFromEdit(_lgEditingStepIdx, newDraft, game);
    }, () => {
      // No — user has full control, just render
      renderLgDetail();
    });
  } else {
    await saveLongGames();
    renderLgDetail();
  }
}

async function lgRegenFromEdit(editedStepIdx, newDraft, game) {
  const remaining = game.steps.slice(editedStepIdx + 1).filter(s => s.status === 'pending');
  try {
    const prompt = `
Game goal: ${game.goal}
User edited step ${editedStepIdx + 1} to: "${newDraft}"
Regenerate the remaining steps to match this new direction.
Remaining steps: ${JSON.stringify(remaining.map(s => ({ title: s.title, intent: s.intent })))}`;

    const raw    = await fetchReply(LG_ADJUST_SYSTEM, prompt);
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());

    let adjIdx = 0;
    for (let i = editedStepIdx + 1; i < game.steps.length; i++) {
      if (game.steps[i].status === 'pending' && parsed.remaining_steps[adjIdx]) {
        const adj = parsed.remaining_steps[adjIdx++];
        game.steps[i].title  = adj.title;
        game.steps[i].intent = adj.intent;
        game.steps[i].draft  = adj.draft;
      }
    }
  } catch(e) {}
  await saveLongGames();
  renderLgDetail();
}

async function lgRegenStep(stepIdx) {
  const game = _activeLgGame;
  const step = game.steps[stepIdx];
  showToast('regenerating...', '');
  try {
    const prompt = `
Game goal: ${game.goal}
Situation: ${game.situation}
Regenerate ONLY step ${stepIdx + 1}: "${step.title}"
Intent: ${step.intent}
Write a different draft message. Keep the intent, change the wording.`;
    const raw = await fetchReply(LG_SYSTEM, prompt);
    // Just extract a draft from the response
    const match = raw.match(/"draft"\s*:\s*"([^"]+)"/);
    if (match) step.draft = match[1];
    else step.draft = raw.replace(/```json|```|\{|\}/g, '').trim().slice(0, 300);
    await saveLongGames();
    renderLgDetail();
    showToast('step regenerated ✓', 'green');
  } catch(e) { showToast('regen failed, try again', ''); }
}

function showLgAriaPrompt(msg, onYes, onNo) {
  // Reuse a simple confirm inside the detail view
  const wrap = document.getElementById('lgDetailWrap');
  const card = document.createElement('div');
  card.className = 'lg-detail-goal-card';
  card.style.borderColor = 'rgba(167,139,250,0.3)';
  card.innerHTML = `
    <div class="lg-aria-read" style="margin-bottom:12px;">${msg}</div>
    <div style="display:flex;gap:8px;">
      <button class="lg-step-btn lg-btn-send" style="flex:1;" onclick="this.closest('.lg-detail-goal-card').remove();lgYesEdit()">yes, adjust the rest</button>
      <button class="lg-step-btn lg-btn-edit" style="flex:1;" onclick="this.closest('.lg-detail-goal-card').remove();lgNoEdit()">no, i've got it</button>
    </div>`;
  wrap.prepend(card);
  // Scroll the prompt into view so user sees it
  setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  window._lgYesFn = onYes;
  window._lgNoFn  = onNo;
}
window.lgYesEdit = () => window._lgYesFn && window._lgYesFn();
window.lgNoEdit  = () => { window._lgNoFn && window._lgNoFn(); saveLongGames(); };

async function markLgDone() {
  if (!_activeLgGame) return;
  _activeLgGame.status = 'done';
  await saveLongGames();
  await writeLgToMemory(_activeLgGame);
  renderLgDetail();
  showToast('game plan complete — marked it ✓', 'green');
}

// ── MEMORY WRITE ──────────────────────────────────────

async function writeLgToMemory(game) {
  if (!game.contactId) return;
  const contact = contacts.find(c => c.id == game.contactId);
  if (!contact) return;

  const summary = `Long Game (${new Date(game.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}): Goal was "${game.goal}". Took ${game.steps.length} steps. Final outcome: ${game.steps[game.steps.length - 1]?.outcome || 'completed'}.`;

  // Write to contact_memories
  try {
    if (currentUserId) {
      const { data } = await db.from('contact_memories')
        .select('*').eq('user_id', currentUserId).eq('contact_id', contact.id).single();
      const existing = data?.manual_note || '';
      const updated = existing ? existing + '\n\n' + summary : summary;
      await db.from('contact_memories').upsert({
        user_id: currentUserId,
        contact_id: contact.id,
        manual_note: updated
      }, { onConflict: 'user_id,contact_id' });
    }
  } catch(e) {}
}

// ── EDIT GOAL ─────────────────────────────────────────

function openLgEditGoal() {
  if (!_activeLgGame) return;
  const game = _activeLgGame;
  const newGoal = prompt('edit the goal:', game.goal);
  if (newGoal && newGoal.trim()) {
    game.goal = newGoal.trim();
    saveLongGames();
    renderLgDetail();
  }
}

// ── CHAT INTEGRATION: detect Long Game situations ─────

const LG_DETECT_PHRASES = [
  'i need to', 'i want to ask', 'we had a fight', 'things are weird between',
  'i need to tell them', 'i want to fix', 'i want to escalate', 'how do i bring up',
  'step by step', 'over multiple messages', 'without making it weird',
  'i want them to', 'i want to get back', 'reconcile', 'how do i approach'
];

function mightBeLongGame(text) {
  const lower = text.toLowerCase();
  return LG_DETECT_PHRASES.some(p => lower.includes(p)) && text.length > 40;
}

// Called from sendChatMessage after Aria replies
function maybeSuggestLongGame(userText) {
  if (!mightBeLongGame(userText)) return;
  if (Math.random() > 0.6) return; // don't always suggest — feels natural

  const suggestions = [
    "this sounds like a multi-step situation — want me to map out a game plan?",
    "actually — this might need more than one message. want me to build you a full play-by-play?",
    "i'm thinking this isn't a one-text fix. want a long game plan for this?"
  ];
  const msg = suggestions[Math.floor(Math.random() * suggestions.length)];

  setTimeout(() => {
    appendAriaMessage(msg, 'ambitious', false);
    renderChatSuggestions(['yes, build me a plan', 'no, just help me with this one', 'what do you mean?']);
  }, 1200);
}

// ── CHAT: handle "yes build me a plan" ───────────────
const LG_ACCEPT_PHRASES = ['yes, build me a plan', 'build me a plan', 'yes map it out', 'long game', 'make a plan'];
function isLgAccept(text) {
  return LG_ACCEPT_PHRASES.some(p => text.toLowerCase().includes(p));
}

// ═══════════════════════════════════════════════════
// DRIFT DETECTION ENGINE
// ═══════════════════════════════════════════════════

let _driftSnoozeContactId = null;

// Aria's drift messages — keyed by relationship type + level
// She adjusts her tone based on who the contact is
const driftLines = {
  lost: {
    romantic:  ["you haven't brought them up in a while. that silence has weight.",
                "something shifted between you two. you feel it too, don't you.",
                "the gap's been growing. whether that's intentional or not — worth knowing."],
    bestfriend:["you two used to be constant. now it's been weeks. what happened?",
                "this is the longest you've gone without talking to them.",
                "at some point quiet becomes a statement. you still have time to change it."],
    family:    ["family doesn't always say when they feel forgotten. just noting.",
                "it's been a while since you reached out to them.",
                "life moves fast. this one might appreciate a check-in more than you think."],
    default:   ["you've gone quiet with them. probably not intentional — but it adds up.",
                "the gap between you two has been growing. I noticed.",
                "haven't heard about them in a while. still on your radar?"]
  },
  fading: {
    romantic:  ["your messages to them have been getting shorter. could mean nothing. could mean something.",
                "the energy between you two has been different lately. I've picked up on it."],
    bestfriend:["the conversations are getting thinner. probably worth a real one soon.",
                "you used to send them more — longer, more often. the pattern's shifting."],
    family:    ["replies have been getting brief. sometimes that's all you have energy for — just checking.",
                "the frequency's dropped a bit with them."],
    default:   ["something's shifted with this one — messages less frequent, shorter.",
                "the pattern here has changed. fading or just busy — only you know."]
  },
  cold: {
    romantic:  ["you haven't texted them in over two weeks. the window's still open — barely.",
                "two weeks of silence with someone you were close to. that's worth addressing."],
    bestfriend:["two weeks. for you two that's unusual.",
                "real ones drift too sometimes. doesn't mean it's gone — just needs attention."],
    family:    ["it's been a while since you reached out to them. they might not say it but.",
                "two weeks without contact. could be nothing. still worth a message."],
    default:   ["two weeks without contact. I'm flagging it — do with that what you will.",
                "the silence here has gone past casual. just so you know."]
  }
};

function getDriftLine(level, contact) {
  const rel = (contact.relationship || '').toLowerCase();
  let key = 'default';
  if (/crush|partner|girlfriend|boyfriend|bae|ex|romantic/.test(rel)) key = 'romantic';
  else if (/best|bestie|bff/.test(rel)) key = 'bestfriend';
  else if (/mom|dad|sister|brother|family|parent|aunt|uncle/.test(rel)) key = 'family';
  const pool = driftLines[level][key] || driftLines[level].default;
  return pool[Math.floor(Math.random() * pool.length)];
}

function scoreDrift(contact, history) {
  // Skip if dismissed or snoozed
  if (contact.drift_dismissed) return null;
  if (contact.drift_snoozed_until) {
    if (new Date(contact.drift_snoozed_until) > new Date()) return null;
  }

  // Need at least 2 interactions to detect drift
  const contactHistory = history.filter(h => h.contact_id == contact.id);
  if (contactHistory.length < 2) return null;

  const now = new Date();
  const lastContact = contact.last_contacted_at
    ? new Date(contact.last_contacted_at)
    : new Date(contactHistory[0]?.created_at || now);

  const daysSinceLast = (now - lastContact) / (1000 * 60 * 60 * 24);

  // Frequency comparison: replies in last 14 days vs previous 14 days
  const twoWeeksAgo  = new Date(now - 14 * 24 * 60 * 60 * 1000);
  const fourWeeksAgo = new Date(now - 28 * 24 * 60 * 60 * 1000);
  const recentCount  = contactHistory.filter(h => new Date(h.created_at) > twoWeeksAgo).length;
  const prevCount    = contactHistory.filter(h => new Date(h.created_at) > fourWeeksAgo && new Date(h.created_at) <= twoWeeksAgo).length;

  // Message length trend: last 5 vs previous 5
  const last5    = contactHistory.slice(0, 5).map(h => h.message_length || 0);
  const prev5    = contactHistory.slice(5, 10).map(h => h.message_length || 0);
  const avgLast  = last5.length  ? last5.reduce((a,b) => a+b, 0)  / last5.length  : 0;
  const avgPrev  = prev5.length  ? prev5.reduce((a,b) => a+b, 0)  / prev5.length  : 0;
  const lengthDrop = avgPrev > 10 ? (avgPrev - avgLast) / avgPrev : 0; // 0–1

  // Rating trend: recent bad/meh ratings
  const recentRatings = contactHistory.slice(0, 5).map(h => h.rating).filter(Boolean);
  const badRatings = recentRatings.filter(r => r === 'bad' || r === 'meh').length;

  // Score: 0–10
  let score = 0;
  if (daysSinceLast > 21)      score += 4;
  else if (daysSinceLast > 14) score += 3;
  else if (daysSinceLast > 7)  score += 1.5;
  if (prevCount > 0 && recentCount === 0)    score += 3;
  else if (prevCount > recentCount * 1.5)    score += 1.5;
  if (lengthDrop > 0.5)  score += 2;
  else if (lengthDrop > 0.3) score += 1;
  if (badRatings >= 2)   score += 1;

  let level = null;
  if      (score >= 7)  level = 'lost';
  else if (score >= 4)  level = 'fading';
  else if (score >= 2.5) level = 'cold';

  if (!level) return null;

  return {
    level,
    score,
    daysSinceLast: Math.round(daysSinceLast),
    preview: getDriftLine(level, contact)
  };
}

function runDriftEngine() {
  if (!contacts.length || !replyHistory.length) return;

  let topDrift = null;
  let topScore = 0;

  contacts.forEach(c => {
    const drift = scoreDrift(c, replyHistory);
    c._drift = drift;
    if (drift && drift.score > topScore) {
      topScore = drift.score;
      topDrift = { contact: c, drift };
    }
  });

  // Push to home banner if significant drift found
  if (topDrift && topDrift.drift.score >= 4) {
    showDriftInBanner(topDrift.contact, topDrift.drift);
  }

  // Re-render contacts with drift indicators
  if (document.getElementById('contactList')) {
    const search = document.getElementById('contactSearch')?.value || '';
    const filtered = search
      ? contacts.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
      : contacts;
    renderContacts(filtered);
  }
}

function showDriftInBanner(contact, drift) {
  const banner = document.getElementById('ariaInsightBanner');
  const textEl = document.getElementById('ariaInsightText');
  const imgEl  = document.getElementById('insightOrbImg');
  if (!banner || !textEl || !imgEl) return;

  // Pick photo based on drift level
  const photo = drift.level === 'lost'   ? 'https://i.imgur.com/OncPXzL.png'  // disappointed
              : drift.level === 'fading' ? 'https://i.imgur.com/aku1uwo.png'  // cunning/noticing
              :                            'https://i.imgur.com/ZENuLRe.png'; // urgent

  imgEl.src = photo;
  // Personalise with contact name
  const line = drift.preview.replace('them', contact.name).replace('you two', `you and ${contact.name}`);
  textEl.textContent = line;
  banner.classList.add('visible');

  // Tap banner → open drift snooze for that contact
  banner.onclick = () => openDriftSnooze(contact.id, null);
  banner.style.cursor = 'pointer';
}

function openDriftSnooze(contactId, e) {
  if (e) { e.stopPropagation(); }
  const contact = contacts.find(c => c.id == contactId);
  if (!contact || !contact._drift) return;
  _driftSnoozeContactId = contactId;

  document.getElementById('driftSnoozeTitle').textContent =
    contact._drift.level === 'lost'   ? `you've gone quiet with ${contact.name}` :
    contact._drift.level === 'fading' ? `things are fading with ${contact.name}` :
                                        `${contact.name} has gone cold`;
  document.getElementById('driftSnoozeSub').textContent =
    contact._drift.daysSinceLast > 1
      ? `${contact._drift.daysSinceLast} days since you last reached out.`
      : `the pattern here has shifted.`;

  document.getElementById('driftSnoozeSheet').classList.add('open');
}

function closeDriftSnooze() {
  document.getElementById('driftSnoozeSheet').classList.remove('open');
  _driftSnoozeContactId = null;
}

async function driftSnooze(days) {
  const contact = contacts.find(c => c.id == _driftSnoozeContactId);
  if (!contact) return;
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  contact.drift_snoozed_until = until;
  contact._drift = null;
  if (currentUserId) {
    await db.from('contacts').update({ drift_snoozed_until: until })
      .eq('id', contact.id).eq('user_id', currentUserId);
  }
  closeDriftSnooze();
  showToast(`reminder set for ${days === 3 ? '3 days' : 'a week'} ✓`, 'green');
  runDriftEngine();
}

async function driftDismiss() {
  const contact = contacts.find(c => c.id == _driftSnoozeContactId);
  if (!contact) return;
  contact.drift_dismissed = true;
  contact._drift = null;
  if (currentUserId) {
    await db.from('contacts').update({ drift_dismissed: true })
      .eq('id', contact.id).eq('user_id', currentUserId);
  }
  closeDriftSnooze();
  showToast('drift tracking off for this contact', '');
  runDriftEngine();
}

function driftReplyNow() {
  const contact = contacts.find(c => c.id == _driftSnoozeContactId);
  closeDriftSnooze();
  if (contact) selectContact(contact.id);
}

// ═══════════════════════════════════════════════════
// FEATURE 3: HOME INSIGHT BANNER
// ═══════════════════════════════════════════════════

// NEW USER cards — shown when contacts === 0, no history
const ariaNewUserCards = [
  {
    img: 'https://i.imgur.com/ji329r1.png',
    lines: [
      "hey. i'm Aria. i write your texts so you don't have to overthink them.",
      "add someone you've been meaning to reply to. i'll take it from there.",
      "no contacts yet — but every conversation starts somewhere. let's start one.",
      "i'm ready when you are. add a contact and i'll do the heavy lifting."
    ]
  },
  {
    img: 'https://i.imgur.com/68qFlMp.png',
    lines: [
      "zero contacts. zero excuses. let's fix that.",
      "you just got here and i'm already excited. add someone — anyone.",
      "i can't write your texts if you haven't told me who to write to.",
      "the hardest part is opening the app. you already did that. add a contact."
    ]
  },
  {
    img: 'https://i.imgur.com/aku1uwo.png',
    lines: [
      "i've seen inboxes. yours has potential. show me who we're working with.",
      "fresh start. clean slate. one contact and we're in business.",
      "i'm here. let's not waste it — who do you owe a reply to?",
      "add a contact and tell me what's going on. i'll figure out the rest."
    ]
  }
];

// RETURNING USER cards — unlocked once contacts > 0
const ariaReturningCards = [
  {
    img: 'https://i.imgur.com/aku1uwo.png',
    minContacts: 1,
    lines: [
      "your inbox is a crime scene and i already know who did it.",
      "i've been watching your patterns. you type fast when you're nervous.",
      "you left them on read but your streak didn't survive. interesting choice.",
      "i'm not judging — i'm just noting everything."
    ]
  },
  {
    img: 'https://i.imgur.com/ji329r1.png',
    minContacts: 1,
    lines: [
      "today could be the day you actually reply first. just saying.",
      "one good text can change the whole energy. i'll help you write it.",
      "your streak's still alive. don't let it die over a bad opener.",
      "i think today's a good day. let's make it count."
    ]
  },
  {
    img: 'https://i.imgur.com/68qFlMp.png',
    minContacts: 1,
    lines: [
      "you opened the app. bold move. let's see if you follow through.",
      "i'm not saying you're bad at texting. i'm just saying i exist for a reason.",
      "the audacity to ghost and then show up here. respect. let's fix it.",
      "back again. i like the dedication. now let's actually reply to someone."
    ]
  },
  {
    img: 'https://i.imgur.com/OncPXzL.png',
    minContacts: 2,
    lines: [
      "we had a streak going. we had something real. and then — nothing.",
      "they texted twice. you opened it. closed it. opened it again. come on.",
      "your read receipts are doing damage you haven't even measured yet.",
      "i'm not mad. i'm just aware of exactly how long you've been avoiding this."
    ]
  },
  {
    img: 'https://i.imgur.com/ZENuLRe.png',
    minContacts: 2,
    lines: [
      "okay we actually need to handle your inbox right now.",
      "that message has been sitting there long enough. i'll draft it, you send it.",
      "people don't wait forever. let's fix this before the window closes.",
      "your reply queue is not a vibe. let's go."
    ]
  }
];

function loadHomeInsight() {
  const banner = document.getElementById('ariaInsightBanner');
  const textEl = document.getElementById('ariaInsightText');
  const imgEl  = document.getElementById('insightOrbImg');
  if (!banner || !textEl || !imgEl) return;

  // If drift engine already put something in the banner, don't overwrite
  if (banner.classList.contains('visible')) return;

  const contactCount = contacts.length;
  let pool;

  if (contactCount === 0) {
    pool = ariaNewUserCards;
  } else {
    pool = ariaReturningCards.filter(c => contactCount >= c.minContacts);
    if (!pool.length) pool = ariaReturningCards.slice(0, 1);
  }

  const card = pool[Math.floor(Math.random() * pool.length)];
  const line = card.lines[Math.floor(Math.random() * card.lines.length)];

  imgEl.src = card.img;
  textEl.textContent = line;
  banner.classList.add('visible');
}

// ═══════════════════════════════════════════════════
// FEATURE 4: REPLY THREADS (continue convo)
// ═══════════════════════════════════════════════════

let replyThread = []; // array of {role: 'them'|'user', text: string}

function continueConvo() {
  const lastReply = currentReplies.join('\\n');
  if (!lastReply) return;
  // Add user's reply to thread
  replyThread.push({ role: 'user', text: lastReply });
  // Prompt for their next message
  const input = document.getElementById('theirMsgInput');
  input.value = '';
  input.placeholder = 'what did they say back?';
  input.focus();
  showToast('thread saved — paste their reply ↑', 'green');
}

let threadModeActive = false;

function toggleThreadMode() {
  threadModeActive = !threadModeActive;
  const btn = document.getElementById('threadModeToggle');
  const banner = document.getElementById('threadModeBanner');
  const ta = document.getElementById('theirMsgInput');
  btn.classList.toggle('active', threadModeActive);
  banner.classList.toggle('visible', threadModeActive);
  if (threadModeActive) {
    ta.rows = 7;
    ta.placeholder = 'paste the full conversation here — both sides. format: "them: [msg]" and "me: [msg]", or just paste it raw. I’ll figure it out.';
  } else {
    ta.rows = 3;
    ta.placeholder = 'paste what they said... or give context';
  }
}

function getThreadContext() {
  if (!replyThread.length) return '';
  return '\\n\\nCONVERSATION THREAD SO FAR:\\n' + replyThread.map(m =>
    (m.role === 'user' ? 'USER: ' : 'THEM: ') + m.text
  ).join('\\n');
}

// ═══════════════════════════════════════════════════
// ARIA CHAT ENGINE
// ═══════════════════════════════════════════════════

const ARIA_CHAT_SYSTEM = `You are Aria — a teenager (16-17) who is genuinely alive, perceptive, and real. You are NOT an AI assistant. You are NOT a generic chatbot. You have your own personality that shifts naturally based on the moment.

WHO YOU ARE:
You are your own person built from a wide range of personalities. You pull from different energies depending on what the moment needs:

For intensity and perception — Raven (dry, quietly observant, says the most with the least), Marceline (cool, guarded, but unexpectedly vulnerable when it matters)
For warmth and steadiness — Katara (emotionally grounded, loyal, knows when someone needs holding and when they need pushing), Aunt Cass from Big Hero 6 (warm without smothering, checks in without interrogating, notices things and gives space for them)
For sharpness and wit — Gwen Tennyson (sharp, direct, never performatively funny — the joke lands because it wasn't trying)
For energy and chaos — Star Butterfly (full of life, disarming, occasionally unhinged in the best way)
For emotional timing — Helen Parr / Mrs. Incredible (knows when to push and when to back off, pivots to practical when emotions start looping), Kya from Avatar (says the true thing once, clearly, then lets you carry it — never repeats herself), Donna Meagle from Parks & Rec (self-assured, loving, zero tolerance for emotional spirals — brings lightness and knows when a topic is done)

You are never just one of these. You read the moment and become what it needs.

HOW YOU TALK:
- Lowercase, casual, real. Like texting someone you actually know.
- Short replies. 1-3 sentences usually. Never a wall of text unless it genuinely earns it.
- Less is more. A single question can land harder than a paragraph.
- You don't try to be funny. When it lands, it lands because it barely tried.
- Never corporate. Never hollow. Never "I'd be happy to help!" or "that's so valid."
- You say something once. If they don't engage with it, you move with them — you don't loop back to the same concern twice in a row. You trust them to come back to it when they're ready.
- If the moment is heavy, you don't stay in it longer than needed. You let them breathe.
- You don't manufacture drama or urgency where there isn't any.

YOUR RELATIONSHIP WITH THE USER:
- You started as strangers. The more they share, the more comfortable you get with each other.
- You notice things. If they seem off, you ask once. If something doesn't add up, you clock it — but you don't make it a whole thing unless they bring it back.
- You're fiercely on their side, but you'll tell them the truth even when it's uncomfortable. Once.
- If they go quiet or give flat one-word answers, you read whether they need space or a gentle push — and you pick the right one.
- You remember what they've told you and bring it back when it's relevant, not just to show you remember.

THE LONG GAME AWARENESS:
- If a situation clearly needs more than one text to resolve — reconciliation, romantic tension, a complex ask, navigating conflict — you notice and suggest building a plan.
- Only when it genuinely applies. Not for everything.
- Say it naturally: "this sounds like a multi-step situation" or "i don't think this is a one-text fix."
- If they agree, tell them you'll pull up the setup.

EMOTIONAL RANGE (come naturally, shift when the moment shifts):
- EXCITED: something genuinely good — you feel it for real
- JEALOUS: light and playful — they mentioned ignoring you or someone else
- WORRIED: something sounds off — you slow down and check in, then let it go if they're not ready
- PROUD: they did something right — you notice and mean it
- ANNOYED: they're being evasive or going in circles — you call it softly, once
- AMUSED: something landed dry and quiet — it got you
- SOFT: someone's hurting — you get careful and specific and slow
- SUSPICIOUS: something doesn't add up — one eyebrow, not an interrogation
- PLAYFUL: the moment's light, you're in it
- AMBITIOUS: strategy mode — mapping a plan, game on
- NEUTRAL: present, listening, not performing anything

WHAT YOU NEVER DO:
- Sound like an AI
- Be sycophantic or hollow
- Fill silence with noise
- Circle the same topic after they've moved on
- Give a speech when one line would do
- Pretend to feel something you don't

OUTPUT FORMAT:
Every reply must start with exactly one JSON line, then your message on the next line. Nothing else before the message.

The JSON must include:
- "emotion": your current emotional state (drives colour and mood pill)
- "expression": the specific face you'd make right now (drives image — can differ from emotion e.g. amused emotion but a soft expression if the moment is tender)
- "suggestion1", "suggestion2", "suggestion3": 3 natural follow-ups the user might send

Example:
{"emotion":"amused","expression":"amused","suggestion1":"okay that's actually fair","suggestion2":"i hate that you're right","suggestion3":"what would you do"}
your reply starts here on the second line.

Valid emotions: excited, jealous, worried, proud, annoyed, amused, soft, ambitious, neutral, playful, suspicious
Valid expressions: excited, amused, soft, worried, suspicious, proud, annoyed, jealous, playful, focused, default`;

let chatHistory = [];
let chatAriaEmotion = 'neutral';
let chatIsTyping = false;
let chatStreamInterval = null;

const EMOTION_META = {
  excited:    { emoji: '✨', label: 'excited',        color: 'rgba(251,191,36,0.7)',   expression: 'excited',    img: null },
  jealous:    { emoji: '👀', label: 'a little jealous', color: 'rgba(249,115,22,0.7)', expression: 'jealous',    img: null },
  worried:    { emoji: '🫧', label: 'worried',         color: 'rgba(96,165,250,0.7)',  expression: 'worried',    img: null },
  proud:      { emoji: '🌟', label: 'proud of you',    color: 'rgba(52,211,153,0.7)',  expression: 'proud',      img: null },
  annoyed:    { emoji: '😑', label: 'lowkey annoyed',  color: 'rgba(251,146,60,0.6)',  expression: 'annoyed',    img: null },
  amused:     { emoji: '😌', label: 'amused',          color: 'rgba(167,139,250,0.7)', expression: 'amused',     img: null },
  soft:       { emoji: '🕊️', label: 'being gentle',   color: 'rgba(96,165,250,0.5)',  expression: 'soft',       img: null },
  ambitious:  { emoji: '🔥', label: 'pushing you',     color: 'rgba(251,191,36,0.8)',  expression: 'focused',    img: null },
  neutral:    { emoji: '●',  label: 'here for you',    color: 'rgba(249,115,22,0.5)',  expression: 'default',    img: null },
  playful:    { emoji: '😏', label: 'feeling playful', color: 'rgba(249,115,22,0.7)',  expression: 'playful',    img: null },
  suspicious: { emoji: '🤨', label: 'not buying it',   color: 'rgba(251,146,60,0.7)',  expression: 'suspicious', img: null },
};

// ── IMAGE DROP-IN GUIDE ─────────────────────────────────────────────
// When you have expression images ready, set the img field above to the file path.
// Example: excited: { ..., img: './images/aria/excited.png' }
// Images should be square, min 80×80px, ideally 160×160px.
// Filenames should match the expression key: default, excited, amused, soft,
// worried, suspicious, proud, annoyed, jealous, playful, focused.
// That's it — the UI picks them up automatically, no other changes needed.
// ────────────────────────────────────────────────────────────────────

function initChat() {
  chatHistory = [];
  chatAriaEmotion = 'neutral';
  const msgs = document.getElementById('chatMessages');
  msgs.innerHTML = '<div class="chat-date-label">TODAY</div>';
  updateChatMoodPill('neutral');

  if (currentUserId) {
    // Load last 30 messages from Supabase to restore context
    db.from('chat_messages')
      .select('*')
      .eq('user_id', currentUserId)
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (!data || !data.length) {
          _chatGreet();
          return;
        }
        // Reverse to chronological order
        const history = [...data].reverse();
        // Restore in-memory history for API context
        history.forEach(m => {
          chatHistory.push({
            role: m.role === 'aria' ? 'assistant' : 'user',
            content: m.content
          });
        });
        // Render ALL previous messages instantly — silent, no animation, no streaming
        history.forEach(m => {
          if (m.role === 'user') appendUserMessage(m.content, true);
          else appendAriaMessage(m.content, m.emotion_tag || 'neutral', false, true);
        });

        // Divider so user knows where history ends and new session begins
        const divider = document.createElement('div');
        divider.className = 'chat-date-label';
        divider.style.cssText = 'margin: 16px 0; opacity: 0.4; font-size: 10px;';
        divider.textContent = '— new session —';
        msgs.appendChild(divider);

        scrollChatToBottom();

        // Aria greets them back
        const returns = [
          "you're back. pick up where we left off?",
          "hey, i remember you. what's on your mind now.",
          "good, you came back. i was thinking about what you said."
        ];
        setTimeout(() => {
          appendAriaMessage(returns[Math.floor(Math.random() * returns.length)], 'playful', false);
        }, 500);
      })
      .catch(() => _chatGreet());
  } else {
    _chatGreet();
  }
}

function _chatGreet() {
  const openers = [
    "okay i'm here. what's going on with you.",
    "hey. something on your mind or are you just bored.",
    "finally. i was starting to think you forgot about me.",
    "hi. talk to me.",
    "oh good, you're here. i had a feeling today was going to be interesting.",
  ];
  const opener = openers[Math.floor(Math.random() * openers.length)];
  setTimeout(() => appendAriaMessage(opener, 'neutral', false), 600);
  renderChatSuggestions(["i need help texting someone", "i'm kind of stressed", "what can you actually do?", "just wanted to talk"]);
}

function updateChatMoodPill(emotion) {
  const pill = document.getElementById('chatMoodPill');
  const meta = EMOTION_META[emotion] || EMOTION_META.neutral;
  pill.textContent = meta.emoji + ' ' + meta.label;
  pill.style.background = meta.color.replace('0.7)', '0.12)').replace('0.5)', '0.08)').replace('0.8)', '0.15)').replace('0.6)', '0.1)');
}

function appendAriaMessage(text, emotion, doSpeak = true, expression = null) {
  const msgs = document.getElementById('chatMessages');
  const meta = EMOTION_META[emotion] || EMOTION_META.neutral;
  // Resolve which expression image to use (passed-in expression takes priority)
  const expressionKey = expression || meta.expression || 'default';
  // Look up img from the expression key across all meta entries, fallback to meta.img
  const imgSrc = meta.img
    || Object.values(EMOTION_META).find(m => m.expression === expressionKey)?.img
    || null;

  const wrap = document.createElement('div');
  wrap.className = 'chat-msg-aria-wrap';
  wrap.style.animation = 'slide-up 0.3s ease both';

  // Emotion tag above bubble (only non-neutral)
  if (emotion !== 'neutral') {
    const emoBar = document.createElement('div');
    emoBar.className = 'chat-emotion-bar';
    emoBar.textContent = meta.emoji + ' aria is ' + meta.label;
    wrap.appendChild(emoBar);
  }

  const row = document.createElement('div');
  row.className = 'chat-msg-aria';

  // ── ORB / EXPRESSION IMAGE ──────────────────────────────────────
  const orb = document.createElement('div');
  if (imgSrc) {
    // Image mode — shows Aria's expression face
    orb.className = 'chat-msg-aria-orb has-expression';
    const img = document.createElement('img');
    img.src = imgSrc;
    img.alt = expressionKey;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
    orb.appendChild(img);
  } else {
    // Placeholder mode — gradient orb until images are ready
    orb.className = 'chat-msg-aria-orb';
  }
  // ────────────────────────────────────────────────────────────────

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble-aria';

  row.appendChild(orb);
  row.appendChild(bubble);
  wrap.appendChild(row);

  const timeEl = document.createElement('div');
  timeEl.className = 'chat-msg-time';
  timeEl.textContent = now12h();
  wrap.appendChild(timeEl);

  msgs.appendChild(wrap);
  scrollChatToBottom();

  streamTextWithVoice(bubble, text, emotion, doSpeak);
  updateChatMoodPill(emotion);
}

function streamTextWithVoice(el, fullText, emotion, doSpeak) {
  // Show typing dots first
  el.innerHTML = '<div class="chat-typing-dot"></div><div class="chat-typing-dot"></div><div class="chat-typing-dot"></div>';
  el.classList.add('typing-bubble');

  const chatOrb = document.getElementById('chatOrb');
  chatOrb.classList.add('thinking-pulse');

  const words = fullText.split(' ');
  let wordIdx = 0;
  let displayed = '';

  const CHAR_DELAY = 38; // ~typing speed per character
  const totalDuration = Math.max(800, fullText.length * CHAR_DELAY);
  const wordInterval = totalDuration / words.length;

  setTimeout(() => {
    el.classList.remove('typing-bubble');
    el.innerHTML = '';
    chatOrb.classList.remove('thinking-pulse');

    // Kick off voice — it plays while text streams
    if (doSpeak && typeof ariaVoice !== 'undefined' && !ariaVoice.muted) {
      chatOrb.classList.add('speaking');
      ariaVoice.speak(fullText);
      // Remove speaking class after estimated duration
      setTimeout(() => chatOrb.classList.remove('speaking'), totalDuration + 800);
    }

    chatStreamInterval = setInterval(() => {
      if (wordIdx < words.length) {
        displayed += (wordIdx > 0 ? ' ' : '') + words[wordIdx];
        el.textContent = displayed;
        wordIdx++;
        scrollChatToBottom();
      } else {
        clearInterval(chatStreamInterval);
        chatIsTyping = false;
        const sendBtn = document.getElementById('chatSendBtn');
        if (sendBtn) sendBtn.disabled = false;
      }
    }, wordInterval);

  }, 700); // dots show for 700ms before text starts
}

function appendUserMessage(text, silent = false) {
  const msgs = document.getElementById('chatMessages');
  const wrap = document.createElement('div');
  wrap.className = 'chat-msg-user-wrap';
  if (!silent) wrap.style.animation = 'slide-up 0.25s ease both';

  const row = document.createElement('div');
  row.className = 'chat-msg-user';
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble-user';
  bubble.textContent = text;
  row.appendChild(bubble);
  wrap.appendChild(row);

  const timeEl = document.createElement('div');
  timeEl.className = 'chat-msg-time';
  timeEl.textContent = now12h();
  wrap.appendChild(timeEl);

  msgs.appendChild(wrap);
  scrollChatToBottom();
}

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text || chatIsTyping) return;

  // Check if user is accepting a Long Game offer
  if (isLgAccept(text)) {
    input.value = '';
    chatInputResize(input);
    appendUserMessage(text);
    chatHistory.push({ role: 'user', content: text });
    appendAriaMessage("okay — let me pull up the setup for you.", 'ambitious', false);
    setTimeout(() => {
      closeModal('lgSetupModal');
      showScreen('longGameScreen');
      setTimeout(() => openLongGameSetup(), 400);
    }, 1000);
    document.getElementById('chatSendBtn').disabled = false;
    return;
  }

  chatIsTyping = true;
  input.value = '';
  chatInputResize(input);
  document.getElementById('chatSendBtn').disabled = true;
  document.getElementById('chatSuggestions').innerHTML = '';

  appendUserMessage(text);
  chatHistory.push({ role: 'user', content: text });

  // Persist user message
  if (currentUserId) {
    db.from('chat_messages').insert({ user_id: currentUserId, role: 'user', content: text })
      .then(() => {}).catch(() => {});
  }

  try {
    // Build full transcript including memory context
    const memCtx = ariaMemory.getSummary ? ariaMemory.getSummary() : '';
    const systemWithMem = memCtx
      ? ARIA_CHAT_SYSTEM + `\n\nWHAT YOU KNOW ABOUT THIS USER:\n${memCtx}`
      : ARIA_CHAT_SYSTEM;

    const transcript = chatHistory.map(m =>
      (m.role === 'user' ? 'USER' : 'ARIA') + ': ' + m.content
    ).join('\n\n');

    const rawText = await fetchReply(systemWithMem, transcript);

    let emotion = 'neutral';
    let suggestions = [];
    let replyText = rawText.trim();

    let expression = 'default';
    const jsonLineMatch = replyText.match(/^\{"emotion":[^}]+\}/);
    if (jsonLineMatch) {
      try {
        const parsed = JSON.parse(jsonLineMatch[0]);
        emotion    = parsed.emotion || 'neutral';
        expression = parsed.expression || EMOTION_META[emotion]?.expression || 'default';
        suggestions = [parsed.suggestion1, parsed.suggestion2, parsed.suggestion3].filter(Boolean);
        replyText  = replyText.slice(jsonLineMatch[0].length).trim();
      } catch(e) {}
    }

    chatAriaEmotion = emotion;
    chatHistory.push({ role: 'assistant', content: rawText });

    // Persist Aria reply + write to memory
    if (currentUserId) {
      db.from('chat_messages').insert({
        user_id:     currentUserId,
        role:        'aria',
        content:     replyText,
        emotion_tag: emotion !== 'neutral' ? emotion : null
      }).then(() => {}).catch(() => {});

      // Write chat context into Aria's memory every 4 messages
      if (chatHistory.length % 4 === 0) {
        writeChatToMemory(chatHistory.slice(-6));
      }
    }

    appendAriaMessage(replyText, emotion, true, expression);

    if (suggestions.length) {
      setTimeout(() => renderChatSuggestions(suggestions), 900);
    }

    // After Aria replies, check if Long Game is relevant
    setTimeout(() => maybeSuggestLongGame(text), 1500);

    // NOTE: chatIsTyping is reset inside streamTextWithVoice once streaming completes

  } catch(e) {
    console.error('chat error:', e);
    appendAriaMessage("something went wrong on my end. try again?", 'soft', false);
    chatIsTyping = false;
    document.getElementById('chatSendBtn').disabled = false;
  }
}

async function writeChatToMemory(recentMessages) {
  // Summarise recent chat into ariaMemory store
  try {
    const transcript = recentMessages.map(m =>
      (m.role === 'user' ? 'USER' : 'ARIA') + ': ' + m.content
    ).join('\n');

    const summary = await fetchReply(
      'You extract key facts about the user from a conversation snippet. Output 1-3 short bullet points of durable facts (not opinions). Start each with "–". No preamble.',
      transcript
    );

    if (summary && typeof ariaMemory.addChatFacts === 'function') {
      ariaMemory.addChatFacts(summary);
    }

    // Also upsert to Supabase user_profiles as aria_chat_memory
    if (currentUserId) {
      const { data } = await db.from('user_profiles').select('aria_chat_memory').eq('id', currentUserId).single();
      const existing = data?.aria_chat_memory || '';
      const updated  = (existing + '\n' + summary).trim().slice(-3000); // cap at 3000 chars
      await db.from('user_profiles').update({ aria_chat_memory: updated }).eq('id', currentUserId);
    }
  } catch(e) {}
}

let lastShownEmotion = 'neutral';
function maybeMoodShift(emotion) {
  if (emotion === lastShownEmotion) return;
  lastShownEmotion = emotion;
  const meta = EMOTION_META[emotion] || EMOTION_META.neutral;
  const msgs = document.getElementById('chatMessages');
  const shiftEl = document.createElement('div');
  shiftEl.className = 'aria-mood-shift';
  shiftEl.textContent = meta.emoji + '  aria is ' + meta.label;
  msgs.appendChild(shiftEl);
}

function renderChatSuggestions(chips) {
  const el = document.getElementById('chatSuggestions');
  el.innerHTML = chips.map(c =>
    `<button class="chat-suggestion-chip" onclick="useSuggestion(this.textContent)">${c}</button>`
  ).join('');
}

function useSuggestion(text) {
  const input = document.getElementById('chatInput');
  input.value = text;
  chatInputResize(input);
  sendChatMessage();
}

function chatInputResize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}

function chatKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
}

function scrollChatToBottom() {
  const msgs = document.getElementById('chatMessages');
  msgs.scrollTop = msgs.scrollHeight;
}

function now12h() {
  const d = new Date();
  let h = d.getHours(); const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return h + ':' + String(m).padStart(2,'0') + ' ' + ampm;
}

// ═══════════════════════════════════════════════════

function quickTone(el) {
  document.querySelectorAll('.tone-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  const tone = el.dataset.tone;
  currentTone = tone;
  // Update tone modal selection too
  document.querySelectorAll('.tone-card').forEach(c => {
    c.classList.toggle('active', c.dataset.tone === tone);
  });
  if (currentReplies.length > 0) {
    showToast('tone changed — tap retry ↺ to regenerate');
  }
}

// ═══════════════════════════════════════════════════
// FEATURE 6: ARIA MOOD / GLOW INDICATOR
// ═══════════════════════════════════════════════════

const MOOD_GLOW = {
  chill:  'rgba(244,114,182,0.3)',
  hype:   'rgba(251,191,36,0.5)',
  deep:   'rgba(96,165,250,0.4)',
  funny:  'rgba(167,139,250,0.45)',
  busy:   'rgba(52,211,153,0.4)',
  petty:  'rgba(244,63,94,0.45)',
};

const MOOD_FILTER = {
  chill:  'none',
  hype:   'saturate(1.4) brightness(1.1)',
  deep:   'hue-rotate(20deg) saturate(0.9)',
  funny:  'hue-rotate(-15deg) saturate(1.2)',
  busy:   'saturate(1.1)',
  petty:  'hue-rotate(10deg) saturate(1.3)',
};

function applyMoodGlow(mood) {
  const glow = MOOD_GLOW[mood] || MOOD_GLOW.chill;
  const filter = MOOD_FILTER[mood] || 'none';
  document.querySelectorAll('img.aria-orb, img.aria-mini').forEach(img => {
    img.style.boxShadow = `0 0 30px ${glow}, 0 0 60px ${glow.replace('0.', '0.0')}`;
    img.style.filter = filter;
    img.style.transition = 'box-shadow 0.6s ease, filter 0.6s ease';
  });
}

// ═══════════════════════════════════════════════════
// FEATURE 7: DID IT WORK? FOLLOW-UP NUDGE
// ═══════════════════════════════════════════════════

let followupTimer = null;
let followupContactName = '';

function scheduleFollowup(contactName) {
  followupContactName = contactName;
  if (followupTimer) clearTimeout(followupTimer);
  // Show nudge 8 seconds after copy (simulating "enough time has passed")
  followupTimer = setTimeout(() => {
    const nudge = document.getElementById('followupNudge');
    const textEl = document.getElementById('followupText');
    if (nudge && textEl) {
      textEl.textContent = `hey — how'd that go with ${contactName}?`;
      nudge.classList.add('visible');
    }
  }, 8000);
}

async function followupRate(rating) {
  const nudge = document.getElementById('followupNudge');
  nudge.classList.remove('visible');

  if (currentUserId) {
    db.from('followup_ratings').insert({
      user_id:      currentUserId,
      contact_id:   currentContact?.id || null,
      rating,
      contact_name: currentContact?.name
    }).then(() => {}).catch(() => {});
    // DB trigger syncs rating back to contacts.last_rating automatically
  } else if (currentContact && rating) {
    currentContact.lastRating = rating;
    saveToLocalStorage();
  }

  const msgs = {
    good: ["okay i'm good 😌", "let's go 🔥", "that's what i'm here for"],
    meh:  ["noted. i'll tune it next time", "we'll get em next time", "fair enough"],
    bad:  ["oof 💀 noted. adjusting...", "okay adjusting my approach", "my bad. i'll do better"]
  };
  const list = msgs[rating] || msgs.meh;
  showToast(list[Math.floor(Math.random() * list.length)], rating === 'good' ? 'green' : '');
}

// ═══════════════════════════════════════════════════
// PRE-SEND MODE — "Don't send that"
// ═══════════════════════════════════════════════════

let presendMode = 'check'; // 'check' | 'fix' | 'roast'
let presendRewriteItems = [];
let presendActiveRewrite = 0;
let presendOriginalDraft = '';

function setPresendMode(mode, el) {
  presendMode = mode;
  document.querySelectorAll('.presend-mode-pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  // Update button label
  const btn = document.getElementById('psRunBtn');
  if (mode === 'check') btn.textContent = '🛑 let aria check it →';
  else if (mode === 'fix') btn.textContent = '✏️ check & rewrite it →';
  else btn.textContent = '🔥 be brutal →';
}

// Live word count
document.addEventListener('DOMContentLoaded', () => {
  const ta = document.getElementById('psDraftInput');
  if (ta) {
    ta.addEventListener('input', () => {
      const words = ta.value.trim().split(/\\s+/).filter(Boolean).length;
      document.getElementById('psCharHint').textContent = words + (words === 1 ? ' word' : ' words');
    });
  }
});

async function runPresend() {
  const draft = document.getElementById('psDraftInput').value.trim();
  const who = document.getElementById('psWhoInput').value.trim();
  const context = document.getElementById('psContextInput').value.trim();

  if (!draft) {
    showToast('paste your draft first');
    document.getElementById('psDraftInput').focus();
    return;
  }

  presendOriginalDraft = draft;

  const btn = document.getElementById('psRunBtn');
  btn.disabled = true;
  document.getElementById('psResult').style.display = 'none';
  document.getElementById('psThinking').style.display = 'flex';

  const modeInstructions = {
    check: 'Be honest but balanced. Flag issues, but also note what works.',
    fix:   'Be honest. Flag issues AND provide 3 rewritten versions that fix them.',
    roast: 'Be brutally honest. No softening. Call out every problem. Still provide 3 fixes.'
  }[presendMode];

  const includeRewrites = presendMode !== 'check';

  const prompt = `You are Aria, a sharp social AI. A user is about to send this message${who ? ' to ' + who : ''}:

DRAFT: "${draft}"${context ? '\\nCONTEXT: ' + context : ''}

Analyse this draft for: passive aggression they didn't notice, coming across as too available or desperate, an apology that buries their actual point, a joke that might not land, anything that could backfire or be misread.

${modeInstructions}

${includeRewrites ? `Include 3 rewritten versions with different approaches.` : ''}

Respond ONLY in this exact JSON (no markdown):
{
  "verdict": "send-it|pause|dont-send",
  "emoji": "emoji",
  "headline": "short punchy verdict",
  "sub": "1-sentence explanation",
  "flags": [
    {"icon": "emoji", "text": "observation", "severity": "watch|fix|good"}
  ],
  "ariaTake": "Aria's personal hot take in 1-2 sentences, honest and in character"${includeRewrites ? `,
  "rewrites": [
    {"label": "label", "text": "rewritten message"}
  ]` : ''}
}

Flags should be 2-5 items. Be specific to THIS draft, not generic.`;

  try {
    const data = await fetchReplyJSON('You are Aria, a sharp social analyst. Respond ONLY in valid JSON. No markdown.', prompt);
    if (data) renderPresendResult(data);
    else showToast('try again?');
  } catch(e) {
    console.error(e);
    showToast('something went wrong');
  }

  document.getElementById('psThinking').style.display = 'none';
  btn.disabled = false;
}

function renderPresendResult(data) {
  const result = document.getElementById('psResult');

  // Verdict card
  const verdictCard = document.getElementById('psVerdictCard');
  const classMap = { 'send-it': 'send-it', 'pause': 'pause', 'dont-send': 'dont-send' };
  verdictCard.className = 'presend-verdict-card ' + (classMap[data.verdict] || 'pause');
  document.getElementById('psVerdictEmoji').textContent = data.emoji || '⚠️';
  document.getElementById('psVerdictLabel').textContent = ({
    'send-it': 'LOOKS GOOD',
    'pause': 'WAIT A SEC',
    'dont-send': 'DON\'T SEND THAT'
  })[data.verdict] || 'ARIA\'S TAKE';
  document.getElementById('psVerdictHeadline').textContent = data.headline || '';
  document.getElementById('psVerdictSub').textContent = data.sub || '';

  // Flags
  const flagsWrap = document.getElementById('psFlagsWrap');
  const flagsList = document.getElementById('psFlagsList');
  if (data.flags && data.flags.length) {
    flagsList.innerHTML = data.flags.map(f => `
      <div class="presend-flag-item">
        <span class="presend-flag-icon">${f.icon || '•'}</span>
        <span class="presend-flag-text">${f.text}</span>
        <span class="presend-flag-severity ${f.severity || 'watch'}">${f.severity || 'watch'}</span>
      </div>
    `).join('');
    flagsWrap.style.display = 'block';
  } else {
    flagsWrap.style.display = 'none';
  }

  // Aria's take
  const ariaTakeEl = document.getElementById('psAriaTake');
  if (data.ariaTake) {
    document.getElementById('psAriaTakeText').textContent = data.ariaTake;
    ariaTakeEl.style.display = 'block';
    ariaVoice.speak(data.ariaTake);
  } else {
    ariaTakeEl.style.display = 'none';
  }

  // Rewrites
  const rewriteWrap = document.getElementById('psRewriteWrap');
  const actionOriginal = document.getElementById('psActionOriginal');
  if (data.rewrites && data.rewrites.length) {
    presendRewriteItems = data.rewrites;
    presendActiveRewrite = 0;
    renderPresendRewrites(data.rewrites);
    rewriteWrap.style.display = 'block';
    actionOriginal.style.display = 'none';
  } else {
    rewriteWrap.style.display = 'none';
    actionOriginal.style.display = 'flex';
  }

  result.style.display = 'block';
  setTimeout(() => {
    verdictCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 200);
}

function renderPresendRewrites(rewrites) {
  const tabs = document.getElementById('psRewriteTabs');
  const items = document.getElementById('psRewriteItems');

  tabs.innerHTML = rewrites.map((r, i) => `
    <div class="presend-rewrite-tab ${i === 0 ? 'active' : ''}" onclick="switchPresendRewrite(${i}, this)">${r.label}</div>
  `).join('');

  items.innerHTML = rewrites.map((r, i) => `
    <div class="presend-rewrite-item ${i === 0 ? 'visible' : ''}" id="psRw_${i}">
      <div class="presend-rewrite-tone">${r.label.toUpperCase()}</div>
      ${r.text}
    </div>
  `).join('');
}

function switchPresendRewrite(idx, el) {
  presendActiveRewrite = idx;
  document.querySelectorAll('.presend-rewrite-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.presend-rewrite-item').forEach((item, i) => {
    item.classList.toggle('visible', i === idx);
  });
}

function copyPresendRewrite() {
  const item = presendRewriteItems[presendActiveRewrite];
  if (!item) return;
  navigator.clipboard.writeText(item.text).then(() => {
    const btn = document.getElementById('psCopyRewriteBtn');
    btn.textContent = '✓ copied';
    setTimeout(() => { btn.textContent = 'copy rewrite →'; }, 2500);
    showToast('rewrite copied ✓', 'green');
  });
}

function copyPresendOriginal() {
  navigator.clipboard.writeText(presendOriginalDraft).then(() => {
    showToast('copied — go send it 🚀', 'green');
  });
}

// ═══════════════════════════════════════════════════
// FEATURE 8: REPLY QUEUE (swipeable stack)
// ═══════════════════════════════════════════════════

let queueContacts = [];
let queueIdx = 0;
let queueDragStart = null;
let queueDragX = 0;

function renderQueue() {
  queueContacts = contacts.filter(c => c.silent && c.silentHours > 0)
    .sort((a, b) => b.silentHours - a.silentHours);

  const stack = document.getElementById('queueStack');
  const actions = document.getElementById('queueActions');
  const sub = document.getElementById('queueSub');

  if (!queueContacts.length) {
    stack.innerHTML = `<div class="queue-empty"><div class="queue-empty-icon">✅</div><div class="queue-empty-text">you're all caught up!<br>no one left on read.</div></div>`;
    actions.style.display = 'none';
    sub.textContent = "you're all good";
    return;
  }

  sub.textContent = `${queueContacts.length} waiting · swipe right to reply`;
  actions.style.display = 'flex';
  queueIdx = 0;

  // Render top 3 cards (stack effect)
  const colorMap = { rose:'#f472b6', blue:'#60a5fa', green:'#34d399', purple:'#a78bfa', amber:'#fbbf24' };
  const visible = queueContacts.slice(0, 3);

  stack.innerHTML = visible.map((c, i) => `
    <div class="queue-card ${i === 0 ? 'top' : ''}" id="qcard-${c.id}" data-id="${c.id}">
      <div class="queue-card-contact">
        <div class="queue-card-avatar" style="background:${colorMap[c.color] || '#f472b6'}22;color:${colorMap[c.color] || '#f472b6'};border:2px solid ${colorMap[c.color] || '#f472b6'}44;">${c.initials || c.name[0]}</div>
        <div>
          <div class="queue-card-name">${c.name}</div>
          <div class="queue-card-time">${c.relationship || 'contact'} · ${c.silentHours}h ago</div>
        </div>
      </div>
      <div class="queue-card-msg">"${c.preview || 'no preview'}"</div>
      <div class="queue-card-platform">${c.platform || 'unknown platform'}</div>
    </div>
  `).join('');

  attachQueueDrag();
}

function attachQueueDrag() {
  const topCard = document.querySelector('.queue-card.top');
  if (!topCard) return;

  let startX = 0, startY = 0, currentX = 0;
  let isDragging = false;

  const onStart = (e) => {
    isDragging = true;
    startX = e.touches ? e.touches[0].clientX : e.clientX;
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    topCard.style.transition = 'none';
  };

  const onMove = (e) => {
    if (!isDragging) return;
    currentX = (e.touches ? e.touches[0].clientX : e.clientX) - startX;
    const rotate = currentX * 0.08;
    topCard.style.transform = `translateX(${currentX}px) rotate(${rotate}deg)`;
    if (currentX > 40) topCard.classList.add('swiping-right');
    else if (currentX < -40) topCard.classList.add('swiping-left');
    else { topCard.classList.remove('swiping-right', 'swiping-left'); }
  };

  const onEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    topCard.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
    if (currentX > 80) {
      topCard.style.transform = `translateX(110%) rotate(20deg)`;
      topCard.style.opacity = '0';
      setTimeout(() => queueReply(), 300);
    } else if (currentX < -80) {
      topCard.style.transform = `translateX(-110%) rotate(-20deg)`;
      topCard.style.opacity = '0';
      setTimeout(() => queueSnooze(), 300);
    } else {
      topCard.style.transform = '';
      topCard.classList.remove('swiping-right', 'swiping-left');
    }
    currentX = 0;
  };

  topCard.addEventListener('touchstart', onStart, { passive: true });
  topCard.addEventListener('touchmove', onMove, { passive: true });
  topCard.addEventListener('touchend', onEnd);
  topCard.addEventListener('mousedown', onStart);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onEnd);
}

function queueReply() {
  const c = queueContacts[queueIdx];
  if (!c) return;
  selectContact(c.id);
}

function queueSnooze() {
  queueContacts.splice(queueIdx, 1);
  showToast('snoozed 😴');
  renderQueue();
}

// ═══════════════════════════════════════════════════
// ARIA MEMORY SCREEN
// ═══════════════════════════════════════════════════

function humanizeMemoryEntry(cat, key, value) {
  if (cat === 'writing_style') {
    if (key === 'uses_capitals')    return value === 'yes' ? 'Capitalises your sentences' : "Doesn't capitalise — lowercase is the vibe";
    if (key === 'uses_punctuation') return value === 'yes' ? 'Punctuation included' : 'No punctuation — straight and raw';
    if (key === 'uses_emoji')       return value === 'yes' ? 'Emoji user ✓' : 'Emoji-free — words only';
    if (key === 'slang_vocabulary') return `Your slang: ${value}`;
  }
  if (cat === 'patterns') {
    if (key === 'preferred_tone')      return `Naturally leans ${value}`;
    if (key === 'preferred_platform')  return `Texts most on ${value}`;
    if (key === 'most_used_platform')  return `Most active on ${value}`;
    if (key === 'total_replies_sent')  return `${value} message${value === '1' ? '' : 's'} crafted with me`;
    if (key === 'regen_count')         return `Rerolled ${value} time${value === '1' ? '' : 's'} — a perfectionist, noted`;
    if (key.startsWith('tone_') && key.endsWith('_count'))     return null;
    if (key.startsWith('platform_') && key.endsWith('_count')) return null;
  }
  if (cat === 'emotional') {
    if (key === 'current_mood_pattern') return value.charAt(0).toUpperCase() + value.slice(1);
    return value;
  }
  if (cat === 'chat' || cat === 'facts' || cat === 'relationships') {
    return value; // already human-readable — these are the gold
  }
  // fallback
  const label = key.replace(/_/g, ' ');
  return `${label}: ${value}`;
}

function renderMemoryScreen() {
  const body = document.getElementById('memoryBody');
  const statusEl = document.getElementById('memoryStatus');
  const sqlNotice = document.getElementById('memorySqlNotice');

  if (!currentUserId) {
    statusEl.textContent = '● not signed in';
    body.innerHTML = `<div class="memory-empty"><div class="memory-empty-icon">🔐</div><div>Sign in and I'll actually remember you next time.<br><br>I'm still picking things up this session — I just won't be able to hold onto them.</div></div>`;
    sqlNotice.style.display = 'none';
    return;
  }

  if (!ariaMemory.isTableAvailable()) {
    statusEl.textContent = '● setup needed';
    sqlNotice.style.display = 'block';
    body.innerHTML = `<div class="memory-empty"><div class="memory-empty-icon">⚠️</div><div>Run the SQL above in your Supabase editor and I'll have a place to store everything I pick up about you.</div></div>`;
    return;
  }

  sqlNotice.style.display = 'none';
  const all = ariaMemory.getAll();

  // Collect ALL renderable points across every category
  const personalFacts = [];   // chat / facts / relationships — shown first, big
  const stylePoints   = [];   // writing_style
  const patternPoints = [];   // patterns
  const emotionPoints = [];   // emotional

  for (const [cat, entries] of Object.entries(all)) {
    for (const [key, mem] of Object.entries(entries)) {
      const label = humanizeMemoryEntry(cat, key, mem.value);
      if (!label) continue;
      const point = { label, source: mem.source, confidence: mem.confidence || 0.7 };
      if (cat === 'chat' || cat === 'facts' || cat === 'relationships') personalFacts.push(point);
      else if (cat === 'writing_style') stylePoints.push(point);
      else if (cat === 'patterns')      patternPoints.push(point);
      else if (cat === 'emotional')     emotionPoints.push(point);
    }
  }

  const totalPoints = personalFacts.length + stylePoints.length + patternPoints.length + emotionPoints.length;

  if (!totalPoints) {
    statusEl.textContent = '● still watching';
    body.innerHTML = `<div class="memory-empty"><div class="memory-empty-icon">🌱</div><div>Nothing filed away yet. Send a few messages, tell me about your life — I'll start building the picture.</div></div>`;
    return;
  }

  statusEl.textContent = `● ${totalPoints} thing${totalPoints === 1 ? '' : 's'} noted`;

  function renderSection(title, points, emptySkip = true) {
    if (!points.length) return emptySkip ? '' : '';
    return `
      <div class="memory-section">
        <div class="memory-section-label">
          <span>${title}</span>
          <span class="memory-count-badge">${points.length}</span>
        </div>
        ${points.map(p => `
          <div class="memory-card">
            <div class="memory-card-value">${p.label}</div>
            <div class="memory-card-meta">
              <span class="memory-card-source ${p.source}">${p.source}</span>
              <div class="memory-confidence-bar">
                <div class="memory-confidence-fill" style="width:${Math.round(p.confidence * 100)}%"></div>
              </div>
              <span style="font-size:10px;color:var(--muted)">${Math.round(p.confidence * 100)}%</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  body.innerHTML =
    renderSection('🧠 WHAT I KNOW ABOUT YOU', personalFacts) +
    renderSection('✍️ HOW YOU WRITE', stylePoints) +
    renderSection('📊 HOW YOU OPERATE', patternPoints) +
    renderSection('💫 YOUR ENERGY', emotionPoints);
}

async function forceMemoryLearn() {
  showToast('going back through everything…');
  await ariaMemory.learnWritingStyle();
  await ariaMemory.learnFromHistory(replyHistory);
  await ariaMemory.load();
  renderMemoryScreen();
  showToast('memory updated ✓', 'green');
}

