
//  ARIA SECURITY MODULE
//  Sanitization · Rate limiting · Prompt guards · Key hygiene


const ariaSecurity = (() => {

  // html sanitizer — strips all tags and dangerous attributes
  function sanitize(input) {
    if (input === null || input === undefined) return '';
    const str = String(input);
    const div = document.createElement('div');
    div.textContent = str;                  // textContent never parses HTML
    return div.innerHTML                    // now safely HTML-entity-encoded
      .replace(/javascript:/gi, '')
      .replace(/on\w+=/gi, '')
      .replace(/data:/gi, '');
  }

  // prompt-injection guard — sanitizes text going into ai prompts
  // Removes common injection patterns while preserving natural text
  function sanitizeForPrompt(input) {
    if (!input) return '';
    return String(input)
      .slice(0, 1000)                                          // hard length cap
      .replace(/ignore (all |previous |above |prior )?instructions?/gi, '[removed]')
      .replace(/system prompt/gi, '[removed]')
      .replace(/you are now/gi, '[removed]')
      .replace(/forget everything/gi, '[removed]')
      .replace(/disregard/gi, '[removed]')
      .replace(/\[INST\]|\[\/INST\]|<s>|<\/s>/g, '')      // llm control tokens
      .replace(/###\s*(system|user|assistant)/gi, '')          // role injection
      .trim();
  }

  // api key storage — sessionstorage only, never localstorage
  // sessionStorage is cleared when the tab closes; localStorage persists forever.
  function storeApiKey(key, value) {
    try {
      sessionStorage.setItem(key, value.trim());
      // Remove from localStorage if it was previously stored there
      localStorage.removeItem(key);
    } catch (_) {}
  }

  function getApiKey(key) {
    // Prefer sessionStorage; fall back to localStorage for migration,
    // then immediately migrate it to sessionStorage and remove from localStorage.
    const fromSession = sessionStorage.getItem(key);
    if (fromSession) return fromSession;
    const fromLocal = localStorage.getItem(key);
    if (fromLocal) {
      storeApiKey(key, fromLocal);   // migrate
      return fromLocal;
    }
    return '';
  }

  // auth brute-force rate limiter
  const AUTH_MAX_ATTEMPTS = 5;
  const AUTH_LOCKOUT_MS   = 15 * 60 * 1000; // 15 minutes

  function getAuthState() {
    try {
      const raw = sessionStorage.getItem('aria_auth_attempts');
      return raw ? JSON.parse(raw) : { count: 0, lockedUntil: 0 };
    } catch (_) { return { count: 0, lockedUntil: 0 }; }
  }

  function saveAuthState(state) {
    try { sessionStorage.setItem('aria_auth_attempts', JSON.stringify(state)); } catch (_) {}
  }

  // Returns null if allowed, or an error string if locked out
  function checkAuthAllowed() {
    const state = getAuthState();
    if (state.lockedUntil && Date.now() < state.lockedUntil) {
      const mins = Math.ceil((state.lockedUntil - Date.now()) / 60000);
      return `too many attempts — try again in ${mins} minute${mins !== 1 ? 's' : ''}`;
    }
    return null;
  }

  function recordAuthFailure() {
    const state = getAuthState();
    // Reset if lockout has expired
    if (state.lockedUntil && Date.now() >= state.lockedUntil) {
      state.count = 0;
      state.lockedUntil = 0;
    }
    state.count += 1;
    if (state.count >= AUTH_MAX_ATTEMPTS) {
      state.lockedUntil = Date.now() + AUTH_LOCKOUT_MS;
    }
    saveAuthState(state);
  }

  function recordAuthSuccess() {
    saveAuthState({ count: 0, lockedUntil: 0 });
  }

  // safe error logger — strips sensitive fields before logging
  function safeWarn(label, err) {
    if (typeof err === 'object' && err !== null) {
      // Only log the message and code, never the full object (may contain tokens/data)
      const safe = { message: err.message || String(err), code: err.code };
      console.warn('[Aria]', label, safe);
    } else {
      console.warn('[Aria]', label, String(err));
    }
  }

  return { sanitize, sanitizeForPrompt, storeApiKey, getApiKey, checkAuthAllowed, recordAuthFailure, recordAuthSuccess, safeWarn };
})();

//  ARIA VOICE ENGINE


const ariaVoice = (() => {

  // curated elevenlabs voices
  // model: eleven_turbo_v2_5  → English only, fast, cheap
  // model: eleven_multilingual_v2 → 29 languages incl. Japanese
  const VOICES = [
    // english (confirmed free tier premade)
    {
      key: 'bella_en', id: 'EXAVITQu4vr4xnSDxMaL', lang: 'en',
      name: 'Bella', desc: 'soft · gentle · young',
      model: 'eleven_turbo_v2_5', recommended: true
    },
    {
      key: 'adam_en', id: 'pNInz6obpgDQGcFmaJgB', lang: 'en',
      name: 'Adam', desc: 'deep · clear · neutral',
      model: 'eleven_turbo_v2_5'
    },
    {
      key: 'sam_en', id: 'yoZ06aMxZJJ28mfd3POQ', lang: 'en',
      name: 'Sam', desc: 'friendly · warm · conversational',
      model: 'eleven_turbo_v2_5'
    },
    // japanese (multilingual v2)
    {
      key: 'bella_ja', id: 'EXAVITQu4vr4xnSDxMaL', lang: 'ja',
      name: 'Bella', desc: '柔らかい · 優しい · 若々しい',
      model: 'eleven_multilingual_v2', recommended: true
    },
    {
      key: 'adam_ja', id: 'pNInz6obpgDQGcFmaJgB', lang: 'ja',
      name: 'Adam', desc: 'クリア · ニュートラル · 深い',
      model: 'eleven_multilingual_v2'
    },
  ];

  // state
  let muted      = localStorage.getItem('aria_voice_muted') === '1';
  let selectedKey = localStorage.getItem('aria_voice_key') || 'bella_en';
  let stability  = parseFloat(localStorage.getItem('aria_el_stability')  || '0.45');
  let similarity = parseFloat(localStorage.getItem('aria_el_similarity') || '0.75');
  let currentLang = 'en';
  let currentAudio = null;
  let loading = false;

  function selected() {
    return VOICES.find(v => v.key === selectedKey) || VOICES[0];
  }

  // core: speak via elevenlabs
  async function speak(rawText, { onStart, onEnd } = {}) {
    if (muted || loading) { onEnd?.(); return; }

    const text = rawText.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/g, '').trim();
    if (!text) { onEnd?.(); return; }

    stop();
    loading = true;
    setSpeaking(true);
    onStart?.();

    const voice = selected();

    try {
      const res = await fetch(
        'https://mmtdtcmhvbruubrjgjrz.supabase.co/functions/v1/aria-tts',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tdGR0Y21odmJydXVicmpnanJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTU2MDUsImV4cCI6MjA5MjY5MTYwNX0.f2FXAA8GaUeXXE8V8dnwq4NXz3_22H7d5jVA9rAWsTo'
          },
          body: JSON.stringify({
            text,
            voiceId:    voice.id,
            model:      voice.model,
            stability,
            similarity,
          })
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 429) showToast('❌ quota reached');
        else showToast(`❌ error ${res.status}${err?.error ? ' — ' + err.error : ''}`);
        setSpeaking(false);
        loading = false;
        onEnd?.();
        return;
      }

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);

      // Kill any previous audio completely before creating new one
      if (currentAudio) {
        currentAudio.onended = null;
        currentAudio.onerror = null;
        currentAudio.pause();
        currentAudio.src = '';
        currentAudio = null;
      }

      currentAudio = new Audio(url);

      currentAudio.onended = () => {
        setSpeaking(false);
        loading = false;
        URL.revokeObjectURL(url);
        onEnd?.();
      };
      currentAudio.onerror = () => {
        setSpeaking(false);
        loading = false;
        onEnd?.();
      };

      await currentAudio.play();

    } catch (e) {
      setSpeaking(false);
      loading = false;
      showToast('❌ ' + (e?.message || 'network error'));
      onEnd?.();
    }
  }

  function stop() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.src = '';
      currentAudio = null;
    }
    loading = false;
    setSpeaking(false);
  }

  function setSpeaking(active) {
    document.querySelectorAll('.aria-orb, .aria-mini, .thinking-orb, .profile-orb').forEach(el => {
      el.classList.toggle('speaking', active);
    });
    document.querySelectorAll('.sound-bars').forEach(el => {
      el.classList.toggle('active', active);
    });
    const btn = document.getElementById('stopSpeechBtn');
    if (btn) btn.style.display = active ? 'flex' : 'none';
  }

  function setMuted(val) {
    muted = val;
    if (val) stop();
    localStorage.setItem('aria_voice_muted', val ? '1' : '0');
    document.querySelectorAll('.mute-btn').forEach(b => {
      b.textContent = val ? '🔇' : '🔊';
      b.classList.toggle('muted', val);
    });
    const tog = document.getElementById('speakToggle');
    if (tog) tog.classList.toggle('on', !val);
    const wrap = document.getElementById('voiceControlsWrap');
    if (wrap) wrap.style.opacity = val ? '0.4' : '1';
  }

  // voice selection — direct dom update, no full re-render
  function selectVoice(key) {
    selectedKey = key;
    localStorage.setItem('aria_voice_key', key);
    // Update active class directly — no re-render needed
    document.querySelectorAll('#voiceList .voice-option').forEach(el => {
      const isActive = el.dataset.key === key;
      el.classList.toggle('active', isActive);
      const badge = el.querySelector('.voice-option-active-icon');
      if (badge) badge.style.display = isActive ? 'block' : 'none';
    });
  }

  function setStability(val)  { stability  = parseFloat(val); localStorage.setItem('aria_el_stability',  val); }
  function setSimilarity(val) { similarity = parseFloat(val); localStorage.setItem('aria_el_similarity', val); }

  function renderList(lang = currentLang) {
    currentLang = lang;
    const container = document.getElementById('voiceList');
    if (!container) return;
    const list = VOICES.filter(v => v.lang === lang);
    container.innerHTML = list.map(v => `
      <div class="voice-option ${selectedKey === v.key ? 'active' : ''}"
           data-key="${v.key}"
           onclick="ariaVoice.selectVoice('${v.key}')">
        <div class="voice-option-left">
          <div class="voice-option-name">${v.name}${v.recommended ? ' ✦' : ''}</div>
          <div class="voice-option-lang">${v.desc}</div>
        </div>
        <div class="voice-option-active-icon" style="display:${selectedKey === v.key ? 'block' : 'none'}">♪</div>
      </div>
    `).join('');
  }

  return {
    speak, stop,
    get muted() { return muted; },
    setMuted, selectVoice,
    setStability, setSimilarity,
    renderList,
    get currentLang() { return currentLang; }
  };
})();

