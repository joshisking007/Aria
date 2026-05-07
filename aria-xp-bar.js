// ─── ARIA RELATIONSHIP XP BAR ────────────────────────────────────────────────
// Surfaces the existing ariaRelationshipXP and getRelationshipStage() as a
// visible, animated progress indicator shown in the chat screen and intro screen.
//
// Features:
//  - Subtle progress arc embedded in the chat header orb
//  - Stage unlock toast when crossing a threshold
//  - Intro screen relationship card showing stage + next milestone
//  - All persists via the existing saveProfile() call — no new tables needed
//
// DEPENDS ON: aria-core.js (ariaRelationshipXP, getRelationshipStage, gainRelationshipXP)
// LOAD ORDER: after aria-core.js and aria-app.js
//
// USAGE: Call ariaXP.init() once on app load. XP updates happen automatically
//        by hooking into gainRelationshipXP.

const ariaXP = (() => {

  // ── stage definitions ────────────────────────────────────────────────────────
  const STAGES = [
    {
      id:       'stranger',
      label:    'stranger',
      subLabel: 'she's still figuring you out',
      min: 0,
      max: 5,
      color: '#64748b',
      glowColor: 'rgba(100,116,139,0.3)',
      unlockMsg: null, // first stage — no unlock toast
    },
    {
      id:       'acquaintance',
      label:    'acquaintance',
      subLabel: 'picking up your patterns',
      min: 5,
      max: 15,
      color: '#60a5fa',
      glowColor: 'rgba(96,165,250,0.35)',
      unlockMsg: "now we're getting somewhere. she's starting to get your style.",
    },
    {
      id:       'friend',
      label:    'friend',
      subLabel: 'she knows how you move',
      min: 15,
      max: 30,
      color: '#f472b6',
      glowColor: 'rgba(244,114,182,0.4)',
      unlockMsg: "you two are actually friends now. she writes like she knows you.",
    },
    {
      id:       'close',
      label:    'close',
      subLabel: 'she gets you. no explanation needed',
      min: 30,
      max: 99,
      color: '#a78bfa',
      glowColor: 'rgba(167,139,250,0.45)',
      unlockMsg: "okay she actually knows you now. real ones only fr.",
    },
  ];

  // ── helpers ──────────────────────────────────────────────────────────────────
  function getStageData(stageId) {
    return STAGES.find(s => s.id === stageId) || STAGES[0];
  }

  function getProgress() {
    const xp    = typeof ariaRelationshipXP !== 'undefined' ? ariaRelationshipXP : 0;
    const stage = getStageData(
      typeof getRelationshipStage === 'function' ? getRelationshipStage() : 'stranger'
    );
    const range    = stage.max - stage.min;
    const inStage  = Math.max(0, Math.min(xp - stage.min, range));
    const pct      = Math.round((inStage / range) * 100);
    const stageIdx = STAGES.findIndex(s => s.id === stage.id);
    const nextStage = STAGES[stageIdx + 1] || null;
    return { xp, stage, pct, stageIdx, nextStage };
  }

  // ── DOM builders ─────────────────────────────────────────────────────────────
  function _buildChatXPBar() {
    const existing = document.getElementById('ariaXPBar');
    if (existing) return existing;

    const bar = document.createElement('div');
    bar.id = 'ariaXPBar';
    bar.innerHTML = `
      <div class="xp-stage-label" id="xpStageLabel">—</div>
      <div class="xp-track-wrap">
        <div class="xp-track">
          <div class="xp-fill" id="xpFill"></div>
        </div>
        <div class="xp-pct" id="xpPct"></div>
      </div>`;

    // Inject into chat top bar — after the orb
    const chatTopBar = document.querySelector('#chatScreen .top-bar');
    if (chatTopBar) {
      chatTopBar.insertAdjacentElement('afterend', bar);
    }
    return bar;
  }

  function _buildIntroXPCard() {
    const existing = document.getElementById('ariaXPCard');
    if (existing) return existing;

    const card = document.createElement('div');
    card.id = 'ariaXPCard';
    card.className = 'xp-intro-card';
    card.innerHTML = `
      <div class="xp-intro-top">
        <div class="xp-intro-stage-wrap">
          <div class="xp-intro-stage-label">MY BOND WITH ARIA</div>
          <div class="xp-intro-stage-name" id="xpIntroStageName">stranger</div>
        </div>
        <div class="xp-intro-stage-num" id="xpIntroStageNum">1 / 4</div>
      </div>
      <div class="xp-intro-arc-wrap">
        <div class="xp-intro-track">
          <div class="xp-intro-fill" id="xpIntroFill"></div>
          <div class="xp-intro-nodes" id="xpIntroNodes"></div>
        </div>
      </div>
      <div class="xp-intro-sub" id="xpIntroSub">she's still figuring you out</div>`;

    // Insert above the options list
    const introOptions = document.getElementById('introOptions');
    if (introOptions) {
      introOptions.insertAdjacentElement('beforebegin', card);
    }
    return card;
  }

  // ── render ────────────────────────────────────────────────────────────────────
  function _renderChatXPBar() {
    const { stage, pct } = getProgress();
    const fill     = document.getElementById('xpFill');
    const label    = document.getElementById('xpStageLabel');
    const pctEl    = document.getElementById('xpPct');
    if (!fill) return;

    fill.style.width           = pct + '%';
    fill.style.background      = `linear-gradient(90deg, ${stage.color}88, ${stage.color})`;
    fill.style.boxShadow       = `0 0 8px ${stage.glowColor}`;
    if (label) label.textContent = stage.label;
    if (pctEl) pctEl.textContent = pct + '%';

    document.getElementById('ariaXPBar')?.setAttribute('data-stage', stage.id);
  }

  function _renderIntroXPCard() {
    const { stage, pct, stageIdx, nextStage } = getProgress();
    const fill    = document.getElementById('xpIntroFill');
    const name    = document.getElementById('xpIntroStageName');
    const sub     = document.getElementById('xpIntroSub');
    const num     = document.getElementById('xpIntroStageNum');
    const nodes   = document.getElementById('xpIntroNodes');
    const card    = document.getElementById('ariaXPCard');
    if (!fill) return;

    // Full arc pct across ALL stages — so the bar shows total journey, not within-stage
    const xp         = typeof ariaRelationshipXP !== 'undefined' ? ariaRelationshipXP : 0;
    const totalArcPct = Math.min(Math.round((xp / 30) * 100), 100); // 30 xp = full friend
    fill.style.width  = totalArcPct + '%';
    fill.style.background = `linear-gradient(90deg, #60a5fa, ${stage.color})`;

    if (name) name.textContent = stage.label;
    if (num)  num.textContent  = `${stageIdx + 1} / ${STAGES.length}`;
    if (sub)  sub.textContent  = stage.subLabel;
    if (card) card.setAttribute('data-stage', stage.id);

    // Stage milestone dots
    if (nodes) {
      nodes.innerHTML = STAGES.map((s, i) => `
        <div class="xp-node ${i <= stageIdx ? 'xp-node-reached' : ''}"
             style="left:${(i / (STAGES.length - 1)) * 100}%;--node-color:${s.color}"
             title="${s.label}">
        </div>`).join('');
    }
  }

  // ── stage unlock toast ────────────────────────────────────────────────────────
  let _lastRenderedStage = null;

  function _checkStageUnlock() {
    const { stage } = getProgress();
    if (_lastRenderedStage && _lastRenderedStage !== stage.id && stage.unlockMsg) {
      _showUnlockToast(stage);
    }
    _lastRenderedStage = stage.id;
  }

  function _showUnlockToast(stage) {
    const existing = document.getElementById('xpUnlockToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'xpUnlockToast';
    toast.className = 'xp-unlock-toast';
    toast.innerHTML = `
      <div class="xp-unlock-inner">
        <div class="xp-unlock-stage" style="color:${stage.color}">${stage.label}</div>
        <div class="xp-unlock-msg">${stage.unlockMsg}</div>
      </div>`;

    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.classList.add('xp-unlock-visible');
      });
    });

    setTimeout(() => {
      toast.classList.remove('xp-unlock-visible');
      setTimeout(() => toast.remove(), 500);
    }, 4500);
  }

  // ── public update call ────────────────────────────────────────────────────────
  // Call after any XP change to refresh both indicators
  function update() {
    _checkStageUnlock();
    _renderChatXPBar();
    _renderIntroXPCard();
  }

  // ── init ──────────────────────────────────────────────────────────────────────
  function init() {
    // Build DOM elements
    _buildChatXPBar();
    _buildIntroXPCard();

    // Initial render
    _lastRenderedStage = typeof getRelationshipStage === 'function'
      ? getRelationshipStage()
      : 'stranger';

    update();

    // Hook into gainRelationshipXP
    if (typeof gainRelationshipXP === 'function') {
      const _origGain = gainRelationshipXP;
      window.gainRelationshipXP = function(n = 1) {
        _origGain(n);
        // Small delay so ariaRelationshipXP has been updated
        setTimeout(() => update(), 50);
      };
    }

    // Also re-render when chat screen opens
    const _origShowScreen = typeof showScreen === 'function' ? showScreen : null;
    if (_origShowScreen) {
      window.showScreen = function(id) {
        _origShowScreen(id);
        if (id === 'chatScreen' || id === 'introScreen') {
          setTimeout(() => update(), 80);
        }
      };
    }
  }

  return { init, update, getProgress, STAGES };
})();
