/**
 * ARIA CHAT ATTACHMENTS + ENHANCED INPUT
 * ─────────────────────────────────────────────────────────────────────────────
 * Features:
 *   • + button     → file picker (images, docs, audio, PDF — up to 3 at once)
 *   • mic icon     → speech-to-text with live transcript + visible stop bar
 *   • waveform btn → send (when content present) / aria voice toggle
 *
 * Attachment behaviour:
 *   • Images       → vision API via window.fetchReply; Aria reads contextually
 *   • Non-images   → Aria acknowledges; user can ask for more later
 *   • Max 3 files per message
 *   • Preview: horizontal scroll strip (thumbnails for images, pills for files)
 *   • Chat history: image bubbles inline, files as pill/chip with icon
 *
 * Security:
 *   • Blocks executables (EXE, ELF, Mach-O, Java), script injection, polyglots
 *   • Allows images, PDFs, audio, text, office docs
 *   • 20 MB per file limit
 *
 * Integrates with aria-app.js: window.fetchReply, window.chatHistory,
 *   appendAriaMessage, appendUserMessage, chatIsTyping,
 *   ARIA_CHAT_SYSTEM, getAriaMemoryContext, sendChatMessage
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════════════
     1. FILE SECURITY SCANNER
     ═══════════════════════════════════════════════════════════════════════════ */

  const AriaFileScanner = (() => {

    const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

    const ALLOWED_MIME_PREFIXES = [
      'image/',
      'audio/',
      'video/',
      'text/',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument',
      'application/vnd.ms-',
      'application/rtf',
      'application/json',
    ];

    // Always block these — regardless of extension
    const DANGEROUS_SIGNATURES = [
      { name: 'Windows PE',     offset: 0, bytes: [0x4D, 0x5A] },
      { name: 'ELF binary',     offset: 0, bytes: [0x7F, 0x45, 0x4C, 0x46] },
      { name: 'Mach-O',         offset: 0, bytes: [0xCE, 0xFA, 0xED, 0xFE] },
      { name: 'Mach-O 64',      offset: 0, bytes: [0xCF, 0xFA, 0xED, 0xFE] },
      { name: 'Java class',     offset: 0, bytes: [0xCA, 0xFE, 0xBA, 0xBE] },
      { name: 'Python bytecode',offset: 0, bytes: [0x6F, 0x0D, 0x0D, 0x0A] },
      { name: 'RAR archive',    offset: 0, bytes: [0x52, 0x61, 0x72, 0x21] },
    ];
    // NOTE: ZIP/PDF NOT in dangerous list — office docs are ZIP-based, PDFs are %PDF

    const IMAGE_SIGNATURES = [
      [0xFF, 0xD8, 0xFF],
      [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
      [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
      [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
      [0x52, 0x49, 0x46, 0x46],
      [0x42, 0x4D],
    ];

    const TEXT_DANGER_PATTERNS = [
      /<script[\s>]/i, /<\/script>/i,
      /javascript\s*:/i, /eval\s*\(\s*['"`]/i,
      /document\.cookie/i, /window\.location\s*=/i,
      /<!DOCTYPE\s+html/i, /<html[\s>]/i,
      /ignore\s+(all\s+)?(previous|above|prior)\s+instructions?/i,
      /you\s+are\s+now\s+(?:a|an)\s/i,
      /system\s+prompt\s*:/i,
      /forget\s+everything\s+(?:i|you)/i,
    ];

    function readAllBytes(file) {
      return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = e => res(new Uint8Array(e.target.result));
        r.onerror = () => rej(new Error('read error'));
        r.readAsArrayBuffer(file);
      });
    }

    function matchBytes(buf, offset, expected) {
      if (buf.length < offset + expected.length) return false;
      return expected.every((b, i) => buf[offset + i] === b);
    }

    function toText(buf, start, end) {
      return new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(start, end));
    }

    function looksLikeText(buf, start, end) {
      const sl = buf.slice(start, end);
      let p = 0;
      for (let i = 0; i < sl.length; i++) {
        const b = sl[i];
        if ((b >= 0x20 && b <= 0x7E) || b === 0x09 || b === 0x0A || b === 0x0D) p++;
      }
      return sl.length > 0 && p / sl.length > 0.60;
    }

    function mimeAllowed(mime) {
      const m = (mime || '').toLowerCase().trim();
      return ALLOWED_MIME_PREFIXES.some(p => m.startsWith(p));
    }

    async function scan(file) {
      if (file.size === 0)                  return { safe: false, reason: 'file is empty' };
      if (file.size > MAX_FILE_SIZE_BYTES)  return { safe: false, reason: 'file too large (max 20 MB)' };

      const mime = (file.type || '').toLowerCase().trim();
      if (!mimeAllowed(mime))               return { safe: false, reason: `file type not supported (${mime || 'unknown'})` };

      let buf;
      try { buf = await readAllBytes(file); }
      catch { return { safe: true, reason: 'scan skipped' }; }

      for (const sig of DANGEROUS_SIGNATURES) {
        if (matchBytes(buf, sig.offset, sig.bytes))
          return { safe: false, reason: `blocked: ${sig.name}` };
      }

      if (mime.startsWith('image/') && mime !== 'image/svg+xml') {
        const valid = IMAGE_SIGNATURES.some(sig => matchBytes(buf, 0, sig));
        if (!valid) {
          const head = toText(buf, 0, Math.min(buf.length, 512));
          if (/<script/i.test(head) || /<!DOCTYPE\s+html/i.test(head))
            return { safe: false, reason: 'blocked: script in image file' };
          return { safe: false, reason: 'blocked: invalid image signature' };
        }
      }

      if (mime === 'image/svg+xml') {
        const text = toText(buf, 0, buf.length);
        for (const p of TEXT_DANGER_PATTERNS)
          if (p.test(text)) return { safe: false, reason: 'blocked: SVG contains script' };
      }

      if (mime.startsWith('text/')) {
        const text = toText(buf, 0, Math.min(buf.length, 8192));
        for (const p of TEXT_DANGER_PATTERNS)
          if (p.test(text)) return { safe: false, reason: 'blocked: script in text file' };
      }

      // Polyglot tail scan — images only
      if (mime.startsWith('image/')) {
        const tailStart = Math.max(0, buf.length - 4096);
        if (looksLikeText(buf, tailStart, buf.length)) {
          const tail = toText(buf, tailStart, buf.length);
          for (const p of TEXT_DANGER_PATTERNS)
            if (p.test(tail)) return { safe: false, reason: 'blocked: polyglot attack' };
        }
      }

      return { safe: true, reason: 'ok' };
    }

    return { scan };
  })();


  /* ═══════════════════════════════════════════════════════════════════════════
     2. FILE TYPE HELPERS
     ═══════════════════════════════════════════════════════════════════════════ */

  function getFileCategory(file) {
    const m = (file.type || '').toLowerCase();
    if (m.startsWith('image/'))         return 'image';
    if (m.startsWith('audio/'))         return 'audio';
    if (m.startsWith('video/'))         return 'video';
    if (m === 'application/pdf')        return 'pdf';
    if (m.startsWith('text/'))          return 'text';
    if (m.includes('word') || m.includes('document'))    return 'doc';
    if (m.includes('sheet') || m.includes('excel'))      return 'sheet';
    if (m.includes('presentation') || m.includes('powerpoint')) return 'slides';
    return 'file';
  }

  const FILE_ICONS = { audio:'🎵', video:'🎬', pdf:'📄', text:'📝', doc:'📝', sheet:'📊', slides:'📑', file:'📎' };

  function getFileIcon(file) { return FILE_ICONS[getFileCategory(file)] || '📎'; }

  function fmtSize(bytes) {
    if (bytes < 1024)     return bytes + ' B';
    if (bytes < 1048576)  return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function truncate(str, max) {
    if (str.length <= max) return str;
    const ext = str.lastIndexOf('.');
    if (ext > 0) return str.slice(0, max - 3 - (str.length - ext)) + '…' + str.slice(ext);
    return str.slice(0, max) + '…';
  }

  function buildFilePrompt(file, caption) {
    const cat  = getFileCategory(file);
    const base = caption
      ? `The user shared a ${cat} file called "${file.name}" (${fmtSize(file.size)}) with the message: "${caption}".`
      : `The user shared a ${cat} file called "${file.name}" (${fmtSize(file.size)}).`;
    return base + ' Acknowledge it naturally as Aria — you can\'t read it yet, but let them know you have it and they can ask you to do something with it.';
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     3. STATE
     ═══════════════════════════════════════════════════════════════════════════ */

  let pendingAttachments = [];  // { dataUrl|null, file, category }
  let speechRecognition  = null;
  let isListening        = false;
  const MAX_ATTACHMENTS  = 3;


  /* ═══════════════════════════════════════════════════════════════════════════
     4. INJECT UI
     ═══════════════════════════════════════════════════════════════════════════ */

  function injectEnhancedInputUI() {
    const bar = document.querySelector('#chatScreen .chat-input-bar') ||
                document.querySelector('.chat-input-bar');
    if (!bar || bar.querySelector('.chat-attach-btn')) return;

    const suggestionsEl = bar.querySelector('#chatSuggestions');
    const inputRow      = bar.querySelector('.chat-input-row');
    if (!inputRow) return;
    const textarea = inputRow.querySelector('#chatInput');
    if (!textarea) return;

    textarea.placeholder = 'Chat with Aria…';
    textarea.style.cssText = 'flex:1;min-height:36px;max-height:130px;resize:none;background:transparent;border:none;outline:none;color:var(--text,#e8e3f0);font-size:15px;font-family:"DM Sans",sans-serif;line-height:1.45;padding:6px 0;caret-color:var(--green,#34d399);';

    inputRow.innerHTML = '';
    inputRow.style.cssText = 'display:flex;align-items:flex-end;gap:8px;padding:0;';

    // ── attach button ─────────────────────────────────────────────────────────
    const attachBtn = document.createElement('button');
    attachBtn.className = 'chat-attach-btn';
    attachBtn.title = 'Attach file';
    attachBtn.setAttribute('aria-label', 'Attach file');
    attachBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
    _btnBase(attachBtn, '34px');

    // ── file input — on bar (outside inputRow) so innerHTML clears never kill it ──
    if (!bar.querySelector('#chatFileInput')) {
      const fi = document.createElement('input');
      fi.type     = 'file';
      fi.id       = 'chatFileInput';
      fi.multiple = true;
      fi.accept   = 'image/*,audio/*,video/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.*,application/vnd.ms-excel,application/vnd.ms-powerpoint,text/plain,text/csv,text/markdown,application/json,application/rtf';
      fi.style.display = 'none';
      fi.setAttribute('aria-hidden', 'true');
      fi.addEventListener('change', handleFilesSelected);
      bar.appendChild(fi);
    }

    attachBtn.addEventListener('click', () => {
      if (pendingAttachments.length >= MAX_ATTACHMENTS) {
        if (typeof showToast === 'function') showToast(`max ${MAX_ATTACHMENTS} files per message`);
        return;
      }
      const fi = document.getElementById('chatFileInput');
      if (fi) { fi.value = ''; fi.click(); }
    });

    // ── mic button ────────────────────────────────────────────────────────────
    const micBtn = document.createElement('button');
    micBtn.className = 'chat-mic-btn';
    micBtn.title = 'Tap to speak';
    micBtn.setAttribute('aria-label', 'Voice input');
    micBtn.setAttribute('data-idle-title',      'Tap to speak');
    micBtn.setAttribute('data-recording-title', 'Tap to stop');
    micBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
    _btnBase(micBtn, '34px');
    micBtn.addEventListener('click', toggleSpeechInput);

    // ── send / waveform button ────────────────────────────────────────────────
    const sendBtn = document.createElement('button');
    sendBtn.className = 'chat-wave-btn';
    sendBtn.id        = 'chatSendBtn';
    sendBtn.setAttribute('aria-label', 'Send');
    sendBtn.innerHTML = _waveformSVG();
    sendBtn.style.cssText = 'flex-shrink:0;width:40px;height:40px;border-radius:50%;border:none;background:var(--card2,rgba(255,255,255,0.06));color:var(--text,#e8e3f0);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background 0.18s,color 0.18s,transform 0.12s;-webkit-tap-highlight-color:transparent;';
    sendBtn.addEventListener('click', onSendClick);

    inputRow.appendChild(attachBtn);
    inputRow.appendChild(textarea);
    inputRow.appendChild(micBtn);
    inputRow.appendChild(sendBtn);

    textarea.addEventListener('input',   updateSendBtnState);
    textarea.addEventListener('keydown', e => {
      if (typeof window.chatKeyDown === 'function') window.chatKeyDown(e);
      updateSendBtnState();
    });

    _ensureAttachPreview(bar, suggestionsEl);
    _ensureMicBar(bar, inputRow);
    _injectStyles();
    updateSendBtnState();
  }

  function _btnBase(btn, size) {
    btn.style.cssText = `flex-shrink:0;width:${size};height:${size};border-radius:50%;border:none;background:none;color:var(--muted,rgba(255,255,255,0.4));display:flex;align-items:center;justify-content:center;cursor:pointer;transition:color 0.18s,background 0.18s;-webkit-tap-highlight-color:transparent;`;
  }

  function _waveformSVG() {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="2" y1="12" x2="2" y2="12"/><line x1="5" y1="9" x2="5" y2="15"/><line x1="8" y1="6" x2="8" y2="18"/><line x1="11" y1="4" x2="11" y2="20"/><line x1="14" y1="6" x2="14" y2="18"/><line x1="17" y1="9" x2="17" y2="15"/><line x1="20" y1="12" x2="20" y2="12"/></svg>`;
  }

  function _sendArrowSVG() {
    return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 14V4M9 4L4.5 8.5M9 4L13.5 8.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     5. SEND BUTTON STATE
     ═══════════════════════════════════════════════════════════════════════════ */

  function updateSendBtnState() {
    const btn   = document.getElementById('chatSendBtn');
    const input = document.getElementById('chatInput');
    if (!btn) return;
    const active = (input && input.value.trim().length > 0) || pendingAttachments.length > 0;
    btn.innerHTML = active ? _sendArrowSVG() : _waveformSVG();
    btn.style.background  = active ? 'linear-gradient(135deg,#34d399,#10b981)' : 'var(--card2,rgba(255,255,255,0.06))';
    btn.style.color       = active ? '#fff' : 'var(--text,#e8e3f0)';
    btn.style.transform   = active ? 'scale(1.05)' : 'scale(1)';
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     6. SEND CLICK
     ═══════════════════════════════════════════════════════════════════════════ */

  function onSendClick() {
    const input   = document.getElementById('chatInput');
    const hasText = input && input.value.trim().length > 0;
    if (pendingAttachments.length > 0) {
      sendWithAttachments();
    } else if (hasText && typeof window.sendChatMessage === 'function') {
      window.sendChatMessage();
      updateSendBtnState();
    }
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     7. ATTACH PREVIEW
     ═══════════════════════════════════════════════════════════════════════════ */

  function _ensureAttachPreview(bar, suggestionsEl) {
    if (bar.querySelector('#chatAttachPreview')) return;
    const strip = document.createElement('div');
    strip.id = 'chatAttachPreview';
    strip.style.cssText = 'display:none;padding:8px 14px 0;gap:8px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;';
    if (suggestionsEl) bar.insertBefore(strip, suggestionsEl);
    else               bar.insertBefore(strip, bar.firstChild);
  }

  function _refreshPreview() {
    const strip = document.getElementById('chatAttachPreview');
    if (!strip) return;
    if (!pendingAttachments.length) { strip.style.display = 'none'; strip.innerHTML = ''; return; }
    strip.style.display = 'flex';
    strip.innerHTML = '';

    pendingAttachments.forEach((att, idx) => {
      const thumb = document.createElement('div');
      thumb.className = 'aria-attach-thumb';

      if (att.category === 'image' && att.dataUrl) {
        const img = document.createElement('img');
        img.src = att.dataUrl; img.alt = att.file.name;
        thumb.appendChild(img);
      } else {
        const pill = document.createElement('div');
        pill.className = 'aria-thumb-pill';
        pill.innerHTML = `<span class="aria-thumb-icon">${getFileIcon(att.file)}</span><span class="aria-thumb-name">${truncate(att.file.name, 14)}</span><span class="aria-thumb-sz">${fmtSize(att.file.size)}</span>`;
        thumb.appendChild(pill);
      }

      const rm = document.createElement('button');
      rm.className = 'aria-thumb-rm'; rm.innerHTML = '×'; rm.setAttribute('aria-label','Remove');
      rm.addEventListener('click', () => { pendingAttachments.splice(idx, 1); _refreshPreview(); updateSendBtnState(); });
      thumb.appendChild(rm);
      strip.appendChild(thumb);
    });

    if (pendingAttachments.length > 1) {
      const badge = document.createElement('div');
      badge.className = 'aria-attach-badge';
      badge.textContent = `${pendingAttachments.length}/${MAX_ATTACHMENTS}`;
      strip.appendChild(badge);
    }
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     8. MIC BAR
     ═══════════════════════════════════════════════════════════════════════════ */

  function _ensureMicBar(bar, inputRow) {
    if (document.getElementById('ariaMicBar')) return;
    const mb = document.createElement('div');
    mb.id = 'ariaMicBar';
    mb.innerHTML = `<div class="mic-dot"></div><span id="ariaMicLabel">recording…</span><button class="mic-stop-btn" id="ariaMicStopBtn">stop</button>`;
    bar.insertBefore(mb, inputRow);
    document.getElementById('ariaMicStopBtn').addEventListener('click', toggleSpeechInput);
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     9. FILE SELECTION
     ═══════════════════════════════════════════════════════════════════════════ */

  async function handleFilesSelected(e) {
    // Capture BEFORE reset — Android fires second 'change' with empty list if reset first
    const files = Array.from(e.target.files || []);
    try { e.target.value = ''; } catch (_) {}
    if (!files.length) return;

    const bar   = document.querySelector('#chatScreen .chat-input-bar') || document.querySelector('.chat-input-bar');
    const slots = MAX_ATTACHMENTS - pendingAttachments.length;
    const batch = files.slice(0, slots);
    if (files.length > slots && typeof showToast === 'function')
      showToast(`only ${slots} more file${slots !== 1 ? 's' : ''} can be added`);

    // Scanning indicator
    const scanEl = document.createElement('div');
    scanEl.className = 'aria-scanning';
    scanEl.innerHTML = `<div class="aria-scan-dot"></div><div class="aria-scan-dot"></div><div class="aria-scan-dot"></div><span>scanning…</span>`;
    const preview = bar && bar.querySelector('#chatAttachPreview');
    if (bar) bar.insertBefore(scanEl, preview || bar.firstChild);

    const results = await Promise.all(batch.map(async file => {
      try   { return { file, ok: await AriaFileScanner.scan(file) }; }
      catch { return { file, ok: { safe: false, reason: 'scan error' } }; }
    }));

    scanEl.remove();

    let rejected = 0;
    for (const { file, ok } of results) {
      if (!ok.safe) { rejected++; console.warn('[Aria] Blocked:', ok.reason, file.name); continue; }
      const category = getFileCategory(file);
      if (category === 'image') {
        await new Promise(res => {
          const r = new FileReader();
          r.onload  = ev => { pendingAttachments.push({ dataUrl: ev.target.result, file, category }); res(); };
          r.onerror = ()  => { pendingAttachments.push({ dataUrl: null, file, category }); res(); };
          r.readAsDataURL(file);
        });
      } else {
        pendingAttachments.push({ dataUrl: null, file, category });
      }
    }

    if (rejected) _securityToast(`⚠ ${rejected} file${rejected > 1 ? 's' : ''} blocked for security`);
    _refreshPreview();
    updateSendBtnState();
  }

  function _securityToast(msg) {
    let t = document.getElementById('ariaSecToast');
    if (!t) {
      t = document.createElement('div'); t.id = 'ariaSecToast'; t.className = 'aria-sec-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._tmr); t._tmr = setTimeout(() => t.classList.remove('show'), 4000);
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     10. SEND WITH ATTACHMENTS
     ═══════════════════════════════════════════════════════════════════════════ */

  async function sendWithAttachments() {
    if (!pendingAttachments.length) return;

    const input       = document.getElementById('chatInput');
    const caption     = input ? input.value.trim() : '';
    const attachments = [...pendingAttachments];

    // Clear state immediately
    pendingAttachments = [];
    _refreshPreview();
    if (input) { input.value = ''; if (typeof chatInputResize === 'function') chatInputResize(input); }
    updateSendBtnState();

    const sendBtn = document.getElementById('chatSendBtn');
    if (sendBtn) sendBtn.disabled = true;
    if (typeof window.chatIsTyping !== 'undefined') window.chatIsTyping = true;

    // ── Render user-side bubbles ──────────────────────────────────────────────
    attachments.forEach(a => {
      if (a.category === 'image' && a.dataUrl) _appendImageBubble(a.dataUrl, '', 'user');
      else _appendFilePill(a.file, '', 'user');
    });
    if (caption) {
      const msgs = document.getElementById('chatMessages');
      if (msgs) {
        const wrap = document.createElement('div');
        wrap.className = 'chat-msg-user-wrap';
        const bub = document.createElement('div');
        bub.className = 'chat-bubble-user'; bub.textContent = caption;
        wrap.appendChild(bub); msgs.appendChild(wrap);
        if (typeof scrollChatToBottom === 'function') scrollChatToBottom();
      }
    }

    // ── History entry ─────────────────────────────────────────────────────────
    const names        = attachments.map(a => a.file.name).join(', ');
    const historyEntry = caption ? `[${names}] ${caption}` : `[${names}]`;
    if (Array.isArray(window.chatHistory))
      window.chatHistory.push({ role: 'user', content: historyEntry });

    // ── Typing bubble ─────────────────────────────────────────────────────────
    const msgs     = document.getElementById('chatMessages');
    const ariaWrap = document.createElement('div');
    ariaWrap.className = 'chat-msg-aria-wrap';
    ariaWrap.style.animation = 'slide-up 0.25s ease both';
    const ariaBubble = document.createElement('div');
    ariaBubble.className = 'chat-bubble-aria typing-bubble';
    ariaBubble.innerHTML = '<div class="chat-typing-dot"></div><div class="chat-typing-dot"></div><div class="chat-typing-dot"></div>';
    ariaWrap.appendChild(ariaBubble);
    if (msgs) msgs.appendChild(ariaWrap);
    if (typeof scrollChatToBottom === 'function') scrollChatToBottom();

    try {
      const memCtx    = typeof getAriaMemoryContext === 'function' ? await getAriaMemoryContext() : '';
      const sysPrompt = (typeof ARIA_CHAT_SYSTEM !== 'undefined' ? ARIA_CHAT_SYSTEM : '') +
                        (memCtx ? `\n\nWHAT YOU KNOW ABOUT THIS USER:\n${memCtx}` : '');

      let rawText;
      const images    = attachments.filter(a => a.category === 'image' && a.dataUrl);
      const nonImages = attachments.filter(a => a.category !== 'image');

      if (images.length > 0) {
        // ── Vision path ───────────────────────────────────────────────────────
        const img       = images[0];
        const mimeMatch = img.dataUrl.match(/^data:([^;]+);base64,/);
        const mimeType  = (mimeMatch && mimeMatch[1]) || 'image/jpeg';
        const b64       = img.dataUrl.split(',')[1];

        const extras = attachments.length > 1
          ? ` (also attached: ${attachments.slice(1).map(a => a.file.name).join(', ')})`
          : '';
        const promptText = caption
          ? `The user sent this image with the message: "${caption}"${extras}. Look at it carefully — read any text, understand the context — then respond naturally as Aria.`
          : `The user sent you this image${extras}. Look at it carefully — read any text, understand what it shows — respond naturally as Aria based on what you see.`;

        const visionContent = [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: b64 } },
          { type: 'text',  text: promptText }
        ];
        // window. prefix — strict-mode IIFE; fetchReply lives on window in aria-app.js
        rawText = await window.fetchReply(sysPrompt, visionContent, null);

      } else {
        // ── Non-image acknowledgement path ────────────────────────────────────
        let promptText = buildFilePrompt(nonImages[0].file, caption);
        if (nonImages.length > 1)
          promptText += ` They also attached: ${nonImages.slice(1).map(a => a.file.name).join(', ')}.`;
        rawText = await window.fetchReply(sysPrompt, promptText, null);
      }

      // ── Strip JSON envelope — same logic as sendChatMessage ───────────────
      let replyText   = (rawText || '').trim();
      let emotion     = 'neutral';
      let expressionTag = null;
      let suggestions   = [];

      replyText = replyText.replace(/^(okay|ok)[,.\s!]*/i, '').trim();

      if (replyText.startsWith('{')) {
        try {
          let depth = 0, end = -1;
          for (let i = 0; i < replyText.length; i++) {
            if      (replyText[i] === '{') depth++;
            else if (replyText[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
          }
          if (end !== -1) {
            const parsed = JSON.parse(replyText.slice(0, end + 1));
            if (parsed.emotion !== undefined) {
              emotion       = parsed.emotion    || 'neutral';
              expressionTag = parsed.expression || null;
              suggestions   = [parsed.suggestion1, parsed.suggestion2, parsed.suggestion3].filter(Boolean);
              replyText     = replyText.slice(end + 1).trim();
            }
          }
        } catch (_) { /* not JSON — render as-is */ }
      }

      // ── Render via appendAriaMessage ──────────────────────────────────────
      ariaBubble.remove();
      if (typeof appendAriaMessage === 'function') {
        appendAriaMessage(replyText, emotion, true, false, expressionTag);
      } else {
        ariaBubble.classList.remove('typing-bubble');
        ariaBubble.textContent = replyText;
        if (msgs && !ariaWrap.isConnected) msgs.appendChild(ariaWrap);
        if (typeof scrollChatToBottom === 'function') scrollChatToBottom();
      }

      if (suggestions.length && typeof window.renderChatSuggestions === 'function')
        window.renderChatSuggestions(suggestions);

      if (Array.isArray(window.chatHistory))
        window.chatHistory.push({ role: 'assistant', content: replyText });

      if (window.currentUserId && window.db) {
        window.db.from('chat_messages').insert([
          { user_id: window.currentUserId, role: 'user', content: historyEntry },
          { user_id: window.currentUserId, role: 'aria', content: replyText }
        ]).then(() => {}).catch(() => {});
      }

    } catch (err) {
      ariaBubble.classList.remove('typing-bubble');
      ariaBubble.textContent = 'something went wrong — try again?';
      console.error('[Aria] Attachment send error:', err);
    } finally {
      if (sendBtn) sendBtn.disabled = false;
      if (typeof window.chatIsTyping !== 'undefined') window.chatIsTyping = false;
      updateSendBtnState();
    }
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     11. CHAT BUBBLE RENDERERS
     ═══════════════════════════════════════════════════════════════════════════ */

  function _appendImageBubble(dataUrl, caption, side) {
    const msgs = document.getElementById('chatMessages');
    if (!msgs) return;
    const wrap = document.createElement('div');
    wrap.className = side === 'user' ? 'chat-msg-user-wrap' : 'chat-msg-aria-wrap';
    wrap.style.animation = 'slide-up 0.25s ease both';
    const row = document.createElement('div');
    row.className = side === 'user' ? 'chat-msg-user' : 'chat-msg-aria';
    const imgWrap = document.createElement('div');
    imgWrap.className = 'aria-img-bubble';
    const img = document.createElement('img');
    img.src = dataUrl; img.alt = caption || 'image'; img.loading = 'lazy';
    img.addEventListener('click', () => _lightbox(dataUrl));
    imgWrap.appendChild(img);
    row.appendChild(imgWrap);
    if (caption) {
      const c = document.createElement('div');
      c.className = side === 'user' ? 'chat-bubble-user' : 'chat-bubble-aria';
      c.textContent = caption; c.style.marginTop = '4px';
      row.appendChild(c);
    }
    wrap.appendChild(row);
    msgs.appendChild(wrap);
    if (typeof scrollChatToBottom === 'function') scrollChatToBottom();
  }

  function _appendFilePill(file, caption, side) {
    const msgs = document.getElementById('chatMessages');
    if (!msgs) return;
    const wrap = document.createElement('div');
    wrap.className = side === 'user' ? 'chat-msg-user-wrap' : 'chat-msg-aria-wrap';
    wrap.style.animation = 'slide-up 0.25s ease both';
    const row = document.createElement('div');
    row.className = side === 'user' ? 'chat-msg-user' : 'chat-msg-aria';
    const pill = document.createElement('div');
    pill.className = 'aria-file-pill';
    pill.innerHTML = `<span class="aria-file-pill-icon">${getFileIcon(file)}</span><div class="aria-file-pill-info"><span class="aria-file-pill-name">${truncate(file.name, 28)}</span><span class="aria-file-pill-size">${fmtSize(file.size)}</span></div>`;
    row.appendChild(pill);
    if (caption) {
      const c = document.createElement('div');
      c.className = side === 'user' ? 'chat-bubble-user' : 'chat-bubble-aria';
      c.textContent = caption; c.style.marginTop = '4px';
      row.appendChild(c);
    }
    wrap.appendChild(row);
    msgs.appendChild(wrap);
    if (typeof scrollChatToBottom === 'function') scrollChatToBottom();
  }

  function _lightbox(dataUrl) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:99999;cursor:zoom-out;animation:fadein 0.18s ease;';
    const img = document.createElement('img');
    img.src = dataUrl; img.style.cssText = 'max-width:92vw;max-height:88vh;border-radius:12px;object-fit:contain;';
    ov.appendChild(img); ov.addEventListener('click', () => ov.remove());
    document.body.appendChild(ov);
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     12. SPEECH TO TEXT
     ═══════════════════════════════════════════════════════════════════════════ */

  async function toggleSpeechInput() {
    const SR     = window.SpeechRecognition || window.webkitSpeechRecognition;
    const micBtn = document.querySelector('.chat-mic-btn');
    const micBar = document.getElementById('ariaMicBar');
    const micLbl = document.getElementById('ariaMicLabel');

    if (isListening) { if (speechRecognition) speechRecognition.stop(); return; }
    if (!SR) { if (typeof showToast === 'function') showToast('voice input not supported in this browser'); return; }

    // Permission warm-up — Android/iOS silent-fail fix
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch (_) {
      if (typeof showToast === 'function') showToast('microphone access denied — check browser settings');
      return;
    }

    speechRecognition = new SR();
    speechRecognition.lang            = navigator.language || 'en-US';
    speechRecognition.interimResults  = true;
    speechRecognition.maxAlternatives = 1;
    speechRecognition.continuous      = false;

    function setRec(active) {
      isListening = active;
      if (micBtn) {
        micBtn.classList.toggle('listening', active);
        micBtn.title       = active ? micBtn.getAttribute('data-recording-title') : micBtn.getAttribute('data-idle-title');
        micBtn.style.color = active ? '#f43f5e' : 'var(--muted,rgba(255,255,255,0.4))';
        micBtn.style.background = active ? 'rgba(244,63,94,0.12)' : 'none';
      }
      if (micBar) micBar.classList.toggle('active', active);
    }

    speechRecognition.onstart  = () => { setRec(true); if (micLbl) micLbl.textContent = 'recording…'; };
    speechRecognition.onresult = e => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else interim += t;
      }
      if (micLbl && interim) micLbl.textContent = interim;
      if (final) {
        const inp = document.getElementById('chatInput');
        if (inp) {
          const ex = inp.value.trimEnd();
          inp.value = ex ? ex + ' ' + final : final;
          if (typeof chatInputResize === 'function') chatInputResize(inp);
          updateSendBtnState();
        }
        if (micLbl) micLbl.textContent = 'recording…';
      }
    };
    speechRecognition.onerror = e => {
      setRec(false);
      const map = { 'not-allowed':'microphone access denied', 'no-speech':'no speech detected', 'network':'network error', 'audio-capture':'no microphone found' };
      if (typeof showToast === 'function') showToast(map[e.error] || `voice error: ${e.error}`);
    };
    speechRecognition.onend = () => setRec(false);

    try { speechRecognition.start(); }
    catch (err) {
      setRec(false);
      if (typeof showToast === 'function') showToast('could not start voice input');
      console.error('[Aria] SpeechRecognition start error:', err);
    }
  }
  window._ariaToggleSpeech = toggleSpeechInput;


  /* ═══════════════════════════════════════════════════════════════════════════
     13. STYLES
     ═══════════════════════════════════════════════════════════════════════════ */

  function _injectStyles() {
    if (document.getElementById('aria-attach-styles')) return;
    const s = document.createElement('style');
    s.id = 'aria-attach-styles';
    s.textContent = `
      #chatScreen .chat-input-bar {
        border-top:1px solid var(--border,rgba(255,255,255,0.07));
        background:var(--bg,#111118);padding:10px 14px 14px;
        border-radius:18px 18px 0 0;box-shadow:0 -4px 24px rgba(0,0,0,0.22);
      }
      #chatScreen .chat-input-row {
        background:var(--card2,rgba(255,255,255,0.06));border-radius:14px;
        padding:6px 10px 6px 14px;
        border:1px solid var(--border,rgba(255,255,255,0.07));transition:border-color 0.2s;
      }
      #chatScreen .chat-input-row:focus-within { border-color:rgba(52,211,153,0.3); }

      .chat-mic-btn.listening { animation:mic-pulse 1s ease-in-out infinite; }
      @keyframes mic-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(244,63,94,0.35)} 50%{box-shadow:0 0 0 6px rgba(244,63,94,0)} }

      #ariaMicBar { display:none;align-items:center;gap:8px;padding:6px 14px 0;font-size:12px;font-family:'DM Sans',sans-serif;color:#f43f5e;letter-spacing:0.3px;animation:fadein 0.18s ease; }
      #ariaMicBar.active { display:flex; }
      #ariaMicBar .mic-dot { width:7px;height:7px;border-radius:50%;background:#f43f5e;flex-shrink:0;animation:mic-blink 1s ease-in-out infinite; }
      @keyframes mic-blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
      #ariaMicLabel { flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
      .mic-stop-btn { margin-left:auto;flex-shrink:0;background:rgba(244,63,94,0.15);border:1px solid rgba(244,63,94,0.3);color:#f43f5e;border-radius:8px;padding:2px 10px;font-size:11px;font-family:'DM Sans',sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent; }

      #chatAttachPreview { scrollbar-width:none; }
      #chatAttachPreview::-webkit-scrollbar { display:none; }

      .aria-attach-thumb { position:relative;flex-shrink:0;width:64px;height:64px;border-radius:10px;overflow:hidden;border:1px solid var(--border,rgba(255,255,255,0.1));animation:thumb-in 0.2s ease both;background:var(--card2,rgba(255,255,255,0.06)); }
      @keyframes thumb-in { from{opacity:0;transform:scale(0.85)} to{opacity:1;transform:scale(1)} }
      .aria-attach-thumb img { width:100%;height:100%;object-fit:cover;display:block; }
      .aria-thumb-rm { position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,0.65);border:none;color:#fff;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;line-height:1; }

      .aria-thumb-pill { display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;padding:6px 4px;box-sizing:border-box;gap:2px; }
      .aria-thumb-icon { font-size:20px;line-height:1; }
      .aria-thumb-name { font-size:9px;color:var(--text,#e8e3f0);font-family:'DM Sans',sans-serif;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%; }
      .aria-thumb-sz { font-size:8px;color:var(--muted,rgba(255,255,255,0.4));font-family:'DM Sans',sans-serif; }
      .aria-attach-badge { align-self:center;flex-shrink:0;font-size:11px;color:var(--muted,rgba(255,255,255,0.4));font-family:'DM Sans',sans-serif;padding:0 4px; }

      .aria-img-bubble { max-width:220px;border-radius:14px;overflow:hidden;border:1px solid var(--border,rgba(255,255,255,0.1));cursor:pointer;transition:opacity 0.15s; }
      .aria-img-bubble:hover { opacity:0.88; }
      .aria-img-bubble img { width:100%;display:block; }

      .aria-file-pill { display:flex;align-items:center;gap:10px;background:var(--card2,rgba(255,255,255,0.07));border:1px solid var(--border,rgba(255,255,255,0.1));border-radius:12px;padding:10px 14px;max-width:240px; }
      .aria-file-pill-icon { font-size:22px;flex-shrink:0; }
      .aria-file-pill-info { display:flex;flex-direction:column;overflow:hidden; }
      .aria-file-pill-name { font-size:13px;font-family:'DM Sans',sans-serif;color:var(--text,#e8e3f0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
      .aria-file-pill-size { font-size:11px;color:var(--muted,rgba(255,255,255,0.4));font-family:'DM Sans',sans-serif;margin-top:1px; }

      .aria-scanning { display:flex;align-items:center;gap:6px;padding:6px 12px 0;font-size:11px;color:var(--muted,rgba(255,255,255,0.4));font-family:'DM Sans',sans-serif;letter-spacing:0.4px;animation:fadein 0.2s ease; }
      .aria-scan-dot { width:5px;height:5px;border-radius:50%;background:var(--green,#34d399);animation:scan-dot 0.8s ease-in-out infinite; }
      .aria-scan-dot:nth-child(2){animation-delay:0.2s} .aria-scan-dot:nth-child(3){animation-delay:0.4s}
      @keyframes scan-dot { 0%,100%{opacity:0.3;transform:scale(0.8)} 50%{opacity:1;transform:scale(1.2)} }

      .aria-sec-toast { position:fixed;bottom:100px;left:50%;transform:translateX(-50%) translateY(20px);background:rgba(244,63,94,0.92);color:#fff;padding:10px 18px;border-radius:12px;font-size:13px;font-family:'DM Sans',sans-serif;z-index:9999;opacity:0;transition:opacity 0.25s,transform 0.25s;max-width:300px;text-align:center;pointer-events:none; }
      .aria-sec-toast.show { opacity:1;transform:translateX(-50%) translateY(0); }

      @keyframes fadein { from{opacity:0} to{opacity:1} }
      @keyframes slide-up { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
    `;
    document.head.appendChild(s);
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     14. INIT
     ═══════════════════════════════════════════════════════════════════════════ */

  function hookInitChat() {
    const orig = window.initChat;
    window.initChat = function (...args) {
      if (orig) orig.apply(this, args);
      setTimeout(injectEnhancedInputUI, 50);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { hookInitChat(); });
  } else {
    hookInitChat();
  }

  // Also inject immediately if chatScreen is already visible
  const _tryNow = () => {
    const sc = document.getElementById('chatScreen');
    if (sc && sc.style.display !== 'none') injectEnhancedInputUI();
  };
  _tryNow();
  setTimeout(_tryNow, 300);

  window.AriaFileScanner        = AriaFileScanner;
  window.ariaInjectChatInput    = injectEnhancedInputUI;

})();