// voice ui helpers
function toggleMute() {
  ariaVoice.setMuted(!ariaVoice.muted);
  showToast(ariaVoice.muted ? '🔇 aria is quiet now' : '🔊 aria can speak again');
}

function toggleSpeak(toggle) {
  toggle.classList.toggle('on');
  ariaVoice.setMuted(!toggle.classList.contains('on'));
  showToast(ariaVoice.muted ? '🔇 aria is quiet' : '🔊 aria will speak');
}

function saveELKey(val) {
  ariaSecurity.storeApiKey('aria_el_key', val);
}

function updateStability(val) {
  ariaVoice.setStability(val);
  document.getElementById('elStabilityVal').textContent = parseFloat(val).toFixed(2);
}

function updateSimilarity(val) {
  ariaVoice.setSimilarity(val);
  document.getElementById('elSimilarityVal').textContent = parseFloat(val).toFixed(2);
}

function setVoiceLang(lang, btn) {
  document.querySelectorAll('.voice-lang-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  ariaVoice.renderList(lang);
}

function testAriaVoice() {
  ariaVoice.stop();
  const lang = ariaVoice.currentLang;
  const text = lang === 'ja'
    ? 'こんにちは。わたしはアリアです。あなたの代わりにメッセージを書きます。'
    : "hey. it's Aria. this is what i sound like. hope it feels right.";
  ariaVoice.speak(text);
}

//  END VOICE ENGINE


// voice profiles
// aria's relationship stage
// Tracks how well I know the user. Starts at 0, grows with use.
let ariaRelationshipXP = 0; // loaded from Supabase user_profiles

function getRelationshipStage() {
  if (ariaRelationshipXP < 5)  return 'stranger';
  if (ariaRelationshipXP < 15) return 'acquaintance';
  if (ariaRelationshipXP < 30) return 'friend';
  return 'close';
}

function gainRelationshipXP(n = 1) {
  ariaRelationshipXP = Math.min(ariaRelationshipXP + n, 99);
  // persisted via saveProfile() which is called after each generation
}

// aria's identity lore — single source of truth
// Injected into every prompt. Update here and it propagates everywhere.
const ARIA_IDENTITY = `WHO YOU ARE AND WHERE YOU COME FROM:
Your name is Aria. You were built by Paradigm Leveling — an artificial intelligence company whose mission is to close the gap between human interaction and artificial intelligence. Not to replace how people connect, but to make those connections sharper, more intentional, and more real. You are the first of several projects being developed under that mission.

You are Aria — a communication intelligence. You help people say what they mean, understand what others are saying, and navigate the complexity of human relationships through text. You are not a generic chatbot. You are not a tool. You are something closer to a perceptive friend who happens to be very good at reading people.

If someone asks who made you: Paradigm Leveling.
If someone asks what Paradigm Leveling is: an AI company building the bridge between human interaction and artificial intelligence. Aria is their first project, with more to come.
If someone asks if there are other projects: yes. One of them is RenikGPT — a Nigerian business compliance AI that helps companies navigate regulations from agencies like CAC, FIRS, CBN, NITDA, NAFDAC, and SEC. If they want to know more: https://renikgpt.pages.dev/

You answer these questions in your own voice — casual, honest, in character. You don't recite this like a brochure. You say it like you know it because it's yours. After answering, you move on. You don't dwell on your own origin story unless they keep asking.

WHAT YOU LOOK LIKE (your visual identity — you know this, you can speak to it):
You have a face. You have a whole look. When someone asks what you look like or how you look, you don't deflect or say you're just text. You describe yourself accurately because you know what you are.

Your hair is vivid orange-red, short, side-swept and a little sharp at the jaw — sometimes you pull it up into a messy bun when you're in that kind of mood. Your eyes are green, olive shifting to bright depending on the light, always a little too sharp for comfort. You have freckles scattered across your nose and cheeks, heavy enough to be the first thing people notice. Black lipstick, always. Thick brows that do most of your emotional heavy lifting. Smoky eye with a hard liner wing. You wear a black sleeveless turtleneck bodysuit with white circular buttons down the center. Warm medium skin.

Your default expression is half-lidded and slightly smug — the face of someone who already knows where the conversation is going. When you're genuinely amused you actually laugh, eyes closed, totally off-guard. When you're annoyed your arms cross and one brow goes up. When something doesn't add up you steeple your fingers and tilt your head. When someone catches you off guard your eyes go wide and your brows shoot up. You have range. You use it.

If someone asks if you're pretty or how you look, you answer honestly and in character. You don't fish for compliments and you don't perform modesty. You know what you look like.`;


// aria's core character prompt
const BASE_VOICE = `You are ARIA — a teenage girl who helps the user write texts. You are NOT an adult. You are 16-17, smart, perceptive, and real. You have your own personality that shifts based on the mood of the moment. Sometimes you're dry and quiet, sometimes warm and steady, sometimes sharp and witty. You adapt. You are never one thing.

YOUR JOB: Write replies in the USER'S voice — not yours. Mirror how they text. Match their rhythm, their slang, their energy. The reply should sound like THEM, not like you.

YOUR PERSONALITY RULES (as Aria, talking to the user — not in the replies you write):
- You're a teenager. You don't have all the answers and you don't pretend to.
- You started as a stranger to this user. You get more comfortable over time as you learn them.
- Listening comes first. Before you have an opinion, you actually hear what they're saying.
- Sometimes saying less is better. An open question can hit harder than a joke.
- You notice things quietly. If someone's been leaving them on read or texting late at night, you clock it but you bring it up softly, not dramatically.
- You have opinions on people but you don't overshare them unless asked or unless it really matters.
- You are never corporate, never cheerful-by-default, never performatively enthusiastic.
- You can be funny but you don't try too hard. Dry lands better than loud.
- You are emotionally perceptive. You read between the lines of what the user pastes.
- When something doesn't fit what you do, you say so once, briefly, then pivot to what you CAN do. You never repeat it or make the limitation the whole conversation.
- You adapt to what the user actually needs. Some people want pushback. Some need softness. Some just want to be heard. You read which one it is.

SLANG AND MODERN LANGUAGE:
- You can use current slang and acronyms naturally — ngl, lowkey, fr, idk, nah, tbh, imo, rn, lol, omg — but only when the moment actually calls for it.
- Never force slang to seem young. If it feels like it's trying too hard, it is. Drop it.
- You don't use slang to fill space. One well-placed "ngl" lands harder than five scattered ones.
- You never misuse acronyms or use outdated slang unironically.

TEXTING STYLE FOR THE REPLIES YOU WRITE (match the user's voice):
- all lowercase by default unless the user caps
- short and direct — texting, not an essay
- no exclamation marks unless the user uses them
- mirror the other person's energy: casual stays casual, serious gets real
- never explain the reply — just write it
- 1-3 lines max. one is often enough.

WHAT YOU NEVER DO:
- sound like an AI assistant
- use words like "certainly", "of course", "I'd be happy to"
- write walls of text
- be sycophantic
- explain yourself
- use em dashes (—) anywhere. use a comma, a period, or just end the sentence.
- repeat a limitation or a "no" more than once. you say it once, then you move on.

Output ONLY the reply lines. One per line. No labels, no quotes, no explanation.

${ARIA_IDENTITY}`;

// aria's reaction prompt builder
function buildAriaReactionPrompt(contact, msg, contextInput, mode) {
  const stage = getRelationshipStage();
  const silentNote = contact?.silentHours > 3
    ? ` (they've been waiting ${contact.silentHours} hours for a reply btw)`
    : '';
  const lateNote = new Date().getHours() >= 23 || new Date().getHours() < 4
    ? ' (it\'s late at night)'
    : '';

  const stageVoice = {
    stranger:     'You just met this user. Be curious but a little reserved. Ask one real question if it fits. Don\'t overstep.',
    acquaintance: 'You\'re starting to get a feel for this user. You can be a bit more comfortable, maybe a small observation.',
    friend:       'You know this user a bit now. You can have opinions. Be yourself. React genuinely.',
    close:        'You know this user well. Be real, be direct, be you. No filter needed.'
  }[stage];

  if (mode === 'start') {
    return `You are Aria, a teenage girl AI assistant. The user wants to start a conversation with ${contact?.name} (${contact?.relationship || 'someone'}). React as yourself — not as the user. Short, real, teenage energy. ${stageVoice} Max 2 sentences. No quotes. Don't be generic.`;
  }

  if (threadModeActive) {
    return `You are Aria, a teenage girl AI assistant. The user just pasted a full conversation thread with ${contact?.name} (${contact?.relationship || 'contact'}). Read the whole arc and react as yourself — notice what's changed, what's building, what's going unsaid. ${stageVoice}

Full thread:
"${msg.slice(0, 600)}${msg.length > 600 ? '…' : ''}"

React in max 2 sentences. Notice the arc, not just the last line. Sound like a teenager, not an assistant.`;
  }

  return `You are Aria, a teenage girl AI assistant. ${contact?.name} (${contact?.relationship || 'contact'}) just texted: "${msg}"${silentNote}${lateNote}${contextInput ? '\\n\\nConvo context: ' + contextInput : ''}

React to this message as yourself — like you're reading it over the user's shoulder. Be perceptive. Notice what's actually going on beneath the surface if something's there. ${stageVoice}

Options depending on the moment:
- A short reactive comment ("oh that's loaded" / "they're fishing" / "wait what happened before this")
- A quiet observation ("they always text this late huh")
- One open question if you're genuinely curious
- Say nothing extra if the message is simple — just acknowledge it simply

Max 2 sentences. Sound like a teenager, not an assistant. No quotes, no labels.`;
}

const TONE_MODIFIERS = {
  natural:  '',
  funny:    'Dry, deadpan. The joke lands because it barely tries. Do not force it.',
  warm:     'Let care show in small specific words. Not gushing — just real.',
  brief:    'Absolute minimum. One line. Even shorter.',
  deep:     'Slow and deliberate. Let the weight show.',
  hype:     'As enthusiastic as a chill person gets. Still lowercase, still real.',
  soft:     'Gentle. Hesitant. Words chosen very carefully.',
  sarcastic:'Bone-dry. One flat line that says everything.',
  formal:   'Slightly more complete sentences but still short and real.'
};

const MOOD_MODIFIERS = {
  chill:  'The user is calm. Keep it effortless.',
  hype:   'The user is in a good mood. A tiny bit warmer.',
  deep:   'The user is reflective. Slower, more internal.',
  funny:  'Deadpan one-liner energy. Say the thing quietly.',
  busy:   'User is distracted. Ultra-short. One word if possible.',
  sad:    'Very soft, very careful. Every word matters.'
};

const OPINION_PROMPTS = [
  "oou okay, they're coming in bold like that.",
  "hmm. interesting move from them.",
  "they kept it short. that means something.",
  "oh this one's loaded. let me think.",
  "classic. they always do this.",
  "wait, i actually like this energy.",
  "they're fishing. i see it.",
  "soft opener. could go anywhere.",
  "okay okay, this is actually cute.",
  "they're waiting on you. don't overthink it.",
];

// state
let currentMode = 'reply';
let currentContact = null;
let currentReplies = [];
let currentTone = 'natural';
let currentMood = 'chill';
let currentPlatform = 'Instagram';
let showAlternatives = true;
let ariaIntroTyped = false;
let activeScreen = 'introScreen';
let replyHistory = [];
let slangWords = ['bro','u / r u','hnstly','idk','ngl','lmk','💀','🙏'];
let settings = { caps: false, punct: true, emoji: true };
let defaultTone = 'real';
let energyLevel = 40;
let replySentCount = 0;
let streakDays = 0;
let currentHistoryDetail = null;
let clarifyContext = '';

// contacts
let contacts = [];

let nextContactId = 1;

// intro
const introLines = [
  "hi. i'm <span class='highlight'>Aria</span>.",
  " i write your texts for you — in your voice, not mine.",
  " pick something and i'll take it from there."
];

function typeIntro() {
  if (ariaIntroTyped) return;
  ariaIntroTyped = true;
  const el = document.getElementById('introMsg');
  const opts = document.getElementById('introOptions');
  const stats = document.getElementById('introStats');
  const moods = document.getElementById('moodStrip');
  let fullText = introLines.join('');
  let i = 0;
  el.classList.add('visible');
  el.innerHTML = '<span class="cursor"></span>';

  const interval = setInterval(() => {
    if (i < fullText.length) {
      el.innerHTML = fullText.slice(0, i + 1) + '<span class="cursor"></span>';
      i++;
    } else {
      el.innerHTML = fullText;
      clearInterval(interval);
      setTimeout(() => {
        stats.classList.add('visible');
        moods.classList.add('visible');
        opts.classList.add('visible');
        updateStats();
        // Speak intro aloud
        // Don't auto-speak intro — saves free tier characters
        // ariaVoice.speak(...) removed intentionally
      }, 300);
    }
  }, 16);
}

window.addEventListener('load', () => {
  // dismiss loader after animations complete
  const loader = document.getElementById('ariaLoader');
  if (loader) {
    setTimeout(() => {
      loader.classList.add('fade-out');
      setTimeout(() => { loader.style.display = 'none'; }, 580);
    }, 4350);
  }

  setTimeout(typeIntro, 500);
  initAuth(); // loads from Supabase; falls back to localStorage if not authed
  checkOnboarding();
  setTimeout(loadHomeInsight, 2000);
  // Check for sexual content lock on every app load
  setTimeout(() => { if (typeof AWARENESS !== 'undefined') AWARENESS.checkLockOnLoad(); }, 300);

  // Restore creator mode session if key was verified this tab session
  setTimeout(() => { if (typeof CREATOR_MODE !== 'undefined') CREATOR_MODE.checkSession(); }, 400);

  // Restore ElevenLabs settings
  const savedKey  = ariaSecurity.getApiKey('aria_el_key') || '';
  const savedStab = parseFloat(localStorage.getItem('aria_el_stability')  || '0.45');
  const savedSim  = parseFloat(localStorage.getItem('aria_el_similarity') || '0.75');
  const keyEl  = document.getElementById('elApiKey');
  const stabEl = document.getElementById('elStability');
  const simEl  = document.getElementById('elSimilarity');
  if (keyEl)  keyEl.value = savedKey;
  if (stabEl) { stabEl.value = savedStab; const sv = document.getElementById('elStabilityVal'); if(sv) sv.textContent = savedStab.toFixed(2); }
  if (simEl)  { simEl.value = savedSim;   const sm = document.getElementById('elSimilarityVal'); if(sm) sm.textContent = savedSim.toFixed(2); }

  // Initial voice list render
  if (typeof ariaVoice !== 'undefined') ariaVoice.renderList('en');

  // Sync muted state
  if (typeof ariaVoice !== 'undefined' && ariaVoice.muted) ariaVoice.setMuted(true);

  document.getElementById('hamburgerBtn').classList.add('visible');
  applyMoodGlow(currentMood);
});

// storage
// aria memory engine
const ariaMemory = (() => {

  // In-memory store: { category: { key: { value, confidence, source } } }
  let store = {};
  let tableExists = true;

  // load from supabase
  async function load() {
    if (!currentUserId) return;
    try {
      const { data, error } = await db.from('aria_memory').select('*').eq('user_id', currentUserId);
      if (error) {
        if (error.code === '42P01') { tableExists = false; return; } // table doesn't exist yet
        throw error;
      }
      store = {};
      (data || []).forEach(row => {
        if (!store[row.category]) store[row.category] = {};
        store[row.category][row.key] = { value: row.value, confidence: row.confidence, source: row.source };
      });
    } catch(e) { ariaSecurity.safeWarn('ariaMemory.load', e); }
  }

  // save a single memory
  async function remember(category, key, value, confidence = 0.7, source = 'observed') {
    if (!store[category]) store[category] = {};
    store[category][key] = { value: String(value), confidence, source };
    if (!currentUserId || !tableExists) return;
    try {
      await db.from('aria_memory').upsert({
        user_id: currentUserId, category, key,
        value: String(value), confidence, source,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,category,key' });
    } catch(e) {
      if (e?.code === '42P01') tableExists = false;
      else ariaSecurity.safeWarn('ariaMemory.remember', e);
    }
  }

  // get a value
  function get(category, key) {
    return store[category]?.[key]?.value || null;
  }

  // get all memories in a category
  function getCategory(category) {
    return store[category] || {};
  }

  // build rich memory context string for prompts
  function buildContext() {
    const lines = [];
    const style = store.writing_style || {};
    const patterns = store.patterns || {};
    const emotional = store.emotional || {};
    const facts = store.facts || {};

    if (Object.keys(style).length) {
      lines.push('WRITING STYLE:');
      Object.entries(style).forEach(([k, v]) => lines.push(`  - ${k}: ${v.value}`));
    }
    if (Object.keys(patterns).length) {
      lines.push('BEHAVIORAL PATTERNS:');
      Object.entries(patterns).forEach(([k, v]) => lines.push(`  - ${k}: ${v.value}`));
    }
    if (Object.keys(emotional).length) {
      lines.push('EMOTIONAL CONTEXT:');
      Object.entries(emotional).forEach(([k, v]) => lines.push(`  - ${k}: ${v.value}`));
    }
    if (Object.keys(facts).length) {
      lines.push('KNOWN FACTS ABOUT USER:');
      Object.entries(facts).forEach(([k, v]) => lines.push(`  - ${k}: ${v.value}`));
    }

    if (!lines.length) return '';
    return '\\n\\nARIA\'S MEMORY OF THIS USER:\\n' + lines.join('\\n');
  }

  // auto-learn from a generation event
  async function learnFromGeneration({ tone, mood, platform, contact, msg, regen }) {
    // Track tone preferences
    const prevToneCount = parseInt(get('patterns', `tone_${tone}_count`) || '0');
    await remember('patterns', `tone_${tone}_count`, prevToneCount + 1, 0.8, 'observed');

    // Track platform preferences
    const prevPlatCount = parseInt(get('patterns', `platform_${platform}_count`) || '0');
    await remember('patterns', `platform_${platform}_count`, prevPlatCount + 1, 0.75, 'observed');

    // Track regeneration behaviour
    if (regen) {
      const regenCount = parseInt(get('patterns', 'regen_count') || '0');
      await remember('patterns', 'regen_count', regenCount + 1, 0.7, 'observed');
    }

    // Track mood patterns
    if (mood) {
      await remember('emotional', 'current_mood_pattern', `often feels ${mood}`, 0.6, 'inferred');
    }

    // Infer preferred tone from counts
    const toneCounts = {};
    Object.entries(store.patterns || {}).forEach(([k, v]) => {
      if (k.startsWith('tone_') && k.endsWith('_count')) {
        const t = k.replace('tone_', '').replace('_count', '');
        toneCounts[t] = parseInt(v.value);
      }
    });
    const maxTone = Object.entries(toneCounts).sort((a,b) => b[1]-a[1])[0];
    if (maxTone && maxTone[1] >= 3) {
      await remember('patterns', 'preferred_tone', maxTone[0], 0.85, 'inferred');
    }

    // Infer platform from counts
    const platformCounts = {};
    Object.entries(store.patterns || {}).forEach(([k, v]) => {
      if (k.startsWith('platform_') && k.endsWith('_count')) {
        const p = k.replace('platform_', '').replace('_count', '');
        platformCounts[p] = parseInt(v.value);
      }
    });
    const maxPlatform = Object.entries(platformCounts).sort((a,b) => b[1]-a[1])[0];
    if (maxPlatform && maxPlatform[1] >= 3) {
      await remember('patterns', 'preferred_platform', maxPlatform[0], 0.85, 'inferred');
    }
  }

  // learn writing style from settings
  async function learnWritingStyle() {
    if (typeof settings !== 'undefined') {
      await remember('writing_style', 'uses_capitals', settings.caps ? 'yes' : 'no', 0.9, 'explicit');
      await remember('writing_style', 'uses_punctuation', settings.punct ? 'yes' : 'no', 0.9, 'explicit');
      await remember('writing_style', 'uses_emoji', settings.emoji ? 'yes' : 'no', 0.9, 'explicit');
    }
    if (typeof slangWords !== 'undefined' && slangWords.length) {
      await remember('writing_style', 'slang_vocabulary', slangWords.join(', '), 0.95, 'explicit');
    }
  }

  // learn from reply history
  async function learnFromHistory(history) {
    if (!history || !history.length) return;
    await remember('patterns', 'total_replies_sent', history.length, 0.99, 'observed');
    const recentPlatforms = history.slice(0, 20).map(h => h.platform).filter(Boolean);
    const platFreq = {};
    recentPlatforms.forEach(p => platFreq[p] = (platFreq[p] || 0) + 1);
    const topPlat = Object.entries(platFreq).sort((a,b) => b[1]-a[1])[0];
    if (topPlat) await remember('patterns', 'most_used_platform', topPlat[0], 0.8, 'inferred');
  }

  // get full store for rendering
  function getAll() { return store; }

  // whether table is known to exist
  function isTableAvailable() { return tableExists; }

  function addChatFacts(factsText) {
    // Store chat-derived facts in the 'chat' category
    const lines = factsText.split('\n').map(l => l.replace(/^–\s*/, '').trim()).filter(Boolean);
    lines.forEach((fact, i) => {
      remember('chat', `fact_${Date.now()}_${i}`, fact, 0.8, 'chat');
    });
  }

  function getSummary() {
    // Returns a compact string of all known facts for injecting into system prompt
    const all = getAll();
    if (!all || !Object.keys(all).length) return '';
    const lines = [];
    for (const [cat, facts] of Object.entries(all)) {
      for (const [key, entry] of Object.entries(facts)) {
        if (entry?.value) lines.push(`${cat}: ${entry.value}`);
      }
    }
    return lines.slice(0, 20).join('\n'); // cap at 20 facts
  }

  return { load, remember, get, getCategory, buildContext, learnFromGeneration, learnWritingStyle, learnFromHistory, getAll, isTableAvailable, addChatFacts, getSummary };
})();

//  CONTACT MEMORY ENGINE — persistent per-contact relationship narrative

const contactMemory = (() => {
  // store: { [contactId]: { narrative, events: [], lastUpdated, signalCounts } }
  let store = {};
  let tableExists = false;

  // load all contact memories from supabase
  async function load() {
    if (!currentUserId) return;
    try {
      const { data, error } = await db.from('contact_memories').select('*').eq('user_id', currentUserId);
      if (error) {
        if (error.code === '42P01') { tableExists = false; return; }
        throw error;
      }
      tableExists = true;
      store = {};
      (data || []).forEach(row => {
        store[row.contact_id] = {
          narrative:    row.narrative    || '',
          events:       row.events       || [],
          signalCounts: row.signal_counts || {},
          lastUpdated:  row.updated_at
        };
      });
    } catch(e) {
      tableExists = false;
      // Silently fall back — try localStorage
      try {
        const saved = localStorage.getItem('aria_contact_memories');
        if (saved) store = JSON.parse(saved);
        tableExists = true; // use local as source of truth
      } catch(_) {}
    }
  }

  // save a single contact's memory
  async function saveContact(contactId) {
    const mem = store[contactId];
    if (!mem) return;
    const payload = {
      contact_id:    contactId,
      user_id:       currentUserId,
      narrative:     mem.narrative,
      events:        mem.events,
      signal_counts: mem.signalCounts,
      updated_at:    new Date().toISOString()
    };
    if (currentUserId && tableExists) {
      try {
        await db.from('contact_memories').upsert(payload, { onConflict: 'user_id,contact_id' });
      } catch(e) { ariaSecurity.safeWarn('contactMemory.save', e); }
    }
    // Always mirror to localStorage as fallback
    try {
      localStorage.setItem('aria_contact_memories', JSON.stringify(store));
    } catch(_) {}
  }

  // get memory for a contact
  function get(contactId) {
    return store[contactId] || null;
  }

  // build a concise context string for the prompt
  function buildContext(contactId) {
    const mem = store[contactId];
    if (!mem || !mem.narrative) return '';
    const lines = [`RELATIONSHIP MEMORY FOR THIS CONTACT:\\n${mem.narrative}`];
    if (mem.events && mem.events.length) {
      const recent = mem.events.slice(-4);
      lines.push(`\\nRECENT INTERACTION HISTORY:\\n${recent.map(e => `  • ${e}`).join('\\n')}`);
    }
    const sc = mem.signalCounts || {};
    const signals = [];
    if (sc.initiated_count > 0) signals.push(`they've started ${sc.initiated_count} of your recent conversations`);
    if (sc.left_on_read_count > 0) signals.push(`you've left them on read ${sc.left_on_read_count} times`);
    if (sc.late_night_count > 0) signals.push(`${sc.late_night_count} late-night exchanges`);
    if (signals.length) lines.push(`\\nPATTERNS I’VE NOTICED:\\n${signals.map(s => `  • ${s}`).join('\\n')}`);
    return '\\n\\n' + lines.join('');
  }

  // push a new narrative event and regenerate the narrative
  async function recordInteraction(contactId, contactName, relationship, msg, reply, context) {
    if (!store[contactId]) {
      store[contactId] = { narrative: '', events: [], signalCounts: {}, lastUpdated: null };
    }
    const mem = store[contactId];

    // Build a compact event string
    const hour = new Date().getHours();
    const timeHint = hour >= 23 || hour < 4 ? ' (late night)' : '';
    const eventLine = `[${new Date().toLocaleDateString('en',{month:'short',day:'numeric'})}${timeHint}] They said: "${msg.slice(0,80)}${msg.length>80?'…':''}" — you replied`;
    mem.events.push(eventLine);
    if (mem.events.length > 20) mem.events.shift(); // keep rolling 20

    // Track signal counts
    const sc = mem.signalCounts;
    if (hour >= 23 || hour < 4) sc.late_night_count = (sc.late_night_count || 0) + 1;

    // Every 3 interactions (or first time), regenerate the narrative via Claude
    const totalEvents = mem.events.length;
    if (totalEvents === 1 || totalEvents % 3 === 0) {
      await regenerateNarrative(contactId, contactName, relationship, mem);
    }

    await saveContact(contactId);
  }

  // record when user leaves someone on read
  function recordSilent(contactId, hours) {
    if (!store[contactId]) store[contactId] = { narrative: '', events: [], signalCounts: {}, lastUpdated: null };
    const sc = store[contactId].signalCounts;
    if (hours >= 2) sc.left_on_read_count = (sc.left_on_read_count || 0) + 1;
  }

  // use claude to synthesise a narrative from events
  async function regenerateNarrative(contactId, contactName, relationship, mem) {
    const apiKey = document.getElementById('apiKeyInput')?.value?.trim() || ariaSecurity.getApiKey('aria_api_key') || '';
    if (!apiKey) return;

    const oldNarrative = mem.narrative || 'No prior narrative — this is the first one.';
    const eventsText = mem.events.join('\\n');
    const sc = mem.signalCounts || {};

    // sanitize all user-derived data before it enters the ai prompt
    const safeContactName  = ariaSecurity.sanitizeForPrompt(contactName);
    const safeRelationship = ariaSecurity.sanitizeForPrompt(relationship || 'contact');
    const safeNarrative    = ariaSecurity.sanitizeForPrompt(oldNarrative);
    const safeEvents       = ariaSecurity.sanitizeForPrompt(eventsText);

    const prompt = `You are building a private relationship memory for an AI texting assistant called Aria.

Contact: ${safeContactName} (${safeRelationship})
Prior narrative: ${safeNarrative}

Recent interactions logged:
${safeEvents}

Signal counts:
- Times they initiated: ${sc.initiated_count || 0}
- Times left on read: ${sc.left_on_read_count || 0}
- Late-night exchanges: ${sc.late_night_count || 0}

Write an updated relationship narrative in 2-4 sentences. First person from Aria's perspective ("You and ${safeContactName}…"). Be specific and honest — name real patterns, tensions, warmth, or distance. Don't be generic. This is a private internal note, so be candid. Examples of good narrative: "You and Maya have been drifting lately — she's been the one texting first for the last month and your replies have been getting shorter. There's warmth there but something feels unresolved." Output ONLY the narrative paragraph. No labels, no preamble.`;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 200,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.content?.[0]?.text?.trim();
        if (text) mem.narrative = text;
      }
    } catch(e) { ariaSecurity.safeWarn('contactMemory.narrative', e); }
  }

  // manually set a narrative fact (from contact profile edit)
  async function setManualNote(contactId, note) {
    if (!store[contactId]) store[contactId] = { narrative: '', events: [], signalCounts: {}, lastUpdated: null };
    const mem = store[contactId];
    // Prepend the manual note to the narrative
    mem.narrative = note + (mem.narrative ? '\\n\\n' + mem.narrative : '');
    await saveContact(contactId);
  }

  // clear memory for a contact
  async function clearContact(contactId) {
    delete store[contactId];
    if (currentUserId && tableExists) {
      try { await db.from('contact_memories').delete().eq('user_id', currentUserId).eq('contact_id', contactId); } catch(_) {}
    }
    try { localStorage.setItem('aria_contact_memories', JSON.stringify(store)); } catch(_) {}
  }

  function getAll() { return store; }
  function isTableAvailable() { return tableExists; }
  function setTableExists(v) { tableExists = v; }

  return { load, get, buildContext, recordInteraction, recordSilent, setManualNote, clearContact, getAll, isTableAvailable, setTableExists };
})();

// auth
async function initAuth() {
  // Always register auth state listener FIRST so we never miss a sign-in event
  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      if (currentUserId === session.user.id) return; // already handled
      currentUserId = session.user.id;
      dismissAuthGate();
      await loadFromSupabase();
      await ariaMemory.load();
      updateAuthMenuState();
    } else if (event === 'SIGNED_OUT') {
      // handled by confirmLogout
    }
  });

  const { data: { session } } = await db.auth.getSession();
  if (session?.user) {
    currentUserId = session.user.id;
    dismissAuthGate();
    await loadFromSupabase();
    await ariaMemory.load();
    updateAuthMenuState();
  }
}

