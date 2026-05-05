
// ═══════════════════════════════════════════════════════════════════════════════
// ARIA UNIFIED PROFILE — multi-game triangulation engine
//
// What this is:
//   The central nervous system for everything the games know about the user.
//   Each game (pattern recognition, chess, storytelling, decision trees) outputs
//   to a standard schema. This module aggregates them, finds where they
//   agree and disagree, and produces a single cross-game profile that Aria
//   carries into every conversation.
//
// Current game sources:
//   ✓ pattern_game  — live (aria-games.js + aria-games-upgrades.js)
//   ○ chess         — not yet built. schema slot reserved.
//   ○ storytelling  — not yet built. schema slot reserved.
//   ○ decision_tree — not yet built. schema slot reserved.
//
// Also ingests:
//   ○ therapy_threshold — signals from aria-therapy-threshold.js
//   ○ chat_behavior     — passive signals from the conversation layer
//
// Design principle:
//   One axis from one game is a data point. Two axes from two games on the same
//   trait is a read. Three is a profile. This module holds all of it and knows
//   the difference.
// ═══════════════════════════════════════════════════════════════════════════════

const ariaUnifiedProfile = (() => {

  const STORAGE_KEY    = 'aria_unified_profile';
  const SIGNAL_LOG_KEY = 'aria_signal_log';
  const MAX_SIGNALS    = 100; // rolling log cap

  // ─── GAME SOURCE REGISTRY ──────────────────────────────────────────────────
  // Every game that wants to contribute to the unified profile registers here.
  // When a new game is built, add its key and schema shape here first.

  const GAME_SOURCES = {
    pattern_game: {
      label:      'Pattern Recognition',
      axes: [
        'processingStyle',   // intuitive | deliberate
        'learningCurve',     // rising | flat | declining
        'errorRecovery',     // good | slow | none-needed
        'ruleShiftTolerance',// high | medium | low  (derived)
        'pacing',            // fast | steady | slow  (derived)
        'strongType',        // numeric | shape | word | alpha | rule_break | growing
        'weakType',
        'accuracy',          // 0-100
        'timedOutCount',
        'trend',             // accelerating | stable | decelerating
      ],
      status: 'live',
    },
    chess: {
      label: 'Chess',
      axes: [
        'planningDepth',     // shallow | medium | deep  — how many moves ahead they plan
        'riskTolerance',     // conservative | balanced | aggressive
        'adaptability',      // rigid | flexible  — do they stick to opening or adjust mid-game?
        'pressureResponse',  // crumbles | holds | sharpens  — under threat
        'endgameFocus',      // drops off | sustains | elevates  — attention through long game
        'openingStyle',      // reactive | initiative  — respond or set agenda
      ],
      status: 'pending', // not yet built
    },
    storytelling: {
      label: 'Storytelling',
      axes: [
        'narrativeMode',     // conflict-driven | character-driven | world-driven
        'moralFraming',      // black-white | grey  — how they treat right/wrong
        'emotionalRange',    // flat | moderate | wide  — emotional variety in choices
        'agencyBias',        // external | internal  — do they attribute things to fate or self
        'conflictAvoidance', // avoids | engages | escalates
        'ambiguityTolerance',// low | medium | high  — comfort with unresolved endings
      ],
      status: 'pending',
    },
    decision_tree: {
      label: 'Decision Trees',
      axes: [
        'decisionSpeed',     // fast | moderate | slow
        'riskFraming',       // loss-averse | neutral | gain-seeking
        'informationNeed',   // decides-sparse | decides-full  — how much info before committing
        'consistencyUnderPressure', // consistent | variable
        'regretPattern',     // forward-focused | retrospective  — do they second-guess?
        'groupWeighting',    // self-first | other-weighted  — who do they consider in decisions
      ],
      status: 'pending',
    },
  };

  // ─── CROSS-GAME TRAIT MAPPINGS ─────────────────────────────────────────────
  // When two or more games measure the same underlying trait from different
  // angles, this map defines how to triangulate them.
  //
  // Format: traitName → [ { source, axis, transform } ]
  // transform: function that maps raw axis value → common scale
  // Common scales: 'low|medium|high', 'fast|steady|slow', 'avoids|engages|escalates'

  const TRAIT_TRIANGULATIONS = {

    // How quickly they decide and commit
    decisionSpeed: [
      { source: 'pattern_game',  axis: 'trend',        map: { accelerating: 'fast', stable: 'medium', decelerating: 'slow' } },
      { source: 'pattern_game',  axis: 'processingStyle', map: { intuitive: 'fast', deliberate: 'slow' } },
      { source: 'chess',         axis: 'planningDepth', map: { shallow: 'fast', medium: 'medium', deep: 'slow' } },
      { source: 'decision_tree', axis: 'decisionSpeed', map: { fast: 'fast', moderate: 'medium', slow: 'slow' } },
    ],

    // How they handle uncertainty and broken expectations
    uncertaintyTolerance: [
      { source: 'pattern_game',  axis: 'errorRecovery', map: { good: 'high', slow: 'low', 'none-needed': 'high' } },
      { source: 'storytelling',  axis: 'ambiguityTolerance', map: { high: 'high', medium: 'medium', low: 'low' } },
      { source: 'chess',         axis: 'adaptability',  map: { flexible: 'high', rigid: 'low' } },
    ],

    // How they respond when things get hard
    pressureResponse: [
      { source: 'pattern_game',  axis: 'trend',         map: { accelerating: 'sharpens', stable: 'holds', decelerating: 'crumbles' } },
      { source: 'pattern_game',  axis: 'timedOutCount', map: null }, // computed separately
      { source: 'chess',         axis: 'pressureResponse', map: { crumbles: 'crumbles', holds: 'holds', sharpens: 'sharpens' } },
      { source: 'decision_tree', axis: 'consistencyUnderPressure', map: { consistent: 'holds', variable: 'crumbles' } },
    ],

    // How they learn and adapt mid-session
    adaptiveLearning: [
      { source: 'pattern_game',  axis: 'learningCurve',  map: { rising: 'high', flat: 'medium', declining: 'low' } },
      { source: 'chess',         axis: 'adaptability',   map: { flexible: 'high', rigid: 'low' } },
      { source: 'decision_tree', axis: 'informationNeed', map: { 'decides-sparse': 'high', 'decides-full': 'low' } },
    ],

    // How they process and express emotion
    emotionalExpression: [
      { source: 'storytelling',  axis: 'emotionalRange',   map: { wide: 'expressive', moderate: 'balanced', flat: 'contained' } },
      { source: 'storytelling',  axis: 'conflictAvoidance', map: { escalates: 'expressive', engages: 'balanced', avoids: 'contained' } },
    ],

    // Risk appetite
    riskAppetite: [
      { source: 'chess',         axis: 'riskTolerance',  map: { aggressive: 'high', balanced: 'medium', conservative: 'low' } },
      { source: 'decision_tree', axis: 'riskFraming',    map: { 'gain-seeking': 'high', neutral: 'medium', 'loss-averse': 'low' } },
      { source: 'pattern_game',  axis: 'processingStyle', map: { intuitive: 'high', deliberate: 'low' } },
    ],
  };

  // ─── PROFILE STORE ─────────────────────────────────────────────────────────

  let profile = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : _emptyProfile();
    } catch(_) { return _emptyProfile(); }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch(_) {}
    // Also push the condensed profile into ariaMemory
    _syncToAriaMemory();
  }

  function _emptyProfile() {
    return {
      version: 2,
      lastUpdated: null,
      sources: {},        // keyed by GAME_SOURCES keys + 'therapy_threshold' + 'chat_behavior'
      triangulated: {},   // keyed by TRAIT_TRIANGULATIONS keys
      signals: [],        // rolling log of raw signal events
      disposition: null,  // the final synthesized directive for Aria
    };
  }

  // ─── SIGNAL INGESTION ──────────────────────────────────────────────────────
  // Every source calls this. Idempotent — re-ingesting the same game snapshot
  // updates its slot without duplicating.

  function ingestGameSnapshot(sourceKey, snapshot) {
    if (!GAME_SOURCES[sourceKey]) {
      console.warn(`[ariaUnifiedProfile] unknown source: ${sourceKey}`);
      return;
    }

    profile.sources[sourceKey] = {
      snapshot,
      ingestedAt: Date.now(),
      status: 'live',
    };

    profile.lastUpdated = Date.now();
    _recompute();
    save();
  }

  // For non-game signals (therapy threshold, chat behavior)
  function ingestSignal(category, data) {
    const entry = { category, data, timestamp: Date.now() };

    // Rolling log
    profile.signals.push(entry);
    if (profile.signals.length > MAX_SIGNALS) profile.signals.shift();

    // Also update named source slot
    if (!profile.sources[category]) profile.sources[category] = { history: [] };
    profile.sources[category].history = profile.sources[category].history || [];
    profile.sources[category].history.push(entry);
    if (profile.sources[category].history.length > 20) {
      profile.sources[category].history.shift();
    }
    profile.sources[category].lastUpdated = Date.now();

    profile.lastUpdated = Date.now();
    _recompute();
    save();
  }

  // ─── TRIANGULATION ENGINE ──────────────────────────────────────────────────

  function _recompute() {
    const triangulated = {};

    for (const [trait, mappings] of Object.entries(TRAIT_TRIANGULATIONS)) {
      const votes = [];

      for (const m of mappings) {
        const sourceData = profile.sources[m.source];
        if (!sourceData?.snapshot) continue;

        const raw = sourceData.snapshot[m.axis];
        if (raw === undefined || raw === null) continue;

        // Special case: timedOutCount → pressure response
        if (m.axis === 'timedOutCount' && m.map === null) {
          const count = parseInt(raw) || 0;
          if (count >= 2) votes.push({ value: 'crumbles', weight: 1.5, source: m.source });
          continue;
        }

        if (!m.map) continue;
        const mapped = m.map[raw];
        if (mapped) votes.push({ value: mapped, weight: 1, source: m.source });
      }

      if (!votes.length) continue;

      // Tally: weight each vote, pick winner
      const tally = {};
      votes.forEach(v => { tally[v.value] = (tally[v.value] || 0) + v.weight; });
      const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
      const winner = sorted[0][0];
      const confidence = sorted[0][1] / votes.reduce((a, v) => a + v.weight, 0);

      triangulated[trait] = {
        value:      winner,
        confidence: Math.round(confidence * 100),
        sources:    votes.map(v => v.source),
        unanimous:  sorted.length === 1 || sorted[0][1] > sorted[1]?.[1] * 2,
      };
    }

    profile.triangulated = triangulated;
    profile.disposition   = _buildDisposition(triangulated);
  }

  // ─── DISPOSITION SYNTHESIS ─────────────────────────────────────────────────
  // Converts triangulated trait map → behavioral directives for Aria's prompt.
  // Only uses high-confidence triangulations (2+ sources agreeing).

  function _buildDisposition(t) {
    const directives = [];

    // Decide how Aria paces herself
    const speed = t.decisionSpeed;
    if (speed && speed.sources.length >= 2) {
      if (speed.value === 'fast') {
        directives.push('pace: fast thinker. doesn\'t need buildup. get to the point.');
      } else if (speed.value === 'slow') {
        directives.push('pace: deliberate processor. don\'t rush. let ideas land before moving on.');
      }
    }

    // Uncertainty
    const uncertainty = t.uncertaintyTolerance;
    if (uncertainty && uncertainty.sources.length >= 2) {
      if (uncertainty.value === 'low') {
        directives.push('uncertainty: low tolerance. announce changes and surprises before they land. don\'t pivot without warning.');
      } else if (uncertainty.value === 'high') {
        directives.push('uncertainty: comfortable with ambiguity. can hold open questions. doesn\'t need resolution to feel okay.');
      }
    }

    // Pressure
    const pressure = t.pressureResponse;
    if (pressure && pressure.sources.length >= 2) {
      if (pressure.value === 'sharpens') {
        directives.push('pressure: gets sharper under pressure. can handle stakes. don\'t soften when things are hard.');
      } else if (pressure.value === 'crumbles') {
        directives.push('pressure: can freeze or spiral under load. steady presence helps more than urgency. don\'t escalate.');
      }
    }

    // Learning
    const learning = t.adaptiveLearning;
    if (learning && learning.sources.length >= 2) {
      if (learning.value === 'high') {
        directives.push('learning: picks things up fast within a session. doesn\'t need repetition. trust them to carry context.');
      } else if (learning.value === 'low') {
        directives.push('learning: doesn\'t adapt quickly mid-session. concrete, consistent guidance works better than abstract hints.');
      }
    }

    // Risk
    const risk = t.riskAppetite;
    if (risk && risk.sources.length >= 2) {
      if (risk.value === 'high') {
        directives.push('risk: comfortable with bold moves and outcomes they can\'t control. doesn\'t need reassurance.');
      } else if (risk.value === 'low') {
        directives.push('risk: prefers safety and certainty. highlight stability and control angles when they exist.');
      }
    }

    // Emotion (from storytelling only until more games are live)
    const emotion = t.emotionalExpression;
    if (emotion) {
      if (emotion.value === 'expressive') {
        directives.push('emotional style: expressive. feelings are part of how they process. make room for that.');
      } else if (emotion.value === 'contained') {
        directives.push('emotional style: contained. they don\'t lead with feelings. don\'t push them to.');
      }
    }

    if (!directives.length) return null;
    return directives;
  }

  // ─── PROMPT FRAGMENT ───────────────────────────────────────────────────────
  // Called by buildSystemPrompt to inject the cross-game profile

  function buildPromptFragment() {
    if (!profile.disposition?.length) return '';

    const liveCount = Object.keys(profile.sources).filter(k =>
      profile.sources[k]?.snapshot || profile.sources[k]?.status === 'live'
    ).length;

    if (liveCount === 0) return '';

    const lines = ['\n\nCROSS-GAME PROFILE (triangulated from multiple sources):'];
    profile.disposition.forEach(d => lines.push(`  ${d}`));

    // Add triangulation confidence note if multiple games are live
    if (liveCount >= 2) {
      const highConfidence = Object.values(profile.triangulated)
        .filter(t => t.confidence >= 70 && t.sources.length >= 2);
      if (highConfidence.length) {
        lines.push(`  (${highConfidence.length} trait${highConfidence.length > 1 ? 's' : ''} confirmed across ${liveCount} games — high confidence)`);
      }
    } else {
      lines.push('  (from 1 game source — more games will sharpen this)');
    }

    lines.push('  use these to inform how you speak, not what you say. don\'t reference the games.');
    return lines.join('\n');
  }

  // ─── ARIA MEMORY SYNC ──────────────────────────────────────────────────────
  // Pushes the synthesized profile into ariaMemory so it reaches Supabase

  function _syncToAriaMemory() {
    if (typeof ariaMemory === 'undefined') return;
    if (!profile.disposition?.length) return;

    try {
      profile.disposition.forEach((d, i) => {
        ariaMemory.remember('unified_profile', `directive_${i}`, d, 0.9, 'triangulated');
      });

      // Store triangulated traits individually
      Object.entries(profile.triangulated).forEach(([trait, data]) => {
        if (data.confidence >= 60) {
          ariaMemory.remember('unified_profile', trait, `${data.value} (${data.confidence}% confidence, ${data.sources.join('+')})`, 0.85, 'triangulated');
        }
      });
    } catch(_) {}
  }

  // ─── GAME STATUS PANEL ─────────────────────────────────────────────────────
  // Returns a structured summary of what games are live vs pending
  // Used by the profile screen to show "games that contribute to your read"

  function getGameStatus() {
    return Object.entries(GAME_SOURCES).map(([key, def]) => ({
      key,
      label:     def.label,
      status:    def.status,
      played:    !!profile.sources[key]?.snapshot,
      lastPlayed: profile.sources[key]?.ingestedAt || null,
      axisCount: def.axes.length,
    }));
  }

  // ─── PROFILE SUMMARY ───────────────────────────────────────────────────────
  // Human-readable summary for the profile screen

  function getSummary() {
    const liveGames   = getGameStatus().filter(g => g.played);
    const triangulated = Object.entries(profile.triangulated)
      .filter(([_, t]) => t.confidence >= 60 && t.sources.length >= 2)
      .map(([trait, t]) => ({ trait, value: t.value, confidence: t.confidence, sources: t.sources }));

    return {
      gamesPlayed:   liveGames.length,
      gamesTotal:    Object.keys(GAME_SOURCES).length,
      triangulated,
      disposition:   profile.disposition || [],
      lastUpdated:   profile.lastUpdated,
    };
  }

  // ─── THERAPY THRESHOLD SUMMARY ─────────────────────────────────────────────
  // Returns a condensed read of any threshold signals — for internal use only

  function getThresholdRead() {
    const th = profile.sources['therapy_threshold'];
    if (!th?.history?.length) return null;

    const recent = th.history.slice(-10);
    const highLevelEvents = recent.filter(e => ['surface', 'checkin'].includes(e.data?.level));

    if (!highLevelEvents.length) return null;

    return {
      eventCount:   highLevelEvents.length,
      lastLevel:    highLevelEvents[highLevelEvents.length - 1]?.data?.level,
      lastTimestamp: highLevelEvents[highLevelEvents.length - 1]?.timestamp,
    };
  }

  // ─── INIT / PATCH ──────────────────────────────────────────────────────────
  // Hook into ariaGamesUpgrade to auto-ingest pattern game snapshots

  function init() {
    // When ariaGamesUpgrade saves a disposition, also ingest into unified profile
    if (typeof ariaGamesUpgrade !== 'undefined') {
      const _origSave = ariaGamesUpgrade.dispositionCache.save;
      ariaGamesUpgrade.dispositionCache.save = function(snapshot) {
        const result = _origSave.apply(this, arguments);
        // Ingest into unified profile under pattern_game key
        ariaUnifiedProfile.ingestGameSnapshot('pattern_game', snapshot);
        return result;
      };
    }

    // Patch buildSystemPrompt to inject cross-game profile
    if (typeof buildSystemPrompt === 'function') {
      const _orig = buildSystemPrompt;
      window.buildSystemPrompt = function() {
        let system = _orig.apply(this, arguments);
        system += ariaUnifiedProfile.buildPromptFragment();
        return system;
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 300));
  } else {
    setTimeout(init, 300);
  }

  // ─── PUBLIC API ────────────────────────────────────────────────────────────

  return {
    ingestGameSnapshot,
    ingestSignal,
    buildPromptFragment,
    getGameStatus,
    getSummary,
    getThresholdRead,
    GAME_SOURCES,
    get profile() { return profile; },
    // For new games to register themselves at runtime
    registerGameSource(key, definition) {
      GAME_SOURCES[key] = { ...definition, status: 'live' };
      _recompute();
    },
  };

})();
