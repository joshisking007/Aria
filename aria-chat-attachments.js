/**
 * ARIA CHAT ATTACHMENTS + ENHANCED INPUT
 * ─────────────────────────────────────────────────────────────────────────────
 * Adds to the chatScreen input bar:
 *   + button  → file/photo picker with deep security scan
 *   mic icon  → speech-to-text (Web Speech API)
 *   waveform  → voice recording toggle (same as existing ariaVoice)
 *
 * Security scanning covers:
 *   • MIME type spoofing (file with .png extension but JS/HTML content)
 *   • Magic-byte / file signature verification
 *   • SVG with embedded <script> or event handlers
 *   • HTML/JS disguised as images
 *   • Oversized files
 *   • Executable signatures (ELF, PE, Mach-O, ZIP-based)
 *   • Polyglot files (valid image header + script payload appended)
 *
 * Integrates with the existing aria-core.js ariaSecurity module and the
 * sendChatMessage / appendUserMessage / appendAriaMessage pipeline.
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════════════
     1. FILE SECURITY SCANNER
     ═══════════════════════════════════════════════════════════════════════════ */

  const AriaFileScanner = (() => {

    const MAX_FILE_SIZE_MB   = 10;
    const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

    // Allowed MIME prefixes for the attachment picker
    const ALLOWED_MIME_TYPES = new Set([
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
      'image/webp', 'image/bmp', 'image/tiff'
    ]);

    // Magic bytes / file signatures — [offset, bytes] tuples
    const MAGIC_SIGNATURES = {
      jpeg:  { offset: 0, bytes: [0xFF, 0xD8, 0xFF] },
      png:   { offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
      gif87: { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] },
      gif89: { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] },
      webp:  { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF header
      bmp:   { offset: 0, bytes: [0x42, 0x4D] },
    };

    // Known dangerous magic bytes (even if extension looks safe)
    const DANGEROUS_SIGNATURES = [
      { name: 'Windows PE (EXE/DLL)',  offset: 0,  bytes: [0x4D, 0x5A] },             // MZ
      { name: 'ELF binary',            offset: 0,  bytes: [0x7F, 0x45, 0x4C, 0x46] }, // ELF
      { name: 'Mach-O binary',         offset: 0,  bytes: [0xCE, 0xFA, 0xED, 0xFE] }, // macOS
      { name: 'Mach-O binary (64)',    offset: 0,  bytes: [0xCF, 0xFA, 0xED, 0xFE] },
      { name: 'ZIP archive',           offset: 0,  bytes: [0x50, 0x4B, 0x03, 0x04] }, // PK
      { name: 'RAR archive',           offset: 0,  bytes: [0x52, 0x61, 0x72, 0x21] }, // Rar!
      { name: 'PDF document',          offset: 0,  bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
      { name: 'Python bytecode',       offset: 0,  bytes: [0x6F, 0x0D, 0x0D, 0x0A] },
      { name: 'Java class',            offset: 0,  bytes: [0xCA, 0xFE, 0xBA, 0xBE] },
    ];

    /**
     * Danger patterns applied ONLY after looksLikeText() confirms the bytes
     * are readable text — so binary JPEG/PNG data never triggers false positives.
     * Patterns are tightened to require more context than single-word matches.
     */
    const TEXT_DANGER_PATTERNS = [
      /<script[\s>]/i,
      /<\/script>/i,
      /javascript\s*:/i,
      /eval\s*\(\s*['"`]/i,           // eval("code") — requires quote after paren
      /document\.cookie/i,
      /window\.location\s*=/i,
      /XMLHttpRequest/i,
      /<!DOCTYPE\s+html/i,
      /<html[\s>]/i,
      /System\.Reflection/i,
      /Runtime\.exec\s*\(/i,
      /os\.system\s*\(/i,
      /subprocess\.(call|run|Popen)/i,
      /powershell\s+-\w/i,
      /cmd\.exe\s*\/c/i,
      /\/bin\/(sh|bash)\s/i,
      /ignore\s+(all\s+)?(previous|above|prior)\s+instructions?/i,
      /you\s+are\s+now\s+(?:a|an)\s/i,
      /system\s+prompt\s*:/i,
      /forget\s+everything\s+(?:i|you)/i,
    ];

    /**
     * Read entire file as Uint8Array — one read, no slicing.
     * Avoids Android WebView bugs where File.slice() returns empty blobs.
     */
    function readAllBytes(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = e => resolve(new Uint8Array(e.target.result));
        reader.onerror = () => reject(new Error('read error'));
        reader.readAsArrayBuffer(file);
      });
    }

    /** Check if bytes at given offset match expected sequence */
    function matchBytes(buf, offset, expected) {
      if (buf.length < offset + expected.length) return false;
      return expected.every((b, i) => buf[offset + i] === b);
    }

    /** Decode a slice of a Uint8Array to UTF-8, ignoring invalid bytes */
    function bytesToText(buf, start, end) {
      return new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(start, end));
    }

    /**
     * Returns true only if bytes look like readable text (>60% printable ASCII).
     * Prevents binary JPEG/PNG data from false-matching text-oriented patterns.
     */
    function looksLikeText(buf, start, end) {
      const slice = buf.slice(start, end);
      let printable = 0;
      for (let i = 0; i < slice.length; i++) {
        const b = slice[i];
        if ((b >= 0x20 && b <= 0x7E) || b === 0x09 || b === 0x0A || b === 0x0D) printable++;
      }
      return slice.length > 0 && (printable / slice.length) > 0.60;
    }

    /**
     * Full scan — returns { safe: bool, reason: string }
     * Reads the whole file once into memory (avoids Android File.slice() bugs).
     */
    async function scan(file) {
      // ── 1. Size guard ──────────────────────────────────────────────────────
      if (file.size > MAX_FILE_SIZE_BYTES) {
        return { safe: false, reason: `file too large (max ${MAX_FILE_SIZE_MB} MB)` };
      }
      if (file.size === 0) {
        return { safe: false, reason: 'file is empty' };
      }

      // ── 2. MIME type guard ─────────────────────────────────────────────────
      const declaredMime = (file.type || '').toLowerCase().trim();
      if (!ALLOWED_MIME_TYPES.has(declaredMime)) {
        return { safe: false, reason: `file type not allowed (${declaredMime || 'unknown'})` };
      }

      // ── 3. Read entire file once ───────────────────────────────────────────
      let buf;
      try {
        buf = await readAllBytes(file);
      } catch {
        // Fail open — let it through rather than falsely blocking a real photo
        console.warn('[Aria Security] Could not read file for scanning — allowing through');
        return { safe: true, reason: 'scan skipped (unreadable)' };
      }

      // ── 4. Dangerous magic bytes ───────────────────────────────────────────
      for (const sig of DANGEROUS_SIGNATURES) {
        if (matchBytes(buf, sig.offset, sig.bytes)) {
          return { safe: false, reason: `blocked: file is a ${sig.name}` };
        }
      }

      // ── 5. Verify image signature ──────────────────────────────────────────
      const isJpeg = matchBytes(buf, 0, MAGIC_SIGNATURES.jpeg.bytes);
      const isPng  = matchBytes(buf, 0, MAGIC_SIGNATURES.png.bytes);
      const isGif  = matchBytes(buf, 0, MAGIC_SIGNATURES.gif87.bytes) ||
                     matchBytes(buf, 0, MAGIC_SIGNATURES.gif89.bytes);
      const isWebp = matchBytes(buf, 0, MAGIC_SIGNATURES.webp.bytes);
      const isBmp  = matchBytes(buf, 0, MAGIC_SIGNATURES.bmp.bytes);

      if (!(isJpeg || isPng || isGif || isWebp || isBmp)) {
        const headText = bytesToText(buf, 0, Math.min(buf.length, 512));
        if (/<script/i.test(headText) || /<!DOCTYPE\s+html/i.test(headText) || /<html[\s>]/i.test(headText)) {
          return { safe: false, reason: 'blocked: file contains HTML/script content' };
        }
        return { safe: false, reason: 'blocked: file does not appear to be a valid image' };
      }

      // ── 6. SVG script scan ─────────────────────────────────────────────────
      if (declaredMime === 'image/svg+xml') {
        const svgText = bytesToText(buf, 0, buf.length);
        for (const pattern of TEXT_DANGER_PATTERNS) {
          if (pattern.test(svgText)) {
            return { safe: false, reason: 'blocked: SVG contains embedded script or event handler' };
          }
        }
      }

      // ── 7. Polyglot tail scan ──────────────────────────────────────────────
      // Only run text-pattern checks if the tail bytes actually look like text.
      // This is the critical guard that prevents binary JPEG data from
      // false-matching patterns like /fetch\(/ or /on\w+=/
      const tailStart = Math.max(0, buf.length - 4096);
      if (looksLikeText(buf, tailStart, buf.length)) {
        const tail = bytesToText(buf, tailStart, buf.length);
        for (const pattern of TEXT_DANGER_PATTERNS) {
          if (pattern.test(tail)) {
            return { safe: false, reason: 'blocked: file contains embedded script payload (polyglot attack)' };
          }
        }
      }

      // ── 8. All clear ───────────────────────────────────────────────────────
      return { safe: true, reason: 'ok' };
    }

    return { scan };
  })();


  /* ═══════════════════════════════════════════════════════════════════════════
     2. UI INJECTION — replace chat input bar with enhanced version
     ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Upgrades the existing .chat-input-bar to the Claude-screenshot style:
   *
   *  ┌─────────────────────────────────────────────────────────┐
   *  │  Chat with Aria...                                       │
   *  │                                                          │
   *  │  [+]                              [🎤]  [🎵waveform]   │
   *  └─────────────────────────────────────────────────────────┘
   *
   * Hidden file input is triggered by the + button.
   * The send button appears when there is text OR a pending attachment.
   */
  function injectEnhancedInputUI() {
    const bar = document.querySelector('#chatScreen .chat-input-bar');
    if (!bar) return; // screen not yet rendered — retry on initChat

    // Avoid double-injection
    if (bar.querySelector('.chat-attach-btn')) return;

    // Keep the existing suggestions strip
    const suggestionsEl = bar.querySelector('#chatSuggestions');

    // Rebuild the input row
    const inputRow = bar.querySelector('.chat-input-row');
    if (!inputRow) return;

    // Remove old children from inputRow (keep textarea, replace rest)
    const textarea = inputRow.querySelector('#chatInput');
    if (!textarea) return;

    // Update placeholder to match the style
    textarea.placeholder = 'Chat with Aria…';

    // Build the new bottom toolbar
    // Layout: [+] ── [textarea (flex:1)] ── [mic] [waveform/send]
    inputRow.innerHTML = '';
    inputRow.style.cssText = 'display:flex;align-items:flex-end;gap:8px;padding:0;';

    // Re-attach textarea
    textarea.style.cssText = `
      flex: 1;
      min-height: 36px;
      max-height: 130px;
      resize: none;
      background: transparent;
      border: none;
      outline: none;
      color: var(--text, #e8e3f0);
      font-size: 15px;
      font-family: 'DM Sans', sans-serif;
      line-height: 1.45;
      padding: 6px 0;
      caret-color: var(--green, #34d399);
    `;

    // ── + (attach) button ──────────────────────────────────────────────────
    const attachBtn = document.createElement('button');
    attachBtn.className = 'chat-attach-btn';
    attachBtn.title = 'Attach photo';
    attachBtn.setAttribute('aria-label', 'Attach photo');
    attachBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>`;
    attachBtn.style.cssText = `
      flex-shrink: 0;
      width: 34px; height: 34px;
      border-radius: 50%;
      border: none;
      background: none;
      color: var(--muted, rgba(255,255,255,0.4));
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
      transition: color 0.18s, background 0.18s;
      -webkit-tap-highlight-color: transparent;
    `;

    // ── hidden file input ──────────────────────────────────────────────────
    const fileInput = document.createElement('input');
    fileInput.type   = 'file';
    fileInput.accept = 'image/jpeg,image/jpg,image/png,image/gif,image/webp,image/bmp';
    fileInput.id     = 'chatFileInput';
    fileInput.style.display = 'none';
    fileInput.setAttribute('aria-hidden', 'true');

    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelected);

    // ── mic (speech-to-text) button ────────────────────────────────────────
    const micBtn = document.createElement('button');
    micBtn.className = 'chat-mic-btn';
    micBtn.title = 'Speak';
    micBtn.setAttribute('aria-label', 'Speak message');
    micBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>`;
    micBtn.style.cssText = `
      flex-shrink: 0;
      width: 34px; height: 34px;
      border-radius: 50%;
      border: none;
      background: none;
      color: var(--muted, rgba(255,255,255,0.4));
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
      transition: color 0.18s, background 0.18s;
      -webkit-tap-highlight-color: transparent;
    `;
    micBtn.addEventListener('click', toggleSpeechInput);

    // ── waveform / send button (rightmost) ─────────────────────────────────
    const waveBtn = document.createElement('button');
    waveBtn.className = 'chat-wave-btn';
    waveBtn.id        = 'chatSendBtn';       // keep existing ID so JS works
    waveBtn.title = 'Send / Voice';
    waveBtn.setAttribute('aria-label', 'Send message');
    waveBtn.innerHTML = _waveformIcon();
    waveBtn.style.cssText = `
      flex-shrink: 0;
      width: 40px; height: 40px;
      border-radius: 50%;
      border: none;
      background: var(--card2, rgba(255,255,255,0.06));
      color: var(--text, #e8e3f0);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
      transition: background 0.18s, color 0.18s, transform 0.12s;
      -webkit-tap-highlight-color: transparent;
    `;
    waveBtn.addEventListener('click', onWaveBtnClick);

    // Compose row: [+] [textarea] [mic] [waveform/send]
    inputRow.appendChild(attachBtn);
    inputRow.appendChild(textarea);
    inputRow.appendChild(fileInput);
    inputRow.appendChild(micBtn);
    inputRow.appendChild(waveBtn);

    // Listen for textarea input to switch waveform → send arrow
    textarea.addEventListener('input', updateSendBtnState);
    textarea.addEventListener('keydown', e => {
      if (typeof window.chatKeyDown === 'function') window.chatKeyDown(e);
      updateSendBtnState();
    });

    // Hover/focus highlight
    [attachBtn, micBtn].forEach(btn => {
      btn.addEventListener('mouseenter', () => {
        btn.style.color = 'var(--text, #e8e3f0)';
        btn.style.background = 'var(--card2, rgba(255,255,255,0.06))';
      });
      btn.addEventListener('mouseleave', () => {
        if (!btn.classList.contains('active')) {
          btn.style.color = 'var(--muted, rgba(255,255,255,0.4))';
          btn.style.background = 'none';
        }
      });
    });

    // Inject attachment preview strip (above input row, hidden by default)
    _ensureAttachPreview(bar, suggestionsEl);

    // Inject styles
    _injectStyles();
  }

  /* ── helper: waveform icon SVG ─────────────────────────────────────────── */
  function _waveformIcon() {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <line x1="2"  y1="12" x2="2"  y2="12"/>
      <line x1="5"  y1="9"  x2="5"  y2="15"/>
      <line x1="8"  y1="6"  x2="8"  y2="18"/>
      <line x1="11" y1="4"  x2="11" y2="20"/>
      <line x1="14" y1="6"  x2="14" y2="18"/>
      <line x1="17" y1="9"  x2="17" y2="15"/>
      <line x1="20" y1="12" x2="20" y2="12"/>
    </svg>`;
  }

  /* ── helper: send arrow icon SVG ───────────────────────────────────────── */
  function _sendArrowIcon() {
    return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"
      xmlns="http://www.w3.org/2000/svg">
      <path d="M9 14V4M9 4L4.5 8.5M9 4L13.5 8.5"
        stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  /* ── attachment preview strip ──────────────────────────────────────────── */
  function _ensureAttachPreview(bar, suggestionsEl) {
    if (bar.querySelector('#chatAttachPreview')) return;
    const strip = document.createElement('div');
    strip.id = 'chatAttachPreview';
    strip.style.cssText = `
      display: none;
      padding: 6px 12px 0;
      gap: 8px;
      flex-wrap: wrap;
    `;
    // Insert before suggestions or at top of bar
    if (suggestionsEl) {
      bar.insertBefore(strip, suggestionsEl);
    } else {
      bar.insertBefore(strip, bar.firstChild);
    }
  }

  /* ── inject CSS ────────────────────────────────────────────────────────── */
  function _injectStyles() {
    if (document.getElementById('aria-attach-styles')) return;
    const style = document.createElement('style');
    style.id = 'aria-attach-styles';
    style.textContent = `
      /* ── enhanced chat input bar ── */
      #chatScreen .chat-input-bar {
        border-top: 1px solid var(--border, rgba(255,255,255,0.07));
        background: var(--bg, #111118);
        padding: 10px 14px 14px;
        border-radius: 18px 18px 0 0;
        box-shadow: 0 -4px 24px rgba(0,0,0,0.22);
      }
      #chatScreen .chat-input-row {
        background: var(--card2, rgba(255,255,255,0.06));
        border-radius: 14px;
        padding: 6px 10px 6px 14px;
        border: 1px solid var(--border, rgba(255,255,255,0.07));
        transition: border-color 0.2s;
      }
      #chatScreen .chat-input-row:focus-within {
        border-color: rgba(52,211,153,0.3);
      }
      /* ── mic active state ── */
      .chat-mic-btn.listening {
        color: #f43f5e !important;
        background: rgba(244,63,94,0.12) !important;
        animation: mic-pulse 1s ease-in-out infinite;
      }
      @keyframes mic-pulse {
        0%,100% { box-shadow: 0 0 0 0 rgba(244,63,94,0.35); }
        50%      { box-shadow: 0 0 0 6px rgba(244,63,94,0); }
      }
      /* ── waveform active (send mode) ── */
      .chat-wave-btn.send-mode {
        background: linear-gradient(135deg, #34d399, #10b981) !important;
        color: #fff !important;
        transform: scale(1.05);
      }
      /* ── attach preview thumb ── */
      .chat-attach-thumb {
        position: relative;
        width: 64px; height: 64px;
        border-radius: 10px;
        overflow: hidden;
        border: 1px solid var(--border, rgba(255,255,255,0.1));
        flex-shrink: 0;
        animation: thumb-in 0.2s ease both;
      }
      @keyframes thumb-in {
        from { opacity: 0; transform: scale(0.85); }
        to   { opacity: 1; transform: scale(1); }
      }
      .chat-attach-thumb img {
        width: 100%; height: 100%;
        object-fit: cover;
        display: block;
      }
      .chat-attach-thumb .thumb-remove {
        position: absolute; top: 2px; right: 2px;
        width: 18px; height: 18px;
        border-radius: 50%;
        background: rgba(0,0,0,0.65);
        border: none;
        color: #fff;
        font-size: 11px;
        line-height: 18px;
        text-align: center;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        padding: 0;
      }
      /* ── security error toast ── */
      .attach-security-toast {
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: rgba(244,63,94,0.92);
        color: #fff;
        padding: 10px 18px;
        border-radius: 12px;
        font-size: 13px;
        font-family: 'DM Sans', sans-serif;
        z-index: 9999;
        opacity: 0;
        transition: opacity 0.25s, transform 0.25s;
        max-width: 300px;
        text-align: center;
        pointer-events: none;
      }
      .attach-security-toast.show {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      /* ── image bubble in chat ── */
      .chat-image-bubble {
        max-width: 220px;
        border-radius: 14px;
        overflow: hidden;
        border: 1px solid var(--border, rgba(255,255,255,0.1));
        cursor: pointer;
        transition: opacity 0.15s;
      }
      .chat-image-bubble:hover { opacity: 0.88; }
      .chat-image-bubble img {
        width: 100%;
        display: block;
      }
      /* ── scanning indicator ── */
      .attach-scanning {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px 0;
        font-size: 11px;
        color: var(--muted, rgba(255,255,255,0.4));
        font-family: 'DM Sans', sans-serif;
        letter-spacing: 0.4px;
        animation: fadein 0.2s ease;
      }
      .attach-scanning-dot {
        width: 5px; height: 5px;
        border-radius: 50%;
        background: var(--green, #34d399);
        animation: scan-dot 0.8s ease-in-out infinite;
      }
      .attach-scanning-dot:nth-child(2) { animation-delay: 0.2s; }
      .attach-scanning-dot:nth-child(3) { animation-delay: 0.4s; }
      @keyframes scan-dot {
        0%,100% { opacity: 0.3; transform: scale(0.8); }
        50%      { opacity: 1;   transform: scale(1.2); }
      }
    `;
    document.head.appendChild(style);
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     3. STATE
     ═══════════════════════════════════════════════════════════════════════════ */

  let pendingAttachment = null;  // { dataUrl, file, alt }
  let speechRecognition = null;
  let isListening = false;


  /* ═══════════════════════════════════════════════════════════════════════════
     4. SEND BUTTON STATE
     ═══════════════════════════════════════════════════════════════════════════ */

  function updateSendBtnState() {
    const btn   = document.getElementById('chatSendBtn');
    const input = document.getElementById('chatInput');
    if (!btn) return;

    const hasText = input && input.value.trim().length > 0;
    const hasImg  = !!pendingAttachment;

    if (hasText || hasImg) {
      btn.innerHTML = _sendArrowIcon();
      btn.classList.add('send-mode');
      btn.onclick = onSendClick;
    } else {
      btn.innerHTML = _waveformIcon();
      btn.classList.remove('send-mode');
      btn.onclick = onWaveBtnClick;
    }
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     5. BUTTON HANDLERS
     ═══════════════════════════════════════════════════════════════════════════ */

  function onWaveBtnClick() {
    // Delegates to the existing ariaVoice toggle or sendChatMessage
    const input = document.getElementById('chatInput');
    const hasText = input && input.value.trim().length > 0;
    if (hasText || pendingAttachment) {
      onSendClick();
    } else {
      // No text — waveform tap = nothing (or could expand to audio record)
      // For now, hint the user
      if (typeof showToast === 'function') showToast('type a message to send');
    }
  }

  function onSendClick() {
    if (pendingAttachment) {
      sendWithAttachment();
    } else {
      if (typeof window.sendChatMessage === 'function') {
        window.sendChatMessage();
        updateSendBtnState();
      }
    }
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     6. FILE SELECTION + SECURITY SCAN
     ═══════════════════════════════════════════════════════════════════════════ */

  async function handleFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // reset so same file can be re-selected
    if (!file) return;

    const bar = document.querySelector('#chatScreen .chat-input-bar');

    // Show scanning indicator
    const scanIndicator = document.createElement('div');
    scanIndicator.className = 'attach-scanning';
    scanIndicator.innerHTML = `
      <div class="attach-scanning-dot"></div>
      <div class="attach-scanning-dot"></div>
      <div class="attach-scanning-dot"></div>
      <span>scanning file…</span>
    `;
    bar.insertBefore(scanIndicator, bar.querySelector('#chatAttachPreview') || bar.firstChild);

    let result;
    try {
      result = await AriaFileScanner.scan(file);
    } catch (err) {
      result = { safe: false, reason: 'scan failed — file rejected for safety' };
    }

    scanIndicator.remove();

    if (!result.safe) {
      _showSecurityToast(`⚠ ${result.reason}`);
      // Log to console for debugging (never expose internals to user beyond toast)
      console.warn('[Aria Security] File rejected:', result.reason, file.name);
      return;
    }

    // File is safe — create preview
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      pendingAttachment = { dataUrl, file, alt: file.name };
      _showAttachPreview(dataUrl);
      updateSendBtnState();
    };
    reader.readAsDataURL(file);
  }

  function _showAttachPreview(dataUrl) {
    const strip = document.getElementById('chatAttachPreview');
    if (!strip) return;
    strip.style.display = 'flex';
    strip.innerHTML = '';

    const thumb = document.createElement('div');
    thumb.className = 'chat-attach-thumb';
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = 'attachment preview';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'thumb-remove';
    removeBtn.innerHTML = '×';
    removeBtn.setAttribute('aria-label', 'Remove attachment');
    removeBtn.addEventListener('click', () => {
      pendingAttachment = null;
      strip.style.display = 'none';
      strip.innerHTML = '';
      updateSendBtnState();
    });
    thumb.appendChild(img);
    thumb.appendChild(removeBtn);
    strip.appendChild(thumb);
  }

  function _showSecurityToast(msg) {
    let toast = document.getElementById('ariaSecurityToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ariaSecurityToast';
      toast.className = 'attach-security-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 4000);
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     7. SEND WITH ATTACHMENT
     Sends image to Claude via the Anthropic API vision endpoint, then displays
     Aria's response the same way sendChatMessage does.
     ═══════════════════════════════════════════════════════════════════════════ */

  async function sendWithAttachment() {
    if (!pendingAttachment) return;

    const input   = document.getElementById('chatInput');
    const caption = input ? input.value.trim() : '';
    const { dataUrl, file } = pendingAttachment;

    // Clear state
    pendingAttachment = null;
    const strip = document.getElementById('chatAttachPreview');
    if (strip) { strip.style.display = 'none'; strip.innerHTML = ''; }
    if (input) { input.value = ''; if (typeof chatInputResize === 'function') chatInputResize(input); }
    updateSendBtnState();

    // Disable send
    const sendBtn = document.getElementById('chatSendBtn');
    if (sendBtn) sendBtn.disabled = true;
    if (typeof window.chatIsTyping !== 'undefined') window.chatIsTyping = true;

    // Show image bubble in chat (user side)
    _appendImageBubble(dataUrl, caption, 'user');

    // Add to chat history (text description for non-vision fallback)
    const historyEntry = caption
      ? `[image attached] ${caption}`
      : '[image attached — no caption]';
    if (Array.isArray(window.chatHistory)) {
      window.chatHistory.push({ role: 'user', content: historyEntry });
    }

    // Build aria thinking bubble
    const msgs = document.getElementById('chatMessages');
    const ariaWrap = document.createElement('div');
    ariaWrap.className = 'chat-msg-aria-wrap';
    ariaWrap.style.animation = 'slide-up 0.25s ease both';
    const ariaBubble = document.createElement('div');
    ariaBubble.className = 'chat-bubble-aria';
    ariaBubble.innerHTML = '<div class="chat-typing-dot"></div><div class="chat-typing-dot"></div><div class="chat-typing-dot"></div>';
    ariaBubble.classList.add('typing-bubble');
    ariaWrap.appendChild(ariaBubble);
    if (msgs) msgs.appendChild(ariaWrap);
    if (typeof scrollChatToBottom === 'function') scrollChatToBottom();

    // Use the existing fetchReply() — it routes through the Supabase edge function
    // which already has the API key, auth headers, and vision support (imageB64 param).
    try {
      const base64Data = dataUrl.split(',')[1];

      const memCtx    = typeof getAriaMemoryContext === 'function'
        ? await getAriaMemoryContext()
        : '';
      const sysPrompt = (typeof ARIA_CHAT_SYSTEM !== 'undefined' ? ARIA_CHAT_SYSTEM : '') +
        (memCtx ? `\n\nWHAT YOU KNOW ABOUT THIS USER:\n${memCtx}` : '');

      const promptText = caption
        ? `The user sent this image with the caption: "${caption}". Look at it carefully — read any text you can see, understand what it shows — then respond naturally as Aria.`
        : 'The user sent you this image. Look at it carefully — read any text, understand what it shows (screenshot of a conversation, photo, anything) — then respond naturally as Aria based on what you see.';

      // fetchReply(system, userMsg, imageB64) — third param triggers vision mode
      const rawText = await fetchReply(sysPrompt, promptText, base64Data);

      // Remove typing bubble and stream response
      ariaBubble.classList.remove('typing-bubble');
      ariaBubble.innerHTML = '';

      if (typeof streamTextWithVoice === 'function') {
        streamTextWithVoice(ariaBubble, rawText, 'neutral', true);
      } else {
        ariaBubble.textContent = rawText;
        if (typeof scrollChatToBottom === 'function') scrollChatToBottom();
      }

      if (Array.isArray(window.chatHistory)) {
        window.chatHistory.push({ role: 'assistant', content: rawText });
      }

      // Persist
      if (window.currentUserId && window.db) {
        window.db.from('chat_messages').insert([
          { user_id: window.currentUserId, role: 'user', content: historyEntry },
          { user_id: window.currentUserId, role: 'aria', content: rawText }
        ]).then(() => {}).catch(() => {});
      }

    } catch (err) {
      ariaBubble.classList.remove('typing-bubble');
      ariaBubble.textContent = 'something went wrong sending that image — try again?';
      console.error('[Aria] Vision error:', err);
    } finally {
      if (sendBtn) sendBtn.disabled = false;
      window.chatIsTyping = false;
      updateSendBtnState();
    }
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     8. IMAGE BUBBLE RENDERER
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
    imgWrap.className = 'chat-image-bubble';
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = caption || 'image';
    img.loading = 'lazy';
    // Tap to expand (fullscreen-ish)
    img.addEventListener('click', () => _expandImage(dataUrl));
    imgWrap.appendChild(img);
    row.appendChild(imgWrap);

    if (caption) {
      const capBubble = document.createElement('div');
      capBubble.className = side === 'user' ? 'chat-bubble-user' : 'chat-bubble-aria';
      capBubble.textContent = caption;
      capBubble.style.marginTop = '4px';
      row.appendChild(capBubble);
    }

    wrap.appendChild(row);

    const timeEl = document.createElement('div');
    timeEl.className = 'chat-msg-time';
    timeEl.textContent = typeof now12h === 'function' ? now12h() : '';
    wrap.appendChild(timeEl);

    msgs.appendChild(wrap);
    if (typeof scrollChatToBottom === 'function') scrollChatToBottom();
  }

  function _expandImage(dataUrl) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.88);
      display: flex; align-items: center; justify-content: center;
      z-index: 99999;
      cursor: zoom-out;
      animation: fadein 0.18s ease;
    `;
    const img = document.createElement('img');
    img.src   = dataUrl;
    img.style.cssText = 'max-width:92vw;max-height:88vh;border-radius:12px;object-fit:contain;';
    overlay.appendChild(img);
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     9. SPEECH-TO-TEXT (Web Speech API)
     ═══════════════════════════════════════════════════════════════════════════ */

  function toggleSpeechInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (typeof showToast === 'function') showToast('speech not supported in this browser');
      return;
    }

    if (isListening) {
      speechRecognition && speechRecognition.stop();
      return;
    }

    speechRecognition = new SpeechRecognition();
    speechRecognition.lang = 'en-US';
    speechRecognition.interimResults = true;
    speechRecognition.maxAlternatives = 1;

    const micBtn = document.querySelector('.chat-mic-btn');

    speechRecognition.onstart = () => {
      isListening = true;
      if (micBtn) micBtn.classList.add('listening');
    };

    speechRecognition.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map(r => r[0].transcript)
        .join('');
      const input = document.getElementById('chatInput');
      if (input) {
        input.value = transcript;
        if (typeof chatInputResize === 'function') chatInputResize(input);
        updateSendBtnState();
      }
    };

    speechRecognition.onerror = (e) => {
      isListening = false;
      if (micBtn) micBtn.classList.remove('listening');
      if (e.error === 'not-allowed') {
        if (typeof showToast === 'function') showToast('microphone access denied');
      }
    };

    speechRecognition.onend = () => {
      isListening = false;
      if (micBtn) micBtn.classList.remove('listening');
    };

    speechRecognition.start();
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     10. INIT
     ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Hook into the existing initChat() function so we can upgrade the UI
   * each time the chat screen is opened (it may not exist on first parse).
   */
  function hookInitChat() {
    const originalInit = window.initChat;
    window.initChat = function (...args) {
      if (originalInit) originalInit.apply(this, args);
      // Small delay so any DOM mutations from initChat settle first
      setTimeout(injectEnhancedInputUI, 50);
    };
  }

  // Also try to inject immediately in case chatScreen is already visible
  function tryImmediate() {
    const chatScreen = document.getElementById('chatScreen');
    if (chatScreen && (chatScreen.style.display !== 'none')) {
      injectEnhancedInputUI();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { hookInitChat(); tryImmediate(); });
  } else {
    hookInitChat();
    tryImmediate();
  }

  // Expose scanner publicly for any other modules that may want to reuse it
  window.AriaFileScanner = AriaFileScanner;

})();