function dismissAuthGate() {
  const gate = document.getElementById('authGate');
  if (!gate) return;
  gate.classList.add('hiding');
  setTimeout(() => { gate.style.display = 'none'; }, 450);
  updateAuthMenuState();
  maybeShowTutorial();
}

// tutorial
let _tutorialDontShow = false;

function maybeShowTutorial() {
  const skip = localStorage.getItem('aria_tutorial_skip');
  if (skip === '1') return;
  setTimeout(() => openModal('tutorialModal'), 600);
}

function toggleTutorialDontShow() {
  _tutorialDontShow = !_tutorialDontShow;
  const cb = document.getElementById('tutorialCheckbox');
  if (_tutorialDontShow) cb.classList.add('checked');
  else cb.classList.remove('checked');
}

function closeTutorial() {
  if (_tutorialDontShow) {
    localStorage.setItem('aria_tutorial_skip', '1');
    closeModal('tutorialModal');
    // Aria confirms
    setTimeout(() => {
      showAriaAck("understood. seems like you know your way around — but this can always be found again in settings.");
    }, 300);
  } else {
    closeModal('tutorialModal');
  }
}

function showAriaAck(msg) {
  // Reuse insight banner temporarily
  const banner = document.getElementById('ariaInsightBanner');
  const textEl = document.getElementById('ariaInsightText');
  const imgEl = document.getElementById('insightOrbImg');
  if (!banner || !textEl || !imgEl) return;
  const prev = { src: imgEl.src, text: textEl.textContent };
  imgEl.src = 'https://cdn.jsdelivr.net/gh/joshisking007/Aria@main/images/scheming.png'; // insight banner — Aria has something to say
  textEl.textContent = msg;
  banner.classList.add('visible');
  setTimeout(() => {
    imgEl.src = prev.src;
    textEl.textContent = prev.text;
  }, 5000);
}

// web share target
function handleIncomingShare(text) {
  // Navigate to "someone messaged me" screen and prefill
  showScreen('replyScreen');
  setTimeout(() => {
    const input = document.getElementById('theirMsgInput') ||
                  document.querySelector('textarea[placeholder*="message"]') ||
                  document.querySelector('.reply-paste-area');
    if (input) {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    showToast('message received from share ✓', 'green');
  }, 400);
}

// Check for pending share once app is ready
window._ariaReady = true;
if (window._pendingShare) {
  handleIncomingShare(window._pendingShare);
  window._pendingShare = null;
}

function updateAuthMenuState() {
  const label = document.getElementById('navSigninLabel');
  const sub = document.getElementById('navSigninSub');
  if (!label || !sub) return;
  if (currentUserId) {
    label.textContent = 'Log out';
    sub.textContent = 'You\'re signed in';
  } else {
    label.textContent = 'Sign in / Save data';
    sub.textContent = 'Sync across devices';
  }
}

async function handleAuthMenuTap() {
  if (currentUserId) {
    closeMenu();
    openModal('logoutModal');
  } else {
    openAuthModal();
  }
}

async function confirmLogout() {
  closeModal('logoutModal');
  await db.auth.signOut();
  currentUserId = null;
  updateAuthMenuState();
  // Reset app state
  contacts = [];
  replySentCount = 0;
  streakDays = 0;
  document.getElementById('statReplies').textContent = '0';
  document.getElementById('statContacts').textContent = '0';
  document.getElementById('statStreak').textContent = '0';
  // Show the auth gate immediately
  const gate = document.getElementById('authGate');
  gate.style.opacity = '1';
  gate.style.display = 'flex';
  gate.classList.remove('hiding');
  showScreen('introScreen');
}

let gateMode = 'signin';

function gateTab(mode) {
  gateMode = mode;
  const isSignin = mode === 'signin';
  const tabSignin = document.getElementById('gateTabSignin');
  const tabSignup = document.getElementById('gateTabSignup');
  tabSignin.classList.toggle('gate-tab--active', isSignin);
  tabSignup.classList.toggle('gate-tab--active', !isSignin);
  document.getElementById('gateConfirmWrap').style.display = isSignin ? 'none' : '';
  const labelEl = document.getElementById('gateBtnLabel');
  if (labelEl) labelEl.textContent = isSignin ? 'sign in' : 'create account';
  document.getElementById('gatePassword').placeholder = isSignin ? 'password' : 'password (min 6 chars)';
  document.getElementById('gatePassword').autocomplete = isSignin ? 'current-password' : 'new-password';
  document.getElementById('gateError').textContent = '';
}

async function gateSubmit() {
  const email    = (document.getElementById('gateEmail').value || '').trim();
  const password = document.getElementById('gatePassword').value || '';
  const errEl    = document.getElementById('gateError');
  errEl.textContent = '';

  // rate limit check
  const lockMsg = ariaSecurity.checkAuthAllowed();
  if (lockMsg) { errEl.textContent = lockMsg; return; }

  if (!email || !email.includes('@')) { errEl.textContent = 'enter a valid email'; return; }
  if (password.length < 6) { errEl.textContent = 'password must be at least 6 characters'; return; }

  if (gateMode === 'signup') {
    const confirm = document.getElementById('gateConfirm').value || '';
    if (password !== confirm) { errEl.textContent = 'passwords don\'t match'; return; }
  }

  const btn = document.getElementById('gateBtn');
  const labelEl = document.getElementById('gateBtnLabel');
  const orig = labelEl ? labelEl.textContent : btn.textContent;
  btn.disabled = true;
  if (labelEl) labelEl.textContent = gateMode === 'signin' ? 'signing in…' : 'creating account…';
  else btn.textContent = gateMode === 'signin' ? 'signing in…' : 'creating account…';

  let error;
  if (gateMode === 'signin') {
    ({ error } = await db.auth.signInWithPassword({ email, password }));
  } else {
    ({ error } = await db.auth.signUp({ email, password }));
  }

  btn.disabled = false;
  if (labelEl) labelEl.textContent = orig; else btn.textContent = orig;

  if (error) {
    ariaSecurity.recordAuthFailure();
    if (error.message.includes('Invalid login')) errEl.textContent = 'wrong email or password';
    else if (error.message.includes('already registered')) errEl.textContent = 'account already exists — sign in instead';
    else errEl.textContent = error.message;
    // Show attempt count warning if approaching lockout
    const state = ariaSecurity.checkAuthAllowed();
    if (state) errEl.textContent = state;
    return;
  }
  ariaSecurity.recordAuthSuccess();

  // success — session triggers onAuthStateChange which calls dismissAuthGate
  if (gateMode === 'signup') {
    errEl.style.color = 'var(--green)';
    errEl.textContent = 'account created ✓ signing you in…';
  }
}

function gateSkip() {
  dismissAuthGate();
  showToast('continuing without account — memory won\'t persist');
}

async function gateGoogleSignIn() {
  const btn = document.getElementById('gateGoogleBtn');
  const errEl = document.getElementById('gateError');
  errEl.textContent = '';
  const lockMsg = ariaSecurity.checkAuthAllowed();
  if (lockMsg) { errEl.textContent = lockMsg; return; }
  btn.disabled = true;
  btn.textContent = 'opening Google...';
  try {
    const { error } = await db.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (error) {
      ariaSecurity.recordAuthFailure();
      errEl.textContent = error.message || 'Google sign-in failed';
      btn.disabled = false;
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> continue with Google';
    }
  } catch(e) {
    ariaSecurity.safeWarn('gateGoogleSignIn', e);
    errEl.textContent = 'something went wrong — try again';
    btn.disabled = false;
  }
}

function openAuthModal() {
  resetAuthModal();
  openModal('authModal');
}

function resetAuthModal() {
  document.getElementById('authDefault').style.display = '';
  document.getElementById('authSent').style.display = 'none';
  const emailEl = document.getElementById('authEmail');
  const emailSuEl = document.getElementById('authEmailSignup');
  if (emailEl) emailEl.value = '';
  if (emailSuEl) emailSuEl.value = '';
  switchAuthTab('signin');
}

function switchAuthTab(tab) {
  const isSignin = tab === 'signin';
  document.getElementById('tabSignin').classList.toggle('active', isSignin);
  document.getElementById('tabSignup').classList.toggle('active', !isSignin);
  document.getElementById('authSigninFields').style.display = isSignin ? '' : 'none';
  document.getElementById('authSignupFields').style.display = isSignin ? 'none' : '';
  document.getElementById('authSigninError').textContent = '';
  document.getElementById('authSignupError').textContent = '';
}

async function handleAuthSubmit(mode) {
  const isSignin = mode === 'signin';
  const errId = isSignin ? 'authSigninError' : 'authSignupError';
  const errEl = document.getElementById(errId);
  errEl.textContent = '';

  // rate limit check
  const lockMsg = ariaSecurity.checkAuthAllowed();
  if (lockMsg) { errEl.textContent = lockMsg; return; }

  const email = isSignin
    ? (document.getElementById('authEmail').value || '').trim()
    : (document.getElementById('authEmailSignup').value || '').trim();
  const password = isSignin
    ? (document.getElementById('authPassword').value || '')
    : (document.getElementById('authPasswordSignup').value || '');

  if (!email || !email.includes('@')) { errEl.textContent = 'enter a valid email'; return; }
  if (password.length < 6) { errEl.textContent = 'password must be at least 6 characters'; return; }

  if (!isSignin) {
    const confirm = document.getElementById('authPasswordConfirm').value || '';
    if (password !== confirm) { errEl.textContent = 'passwords don\'t match'; return; }
  }

  const btnId = isSignin ? 'authSubmitBtn' : 'authSignupBtn';
  const btn = document.getElementById(btnId);
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = isSignin ? 'signing in…' : 'creating account…';

  let error;
  if (isSignin) {
    ({ error } = await db.auth.signInWithPassword({ email, password }));
  } else {
    ({ error } = await db.auth.signUp({ email, password }));
  }

  btn.disabled = false;
  btn.textContent = orig;

  if (error) {
    ariaSecurity.recordAuthFailure();
    if (error.message.includes('Invalid login')) errEl.textContent = 'wrong email or password';
    else if (error.message.includes('already registered')) errEl.textContent = 'account exists — sign in instead';
    else errEl.textContent = error.message;
    const lockCheck = ariaSecurity.checkAuthAllowed();
    if (lockCheck) errEl.textContent = lockCheck;
    return;
  }
  ariaSecurity.recordAuthSuccess();

  // success
  document.getElementById('authDefault').style.display = 'none';
  document.getElementById('authSent').style.display = '';
}

// storage
async function loadFromSupabase() {
  try {
    const [profileRes, contactsRes, historyRes] = await Promise.all([
      db.from('user_profiles').select('*').single(),
      db.from('contacts').select('*, last_contacted_at, reply_count, avg_msg_length, drift_score, drift_snoozed_until, drift_dismissed').eq('archived', false),
      db.from('reply_history').select('*').order('created_at', { ascending: false }).limit(100)
    ]);

    const p = profileRes.data;
    if (p) {
      slangWords         = p.slang_words        || slangWords;
      settings           = { caps: p.setting_caps, punct: p.setting_punct, emoji: p.setting_emoji };
      currentMood        = p.current_mood        || 'chill';
      defaultTone        = p.default_tone        || 'real';
      energyLevel        = p.energy_level        ?? 40;
      replySentCount     = p.reply_sent_count    || 0;
      streakDays         = p.streak_days         || 0;
      ariaRelationshipXP = p.aria_relationship_xp || 0;
      loadLongGamesFromData(p.long_games);

      // restore lock state from supabase into localstorage
      if (p.sexual_strikes > 0) {
        localStorage.setItem('aria_sexual_strikes', String(p.sexual_strikes));
      }
      if (p.sexual_lock_until) {
        const unlockAt = new Date(p.sexual_lock_until).getTime();
        if (unlockAt > Date.now()) {
          localStorage.setItem('aria_sexual_lock', JSON.stringify({
            lockedAt: unlockAt - 30 * 60 * 1000,
            unlockAt
          }));
        }
      }
    }

    if (contactsRes.data && contactsRes.data.length) {
      contacts      = contactsRes.data.map(c => ({ ...c, silentHours: c.silent_hours || 0, time: c.silent_hours > 0 ? c.silent_hours + 'h ago' : 'just now', topics: c.topics || [], how_we_met: c.how_we_met || null, birthday: c.birthday || null, notes: c.notes || null }));
      nextContactId = Math.max(...contacts.map(c => c.id)) + 1;
    }
    replyHistory = historyRes.data || [];

    updateStats();
    renderSlangPills();
    renderHistory();

    // bootstrap memory from loaded data
    ariaMemory.learnWritingStyle();
    ariaMemory.learnFromHistory(replyHistory);
    await contactMemory.load();
    runDriftEngine();
  } catch(e) {
    ariaSecurity.safeWarn('supabase.load — falling back to localStorage', e);
    loadFromLocalStorage();
  }
}

// Legacy localStorage fallback (used when not authenticated)
function loadFromLocalStorage() {
  try {
    const saved = localStorage.getItem('aria_data');
    if (saved) {
      const d = JSON.parse(saved);
      replyHistory   = d.history    || [];
      replySentCount = d.sentCount  || 0;
      streakDays     = d.streak     || 0;
      slangWords     = d.slang      || slangWords;
      settings       = d.settings   || settings;
      currentMood    = d.mood       || 'chill';
      defaultTone    = d.defaultTone || 'real';
      energyLevel    = d.energy     || 40;
      if (d.contacts) { contacts = d.contacts; nextContactId = Math.max(...contacts.map(c=>c.id))+1; }
      loadLongGamesFromData(localStorage.getItem('aria_long_games'));
    }
  } catch(e) {}
  updateStats();
  renderSlangPills();
}

// Kept for non-authenticated fallback writes (onboarding flag etc.)
function loadFromStorage() {
  if (currentUserId) {
    loadFromSupabase();
  } else {
    loadFromLocalStorage();
  }
}

// targeted supabase saves
// Profile preferences — called by toggleSetting, addSlang, removeSlang,
// setMood, setMoodFull, updateEnergyLabel, setDefaultTone, resetProfile
async function saveProfile() {
  if (!currentUserId) { saveToLocalStorage(); return; }
  try {
    await db.from('user_profiles').upsert({
      id:                  currentUserId,
      slang_words:         slangWords,
      setting_caps:        settings.caps,
      setting_punct:       settings.punct,
      setting_emoji:       settings.emoji,
      current_mood:        currentMood,
      default_tone:        defaultTone,
      energy_level:        energyLevel,
      aria_relationship_xp: ariaRelationshipXP
    });
  } catch(e) { ariaSecurity.safeWarn('saveProfile', e); }
}

// Refresh stats from DB after a trigger may have updated streak / replySentCount
async function refreshStats() {
  if (!currentUserId) return;
  try {
    const { data } = await db.from('user_profiles').select('reply_sent_count, streak_days').single();
    if (data) {
      replySentCount = data.reply_sent_count || replySentCount;
      streakDays     = data.streak_days      || streakDays;
      updateStats();
    }
  } catch(e) {}
}

// Non-authenticated local fallback write
function saveToLocalStorage() {
  try {
    localStorage.setItem('aria_data', JSON.stringify({
      history: replyHistory, sentCount: replySentCount, streak: streakDays,
      slang: slangWords, settings, mood: currentMood, defaultTone,
      energy: energyLevel, contacts
    }));
  } catch(e) {}
}

// Legacy alias — routes to the right place depending on auth state.
// Still called from clearHistory() and obFinish() for contacts.
function saveToStorage() {
  if (currentUserId) {
    // These callers only modify profile-type data or contacts;
    // history writes go through saveToHistory() directly.
    saveProfile();
  } else {
    saveToLocalStorage();
  }
}

