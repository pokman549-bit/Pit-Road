/* ================================================================
   PIT ROAD — app.js
   Feature 1: Baseline wizard, manual log, dashboard, history
   Feature 2: AI Daily Trainer
   ================================================================ */

'use strict';

// ================================================================
// BENCHMARKS — edit these numbers to change elite targets
// ================================================================
const BENCHMARKS = {
  sprint: {
    label: '10-Yard Sprint', unit: 's', lowerIsBetter: true,
    eliteMin: 1.7, eliteMax: 1.9,
    desc: 'Elite pit athletes: 1.7–1.9s',
  },
  agility: {
    label: 'Pro Agility (5-10-5)', unit: 's', lowerIsBetter: true,
    eliteMin: 4.4, eliteMax: 4.7,
    desc: 'Elite pit athletes: 4.4–4.7s',
  },
  broadJump: {
    label: 'Broad Jump', unit: 'ft', lowerIsBetter: false,
    eliteMin: 8.5, eliteMax: 9.5,
    desc: 'Elite pit athletes: 8.5–9.5+ ft',
  },
  lift1RM: {
    label: 'Trap-Bar Est. 1RM', unit: 'lbs', lowerIsBetter: false,
    bwMultiplier: 2.0,
    desc: 'Target: 2× your bodyweight',
  },
  bodyweight: {
    label: 'Bodyweight', unit: 'lbs',
    targetLo: 240, targetHi: 255,
    desc: 'Recomposition target: 240–255 lbs',
  },
};

// ================================================================
// DATA LAYER
// ================================================================
const DB = {
  _r(k)  { try { return JSON.parse(localStorage.getItem('pr_' + k)); } catch { return null; } },
  _w(k,v){ localStorage.setItem('pr_' + k, JSON.stringify(v)); },

  isFirstLaunch:   ()  => !DB._r('setup'),
  completeSetup:   ()  => DB._w('setup', true),

  getBaselines:      ()  => DB._r('baselines') || [],
  addBaseline:       (b) => { const a = DB.getBaselines(); a.push(b); DB._w('baselines', a); },
  getLatestBaseline: ()  => { const a = DB.getBaselines(); return a.length ? a[a.length - 1] : null; },

  getWorkouts:  ()       => DB._r('workouts') || [],
  addWorkout:   (w)      => { const a = DB.getWorkouts(); a.push(w); DB._w('workouts', a); return w; },
  getWorkout:   (id)     => DB.getWorkouts().find(w => w.id === id) || null,
  updateWorkout:(id, patch) => {
    const a = DB.getWorkouts();
    const i = a.findIndex(w => w.id === id);
    if (i >= 0) { a[i] = Object.assign({}, a[i], patch); DB._w('workouts', a); }
  },
  deleteWorkout:(id) => {
    DB._w('workouts', DB.getWorkouts().filter(w => w.id !== id));
  },

  getRestDays:   ()  => DB._r('restdays') || [],
  addRestDay:    (d) => {
    const a = DB.getRestDays();
    if (!a.includes(d)) { a.push(d); DB._w('restdays', a); }
  },
  removeRestDay: (d) => DB._w('restdays', DB.getRestDays().filter(x => x !== d)),

  getTrackDays:   ()        => DB._r('trackdays') || [],
  addTrackDay:    (d, note) => {
    const a = DB.getTrackDays();
    if (!a.find(t => t.date === d)) { a.push({ date: d, note: note || '' }); DB._w('trackdays', a); }
  },
  removeTrackDay: (d)       => DB._w('trackdays', DB.getTrackDays().filter(t => t.date !== d)),
  getTrackDay:    (d)       => DB.getTrackDays().find(t => t.date === d) || null,

  getNutriDay:      (date)    => DB._r('nutriday_' + date) || [],
  saveNutriDay:     (date, e) => DB._w('nutriday_' + date, e),
  getNutriTargets:  ()        => DB._r('nutri_targets') || { calories: 3500, protein: 220, carbs: 450, fat: 100, fiber: 40, sodium: 3500 },
  saveNutriTargets: (t)       => DB._w('nutri_targets', t),

  getBodyLogs:      ()  => DB._r('bodylog') || [],
  addBodyLog:       (b) => { const a = DB.getBodyLogs(); a.push(b); DB._w('bodylog', a); },
  getLatestBodyLog: ()  => { const a = DB.getBodyLogs(); return a.length ? a[a.length - 1] : null; },

  getSleepLogs:      ()  => DB._r('sleeplogs') || [],
  addSleepLog:       (s) => { const a = DB.getSleepLogs(); a.push(s); DB._w('sleeplogs', a); },
  getLatestSleepLog: ()  => { const a = DB.getSleepLogs(); return a.length ? a[a.length - 1] : null; },
  getTodaySleepLog:  ()  => DB.getSleepLogs().find(s => s.date === today()) || null,

  // Preferences — merged with defaults so new fields always exist
  getPrefs:  () => Object.assign(
    { defaultGym:'', avoidExercises:'', injuryNotes:'', favoriteExercises:'',
      equipmentNotes:'', trainingGoals:'', trainingNotes:'',
      dietaryRestrictions:'', dietaryGoals:'', recoveryNotes:'', coachNotes:'' },
    DB._r('prefs') || {}
  ),
  savePrefs: (p) => DB._w('prefs', p),
};

// Returns the most current bodyweight: body log → baseline → 260
const getCurrentWeight = () =>
  DB.getLatestBodyLog()?.weight || DB.getLatestBaseline()?.bodyweight || 260;

// ================================================================
// UTILITIES
// ================================================================
const uid    = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today  = () => new Date().toISOString().slice(0, 10);

const fmtDate = (s) => {
  const d = new Date(s + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const epley1RM = (weight, reps) => {
  if (!weight || !reps) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
};

const fmtJump = (feet, inches) => `${feet}' ${inches}"`;

const daysSince = (dateStr) => {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr + 'T12:00:00').getTime()) / 86400000);
};

const calcStreak = (workouts, restDays = [], trackDays = []) => {
  // Active dates = workouts + rest days + track/travel days (all keep streak alive)
  const active = new Set([
    ...workouts.map(w => w.date),
    ...restDays,
    ...trackDays.map(t => t.date),
  ]);
  if (!active.size) return { current: 0, longest: 0 };
  const sorted = [...active].sort();
  let longest = 1, run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const diff = (new Date(sorted[i] + 'T12:00:00') - new Date(sorted[i-1] + 'T12:00:00')) / 86400000;
    if (diff === 1) { run++; if (run > longest) longest = run; }
    else run = 1;
  }
  const todayStr = today();
  const yestStr  = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  let current = 0;
  if (active.has(todayStr) || active.has(yestStr)) {
    let d = new Date((active.has(todayStr) ? todayStr : yestStr) + 'T12:00:00');
    while (active.has(d.toISOString().slice(0, 10))) {
      current++;
      d = new Date(d.getTime() - 86400000);
    }
  }
  return { current, longest };
};

// ================================================================
// TOAST
// ================================================================
let _toastTimer;
const toast = (msg, type = 'ok') => {
  const el = document.getElementById('toast');
  clearTimeout(_toastTimer);
  el.textContent = msg;
  el.className = `toast ${type}`;
  requestAnimationFrame(() => el.classList.add('visible'));
  _toastTimer = setTimeout(() => el.classList.remove('visible'), 3200);
};

// ================================================================
// ROUTER
// ================================================================
const show = (id) => {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (!el) { console.error('Screen not found:', id); return; }
  el.classList.add('active');
  window.scrollTo(0, 0);

  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.target === id);
  });
  document.getElementById('bottom-nav').style.display = id === 'screen-wizard' ? 'none' : 'flex';
};

// ================================================================
// BASELINE WIZARD
// ================================================================
let _bdata = {};
const TOTAL_STEPS = 6;

const wizardGo = (step) => {
  document.querySelectorAll('.wizard-step').forEach(s => s.classList.remove('active'));
  document.querySelector(`.wizard-step[data-s="${step}"]`).classList.add('active');
  document.getElementById('wiz-progress').style.width =
    (step === 0 ? 0 : Math.round((step / TOTAL_STEPS) * 100)) + '%';
};

const wizardStart = () => { _bdata = {}; wizardGo(0); show('screen-wizard'); };

const wizardSkip = () => {
  DB.completeSetup();   // mark first-launch done so wizard never re-forces
  renderDashboard();
  show('screen-home');
};

// ================================================================
// REST DAY LOGGING
// ================================================================
const logRestDay = () => {
  const todayStr = today();
  if (DB.getWorkouts().some(w => w.date === todayStr)) {
    toast('You already logged a workout today', 'err');
    return;
  }
  DB.addRestDay(todayStr);
  const wtx = getWeeklyTrainingContext();
  if (!wtx.weekTargetMet) {
    toast(`Rest day logged — but you still need ${wtx.sessionsRemaining} session${wtx.sessionsRemaining > 1 ? 's' : ''} this week 💪`, 'ok');
  } else {
    toast('Rest day logged — fully earned. Recover well 🛌', 'ok');
  }
  renderDashboard();
};

const cancelRestDay = (dateStr) => {
  DB.removeRestDay(dateStr);
  toast('Rest day removed', 'ok');
  renderDashboard();
  // If day view is open for this date, refresh it
  const detailEl = document.getElementById('screen-detail');
  if (detailEl && detailEl.classList.contains('active')) openDayView(dateStr);
};

// ================================================================
// TRACK / TRAVEL DAY LOGGING
// ================================================================
const logTrackDay = () => {
  const todayStr = today();
  if (DB.getWorkouts().some(w => w.date === todayStr)) {
    toast('You already logged a workout today', 'err');
    return;
  }
  const note = prompt('Race weekend, travel, or event? (optional — tap Cancel to skip)') || '';
  DB.addTrackDay(todayStr, note.trim());
  toast('Track/travel day logged — streak protected 🏁', 'ok');
  renderDashboard();
};

const logTrackDayForDate = (dateStr) => {
  const note = prompt('Race weekend, travel, or event? (optional)') || '';
  DB.addTrackDay(dateStr, note.trim());
  toast('Track day logged 🏁', 'ok');
  openDayView(dateStr);
  renderDashboard();
};

const cancelTrackDay = (dateStr) => {
  DB.removeTrackDay(dateStr);
  toast('Track day removed', 'ok');
  renderDashboard();
  const detailEl = document.getElementById('screen-detail');
  if (detailEl && detailEl.classList.contains('active')) openDayView(dateStr);
};

const buildTrackDayCardHtml = () => {
  const track   = DB.getTrackDay(today());
  const note    = track?.note || 'Race weekend / travel';
  const wtx     = getWeeklyTrainingContext();
  const subtext = wtx.trackDaysThisWeek > 0
    ? `Session target adjusted to ${wtx.effectiveTarget}/week · streak protected`
    : 'Streak protected';
  return `
    <div class="card today-card" style="margin-bottom:8px;border-color:rgba(255,149,0,0.25)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div style="flex:1;min-width:0">
          <div class="today-session-tag" style="color:#ff9500">TRACK / TRAVEL · TODAY</div>
          <div class="today-session-name" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${note}</div>
          <div style="font-size:0.78rem;font-weight:600;color:#ff9500;margin-top:6px">${subtext}</div>
        </div>
        <div style="font-size:1.6rem;flex-shrink:0">🏁</div>
      </div>
    </div>
    <button class="btn btn-ghost btn-sm" style="width:100%;margin-bottom:12px;font-size:0.8rem;opacity:0.55"
            onclick="cancelTrackDay('${today()}')">✕ Remove track day</button>
  `;
};

const buildRestDayCardHtml = () => {
  const wtx     = getWeeklyTrainingContext();
  const subtext = wtx.weekTargetMet
    ? `Streak protected · ${wtx.sessionsThisWeek}/${wtx.target} sessions done ✓`
    : `${wtx.sessionsThisWeek}/${wtx.target} sessions this week — ${wtx.sessionsRemaining} still needed`;
  const subColor = wtx.weekTargetMet ? 'var(--green)' : 'var(--gold)';
  return `
    <div class="card today-card" style="margin-bottom:8px;border-color:rgba(255,255,255,0.12)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div style="flex:1;min-width:0">
          <div class="today-session-tag" style="color:var(--muted)">REST DAY · TODAY</div>
          <div class="today-session-name">Recovery logged ✓</div>
          <div style="font-size:0.78rem;font-weight:600;color:${subColor};margin-top:6px">${subtext}</div>
        </div>
        <div style="font-size:1.6rem;flex-shrink:0">🛌</div>
      </div>
    </div>
    <button class="btn btn-ghost btn-sm" style="width:100%;margin-bottom:12px;font-size:0.8rem;opacity:0.55"
            onclick="cancelRestDay('${today()}')">✕ Remove rest day</button>
  `;
};

// ================================================================
// MILESTONE CELEBRATIONS
// ================================================================
const showMilestone = (lines) => {
  const el = document.getElementById('milestone-banner');
  if (!el) return;
  el.innerHTML = `
    <div class="milestone-inner">
      <div class="milestone-trophy">🏁</div>
      <div class="milestone-body">
        <div class="milestone-title">New PR!</div>
        ${lines.map(l => `<div class="milestone-line">${l}</div>`).join('')}
      </div>
      <button class="milestone-close" onclick="document.getElementById('milestone-banner').style.display='none'">✕</button>
    </div>`;
  el.style.display = 'flex';
  setTimeout(() => { if (el) el.style.display = 'none'; }, 8000);
};

const checkBaselineMilestones = (newB, oldB) => {
  if (!oldB) return;
  const msgs = [];
  if (newB.sprint && oldB.sprint && newB.sprint < oldB.sprint) {
    msgs.push(`10-Yard Sprint: ${newB.sprint}s (↓${(oldB.sprint - newB.sprint).toFixed(2)}s faster)`);
    if (newB.sprint <= BENCHMARKS.sprint.eliteMax) msgs.push('🔥 Elite sprint territory reached!');
  }
  if (newB.agility && oldB.agility && newB.agility < oldB.agility) {
    msgs.push(`Pro Agility: ${newB.agility}s (↓${(oldB.agility - newB.agility).toFixed(2)}s faster)`);
    if (newB.agility <= BENCHMARKS.agility.eliteMax) msgs.push('🔥 Elite agility level reached!');
  }
  if (newB.jumpFt != null && oldB.jumpFt != null) {
    const newIn = newB.jumpFt * 12 + (newB.jumpIn || 0);
    const oldIn = oldB.jumpFt * 12 + (oldB.jumpIn || 0);
    if (newIn > oldIn) msgs.push(`Broad Jump: ${fmtJump(newB.jumpFt, newB.jumpIn)} (+${newIn - oldIn} in)`);
  }
  if (newB.estimated1RM && oldB.estimated1RM && newB.estimated1RM > oldB.estimated1RM) {
    msgs.push(`Est. 1RM: ${newB.estimated1RM}lb (+${newB.estimated1RM - oldB.estimated1RM}lb)`);
    if (newB.estimated1RM >= getCurrentWeight() * 2) msgs.push('🔥 2× bodyweight target hit!');
  }
  if (msgs.length) showMilestone(msgs);
};

const checkWorkoutPRs = (savedWorkout) => {
  const allPrev = DB.getWorkouts().filter(w => w.id !== savedWorkout.id);
  const msgs = [];
  (savedWorkout.exercises || []).forEach(ex => {
    const newRM = (ex.sets || []).reduce((best, s) => {
      const rm = s.weight && s.reps ? epley1RM(s.weight, s.reps) : 0;
      return rm > best ? rm : best;
    }, 0);
    if (!newRM) return;
    const prevBest = allPrev
      .flatMap(w => w.exercises || [])
      .filter(e => e.name === ex.name)
      .reduce((best, e) => {
        const rm = (e.sets || []).reduce((b, s) =>
          s.weight && s.reps ? Math.max(b, epley1RM(s.weight, s.reps)) : b, 0);
        return rm > best ? rm : best;
      }, 0);
    if (newRM > prevBest && prevBest > 0) msgs.push(`${ex.name}: ${newRM}lb est. 1RM`);
  });
  if (msgs.length) showMilestone(msgs.length === 1 ? msgs : [`${msgs.length} exercise PRs this session!`, ...msgs.slice(0, 3)]);
};

// ================================================================
// TODAY CARD
// ================================================================
const buildTodayCardHtml = () => {
  const workouts = DB.getWorkouts();
  const phase    = determinePhase(workouts);
  const nextType = getNextSessionType(workouts, phase);
  const typeLabels = {
    A: 'Full-Body Strength', B: 'Conditioning + Core', C: 'Lower + Movement',
    D: 'Conditioning', S: 'Strength Maintenance', P: 'Speed & Power',
  };
  const sessionLabel = typeLabels[nextType] || 'Next Session';

  const latestSleep = DB.getLatestSleepLog();
  const level = calcRecoveryLevel(latestSleep);
  const levelColor = { poor:'#e63946', moderate:'#f5a623', good:'var(--green)', excellent:'var(--red)' }[level] || 'var(--muted)';
  const levelText  = { poor:'⚠ Low recovery — lighter session today', moderate:'→ Moderate recovery', good:'✓ Good recovery', excellent:'💪 Excellent — push hard today' }[level];
  const sleepFallback = !level && latestSleep?.sleepDuration ? `● ${latestSleep.sleepDuration}h sleep` : null;
  const recoveryHtml = levelText
    ? `<div style="font-size:0.78rem;font-weight:600;color:${levelColor};margin-top:6px">${levelText}</div>`
    : sleepFallback
      ? `<div style="font-size:0.78rem;color:var(--muted);margin-top:6px">${sleepFallback}</div>`
      : '';

  return `
    <div class="card today-card" onclick="openTrainScreen()"
         style="cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div style="flex:1;min-width:0">
          <div class="today-session-tag">PH${phase}-${nextType} &middot; UP NEXT</div>
          <div class="today-session-name">${sessionLabel}</div>
          ${recoveryHtml}
        </div>
        <div style="color:var(--red);font-size:1.6rem;font-weight:200;flex-shrink:0;opacity:0.8">›</div>
      </div>
    </div>`;
};

const wizardSave = () => {
  const prevBaseline = DB.getLatestBaseline();
  const newBaseline  = Object.assign({}, _bdata, {
    id: uid(), date: today(),
    estimated1RM: epley1RM(_bdata.liftWeight, _bdata.liftReps),
  });
  DB.addBaseline(newBaseline);
  DB.completeSetup();
  toast('Baselines saved! Let\'s get to work. 🏁', 'ok');
  setTimeout(() => {
    renderDashboard(); show('screen-home');
    checkBaselineMilestones(newBaseline, prevBaseline);
  }, 500);
};

const renderWizSummary = () => {
  const d = _bdata;
  const jump = d.jumpFt !== undefined ? fmtJump(d.jumpFt, d.jumpIn) : '—';
  const liftLabel = { 'trap-bar': 'Trap-Bar Deadlift', 'leg-press': 'Leg Press', 'barbell': 'Barbell Deadlift' }[d.liftType] || 'Main Lift';
  document.getElementById('wiz-summary').innerHTML = `
    <div class="card">
      <div class="summary-row"><span class="summary-key">10-Yard Sprint</span><span class="summary-val">${d.sprint ? d.sprint + 's' : '—'}</span></div>
      <div class="summary-row"><span class="summary-key">Broad Jump</span><span class="summary-val">${jump}</span></div>
      <div class="summary-row"><span class="summary-key">Pro Agility</span><span class="summary-val">${d.agility ? d.agility + 's' : '—'}</span></div>
      <div class="summary-row"><span class="summary-key">${liftLabel}</span><span class="summary-val">${d.liftWeight ? d.liftWeight + ' lbs × ' + d.liftReps + ' reps' : '—'}</span></div>
      <div class="summary-row"><span class="summary-key">Est. 1RM</span><span class="summary-val">${d.liftWeight ? epley1RM(d.liftWeight, d.liftReps) + ' lbs' : '—'}</span></div>
      <div class="summary-row"><span class="summary-key">Bodyweight</span><span class="summary-val">${d.bodyweight ? d.bodyweight + ' lbs' : '—'}</span></div>
    </div>
    <p class="mt8" style="text-align:center">Saved with date: ${fmtDate(today())}</p>
  `;
};

const wizNext = {
  0: () => wizardGo(1),
  1: () => {
    const v = parseFloat(document.getElementById('w-sprint').value);
    if (!v || v < 0.8 || v > 8) { toast('Enter a time between 0.8 and 8 seconds', 'err'); return; }
    _bdata.sprint = v; wizardGo(2);
  },
  2: () => {
    const ft = parseInt(document.getElementById('w-jump-ft').value) || 0;
    const inch = parseInt(document.getElementById('w-jump-in').value) || 0;
    if (ft < 2 || ft > 12) { toast('Enter feet between 2 and 12', 'err'); return; }
    if (inch < 0 || inch > 11) { toast('Inches must be 0–11', 'err'); return; }
    _bdata.jumpFt = ft; _bdata.jumpIn = inch; _bdata.broadJump = ft + inch / 12; wizardGo(3);
  },
  3: () => {
    const v = parseFloat(document.getElementById('w-agility').value);
    if (!v || v < 2 || v > 12) { toast('Enter a time between 2 and 12 seconds', 'err'); return; }
    _bdata.agility = v; wizardGo(4);
  },
  4: () => {
    const w = parseFloat(document.getElementById('w-lift-wt').value);
    const r = parseInt(document.getElementById('w-lift-reps').value);
    const t = document.getElementById('w-lift-type').value;
    if (!w || w < 10) { toast('Enter a weight', 'err'); return; }
    if (!r || r < 1 || r > 20) { toast('Enter reps (1–20)', 'err'); return; }
    _bdata.liftType = t; _bdata.liftWeight = w; _bdata.liftReps = r; wizardGo(5);
  },
  5: () => {
    const v = parseFloat(document.getElementById('w-bw').value);
    if (!v || v < 80 || v > 500) { toast('Enter your bodyweight in lbs', 'err'); return; }
    _bdata.bodyweight = v; renderWizSummary(); wizardGo(6);
  },
};

// ================================================================
// DASHBOARD
// ================================================================
const renderDashboard = () => {
  const baseline  = DB.getLatestBaseline();
  const workouts  = DB.getWorkouts().slice().reverse();
  const lastOut   = workouts[0];
  const phase      = determinePhase(DB.getWorkouts());
  const restDays   = DB.getRestDays();
  const trackDays  = DB.getTrackDays();
  const { current: streakCur, longest: streakBest } = calcStreak(DB.getWorkouts(), restDays, trackDays);

  // Today card — show appropriate state based on what's logged today
  const todayEl = document.getElementById('dash-today');
  if (todayEl) {
    const todayStr        = today();
    const hasWorkoutToday = DB.getWorkouts().some(w => w.date === todayStr);
    const hasRestToday    = restDays.includes(todayStr);
    const hasTrackToday   = !!DB.getTrackDay(todayStr);

    if (hasTrackToday && !hasWorkoutToday) {
      todayEl.innerHTML = buildTrackDayCardHtml();
    } else if (hasRestToday && !hasWorkoutToday) {
      todayEl.innerHTML = buildRestDayCardHtml();
    } else {
      let todayHtml = buildTodayCardHtml();
      if (!hasWorkoutToday) {
        const wtx        = getWeeklyTrainingContext();
        const restLabel  = wtx.weekTargetMet
          ? `🛌 Rest Day · ${wtx.sessionsThisWeek}/${wtx.effectiveTarget} sessions done`
          : `🛌 Rest Day · ${wtx.sessionsThisWeek}/${wtx.effectiveTarget} this week`;
        todayHtml += `
          <div style="display:flex;gap:8px;margin-bottom:12px">
            <button class="btn btn-ghost btn-sm" style="flex:1;font-size:0.78rem;opacity:0.6;touch-action:manipulation"
                    onclick="logRestDay()">${restLabel}</button>
            <button class="btn btn-ghost btn-sm" style="flex:1;font-size:0.78rem;opacity:0.6;touch-action:manipulation"
                    onclick="logTrackDay()">🏁 Track / Travel</button>
          </div>`;
      }
      todayEl.innerHTML = todayHtml;
    }
  }

  // Stat pills — streak inline so no separate card needed
  document.getElementById('dash-stats').innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      <div class="stat-pill">🔥 <span class="pill-val">${streakCur}</span> streak${streakBest > 0 ? `<span style="color:var(--muted);font-weight:400"> / ${streakBest} best</span>` : ''}</div>
      <div class="stat-pill">Phase <span class="pill-val">${phase}</span></div>
      <div class="stat-pill">Sessions <span class="pill-val">${workouts.length}</span></div>
      ${lastOut ? `<div class="stat-pill">Last <span class="pill-val">${daysSince(lastOut.date) === 0 ? 'today' : daysSince(lastOut.date) + 'd ago'}</span></div>` : ''}
    </div>
  `;

  // ── Compact summary card ──────────────────────────────────────────
  // Baselines row
  let blVal = 'No baseline yet — tap to run test';
  if (baseline) {
    const jump = baseline.jumpFt !== undefined ? fmtJump(baseline.jumpFt, baseline.jumpIn) : null;
    blVal = [
      baseline.sprint    ? baseline.sprint + 's sprint'  : null,
      jump               ? jump + ' jump'                : null,
      baseline.agility   ? baseline.agility + 's agility': null,
      baseline.estimated1RM ? baseline.estimated1RM + ' lbs 1RM' : null,
    ].filter(Boolean).join(' · ');
  }

  // Body row
  const body = DB.getLatestBodyLog();
  let bodyVal = 'No check-in yet — tap to log';
  let bodyColor = 'var(--muted)';
  if (body) {
    bodyVal = [
      body.weight      ? body.weight + ' lbs'         : null,
      body.bodyFat     ? body.bodyFat + '% BF'        : null,
      body.muscleMass  ? body.muscleMass + ' lbs muscle' : null,
      body.visceralFat ? 'VF ' + body.visceralFat     : null,
    ].filter(Boolean).join(' · ');
    bodyColor = 'var(--text)';
  }

  // Sleep row
  const sleep = DB.getLatestSleepLog();
  const sleepLevel = calcRecoveryLevel(sleep);
  const sleepLevelColor = { poor:'#e63946', moderate:'#f5a623', good:'var(--green)', excellent:'var(--red)' }[sleepLevel] || 'var(--muted)';
  let sleepVal = 'Not logged — tap to log tonight';
  let sleepColor = 'var(--muted)';
  if (sleep) {
    sleepVal = [
      sleep.sleepDuration ? sleep.sleepDuration + 'h sleep' : null,
      sleep.recovery      ? 'Recovery ' + sleep.recovery    : sleep.sleepQuality ? 'Quality ' + sleep.sleepQuality : null,
      sleep.feelRating    ? 'Feel ' + sleep.feelRating + '/10' : null,
    ].filter(Boolean).join(' · ');
    sleepColor = sleepLevel ? sleepLevelColor : 'var(--text)';
  }

  document.getElementById('dash-summary').innerHTML = `
    <div class="card" style="padding:2px 16px;margin-bottom:16px">
      <div class="dash-row" onclick="renderProgressScreen();show('screen-progress')">
        <span class="dash-row-lbl">Baselines</span>
        <span class="dash-row-val" style="color:${baseline ? 'var(--text)' : 'var(--muted)'}">${blVal}</span>
        <span class="dash-row-arrow">›</span>
      </div>
      <div class="dash-row" onclick="renderProgressScreen();show('screen-progress')">
        <span class="dash-row-lbl">Body</span>
        <span class="dash-row-val" style="color:${bodyColor}">${bodyVal}</span>
        <span class="dash-row-arrow">›</span>
      </div>
      <div class="dash-row" onclick="openSleepLog()">
        <span class="dash-row-lbl">Sleep</span>
        <span class="dash-row-val" style="color:${sleepColor}">${sleepVal}</span>
        <span class="dash-row-arrow">›</span>
      </div>
    </div>
  `;

  document.getElementById('dash-calendar').innerHTML = buildCalendarHtml(DB.getWorkouts(), _calYear, _calMonth);
};

const workoutRowHtml = (w) => {
  const gymClass = w.gym === 'UNOH' ? 'unoh' : w.gym === 'Planet Fitness' ? 'pf' : 'other';
  const gymShort = w.gym === 'UNOH' ? 'UNOH' : w.gym === 'Planet Fitness' ? 'PF' : (w.gym || '?');
  const exCount  = w.exercises ? w.exercises.length : 0;
  const tag      = w.sessionType ? ` · Ph${w.phase} ${w.sessionType}` : '';
  return `
    <div class="row-item" onclick="openWorkoutDetail('${w.id}')">
      <div class="row-item-left">
        <div class="row-date">${fmtDate(w.date)}</div>
        <div class="row-title">${exCount} exercise${exCount !== 1 ? 's' : ''}${w.duration ? ' · ' + w.duration + ' min' : ''}${tag}</div>
        ${w.energy ? `<div class="row-sub" style="text-transform:capitalize">${w.energy} energy${w.aiGenerated ? ' · AI generated' : ''}</div>` : ''}
      </div>
      <span class="gym-badge ${gymClass}">${gymShort}</span>
    </div>
  `;
};

// ================================================================
// LOG WORKOUT
// ================================================================
let _exercises       = [];
let _currentGenerated = null;  // holds the AI-generated workout if coming from Train screen
let _detailId        = null;   // id of the workout currently shown in screen-detail

const openLogScreen = () => {
  _exercises = [];
  _currentGenerated = null;
  document.getElementById('log-date').value     = today();
  document.getElementById('log-gym').value      = '';
  document.getElementById('log-duration').value = '60';
  document.getElementById('log-notes').value    = '';
  document.querySelectorAll('.feel-opt').forEach(el => el.classList.remove('selected'));
  renderSets();
  show('screen-log');
};

const addExercise = (name = '') => {
  _exercises.push({ id: uid(), name, sets: [{ weight: '', reps: '' }] });
  renderSets();
};

const removeExercise = (id) => {
  _exercises = _exercises.filter(e => e.id !== id);
  renderSets();
};

const addSet = (exId) => {
  const ex = _exercises.find(e => e.id === exId);
  if (ex) { ex.sets.push({ weight: '', reps: '' }); renderSets(); }
};

const removeSet = (exId, si) => {
  const ex = _exercises.find(e => e.id === exId);
  if (ex && ex.sets.length > 1) { ex.sets.splice(si, 1); renderSets(); }
};

const updateExName    = (id, val)             => { const e = _exercises.find(x => x.id === id); if (e) e.name = val; };
const updateSetField  = (exId, si, field, val) => { const ex = _exercises.find(e => e.id === exId); if (ex?.sets[si]) ex.sets[si][field] = val; };

const renderSets = () => {
  const container = document.getElementById('exercises-list');
  if (!container) return;

  let html = _exercises.map(ex => `
    <div class="exercise-block" id="exblock-${ex.id}">
      <div class="ex-header">
        <input class="ex-name-input" type="text" placeholder="Exercise name…" value="${ex.name}"
               oninput="updateExName('${ex.id}', this.value)">
        <button class="icon-btn red" onclick="removeExercise('${ex.id}')">✕</button>
      </div>
      <div class="sets-header">
        <div class="sets-col-label">#</div>
        <div class="sets-col-label left">lbs</div>
        <div class="sets-col-label left">reps</div>
        <div></div>
      </div>
      ${ex.sets.map((s, si) => `
        <div class="set-row">
          <div class="set-num">${si + 1}</div>
          <input class="set-input" type="number" placeholder="0" min="0" value="${s.weight}"
                 oninput="updateSetField('${ex.id}', ${si}, 'weight', this.value)" inputmode="decimal">
          <input class="set-input" type="number" placeholder="0" min="0" value="${s.reps}"
                 oninput="updateSetField('${ex.id}', ${si}, 'reps', this.value)" inputmode="numeric">
          <button class="icon-btn" onclick="removeSet('${ex.id}', ${si})"
                  style="${ex.sets.length === 1 ? 'opacity:0.3;pointer-events:none' : ''}">−</button>
        </div>
      `).join('')}
      <button class="btn btn-ghost btn-sm mt8" onclick="addSet('${ex.id}')">+ Add Set</button>
    </div>
  `).join('');

  html += `<button class="btn btn-secondary mt8" onclick="addExercise()">+ Add Exercise</button>`;
  container.innerHTML = html;
};

const saveWorkout = () => {
  const gym      = document.getElementById('log-gym').value;
  const date     = document.getElementById('log-date').value;
  const energy   = document.querySelector('.feel-opt.selected')?.dataset.feel || 'medium';
  const duration = parseInt(document.getElementById('log-duration').value) || 60;
  const notes    = document.getElementById('log-notes').value.trim();

  if (!gym)  { toast('Select a gym first', 'err'); return; }
  if (!date) { toast('Pick a date', 'err'); return; }

  const exercises = _exercises
    .filter(e => e.name.trim())
    .map(e => ({
      name: e.name.trim(),
      sets: e.sets.map(s => ({ weight: parseFloat(s.weight) || 0, reps: parseInt(s.reps) || 0 }))
                  .filter(s => s.reps > 0),
    }))
    .filter(e => e.sets.length > 0);

  const saved = DB.addWorkout({
    id: uid(), date, gym, energy, duration, exercises, notes,
    aiGenerated:  !!_currentGenerated,
    sessionType:  _currentGenerated?.sessionType  || null,
    phase:        _currentGenerated?.phase        || null,
    createdAt:    new Date().toISOString(),
  });

  _currentGenerated = null;
  _exercises = [];
  toast('Workout saved! 💪', 'ok');
  setTimeout(() => {
    renderDashboard(); show('screen-home');
    if (saved) checkWorkoutPRs(saved);
  }, 500);
};

// ================================================================
// WORKOUT DETAIL
// ================================================================
const openWorkoutDetail = (id) => {
  const w = DB.getWorkout(id);
  if (!w) return;
  _detailId = id;

  const gymClass = w.gym === 'UNOH' ? 'unoh' : w.gym === 'Planet Fitness' ? 'pf' : 'other';
  const gymShort = w.gym === 'UNOH' ? 'UNOH' : w.gym === 'Planet Fitness' ? 'PF' : (w.gym || '?');

  let html = `
    <div class="card mb12">
      <div class="card-label">Session</div>
      <div class="summary-row"><span class="summary-key">Date</span><span class="summary-val">${fmtDate(w.date)}</span></div>
      <div class="summary-row"><span class="summary-key">Gym</span><span class="summary-val">${w.gym} <span class="gym-badge ${gymClass}" style="margin-left:6px">${gymShort}</span></span></div>
      <div class="summary-row"><span class="summary-key">Duration</span><span class="summary-val">${w.duration || '?'} min</span></div>
      <div class="summary-row"><span class="summary-key">Energy</span><span class="summary-val" style="text-transform:capitalize">${w.energy || '—'}</span></div>
      ${w.sessionType ? `<div class="summary-row"><span class="summary-key">Session</span><span class="summary-val">Phase ${w.phase} · Type ${w.sessionType}</span></div>` : ''}
      ${w.aiGenerated ? `<div class="summary-row"><span class="summary-key">Source</span><span class="summary-val" style="color:var(--gold)">⚡ AI Trainer</span></div>` : ''}
    </div>
  `;

  if (w.exercises?.length) {
    html += w.exercises.map(ex => {
      const bestSet = ex.sets.reduce((b, s) => epley1RM(s.weight, s.reps) > epley1RM(b.weight, b.reps) ? s : b, ex.sets[0]);
      return `
        <div class="card mb12">
          <div style="font-weight:700;font-size:1rem;margin-bottom:10px">${ex.name}</div>
          ${ex.sets.map((s, i) => `
            <div class="detail-set-row">
              <span class="set-id">Set ${i + 1}</span>
              <span class="set-data">${s.weight ? s.weight + ' lbs × ' : ''}${s.reps} rep${s.reps !== 1 ? 's' : ''}</span>
            </div>
          `).join('')}
          ${ex.sets.length > 1 && bestSet.weight ? `<div style="font-size:0.75rem;color:var(--muted);margin-top:8px">Est. 1RM: ${epley1RM(bestSet.weight, bestSet.reps)} lbs</div>` : ''}
        </div>
      `;
    }).join('');
  }

  if (w.notes) {
    html += `<div class="card mb12"><div class="card-label">Notes</div><p style="color:var(--text);font-size:0.875rem;line-height:1.6">${w.notes}</p></div>`;
  }

  html += `
    <div class="btn-row mt8 mb24">
      <button class="btn btn-ghost" onclick="editWorkout('${id}')">✏️ Edit</button>
      <button class="btn btn-ghost" style="color:#e05555" onclick="deleteWorkoutConfirm('${id}')">🗑 Delete</button>
    </div>
  `;

  document.getElementById('detail-content').innerHTML = html;
  document.getElementById('detail-header-date').textContent = fmtDate(w.date);
  show('screen-detail');
};

// ================================================================
// WORKOUT EDIT / DELETE
// ================================================================

const deleteWorkoutConfirm = (id) => {
  if (!confirm('Delete this workout permanently? This cannot be undone.')) return;
  DB.deleteWorkout(id);
  _detailId = null;
  toast('Workout deleted', 'ok');
  renderDashboard();
  show('screen-home');
};

// Build one editable set row (used by editWorkout and addEditSet)
const buildEditSetRow = (s, si) => `
  <div class="edit-set-row">
    <span class="set-id" style="min-width:48px">Set ${si + 1}</span>
    <input type="number" class="set-input edit-set-wt" value="${s.weight || ''}" placeholder="lbs" inputmode="decimal" style="width:72px">
    <span style="color:var(--muted);font-size:0.85rem;padding:0 2px">×</span>
    <input type="number" class="set-input edit-set-reps" value="${s.reps || ''}" placeholder="reps" inputmode="numeric" style="width:60px">
    <button class="icon-btn" onclick="removeEditSet(this)" style="margin-left:4px">−</button>
  </div>
`;

// Build one editable exercise block
const buildEditExBlock = (ex) => {
  const safeName = (ex.name || '').replace(/"/g, '&quot;');
  return `
    <div class="card mb12 edit-ex">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <input type="text" class="edit-ex-name" value="${safeName}" placeholder="Exercise name"
               style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-size:0.9rem;font-weight:600">
        <button class="icon-btn" onclick="removeEditExercise(this)" style="font-size:1rem">✕</button>
      </div>
      <div class="edit-sets-list">
        ${(ex.sets || []).map((s, si) => buildEditSetRow(s, si)).join('')}
      </div>
      <button class="btn btn-ghost btn-sm mt8" style="font-size:0.78rem;padding:6px 12px" onclick="addEditSet(this)">+ Add Set</button>
    </div>
  `;
};

const editWorkout = (id) => {
  const w = DB.getWorkout(id);
  if (!w) return;
  _detailId = id;

  const exHtml = (w.exercises || []).map(ex => buildEditExBlock(ex)).join('');

  document.getElementById('detail-content').innerHTML = `
    <div class="card mb12">
      <div class="card-label">Session Details</div>
      <div class="form-group">
        <label>Duration (min)</label>
        <input id="edit-duration" type="number" value="${w.duration || ''}" inputmode="numeric" min="1" max="300" placeholder="e.g. 60">
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label>Energy Level</label>
        <select id="edit-energy">
          <option value="">—</option>
          <option value="low"    ${w.energy === 'low'    ? 'selected' : ''}>Low</option>
          <option value="medium" ${w.energy === 'medium' ? 'selected' : ''}>Medium</option>
          <option value="high"   ${w.energy === 'high'   ? 'selected' : ''}>High</option>
        </select>
      </div>
    </div>

    <div id="edit-exercises">${exHtml}</div>

    <button class="btn btn-secondary mb12" style="width:100%" onclick="addEditExercise()">+ Add Exercise</button>

    <div class="card mb12">
      <div class="form-group" style="margin-bottom:0">
        <label>Notes</label>
        <textarea id="edit-notes" rows="3" placeholder="How did it go?">${w.notes || ''}</textarea>
      </div>
    </div>

    <div class="btn-row mt8 mb24">
      <button class="btn btn-ghost" onclick="openWorkoutDetail('${id}')">Cancel</button>
      <button class="btn btn-primary" onclick="saveWorkoutEdit('${id}')">Save Changes</button>
    </div>
  `;
  document.getElementById('detail-header-date').textContent = 'Edit · ' + fmtDate(w.date);
};

const addEditSet = (btn) => {
  const exDiv = btn.closest('.edit-ex');
  const list  = exDiv.querySelector('.edit-sets-list');
  const si    = list.querySelectorAll('.edit-set-row').length;
  list.insertAdjacentHTML('beforeend', buildEditSetRow({ weight: '', reps: '' }, si));
};

const removeEditSet = (btn) => {
  const list = btn.closest('.edit-sets-list');
  if (list && list.querySelectorAll('.edit-set-row').length <= 1) {
    toast('Each exercise needs at least one set', 'err');
    return;
  }
  btn.closest('.edit-set-row').remove();
  // Re-number remaining set labels
  btn.closest('.edit-sets-list')?.querySelectorAll('.edit-set-row').forEach((row, i) => {
    const lbl = row.querySelector('.set-id');
    if (lbl) lbl.textContent = 'Set ' + (i + 1);
  });
};

const addEditExercise = () => {
  document.getElementById('edit-exercises')
    .insertAdjacentHTML('beforeend', buildEditExBlock({ name: '', sets: [{ weight: '', reps: '' }] }));
};

const removeEditExercise = (btn) => {
  const exDivs = document.querySelectorAll('.edit-ex');
  if (exDivs.length <= 1) { toast('Workout must have at least one exercise', 'err'); return; }
  btn.closest('.edit-ex').remove();
};

const saveWorkoutEdit = (id) => {
  const exercises = Array.from(document.querySelectorAll('.edit-ex')).map(exDiv => ({
    name: exDiv.querySelector('.edit-ex-name').value.trim(),
    sets: Array.from(exDiv.querySelectorAll('.edit-set-row')).map(row => ({
      weight: parseFloat(row.querySelector('.edit-set-wt').value)  || 0,
      reps:   parseInt(row.querySelector('.edit-set-reps').value) || 0,
    })).filter(s => s.reps > 0),
  })).filter(ex => ex.name && ex.sets.length > 0);

  if (!exercises.length) { toast('Add at least one exercise with reps', 'err'); return; }

  const duration = parseInt(document.getElementById('edit-duration').value) || null;
  const energy   = document.getElementById('edit-energy').value || null;
  const notes    = document.getElementById('edit-notes').value.trim();

  DB.updateWorkout(id, { exercises, duration, energy, notes });
  toast('Workout updated ✓', 'ok');
  openWorkoutDetail(id);
};

// ================================================================
// UNIFIED DAY VIEW — shows workout + nutrition + sleep for one date
// ================================================================
const openDayView = (dateStr) => {
  const w           = DB.getWorkouts().find(wk => wk.date === dateStr);
  const nutriEntries = DB.getNutriDay(dateStr);
  const sleepLog    = DB.getSleepLogs().find(s => s.date === dateStr);

  let html = '';

  // ── Workout section ──
  if (w) {
    _detailId = w.id;
    const gymClass = w.gym === 'UNOH' ? 'unoh' : w.gym === 'Planet Fitness' ? 'pf' : 'other';
    const gymShort = w.gym === 'UNOH' ? 'UNOH' : w.gym === 'Planet Fitness' ? 'PF' : (w.gym || '?');
    html += `
      <div class="day-section-head">🏋️ Workout</div>
      <div class="card mb12">
        <div class="summary-row"><span class="summary-key">Gym</span><span class="summary-val">${w.gym} <span class="gym-badge ${gymClass}">${gymShort}</span></span></div>
        <div class="summary-row"><span class="summary-key">Duration</span><span class="summary-val">${w.duration || '?'} min</span></div>
        <div class="summary-row"><span class="summary-key">Energy</span><span class="summary-val" style="text-transform:capitalize">${w.energy || '—'}</span></div>
        ${w.sessionType ? `<div class="summary-row"><span class="summary-key">Session</span><span class="summary-val">Ph${w.phase} · ${w.sessionType}${w.aiGenerated ? ' · ⚡ AI' : ''}</span></div>` : ''}
      </div>`;
    if (w.exercises?.length) {
      html += w.exercises.map(ex => {
        const bestSet = ex.sets.reduce((b, s) => epley1RM(s.weight, s.reps) > epley1RM(b.weight, b.reps) ? s : b, ex.sets[0]);
        return `<div class="card mb12">
          <div style="font-weight:700;font-size:1rem;margin-bottom:10px">${ex.name}</div>
          ${ex.sets.map((s, i) => `
            <div class="detail-set-row">
              <span class="set-id">Set ${i+1}</span>
              <span class="set-data">${s.weight ? s.weight + ' lbs × ' : ''}${s.reps} rep${s.reps !== 1 ? 's' : ''}</span>
            </div>`).join('')}
          ${ex.sets.length > 1 && bestSet.weight ? `<div style="font-size:0.75rem;color:var(--muted);margin-top:8px">Est. 1RM: ${epley1RM(bestSet.weight, bestSet.reps)} lbs</div>` : ''}
        </div>`;
      }).join('');
    }
    if (w.notes) html += `<div class="card mb12"><div class="card-label">Notes</div><p style="color:var(--text);font-size:0.875rem;line-height:1.6">${w.notes}</p></div>`;
    html += `<div class="btn-row mt4 mb12">
      <button class="btn btn-ghost btn-sm" onclick="editWorkout('${w.id}')">✏️ Edit Workout</button>
      <button class="btn btn-ghost btn-sm" style="color:#e05555" onclick="deleteWorkoutConfirm('${w.id}')">🗑 Delete</button>
    </div>`;
  }

  // ── Nutrition section ──
  if (nutriEntries.length) {
    const tots = nutriTotals(nutriEntries);
    const targets = DB.getNutriTargets();
    const bar = (val, tgt) => `<div class="macro-track" style="height:6px;flex:1;margin:0 6px"><div class="macro-fill" style="width:${Math.min(100,Math.round(val/tgt*100))}%;height:100%;border-radius:3px"></div></div>`;
    html += `
      <div class="day-section-head">🥗 Nutrition</div>
      <div class="card mb12">
        <div style="font-size:1.4rem;font-weight:800;margin-bottom:4px">${tots.calories} <span style="font-size:0.8rem;font-weight:400;color:var(--muted)">/ ${targets.calories} cal</span></div>
        <div class="day-macro-row">${bar(tots.calories, targets.calories)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px">
          <div><div class="day-macro-val">${tots.protein}g</div><div class="day-macro-key">Protein</div></div>
          <div><div class="day-macro-val">${tots.carbs}g</div><div class="day-macro-key">Carbs</div></div>
          <div><div class="day-macro-val">${tots.fat}g</div><div class="day-macro-key">Fat</div></div>
          <div><div class="day-macro-val">${tots.fiber}g</div><div class="day-macro-key">Fiber</div></div>
          <div><div class="day-macro-val">${tots.sodium}mg</div><div class="day-macro-key">Sodium</div></div>
          <div><div class="day-macro-val">${nutriEntries.length}</div><div class="day-macro-key">Entries</div></div>
        </div>
      </div>`;
  }

  // ── Sleep & Recovery section ──
  if (sleepLog) {
    html += `
      <div class="day-section-head">😴 Sleep & Recovery</div>
      <div class="card mb12">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${sleepLog.sleepDuration ? `<div><div class="day-macro-val">${sleepLog.sleepDuration}h</div><div class="day-macro-key">Sleep</div></div>` : ''}
          ${sleepLog.sleepQuality  ? `<div><div class="day-macro-val">${sleepLog.sleepQuality}</div><div class="day-macro-key">Quality</div></div>` : ''}
          ${sleepLog.recovery      ? `<div><div class="day-macro-val">${sleepLog.recovery}%</div><div class="day-macro-key">Recovery</div></div>` : ''}
          ${sleepLog.feelRating    ? `<div><div class="day-macro-val">${sleepLog.feelRating}/10</div><div class="day-macro-key">Morning Feel</div></div>` : ''}
        </div>
      </div>`;
  }

  // ── Track / Travel day section ──
  const trackEntry = DB.getTrackDay(dateStr);
  if (trackEntry) {
    html += `
      <div class="day-section-head" style="color:#ff9500">🏁 Track / Travel Day</div>
      <div class="card mb12" style="border-color:rgba(255,149,0,0.2);display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div style="flex:1;min-width:0">
          <div style="font-size:0.9rem;font-weight:700;color:#ff9500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${trackEntry.note || 'Race weekend / travel'}</div>
          <div style="font-size:0.75rem;color:var(--muted);margin-top:3px">Session target adjusted · streak protected</div>
        </div>
        <button class="btn btn-ghost btn-sm" style="font-size:0.75rem;opacity:0.6;flex-shrink:0"
                onclick="cancelTrackDay('${dateStr}')">Remove</button>
      </div>`;
  }

  // ── Rest day section ──
  const isRestDay = DB.getRestDays().includes(dateStr);
  if (isRestDay) {
    html += `
      <div class="day-section-head">🛌 Rest Day</div>
      <div class="card mb12" style="display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:0.9rem;font-weight:600;color:var(--muted)">Intentional rest — streak protected</div>
        <button class="btn btn-ghost btn-sm" style="font-size:0.75rem;opacity:0.6;flex-shrink:0;margin-left:12px"
                onclick="cancelRestDay('${dateStr}')">Remove</button>
      </div>`;
  }

  // ── Log options for past days with no workout ──
  if (!w && !trackEntry && !isRestDay) {
    const isPast = dateStr < today();
    if (isPast) {
      html += `
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-ghost btn-sm" style="flex:1;opacity:0.6"
            onclick="DB.addRestDay('${dateStr}');toast('Rest day logged 🛌','ok');openDayView('${dateStr}');renderDashboard()">
            🛌 Mark Rest Day</button>
          <button class="btn btn-ghost btn-sm" style="flex:1;opacity:0.6"
            onclick="logTrackDayForDate('${dateStr}')">
            🏁 Mark Track Day</button>
        </div>`;
    }
  }

  if (!html) html = `<div class="empty mt24"><div class="empty-icon">📅</div><p>Nothing logged for this day.</p></div>`;

  document.getElementById('detail-content').innerHTML = html;
  document.getElementById('detail-header-date').textContent = fmtDate(dateStr);
  show('screen-detail');
};

// ================================================================
// HISTORY
// ================================================================
const buildStreakHtml = (current, longest) => {
  const wDates = new Set(DB.getWorkouts().map(w => w.date));
  const rDates = new Set(DB.getRestDays());
  const tDates = new Set(DB.getTrackDays().map(t => t.date));
  let last7 = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    if (wDates.has(ds) || rDates.has(ds) || tDates.has(ds)) last7++;
  }
  return `
  <div class="streak-card">
    <div class="streak-main">
      <span class="streak-fire">🔥</span>
      <div>
        <div class="streak-num">${current}</div>
        <div class="streak-label">Day Streak</div>
      </div>
    </div>
    <div class="streak-right">
      <div class="streak-best-num">${longest}</div>
      <div class="streak-best-label">Best</div>
      <div class="streak-week">${last7}/7 this week</div>
    </div>
  </div>`;
};

let _calYear  = new Date().getFullYear();
let _calMonth = new Date().getMonth();

const renderHistory = () => {
  document.getElementById('history-list').innerHTML =
    buildCalendarHtml(DB.getWorkouts(), _calYear, _calMonth);
};

const calNav = (delta) => {
  _calMonth += delta;
  if (_calMonth > 11) { _calMonth = 0; _calYear++; }
  if (_calMonth < 0)  { _calMonth = 11; _calYear--; }
  const html = buildCalendarHtml(DB.getWorkouts(), _calYear, _calMonth);
  const dashEl = document.getElementById('dash-calendar');
  const histEl = document.getElementById('history-list');
  if (dashEl) dashEl.innerHTML = html;
  if (histEl) histEl.innerHTML = html;
};

const buildCalendarHtml = (workouts, year, month) => {
  const workoutDates = {};
  workouts.forEach(w => { if (!workoutDates[w.date]) workoutDates[w.date] = w; });
  const sleepDates  = new Set(DB.getSleepLogs().map(s => s.date));
  const restDates   = new Set(DB.getRestDays());
  const trackDates  = new Set(DB.getTrackDays().map(t => t.date));

  const firstDay   = new Date(year, month, 1);
  const lastDate   = new Date(year, month + 1, 0).getDate();
  const todayStr   = today();
  const monthLabel = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const DOW = ['S','M','T','W','T','F','S'];
  let cells = DOW.map(d => `<div class="cal-dow">${d}</div>`).join('');

  for (let i = 0; i < firstDay.getDay(); i++) cells += `<div class="cal-day cal-blank"></div>`;

  for (let d = 1; d <= lastDate; d++) {
    const ds       = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const w        = workoutDates[ds];
    const hasSleep = sleepDates.has(ds);
    const hasNutr  = DB.getNutriDay(ds).length > 0;
    const hasRest  = restDates.has(ds);
    const hasTrack = trackDates.has(ds);
    const hasData  = !!(w || hasSleep || hasNutr || hasRest || hasTrack);
    const cls = ['cal-day',
      w        ? 'has-workout' :
      hasTrack ? 'has-track'   :
      hasRest  ? 'has-rest'    :
      hasData  ? 'has-data'    : '',
      ds === todayStr ? 'cal-today' : '',
    ].filter(Boolean).join(' ');
    const dots = [
      w        ? '<div class="cal-dot workout-dot"></div>' : '',
      hasNutr  ? '<div class="cal-dot nutr-dot"></div>'    : '',
      hasSleep ? '<div class="cal-dot sleep-dot"></div>'   : '',
      hasRest  ? '<div class="cal-dot rest-dot"></div>'    : '',
      hasTrack ? '<div class="cal-dot track-dot"></div>'   : '',
    ].join('');
    cells += `<div class="${cls}"${hasData ? ` onclick="openDayView('${ds}')"` : ''}>${d}${dots ? `<div class="cal-dots">${dots}</div>` : ''}</div>`;
  }

  const emptyHtml = !workouts.length
    ? `<div class="empty mt12"><div class="empty-icon">📋</div><p>No workouts logged yet.</p></div>`
    : '';

  return `
    <div class="cal-nav">
      <button class="cal-arrow" onclick="calNav(-1)">&#8249;</button>
      <span class="cal-month-label">${monthLabel}</span>
      <button class="cal-arrow" onclick="calNav(1)">&#8250;</button>
    </div>
    <div class="cal-grid">${cells}</div>
    ${emptyHtml}
  `;
};

// ================================================================
// FEATURE 2 — AI TRAINER
// ================================================================

const GYM_EQUIPMENT = {
  'UNOH':          'barbell, squat rack, trap bar, deadlift platform, dumbbells (all weights), kettlebells, sled, pull-up bar, cable machines, cardio',
  'Planet Fitness':'Smith machine, leg press, cable machines, dumbbells up to 75lb, machines ONLY — NO barbell, NO squat rack, NO deadlift platform, NO trap bar — plus cardio',
  'Other':         'bodyweight and minimal equipment only',
};

// Determine training phase from session count and weeks elapsed
const determinePhase = (workouts) => {
  if (!workouts.length) return 1;
  const weeksIn = (Date.now() - new Date(workouts[0].date + 'T12:00:00').getTime()) / (7 * 24 * 3600 * 1000);
  if (weeksIn < 5  || workouts.length < 12) return 1;
  if (weeksIn < 11 || workouts.length < 30) return 2;
  return 3;
};

// Pick the next session type by rotating through the phase's sequence
const getNextSessionType = (workouts, phase) => {
  const lastTyped = [...workouts].reverse().find(w => w.sessionType);
  const last = lastTyped?.sessionType;
  const seq = { 1: ['A','B','C'], 2: ['A','B','C','D'], 3: ['S','P'] };
  const types = seq[phase] || seq[1];
  if (!last || !types.includes(last)) return types[0];
  return types[(types.indexOf(last) + 1) % types.length];
};

// Returns weekly training load context — used by coach, rest-day UI, and workout prompt
const getWeeklyTrainingContext = () => {
  const workouts = DB.getWorkouts();
  const phase    = determinePhase(workouts);

  // Sessions required per week for each phase
  const targetMap = { 1: 3, 2: 4, 3: 2 };
  const target    = targetMap[phase] || 3;

  // Monday of the current week
  const now  = new Date();
  const dow  = now.getDay(); // 0 = Sunday
  const diff = dow === 0 ? -6 : 1 - dow;
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() + diff);
  weekStart.setHours(0, 0, 0, 0);
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  const weekWorkouts  = workouts.filter(w => w.date >= weekStartStr);
  const weekRestDays  = DB.getRestDays().filter(d => d >= weekStartStr);
  const weekTrackDays = DB.getTrackDays().filter(t => t.date >= weekStartStr);

  const sessionsThisWeek  = weekWorkouts.length;
  const restDaysThisWeek  = weekRestDays.length;
  const trackDaysThisWeek = weekTrackDays.length;

  // Each track day reduces the session target (being at the track IS the job)
  const effectiveTarget   = Math.max(1, target - trackDaysThisWeek);
  const sessionsRemaining = Math.max(0, effectiveTarget - sessionsThisWeek);
  const maxRestDays       = 7 - effectiveTarget;
  const weekTargetMet     = sessionsThisWeek >= effectiveTarget;

  return {
    phase, target, effectiveTarget, sessionsThisWeek,
    restDaysThisWeek, trackDaysThisWeek,
    sessionsRemaining, maxRestDays, weekTargetMet, weekStartStr,
  };
};

// Build a compact training history string for the prompt
const formatHistoryForPrompt = (workouts) => {
  const recent = workouts.slice(-5).reverse();
  if (!recent.length) return 'No previous sessions logged.';
  return recent.map(w => {
    const ago  = daysSince(w.date);
    const tag  = w.sessionType ? `Ph${w.phase}-${w.sessionType}` : 'manual';
    const exes = (w.exercises || []).slice(0, 3).map(e => {
      if (!e.sets?.length) return e.name;
      const top = e.sets.reduce((b, s) => (parseFloat(s.weight) || 0) > (parseFloat(b.weight) || 0) ? s : b, e.sets[0]);
      return `${e.name} ${e.sets.length}×${top.reps}@${top.weight}lb`;
    }).join(', ');
    return `${ago}d ago [${tag}]: ${exes || 'no exercises'}`;
  }).join('\n');
};

// ── Preferences context injected into every AI prompt ────────────
// scope: 'training' (no dietary), 'nutrition' (no exercise), 'all' (everything)
const buildPrefsContext = (scope = 'all') => {
  const p = DB.getPrefs();
  const lines = [];
  if (scope !== 'nutrition') {
    if (p.avoidExercises)    lines.push(`NEVER program or suggest these exercises: ${p.avoidExercises}`);
    if (p.injuryNotes)       lines.push(`Injury/limitation notes (must always respect): ${p.injuryNotes}`);
    if (p.favoriteExercises) lines.push(`Preferred exercises (use when appropriate): ${p.favoriteExercises}`);
    if (p.equipmentNotes)    lines.push(`Equipment notes: ${p.equipmentNotes}`);
    if (p.trainingGoals)     lines.push(`Athlete's stated goals: ${p.trainingGoals}`);
    if (p.trainingNotes)     lines.push(`Training style preferences: ${p.trainingNotes}`);
    if (p.recoveryNotes)     lines.push(`Recovery/sleep notes: ${p.recoveryNotes}`);
    if (p.coachNotes)        lines.push(`Communication style preference: ${p.coachNotes}`);
  }
  if (scope !== 'training') {
    if (p.dietaryRestrictions) lines.push(`Dietary restrictions/allergies (CRITICAL — always respect): ${p.dietaryRestrictions}`);
    if (p.dietaryGoals)        lines.push(`Dietary goals/preferences: ${p.dietaryGoals}`);
  }
  if (!lines.length) return '';
  return '\n\nATHLETE PREFERENCES (apply consistently — non-negotiable):\n' + lines.map(l => `- ${l}`).join('\n');
};

// Build the full prompt sent to Claude
const buildWorkoutPrompt = (gym, energy, duration) => {
  const workouts = DB.getWorkouts();
  const phase    = determinePhase(workouts);
  const nextType = getNextSessionType(workouts, phase);
  const history  = formatHistoryForPrompt(workouts);
  const equipment = GYM_EQUIPMENT[gym] || GYM_EQUIPMENT['Other'];
  const baseline  = DB.getLatestBaseline();
  const bwNote    = `, bodyweight ${getCurrentWeight()}lb`;

  const phaseDesc = {
    1: 'PHASE 1 — Rebuild Base: moderate strength + conditioning, NO heavy explosive work, protect lower back, athlete is detrained so start conservative with weights',
    2: 'PHASE 2 — Build Power & Speed: explosive work now OK, progressive overload, full recovery on all speed work',
    3: 'PHASE 3 — Sharpen: cut volume, peak intensity, add mock pit-movement reps, athlete should arrive to competition fresh',
  }[phase];

  const typeGuide = {
    '1A': 'Full-body strength — goblet squat or leg press 3×10-12, DB RDL 3×10, DB bench or machine press 3×10-12, cable/machine row 3×12, plank 3×30-45s, back extensions 3×12',
    '1B': 'Conditioning + core — bike/row intervals 20s hard/40s easy ×8-10 (swim OK), farmer carries 3×30-40yd, Pallof press 3×10/side, hanging knee raises 3×12',
    '1C': 'Lower strength + movement — trap-bar DL or DB deadlift 3×8, walking lunges or split squats 3×10/leg, DB overhead press 3×10, light footwork 5 min, side plank 3×20-30s/side',
    '2A': 'Max-effort lower (jackman power) — trap-bar DL heavy 3-5 explosive reps, squat 4×5, KB swings 4×12, back extensions 3×12, heavy carries 3×40yd',
    '2B': 'Speed & agility — 10-20yd sprints 6-8 reps FULL recovery, 5-10-5 shuttle ×4-6, lateral shuffles 4×20yd, box/broad jumps 4×4, med-ball rotational throws 3×6/side',
    '2C': 'Max-effort upper + power — bench 4×5, weighted pull-ups or lat pulldown 4×6-8, push press 4×4, heavy DB rows 3×8, farmer carries + Pallof press',
    '2D': 'Conditioning — sled pushes or bike/row all-out 15-20s / full recovery ×8-10, battle ropes 4×20s, core circuit',
    '3S': 'Strength maintenance — 2-3 heavy compound sets lower and upper, low volume, protect freshness',
    '3P': 'Speed sharpening — sprint quality, agility, jumps, mock pit-crew movements, ALL full recovery',
  }[`${phase}${nextType}`] || 'Design an appropriate session for this phase.';

  return `You are a pit crew strength coach. Generate a workout as JSON only.

ATHLETE: 6'0"~260lb${bwNote}, former football+swimmer, rebuilding.
GOALS: NASCAR pit crew — fueler (core/rotation/grip) + jackman (explosive hips/jumping/pressing).${buildPrefsContext('training')}
RULE SET (non-negotiable):
- Include lower-back protection every session (extensions, McGill, or loaded carries)
- Warm up before any heavy/explosive work
- Speed/jump work = full recovery, never turn into cardio
- Progressive overload — suggest slightly more than last logged session for same exercises
- ONLY use equipment available at gym

${phaseDesc}
SESSION TYPE ${nextType}: ${typeGuide}

TODAY: Gym=${gym} | Equipment: ${equipment} | Energy=${energy} | Time=${duration}min${getRecoveryContext()}

RECENT HISTORY (use for weight suggestions):
${history}

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "sessionType": "${nextType}",
  "phase": ${phase},
  "title": "short session title",
  "coachNote": "1-2 sentences: what to focus on and why this session today",
  "warmup": "specific warmup for this session type",
  "exercises": [
    {"name": "Exercise Name", "sets": 3, "reps": "10-12", "weight": 45, "unit": "lbs", "rest": "60s", "notes": "key form cue or intensity note"}
  ],
  "cooldown": "brief cooldown",
  "sessionNote": "short motivating one-liner"
}`;
};

// Call the Claude API via our local server proxy
const callClaude = async (userMessage, maxTokens = 1200) => {
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages:   [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
};

const callClaudeVision = async (base64, mediaType, prompt, maxTokens = 600) => {
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text',  text: prompt }
      ]}]
    })
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.content[0].text;
};

// Train screen state
let _trainGym      = '';
let _trainEnergy   = '';
let _trainDuration = 60;

const openTrainScreen = () => {
  document.querySelectorAll('.gym-opt').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('#train-feel-row .feel-opt').forEach(el => el.classList.remove('selected'));
  document.getElementById('train-duration').value = '60';
  // Auto-select default gym from preferences
  const prefGym = DB.getPrefs().defaultGym;
  if (prefGym) {
    const gymEl = document.querySelector(`.gym-opt[data-gym="${prefGym}"]`);
    if (gymEl) { gymEl.classList.add('selected'); _trainGym = prefGym; }
  }
  const btn = document.getElementById('train-gen-btn');
  btn.disabled = false;
  btn.innerHTML = 'Generate My Workout →';
  show('screen-train');
};

const selectTrainGym = (el, gym) => {
  document.querySelectorAll('.gym-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  _trainGym = gym;
};

const selectTrainFeel = (el) => {
  document.querySelectorAll('#train-feel-row .feel-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  _trainEnergy = el.dataset.feel;
};

const generateWorkout = async () => {
  _trainGym      = document.querySelector('.gym-opt.selected')?.dataset.gym || '';
  _trainEnergy   = document.querySelector('#train-feel-row .feel-opt.selected')?.dataset.feel || '';
  _trainDuration = parseInt(document.getElementById('train-duration').value) || 60;

  if (!_trainGym)    { toast('Select a gym first', 'err'); return; }
  if (!_trainEnergy) { toast('Select your energy level', 'err'); return; }

  const btn = document.getElementById('train-gen-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Generating…';

  try {
    const prompt   = buildWorkoutPrompt(_trainGym, _trainEnergy, _trainDuration);
    const response = await callClaude(prompt);
    const rawText  = response.content[0].text.trim();

    // Extract JSON — find the first { and last } in the response
    const start = rawText.indexOf('{');
    const end   = rawText.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON found in response');
    const workout = JSON.parse(rawText.slice(start, end + 1));

    _currentGenerated = workout;
    renderGeneratedWorkout(workout);
    show('screen-generated');
  } catch (err) {
    console.error('Generate error:', err);
    btn.disabled = false;
    btn.innerHTML = 'Generate My Workout →';
    if (err.message.toLowerCase().includes('api key') || err.message.includes('not configured')) {
      toast('API key not set — check your .env file', 'err');
    } else if (err.message.includes('SyntaxError') || err.message.includes('JSON')) {
      toast('AI returned unexpected format — try again', 'err');
    } else {
      toast('Error: ' + err.message.slice(0, 55), 'err');
    }
  }
};

const renderGeneratedWorkout = (w) => {
  const phaseLabel = { 1: 'REBUILD BASE', 2: 'BUILD POWER', 3: 'SHARPEN' }[w.phase] || 'TRAINING';

  let html = `
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      <span class="phase-badge">Phase ${w.phase} · ${phaseLabel}</span>
      <span class="phase-badge" style="background:rgba(255,215,0,0.1);border-color:rgba(255,215,0,0.3);color:var(--gold)">Session ${w.sessionType}</span>
    </div>
    <h2 style="margin-bottom:8px;line-height:1.2">${w.title}</h2>
    ${w.coachNote ? `<p style="margin-bottom:20px;color:#b8b8d8;font-size:0.9rem;line-height:1.65">${w.coachNote}</p>` : ''}
  `;

  if (w.warmup) {
    html += `
      <div class="card mb12" style="border-color:rgba(46,204,113,0.3)">
        <div class="card-label" style="color:var(--green)">Warm-Up</div>
        <p style="color:var(--text);font-size:0.875rem;line-height:1.5">${w.warmup}</p>
      </div>
    `;
  }

  if (w.exercises?.length) {
    html += `<div class="card-label mb8">Exercises</div>`;
    html += w.exercises.map((ex, i) => `
      <div class="card mb8">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
          <div style="font-weight:700;font-size:0.95rem;flex:1">${i + 1}. ${ex.name}</div>
          ${ex.rest ? `<span style="font-size:0.68rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px;flex-shrink:0">rest ${ex.rest}</span>` : ''}
        </div>
        <div style="font-size:1.1rem;font-weight:900;color:var(--red);margin-bottom:6px">
          ${ex.sets} × ${ex.reps}${ex.weight ? ' @ ' + ex.weight + ' ' + (ex.unit || 'lbs') : ''}
        </div>
        ${ex.notes ? `<div style="font-size:0.78rem;color:var(--muted);line-height:1.4">${ex.notes}</div>` : ''}
      </div>
    `).join('');
  }

  if (w.cooldown) {
    html += `
      <div class="card mb12" style="border-color:rgba(255,215,0,0.2)">
        <div class="card-label" style="color:var(--gold)">Cool-Down</div>
        <p style="color:var(--text);font-size:0.875rem;line-height:1.5">${w.cooldown}</p>
      </div>
    `;
  }

  if (w.sessionNote) {
    html += `<div style="text-align:center;padding:16px 8px 4px;font-size:0.875rem;font-style:italic;color:var(--muted);line-height:1.5">"${w.sessionNote}"</div>`;
  }

  document.getElementById('generated-content').innerHTML = html;
};

// Move from generated workout view → log form with exercises pre-populated
const logGeneratedWorkout = () => {
  if (!_currentGenerated) { openLogScreen(); return; }

  _exercises = (_currentGenerated.exercises || []).map(ex => ({
    id:   uid(),
    name: ex.name,
    sets: Array.from({ length: Math.max(ex.sets || 1, 1) }, () => ({
      weight: ex.weight ? String(ex.weight) : '',
      reps:   '',
    })),
  }));

  document.getElementById('log-date').value     = today();
  document.getElementById('log-gym').value      = _trainGym;
  document.getElementById('log-duration').value = String(_trainDuration);
  document.getElementById('log-notes').value    = '';
  document.querySelectorAll('.feel-opt').forEach(el => el.classList.remove('selected'));
  const feelEl = document.querySelector(`.feel-opt[data-feel="${_trainEnergy}"]`);
  if (feelEl) feelEl.classList.add('selected');

  renderSets();
  show('screen-log');
};

// ================================================================
// FEATURE 3 — AI COACH CHAT
// ================================================================

// Build compact baseline performance summary for coach prompt
const buildBaselineSummaryForCoach = () => {
  const b = DB.getLatestBaseline();
  if (!b) return 'No baseline tests recorded yet.';
  const bw  = getCurrentWeight();
  const rm  = b.estimated1RM || '—';
  const tgt = Math.round(bw * 2);
  const jump = b.jumpFt !== undefined ? `${b.jumpFt}'${b.jumpIn || 0}"` : '—';
  return `Sprint: ${b.sprint || '—'}s (target <1.9s) | Agility: ${b.agility || '—'}s (target <4.7s) | Broad Jump: ${jump} (target 8'6"+) | Est. 1RM: ${rm}lb (target ${tgt}lb = 2×BW) | Tested: ${fmtDate(b.date)}`;
};

// Build compact body composition summary for coach prompt (last 3 logs)
const buildBodyCompSummaryForCoach = () => {
  const logs = DB.getBodyLogs().slice(-3).reverse();
  if (!logs.length) return 'No body composition logs yet.';
  const lines = logs.map(l => {
    const parts = [`${l.weight || '?'}lb`];
    if (l.bodyFat)    parts.push(`${l.bodyFat}% BF`);
    if (l.muscleMass) parts.push(`${l.muscleMass}lb muscle`);
    if (l.visceralFat) parts.push(`VF ${l.visceralFat}`);
    return `${fmtDate(l.date)}: ${parts.join(', ')}`;
  });
  return lines.join(' | ');
};

// Build 7-day nutrition averages for coach prompt
const buildNutritionSummaryForCoach = () => {
  const targets = DB.getNutriTargets();
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const entries = DB.getNutriDay(key);
    if (entries.length) days.push(entries);
  }
  if (!days.length) return 'No nutrition logged yet.';
  const avg = (field) => Math.round(days.reduce((sum, es) => sum + es.reduce((s, e) => s + (e.perServing?.[field] || 0) * e.servings, 0), 0) / days.length);
  return `${days.length}-day avg — Cal: ${avg('calories')}/${targets.calories} | Protein: ${avg('protein')}g/${targets.protein}g | Carbs: ${avg('carbs')}g/${targets.carbs}g | Fat: ${avg('fat')}g/${targets.fat}g | Fiber: ${avg('fiber')}g/${targets.fiber}g | Sodium: ${avg('sodium')}mg/${targets.sodium}mg`;
};

let _chatHistory      = [];   // [{role, content}] — full conversation
let _chatBusy         = false;
let _pendingUpdate    = null;  // workout JSON pending "Apply" confirmation
let _chatReturnScreen = 'screen-home'; // where Back goes

const buildCoachSystem = () => {
  const workouts  = DB.getWorkouts();
  const phase     = determinePhase(workouts);
  const baseline  = DB.getLatestBaseline();
  const history   = formatHistoryForPrompt(workouts);
  const gym       = _trainGym || 'unknown';
  const equip     = GYM_EQUIPMENT[gym] || 'unknown equipment';

  let todayStr = 'No workout generated yet today.';
  if (_currentGenerated) {
    const exList = (_currentGenerated.exercises || [])
      .map(e => `${e.name} ${e.sets}×${e.reps}${e.weight ? '@' + e.weight + 'lb' : ''}`)
      .join(', ');
    todayStr = `${_currentGenerated.title} (Phase ${_currentGenerated.phase}, Session ${_currentGenerated.sessionType}): ${exList}`;
  }

  const wtx = getWeeklyTrainingContext();
  const trackNote = wtx.trackDaysThisWeek > 0
    ? `Athlete had ${wtx.trackDaysThisWeek} track/travel day(s) this week — session target reduced to ${wtx.effectiveTarget} (from base ${wtx.target}). This is race work, not laziness.`
    : '';
  const restDayGuidance = wtx.weekTargetMet
    ? `Weekly target met (${wtx.sessionsThisWeek}/${wtx.effectiveTarget} sessions done). Rest days fully earned.`
    : `Weekly target not yet met (${wtx.sessionsThisWeek}/${wtx.effectiveTarget} sessions done, ${wtx.sessionsRemaining} still needed). Encourage training first unless recovery data says otherwise. Be supportive, not harsh.`;

  return `You are a pit crew strength coach. Be direct and practical — no fluff.

ATHLETE: 6'0" ${getCurrentWeight()}lb current, former football+swimmer, rebuilding fitness.
GOAL: NASCAR pit crew — fueler (core/rotation/grip) and jackman (explosive hips/jumping/pressing).
TRAINING PHASE: ${phase} (${wtx.target} sessions/week required)
TODAY'S GYM: ${gym} | Equipment: ${equip}
TODAY'S WORKOUT: ${todayStr}

WEEKLY TRAINING LOAD:
- Sessions this week: ${wtx.sessionsThisWeek} of ${wtx.effectiveTarget} required${wtx.trackDaysThisWeek > 0 ? ` (base ${wtx.target}, reduced for track days)` : ''}
- Rest days logged: ${wtx.restDaysThisWeek} | Track/travel days: ${wtx.trackDaysThisWeek}
${trackNote ? `- ${trackNote}` : ''}- ${restDayGuidance}

PERFORMANCE BASELINES:
${buildBaselineSummaryForCoach()}

BODY COMPOSITION (recent):
${buildBodyCompSummaryForCoach()}

NUTRITION (recent avg vs targets):
${buildNutritionSummaryForCoach()}

RECENT TRAINING HISTORY:
${history}

NON-NEGOTIABLE RULES:
- Lower back is protected/trained every session
- Only prescribe exercises possible at ${gym}
- Speed/jump work always gets full recovery — never cardio
- When substituting, maintain the same training goal${buildPrefsContext('training')}

RESPONSE FORMAT:
- For questions or advice: answer in 2-4 sentences, plain text.
- When modifying exercises: first explain the change in plain text, then on its own line output exactly:
WORKOUT_UPDATE:{"exercises":[{"name":"...","sets":3,"reps":"10-12","weight":45,"unit":"lbs","rest":"60s","notes":"..."}],"changeNote":"what changed and why"}`;
};

const openChat = (returnScreen = 'screen-home') => {
  _chatReturnScreen = returnScreen;

  if (_chatHistory.length === 0) {
    const hasWorkout = !!_currentGenerated;
    const phase = determinePhase(DB.getWorkouts());
    const gymStr = _trainGym ? ` at ${_trainGym}` : '';
    const intro = hasWorkout
      ? `Phase ${phase} session loaded${gymStr}. What do you need — substitution, adjustment, or a question?`
      : `Training context loaded. Ask me anything — exercise subs, form questions, session adjustments.`;
    _chatHistory = [{ role: 'assistant', content: intro }];
  }

  _pendingUpdate = null;
  renderChat();
  show('screen-chat');
};

const clearChat = () => {
  _chatHistory = [];
  _pendingUpdate = null;
  openChat(_chatReturnScreen);
};

const renderChat = () => {
  const el = document.getElementById('chat-messages');
  if (!el) return;

  el.innerHTML = _chatHistory.map(m => `
    <div class="chat-bubble ${m.role}">
      ${m.role === 'assistant' ? '<div class="chat-avatar">Coach</div>' : ''}
      <div class="chat-text">${escHtml(m.content).replace(/\n/g, '<br>')}</div>
    </div>
  `).join('') + (_chatBusy ? `
    <div class="chat-bubble assistant">
      <div class="chat-avatar">Coach</div>
      <div class="chat-text">
        <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
      </div>
    </div>
  ` : '');

  requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });

  const applyBtn = document.getElementById('chat-apply-btn');
  if (applyBtn) applyBtn.style.display = _pendingUpdate ? 'block' : 'none';

  const sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn) sendBtn.disabled = _chatBusy;
};


const sendChat = async () => {
  const input = document.getElementById('chat-input');
  const msg   = input.value.trim();
  if (!msg || _chatBusy) return;

  input.value = '';
  input.style.height = 'auto';

  _chatHistory.push({ role: 'user', content: msg });
  _chatBusy = true;
  renderChat();

  try {
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5',
        max_tokens: 700,
        system:     buildCoachSystem(),
        messages:   _chatHistory.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data      = await res.json();
    const fullText  = data.content[0].text.trim();

    // Split off any WORKOUT_UPDATE block
    const marker    = 'WORKOUT_UPDATE:';
    const markerIdx = fullText.indexOf(marker);
    let displayText = fullText;

    if (markerIdx !== -1) {
      displayText = fullText.slice(0, markerIdx).trim();
      const jsonStr = fullText.slice(markerIdx + marker.length).trim();
      try {
        const update = JSON.parse(jsonStr);
        if (update.exercises?.length) {
          _pendingUpdate = update;
          displayText += '\n\nTap "Apply Changes" below to update today\'s workout.';
        }
      } catch (e) { /* ignore malformed update */ }
    }

    _chatHistory.push({ role: 'assistant', content: displayText });

  } catch (err) {
    console.error('Chat error:', err);
    _chatHistory.push({ role: 'assistant', content: 'Something went wrong — try sending again.' });
  }

  _chatBusy = false;
  renderChat();
};

const applyWorkoutUpdate = () => {
  if (!_pendingUpdate) return;

  const newExercises = _pendingUpdate.exercises;
  const note         = _pendingUpdate.changeNote || 'Workout updated.';

  // Update the generated workout object so it re-renders correctly
  if (_currentGenerated) {
    _currentGenerated.exercises = newExercises;
    renderGeneratedWorkout(_currentGenerated);
  } else {
    _currentGenerated = {
      sessionType: 'X',
      phase: determinePhase(DB.getWorkouts()),
      title: 'Coach-Modified Session',
      exercises: newExercises,
    };
  }

  // Update the log form if it's already been pre-filled
  if (_exercises.length > 0) {
    _exercises = newExercises.map(ex => ({
      id:   uid(),
      name: ex.name,
      sets: Array.from({ length: Math.max(ex.sets || 1, 1) }, () => ({
        weight: ex.weight ? String(ex.weight) : '',
        reps:   '',
      })),
    }));
    renderSets();
  }

  _pendingUpdate = null;
  toast('Workout updated ✓', 'ok');

  _chatHistory.push({ role: 'assistant', content: `Done. ${note}\n\nHead back to the session whenever you're ready.` });
  renderChat();
};

const chatKeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
};

// ================================================================
// FEEL SELECTOR (shared between log + train screens)
// ================================================================
const selectFeel = (el) => {
  document.querySelectorAll('.feel-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
};

// ================================================================
// FEATURE 4 — PROGRESS CHARTS
// ================================================================

const fmtShortDate = (s) => {
  const d = new Date(s + 'T12:00:00');
  return (d.getMonth() + 1) + '/' + d.getDate();
};

// Pull all baseline readings for one field, sorted by date
const getBaselineHistory = (field) =>
  DB.getBaselines()
    .filter(b => b[field] !== undefined && b[field] !== null && !isNaN(b[field]))
    .map(b => ({ x: b.date, y: parseFloat(b[field]), label: fmtShortDate(b.date) }))
    .sort((a, b) => a.x.localeCompare(b.x));

// Pull best 1RM per training day from logged workout sets
const getWorkout1RMHistory = () => {
  const keywords = ['trap-bar', 'trap bar', 'deadlift', 'leg press'];
  const byDate   = {};
  DB.getWorkouts().forEach(w => {
    (w.exercises || []).forEach(ex => {
      if (!keywords.some(k => ex.name.toLowerCase().includes(k))) return;
      (ex.sets || []).forEach(s => {
        const rm = epley1RM(parseFloat(s.weight) || 0, parseInt(s.reps) || 0);
        if (rm > 0 && (!byDate[w.date] || rm > byDate[w.date].y)) {
          byDate[w.date] = { x: w.date, y: rm, label: fmtShortDate(w.date) };
        }
      });
    });
  });
  return Object.values(byDate).sort((a, b) => a.x.localeCompare(b.x));
};

// Merge two point arrays, deduplicate by date (keep max value per date)
const mergePoints = (a, b) => {
  const map = {};
  [...a, ...b].forEach(p => { if (!map[p.x] || p.y > map[p.x].y) map[p.x] = p; });
  return Object.values(map).sort((x, y) => x.x.localeCompare(y.x));
};

// Return trend object: { label, color, arrow }
const getTrend = (points, benchCfg) => {
  if (points.length < 2) return { label: 'Need 2+ tests', color: 'muted', arrow: '—' };

  const cur  = points[points.length - 1].y;
  const prev = points[points.length - 2].y;
  const delta = cur - prev;
  const pct   = Math.abs(delta) / (Math.abs(prev) || 1);
  const flat  = pct < 0.004;

  // Bodyweight: target range
  if (benchCfg.targetLo !== undefined) {
    const { targetLo, targetHi } = benchCfg;
    if (cur >= targetLo && cur <= targetHi) return { label: 'On target', color: 'green', arrow: '✓' };
    if (cur > targetHi) {
      if (flat)        return { label: 'Holding', color: 'muted', arrow: '→' };
      if (delta < 0)   return { label: 'Moving toward target', color: 'green', arrow: '↓' };
                       return { label: 'Moving away from target', color: 'red', arrow: '↑' };
    }
    return { label: 'Below target range', color: 'muted', arrow: '?' };
  }

  // 1RM: dynamic target (2× BW)
  if (benchCfg.bwMultiplier) {
    const bw  = getCurrentWeight();
    const tgt = bw * benchCfg.bwMultiplier;
    if (cur >= tgt)  return { label: 'At elite level 🏁', color: 'green', arrow: '🏁' };
    if (flat)        return { label: 'Holding', color: 'muted', arrow: '→' };
    if (delta > 0)   return { label: 'Closing the gap', color: 'green', arrow: '↑' };
                     return { label: 'Trending away', color: 'red', arrow: '↓' };
  }

  // Sprint / agility (lower is better) / broad jump (higher is better)
  const { lowerIsBetter, eliteMin, eliteMax } = benchCfg;
  const atElite = lowerIsBetter ? cur <= eliteMax : cur >= eliteMin;
  if (atElite)   return { label: 'At elite level 🏁', color: 'green', arrow: '🏁' };
  if (flat)      return { label: 'Holding steady', color: 'muted', arrow: '→' };
  const better = lowerIsBetter ? delta < 0 : delta > 0;
  if (better)    return { label: 'Closing the gap', color: 'green', arrow: lowerIsBetter ? '↓' : '↑' };
                 return { label: 'Trending away',   color: 'red',   arrow: lowerIsBetter ? '↑' : '↓' };
};

// Build an SVG line chart with a benchmark reference line
const buildSvgChart = (id, points, benchVal) => {
  if (!points.length) {
    return `<div style="height:90px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:0.78rem">No data yet</div>`;
  }

  const W = 320, H = 96;
  const P = { t: 8, r: 42, b: 18, l: 30 };
  const cW = W - P.l - P.r, cH = H - P.t - P.b;

  const yVals = points.map(p => p.y);
  const allY  = (benchVal != null) ? [...yVals, benchVal] : yVals;
  const yMin  = Math.min(...allY), yMax = Math.max(...allY);
  const yR    = yMax - yMin || 1;
  const yLo   = yMin - yR * 0.14, yHi = yMax + yR * 0.14;

  const xS = (i) => P.l + (points.length > 1 ? (i / (points.length - 1)) * cW : cW * 0.5);
  const yS = (v) => P.t + cH * (1 - (v - yLo) / (yHi - yLo));
  const fv  = (v) => Math.abs(v) >= 100 ? Math.round(v) : +v.toFixed(2);

  const pts   = points.map((p, i) => `${xS(i).toFixed(1)},${yS(p.y).toFixed(1)}`);
  const line  = `M ${pts.join(' L ')}`;
  const area  = `${line} L ${xS(points.length-1).toFixed(1)},${(P.t+cH).toFixed(1)} L ${P.l},${(P.t+cH).toFixed(1)} Z`;
  const bY    = (benchVal != null) ? yS(benchVal) : null;
  const last  = points[points.length - 1];

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible">
    <defs>
      <linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#e63946" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#e63946" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <line x1="${P.l}" y1="${P.t}" x2="${P.l}" y2="${P.t+cH}" stroke="#2a2a44" stroke-width="1"/>
    <line x1="${P.l}" y1="${P.t+cH}" x2="${P.l+cW}" y2="${P.t+cH}" stroke="#2a2a44" stroke-width="1"/>
    ${bY != null ? `
      <line x1="${P.l}" y1="${bY.toFixed(1)}" x2="${P.l+cW}" y2="${bY.toFixed(1)}"
            stroke="#ffd700" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.65"/>
      <text x="${P.l+cW+3}" y="${(bY+3.5).toFixed(1)}" fill="#ffd700" font-size="8.5" opacity="0.8" font-family="system-ui">${fv(benchVal)}</text>
    ` : ''}
    ${points.length > 1 ? `<path d="${area}" fill="url(#g${id})"/>` : ''}
    ${points.length > 1 ? `<path d="${line}" fill="none" stroke="#e63946" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${points.map((p, i) => `<circle cx="${xS(i).toFixed(1)}" cy="${yS(p.y).toFixed(1)}" r="${i===points.length-1?4.5:3}" fill="#e63946" stroke="#080810" stroke-width="1.5"/>`).join('')}
    <text x="${P.l}" y="${H-1}" fill="#7070a0" font-size="8" font-family="system-ui" text-anchor="middle">${points[0].label}</text>
    ${points.length > 1 ? `<text x="${xS(points.length-1).toFixed(1)}" y="${H-1}" fill="#7070a0" font-size="8" font-family="system-ui" text-anchor="middle">${last.label}</text>` : ''}
    <text x="${P.l-3}" y="${(P.t+5).toFixed(1)}" fill="#7070a0" font-size="8" font-family="system-ui" text-anchor="end">${fv(yHi)}</text>
    <text x="${P.l-3}" y="${(P.t+cH).toFixed(1)}" fill="#7070a0" font-size="8" font-family="system-ui" text-anchor="end">${fv(yLo)}</text>
  </svg>`;
};

let _progMetrics    = [];
let _progSelected   = null;
let _bodyMetrics    = [];
let _bodySelected   = null;
let _exSelected     = null;   // exercise name currently charted

// Pull body log history for one field, sorted by date
const getBLHistory = (field) =>
  DB.getBodyLogs()
    .filter(b => b[field] != null && !isNaN(b[field]))
    .map(b => ({ x: b.date, y: parseFloat(b[field]), label: fmtShortDate(b.date) }))
    .sort((a, b) => a.x.localeCompare(b.x));

// ================================================================
// PER-EXERCISE PROGRESSION CHARTS
// ================================================================

// Returns all exercises logged at least once, sorted most-recent first
const getAllExercisesWithData = () => {
  const map = {};
  DB.getWorkouts().forEach(w => {
    (w.exercises || []).forEach(ex => {
      const name = (ex.name || '').trim();
      if (!name) return;
      if (!map[name]) map[name] = { name, sessions: 0, lastDate: '', lastBest: 0, hasWeight: false };
      map[name].sessions++;
      if (w.date > map[name].lastDate) map[name].lastDate = w.date;
      (ex.sets || []).forEach(s => {
        const wt = parseFloat(s.weight) || 0;
        const rp = parseInt(s.reps) || 0;
        if (wt > 0) { map[name].hasWeight = true; }
        const val = wt > 0 ? epley1RM(wt, rp) : rp;
        if (val > map[name].lastBest) map[name].lastBest = val;
      });
    });
  });
  return Object.values(map)
    .filter(e => e.sessions >= 1)
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate));
};

// Best 1RM (or max reps) per session date for one exercise
const getExercisePoints = (name) => {
  const byDate = {};
  DB.getWorkouts().forEach(w => {
    (w.exercises || []).forEach(ex => {
      if ((ex.name || '').trim() !== name) return;
      (ex.sets || []).forEach(s => {
        const wt  = parseFloat(s.weight) || 0;
        const rp  = parseInt(s.reps) || 0;
        const val = wt > 0 ? epley1RM(wt, rp) : rp;
        if (val > 0 && (!byDate[w.date] || val > byDate[w.date].y)) {
          byDate[w.date] = { x: w.date, y: val, label: fmtShortDate(w.date) };
        }
      });
    });
  });
  return Object.values(byDate).sort((a, b) => a.x.localeCompare(b.x));
};

// Returns benchmark value for exercises that match the trap-bar/deadlift pattern
const getExerciseBenchmark = (name) => {
  const lower = name.toLowerCase();
  const isMainLift = ['trap-bar','trap bar','deadlift','leg press'].some(k => lower.includes(k));
  if (!isMainLift) return null;
  const bw = DB.getLatestBaseline()?.bodyweight || 260;
  return bw * BENCHMARKS.lift1RM.bwMultiplier;
};

const expandExerciseChart = (name, skipScroll = false) => {
  // Toggle off
  if (_exSelected === name) {
    _exSelected = null;
    document.getElementById('prog-ex-chart-box').innerHTML = '';
    document.querySelectorAll('.ex-row').forEach(r => r.classList.remove('selected'));
    return;
  }
  _exSelected = name;
  document.querySelectorAll('.ex-row').forEach(r =>
    r.classList.toggle('selected', r.dataset.exname === name));

  const points    = getExercisePoints(name);
  const bench     = getExerciseBenchmark(name);
  const hasWeight = DB.getWorkouts().some(w =>
    (w.exercises || []).some(ex =>
      (ex.name || '').trim() === name &&
      (ex.sets || []).some(s => (parseFloat(s.weight) || 0) > 0)));

  const last  = points.length ? points[points.length - 1] : null;
  const prev  = points.length >= 2 ? points[points.length - 2] : null;
  const ago   = last ? daysSince(last.x) : null;

  let trendLabel = '—', trendColor = 'var(--muted)';
  if (last && prev) {
    if (last.y > prev.y)      { trendLabel = '↑ Improving';          trendColor = 'var(--green)'; }
    else if (last.y < prev.y) { trendLabel = '↓ Down last session';   trendColor = 'var(--red)'; }
    else                      { trendLabel = '→ Holding steady';       trendColor = 'var(--muted)'; }
  }

  const svgId    = 'ex_' + name.replace(/[^a-z0-9]/gi, '_');
  const yLabel   = hasWeight ? 'Est. 1RM (lbs)' : 'Max reps';
  const benchDesc = bench
    ? `Target: ${Math.round(bench)}+ lbs (2× bodyweight)`
    : `Metric: ${yLabel}`;

  const box = document.getElementById('prog-ex-chart-box');
  box.innerHTML = `
    <div class="card mt8">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div class="card-label" style="margin-bottom:0">${name}</div>
        <div style="font-size:0.78rem;font-weight:700;color:${trendColor}">${trendLabel}</div>
      </div>
      ${buildSvgChart(svgId, points, bench)}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
        <div style="display:flex;align-items:center;gap:6px">
          ${bench ? `<span style="display:inline-block;width:16px;height:2px;background:#ffd700;opacity:0.65;flex-shrink:0"></span>` : ''}
          <span style="font-size:0.7rem;color:var(--muted)">${benchDesc}</span>
        </div>
        ${ago !== null ? `<span style="font-size:0.68rem;color:var(--muted);flex-shrink:0">${ago === 0 ? 'today' : ago + 'd ago'}</span>` : ''}
      </div>
    </div>`;

  if (!skipScroll) {
    setTimeout(() => box?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }
};

const renderProgressScreen = () => {
  try { _renderProgressScreen(); } catch(e) {
    console.error('Progress error:', e);
    toast('Progress error: ' + e.message, 'err');
  }
};
const _renderProgressScreen = () => {
  const el = document.getElementById('progress-content');
  if (!el) return;

  const baselines = DB.getBaselines();
  const latestBL  = DB.getLatestBaseline();
  const bw        = latestBL?.bodyweight || 260;

  if (!baselines.length) {
    el.innerHTML = `
      <div class="empty mt24">
        <div class="empty-icon">📈</div>
        <p>Run your baseline tests to start tracking progress against elite benchmarks.</p>
        <button class="btn btn-primary btn-sm mt16" style="max-width:240px;margin:16px auto 0" onclick="wizardStart()">Run Baseline Test</button>
      </div>`;
    return;
  }

  _progMetrics = [
    { id: 'sprint',     cfg: BENCHMARKS.sprint,
      points: getBaselineHistory('sprint'),
      benchVal: BENCHMARKS.sprint.eliteMax },
    { id: 'agility',    cfg: BENCHMARKS.agility,
      points: getBaselineHistory('agility'),
      benchVal: BENCHMARKS.agility.eliteMax },
    { id: 'broadJump',  cfg: BENCHMARKS.broadJump,
      points: getBaselineHistory('broadJump'),
      benchVal: BENCHMARKS.broadJump.eliteMin },
    { id: 'lift1RM',    cfg: BENCHMARKS.lift1RM,
      points: mergePoints(getBaselineHistory('estimated1RM'), getWorkout1RMHistory()),
      benchVal: bw * BENCHMARKS.lift1RM.bwMultiplier },
    { id: 'bodyweight', cfg: BENCHMARKS.bodyweight,
      points: getBodyweightHistory(),
      benchVal: (BENCHMARKS.bodyweight.targetLo + BENCHMARKS.bodyweight.targetHi) / 2 },
  ];

  const tileFn = (m, wide = false, tileClass = 'prog-tile', expandFn = 'expandMetricChart', selectedId = _progSelected) => {
    const trend = getTrend(m.points, m.cfg);
    const last  = m.points.length ? m.points[m.points.length - 1] : null;
    const val   = last ? `${last.y}${m.cfg.unit}` : '—';
    const tc    = trend.color === 'green' ? 'var(--green)' : trend.color === 'red' ? 'var(--red)' : 'var(--muted)';
    const sel   = selectedId === m.id;
    return `
      <div class="${tileClass}${wide ? ' wide' : ''}${sel ? ' selected' : ''}"
           data-mid="${m.id}" onclick="${expandFn}('${m.id}')">
        <div class="card-label" style="margin-bottom:4px">${m.cfg.label}</div>
        <div class="prog-val">${val}</div>
        <div class="prog-trend" style="color:${tc}">${trend.arrow} ${trend.label}</div>
      </div>`;
  };

  // Body comp metrics
  _bodyMetrics = [
    { id: 'bl-weight',      cfg: { label: 'Weight',        unit: 'lbs', targetLo: 240, targetHi: 255 }, points: getBLHistory('weight') },
    { id: 'bl-bodyFat',     cfg: { label: 'Body Fat',       unit: '%',   lowerIsBetter: true  },          points: getBLHistory('bodyFat') },
    { id: 'bl-muscleMass',  cfg: { label: 'Muscle Mass',    unit: 'lbs', lowerIsBetter: false },          points: getBLHistory('muscleMass') },
    { id: 'bl-leanMass',    cfg: { label: 'Lean Mass',      unit: 'lbs', lowerIsBetter: false },          points: getBLHistory('leanMass') },
    { id: 'bl-visceralFat', cfg: { label: 'Visceral Fat',   unit: '',    lowerIsBetter: true  },          points: getBLHistory('visceralFat') },
  ];
  const hasBodyLogs = DB.getBodyLogs().length > 0;

  const bodySection = hasBodyLogs ? `
    <div style="display:flex;align-items:center;justify-content:space-between;margin:20px 0 10px">
      <h3>Body Composition</h3>
      <span class="section-action" onclick="openBodyLog()">Log Today</span>
    </div>
    <div class="prog-grid">
      ${tileFn(_bodyMetrics[0], false, 'prog-tile body-tile', 'expandBodyChart', _bodySelected)}
      ${tileFn(_bodyMetrics[1], false, 'prog-tile body-tile', 'expandBodyChart', _bodySelected)}
      ${tileFn(_bodyMetrics[2], false, 'prog-tile body-tile', 'expandBodyChart', _bodySelected)}
      ${tileFn(_bodyMetrics[3], false, 'prog-tile body-tile', 'expandBodyChart', _bodySelected)}
    </div>
    ${tileFn(_bodyMetrics[4], true, 'prog-tile body-tile', 'expandBodyChart', _bodySelected)}
    <div id="prog-body-chart-box"></div>
    <button class="btn btn-ghost btn-sm mt8" onclick="openBodyLog()">+ Log Check-In</button>
  ` : `
    <div style="margin:20px 0 10px"><h3>Body Composition</h3></div>
    <div class="card" style="text-align:center;padding:24px">
      <div style="font-size:2.2rem;margin-bottom:10px">⚖️</div>
      <p style="margin-bottom:14px">Log your Starfit measurements to track body composition over time.</p>
      <button class="btn btn-primary btn-sm" style="max-width:220px;margin:0 auto" onclick="openBodyLog()">Log First Check-In</button>
    </div>
  `;

  // Sleep & Recovery section
  _sleepMetrics = [
    { id: 'sl-duration', cfg: { label: 'Sleep Duration', unit: 'h'   }, points: getSLHistory('sleepDuration'), benchVal: 8  },
    { id: 'sl-quality',  cfg: { label: 'Sleep Quality',  unit: ''    }, points: getSLHistory('sleepQuality'),  benchVal: 80 },
    { id: 'sl-recovery', cfg: { label: 'Recovery Score', unit: ''    }, points: getSLHistory('recovery'),      benchVal: 75 },
    { id: 'sl-feel',     cfg: { label: 'Morning Feel',   unit: '/10' }, points: getSLHistory('feelRating'),    benchVal: 8  },
  ];
  const hasSleepLogs = DB.getSleepLogs().length > 0;

  const sleepTileFn = (m) => {
    const trend = sleepTrend(m.points);
    const last  = m.points.length ? m.points[m.points.length - 1] : null;
    const val   = last ? `${last.y}${m.cfg.unit}` : '—';
    const tc    = trend.color === 'green' ? 'var(--green)' : trend.color === 'red' ? 'var(--red)' : 'var(--muted)';
    const sel   = _sleepSelected === m.id;
    return `<div class="prog-tile sleep-tile${sel ? ' selected' : ''}"
         data-mid="${m.id}" onclick="expandSleepChart('${m.id}')">
      <div class="card-label" style="margin-bottom:4px">${m.cfg.label}</div>
      <div class="prog-val">${val}</div>
      <div class="prog-trend" style="color:${tc}">${trend.arrow} ${trend.label}</div>
    </div>`;
  };

  const sleepSection = hasSleepLogs ? `
    <div style="display:flex;align-items:center;justify-content:space-between;margin:20px 0 10px">
      <h3>Sleep & Recovery</h3>
      <span class="section-action" onclick="openSleepLog()">Log Today</span>
    </div>
    <div class="prog-grid">
      ${sleepTileFn(_sleepMetrics[0])}${sleepTileFn(_sleepMetrics[1])}
      ${sleepTileFn(_sleepMetrics[2])}${sleepTileFn(_sleepMetrics[3])}
    </div>
    <div id="prog-sleep-chart-box"></div>
    <button class="btn btn-ghost btn-sm mt8" onclick="openSleepLog()">+ Log Check-In</button>
  ` : `
    <div style="margin:20px 0 10px"><h3>Sleep & Recovery</h3></div>
    <div class="card" style="text-align:center;padding:24px">
      <div style="font-size:2.2rem;margin-bottom:10px">😴</div>
      <p style="margin-bottom:14px">Log your sleep to see trends and let the AI tune workouts to your recovery level.</p>
      <button class="btn btn-primary btn-sm" style="max-width:220px;margin:0 auto" onclick="openSleepLog()">Log First Night</button>
    </div>
  `;

  // ── Per-exercise section ─────────────────────────────────────────
  const allExercises = getAllExercisesWithData();
  const exerciseSection = allExercises.length ? (() => {
    const rows = allExercises.map(e => {
      const valStr  = e.hasWeight ? `${e.lastBest} lbs est. 1RM` : `${e.lastBest} reps max`;
      const sessStr = `${e.sessions} session${e.sessions !== 1 ? 's' : ''}`;
      const safeName = e.name.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
      return `
        <div class="ex-row" data-exname="${safeName}"
             onclick="expandExerciseChart(this.dataset.exname)">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.name}</div>
            <div style="font-size:0.72rem;color:var(--muted);margin-top:2px">${valStr} · ${sessStr}</div>
          </div>
          <div style="color:var(--muted);font-size:1.1rem;flex-shrink:0;margin-left:8px">›</div>
        </div>`;
    }).join('');
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;margin:20px 0 10px">
        <h3>Exercises</h3>
        <span style="font-size:0.72rem;color:var(--muted)">${allExercises.length} logged</span>
      </div>
      <div class="card" style="padding:0">${rows}</div>
      <div id="prog-ex-chart-box"></div>`;
  })() : `
    <div style="margin:20px 0 10px"><h3>Exercises</h3></div>
    <div class="card" style="text-align:center;padding:24px">
      <p style="color:var(--muted);font-size:0.875rem">Log workouts with exercises to see your progression charts here.</p>
    </div>`;

  el.innerHTML = `
    <div class="prog-grid">
      ${tileFn(_progMetrics[0])}${tileFn(_progMetrics[1])}
      ${tileFn(_progMetrics[2])}${tileFn(_progMetrics[3])}
    </div>
    ${tileFn(_progMetrics[4], true)}
    <div id="prog-chart-box"></div>
    <button class="btn btn-ghost btn-sm mt12" onclick="wizardStart()">+ Add Baseline Test</button>
    ${bodySection}
    ${sleepSection}
    ${exerciseSection}
  `;

  if (_progSelected) expandMetricChart(_progSelected, true);
  if (_bodySelected) expandBodyChart(_bodySelected, true);
  if (_sleepSelected) expandSleepChart(_sleepSelected, true);
  if (_exSelected)    expandExerciseChart(_exSelected, true);
};

const expandMetricChart = (id, skipScroll = false) => {
  const m = _progMetrics.find(x => x.id === id);
  if (!m) return;

  // Toggle off if already selected
  if (_progSelected === id) {
    _progSelected = null;
    document.getElementById('prog-chart-box').innerHTML = '';
    document.querySelectorAll('.prog-tile').forEach(t => t.classList.remove('selected'));
    return;
  }

  _progSelected = id;
  document.querySelectorAll('.prog-tile').forEach(t =>
    t.classList.toggle('selected', t.dataset.mid === id));

  const bw      = DB.getLatestBaseline()?.bodyweight || 260;
  const bench   = id === 'lift1RM' ? bw * BENCHMARKS.lift1RM.bwMultiplier : m.benchVal;
  const trend   = getTrend(m.points, m.cfg);
  const tc      = trend.color === 'green' ? 'var(--green)' : trend.color === 'red' ? 'var(--red)' : 'var(--muted)';
  const descStr = id === 'lift1RM'
    ? `Target: ${Math.round(bw * 2)}+ lbs (2× your ${bw} lb BW)`
    : m.cfg.desc;
  const last    = m.points.length ? m.points[m.points.length - 1] : null;
  const ago     = last ? daysSince(last.x) : null;

  document.getElementById('prog-chart-box').innerHTML = `
    <div class="card mt8">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div class="card-label" style="margin-bottom:0">${m.cfg.label}</div>
        <div style="font-size:0.78rem;font-weight:700;color:${tc}">${trend.arrow} ${trend.label}</div>
      </div>
      ${buildSvgChart(id + 'x', m.points, bench)}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="display:inline-block;width:16px;height:2px;background:#ffd700;opacity:0.65;flex-shrink:0"></span>
          <span style="font-size:0.7rem;color:var(--muted)">${descStr}</span>
        </div>
        ${ago !== null ? `<span style="font-size:0.68rem;color:var(--muted);flex-shrink:0">${ago === 0 ? 'today' : ago + 'd ago'}</span>` : ''}
      </div>
    </div>`;

  if (!skipScroll) {
    setTimeout(() => {
      document.getElementById('prog-chart-box')
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }
};

const expandBodyChart = (id, skipScroll = false) => {
  const m = _bodyMetrics.find(x => x.id === id);
  if (!m) return;

  if (_bodySelected === id) {
    _bodySelected = null;
    const box = document.getElementById('prog-body-chart-box');
    if (box) box.innerHTML = '';
    document.querySelectorAll('.body-tile').forEach(t => t.classList.remove('selected'));
    return;
  }

  _bodySelected = id;
  document.querySelectorAll('.body-tile').forEach(t =>
    t.classList.toggle('selected', t.dataset.mid === id));

  const trend    = getTrend(m.points, m.cfg);
  const tc       = trend.color === 'green' ? 'var(--green)' : trend.color === 'red' ? 'var(--red)' : 'var(--muted)';
  const benchVal = m.cfg.targetLo != null ? (m.cfg.targetLo + m.cfg.targetHi) / 2 : null;
  const benchLbl = m.cfg.targetLo != null ? `Target: ${m.cfg.targetLo}–${m.cfg.targetHi} ${m.cfg.unit}` : null;
  const last     = m.points.length ? m.points[m.points.length - 1] : null;
  const ago      = last ? daysSince(last.x) : null;

  const box = document.getElementById('prog-body-chart-box');
  if (!box) return;
  box.innerHTML = `
    <div class="card mt8">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div class="card-label" style="margin-bottom:0">${m.cfg.label}</div>
        <div style="font-size:0.78rem;font-weight:700;color:${tc}">${trend.arrow} ${trend.label}</div>
      </div>
      ${buildSvgChart(id, m.points, benchVal)}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
        ${benchLbl ? `
          <div style="display:flex;align-items:center;gap:6px">
            <span style="display:inline-block;width:16px;height:2px;background:#ffd700;opacity:0.65;flex-shrink:0"></span>
            <span style="font-size:0.7rem;color:var(--muted)">${benchLbl}</span>
          </div>` : '<div></div>'}
        ${ago !== null ? `<span style="font-size:0.68rem;color:var(--muted)">${ago === 0 ? 'today' : ago + 'd ago'}</span>` : ''}
      </div>
    </div>`;

  if (!skipScroll) {
    setTimeout(() => box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }
};

// ================================================================
// BODY LOG — Daily scale check-in + AI screenshot scanner
// ================================================================
let _bodyData  = {};
let _scanCount = 0;

// ================================================================
// SLEEP & RECOVERY — state vars
// ================================================================
let _sleepData     = {};
let _sleepMetrics  = [];
let _sleepSelected = null;

const BL_FIELDS = [
  { key: 'weight',       label: 'Weight',           unit: 'lbs', step: '0.1', big: true  },
  { key: 'bodyFat',      label: 'Body Fat',          unit: '%',   step: '0.1'             },
  { key: 'muscleMass',   label: 'Muscle Mass',       unit: 'lbs', step: '0.1'             },
  { key: 'leanMass',     label: 'Lean Body Mass',    unit: 'lbs', step: '0.1'             },
  { key: 'bodyWater',    label: 'Body Water',        unit: '%',   step: '0.1'             },
  { key: 'boneMass',     label: 'Bone Mass',         unit: 'lbs', step: '0.1'             },
  { key: 'visceralFat',  label: 'Visceral Fat',      unit: '',    step: '1'               },
  { key: 'bmi',          label: 'BMI',               unit: '',    step: '0.1'             },
  { key: 'metabolicAge', label: 'Metabolic Age',     unit: 'yrs', step: '1'               },
  { key: 'bmr',          label: 'BMR',               unit: 'cal', step: '1'               },
  { key: 'protein',      label: 'Protein',           unit: '%',   step: '0.1'             },
  { key: 'subcutFat',    label: 'Subcutaneous Fat',  unit: '%',   step: '0.1'             },
  { key: 'fatMass',      label: 'Fat Mass',          unit: 'lbs', step: '0.1'             },
];

// Convert any image (HEIC, PNG, etc.) to a JPEG base64 string, max 1000px
const imageToJpeg = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const MAX = 1000;
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (w > MAX || h > MAX) {
      if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
      else       { w = Math.round(w * MAX / h); h = MAX; }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    resolve(canvas.toDataURL('image/jpeg', 0.75).split(',')[1]);
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image — try a JPEG or PNG screenshot')); };
  img.src = url;
});

const renderBodyLogFields = () => {
  const el = document.getElementById('bl-fields');
  if (!el) return;
  const bigFields  = BL_FIELDS.filter(f => f.big);
  const gridFields = BL_FIELDS.filter(f => !f.big);
  const filledCount = BL_FIELDS.filter(f => _bodyData[f.key] != null).length;
  el.innerHTML = `
    ${filledCount > 0 ? `<div style="font-size:0.75rem;color:var(--muted);margin-bottom:12px;text-align:center">${filledCount} of ${BL_FIELDS.length} fields filled — edit any value below</div>` : ''}
    ${bigFields.map(f => `
      <div class="form-group">
        <label>${f.label}${f.unit ? ' (' + f.unit + ')' : ''}</label>
        <input type="number" id="bl-${f.key}" placeholder="—" step="${f.step}" inputmode="decimal"
               value="${_bodyData[f.key] != null ? _bodyData[f.key] : ''}"
               oninput="_bodyData['${f.key}'] = this.value ? parseFloat(this.value) : null">
      </div>`).join('')}
    <div class="bl-grid">
      ${gridFields.map(f => `
        <div class="form-group" style="margin-bottom:12px">
          <label style="font-size:0.65rem">${f.label}${f.unit ? ' (' + f.unit + ')' : ''}</label>
          <input type="number" id="bl-${f.key}" placeholder="—" step="${f.step}" inputmode="decimal"
                 value="${_bodyData[f.key] != null ? _bodyData[f.key] : ''}"
                 oninput="_bodyData['${f.key}'] = this.value ? parseFloat(this.value) : null">
        </div>`).join('')}
    </div>`;
};

const updateScanButton = () => {
  const btn = document.getElementById('bl-scan-btn');
  if (!btn) return;
  const filledCount = BL_FIELDS.filter(f => _bodyData[f.key] != null).length;
  btn.textContent = _scanCount === 0
    ? '📷  Scan Starfit Screenshot'
    : `📷  Scan Another Screenshot  (${filledCount}/${BL_FIELDS.length} filled)`;
};

const openBodyLog = () => {
  _bodyData  = {};
  _scanCount = 0;
  const dateEl   = document.getElementById('bl-date');
  const statusEl = document.getElementById('bl-scan-status');
  if (dateEl)   dateEl.value = today();
  if (statusEl) { statusEl.style.display = 'none'; statusEl.innerHTML = ''; }
  renderBodyLogFields();
  updateScanButton();
  show('screen-bodylog');
};

const scanBodyScreenshot = async (input) => {
  const file = input.files[0];
  if (!file) return;

  const statusEl = document.getElementById('bl-scan-status');
  const btn      = document.getElementById('bl-scan-btn');
  statusEl.style.display = 'block';
  statusEl.innerHTML = `<div class="card" style="text-align:center;padding:16px"><span class="spinner"></span> Reading screenshot ${_scanCount + 1}…</div>`;
  if (btn) btn.disabled = true;

  try {
    const base64 = await imageToJpeg(file);

    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
            { type: 'text',  text: 'This is a screenshot from a Starfit smart scale app. Find all the numbers on screen and return ONLY this JSON (null for anything not shown): {"weight":null,"bmi":null,"bodyFat":null,"fatMass":null,"muscleMass":null,"leanMass":null,"bodyWater":null,"boneMass":null,"visceralFat":null,"metabolicAge":null,"bmr":null,"protein":null,"subcutFat":null}. Weight in lbs. Percentages as plain numbers like 22.4 not "22.4%". JSON only, no other text.' }
          ]
        }]
      })
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Server returned ${res.status}`);
    }

    const data  = await res.json();
    const raw   = data.content?.[0]?.text || '';
    const start = raw.indexOf('{');
    const end   = raw.lastIndexOf('}');
    if (start === -1) throw new Error('No data found in screenshot — make sure it shows Starfit measurements');

    const parsed   = JSON.parse(raw.slice(start, end + 1));
    let newFields  = 0;
    Object.keys(parsed).forEach(k => {
      if (parsed[k] !== null && parsed[k] !== undefined) {
        if (_bodyData[k] == null) newFields++;
        _bodyData[k] = parsed[k];
      }
    });
    _bodyData.source = 'ai_scan';
    _scanCount++;

    renderBodyLogFields();
    updateScanButton();

    const totalFilled = BL_FIELDS.filter(f => _bodyData[f.key] != null).length;
    const remaining   = BL_FIELDS.length - totalFilled;
    statusEl.innerHTML = `
      <div class="card" style="padding:12px;margin-bottom:0">
        <div style="color:var(--green);font-weight:700;margin-bottom:4px">✓ Screenshot ${_scanCount} done — ${newFields} new fields added</div>
        <div style="font-size:0.78rem;color:var(--muted)">${totalFilled}/${BL_FIELDS.length} total filled${remaining > 0 ? ' · Scan another screenshot to fill the rest' : ' · All fields captured!'}</div>
      </div>`;
    toast(`+${newFields} fields from screenshot ${_scanCount}`, 'ok');

  } catch (err) {
    console.error('Body scan error:', err);
    statusEl.innerHTML = `
      <div class="card" style="padding:12px;margin-bottom:0">
        <div style="color:var(--red);font-weight:700;margin-bottom:4px">Scan failed</div>
        <div style="font-size:0.78rem;color:var(--muted)">${err.message} — try again or fill in manually below.</div>
      </div>`;
    toast('Scan failed', 'err');
  }

  if (btn) btn.disabled = false;
  input.value = '';
};

const saveBodyLog = () => {
  const wt = parseFloat(_bodyData.weight);
  if (!wt || wt < 50 || wt > 700) { toast('Enter your weight (50–700 lbs)', 'err'); return; }
  const dateVal = document.getElementById('bl-date')?.value || today();
  DB.addBodyLog(Object.assign({ id: uid(), date: dateVal, source: _bodyData.source || 'manual' }, _bodyData));
  toast('Check-in saved! 💪', 'ok');
  _bodyData = {};
  renderDashboard();
  show('screen-home');
};

// Merge bodylog weights + baseline weights for the bodyweight chart
const getBodyweightHistory = () => {
  const blPts = DB.getBodyLogs()
    .filter(b => b.weight)
    .map(b => ({ x: b.date, y: b.weight, label: fmtShortDate(b.date) }));
  return mergePoints(getBaselineHistory('bodyweight'), blPts);
};

// ================================================================
// SLEEP & RECOVERY — functions
// ================================================================

// Score 0-100 composite from available sleep fields → 'poor'|'moderate'|'good'|'excellent'|null
const calcRecoveryLevel = (log) => {
  if (!log) return null;
  const scores = [];
  if (log.sleepDuration) scores.push(Math.min((log.sleepDuration / 9) * 100, 100));
  if (log.sleepQuality)  scores.push(log.sleepQuality);
  if (log.recovery)      scores.push(log.recovery);
  if (log.feelRating)    scores.push(log.feelRating * 10);
  if (!scores.length) return null;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avg < 40) return 'poor';
  if (avg < 65) return 'moderate';
  if (avg < 85) return 'good';
  return 'excellent';
};

const buildRecoveryBadge = (log) => {
  const level = calcRecoveryLevel(log);
  if (!level) return '';
  const MAP = {
    poor:      { color: '#e63946', bg: 'rgba(230,57,70,0.12)',  text: '⚠️ Low recovery — trainer will reduce intensity today' },
    moderate:  { color: '#ffd700', bg: 'rgba(255,215,0,0.10)',  text: '😐 Moderate recovery — standard session today' },
    good:      { color: '#2ecc71', bg: 'rgba(46,204,113,0.10)', text: '✅ Good recovery — push for progress today' },
    excellent: { color: '#1e9fff', bg: 'rgba(30,159,255,0.10)', text: '💪 Excellent recovery — prime day for PRs' },
  }[level];
  return `<div class="recovery-badge" style="background:${MAP.bg};color:${MAP.color}">${MAP.text}</div>`;
};

// Returns a line to inject into the workout prompt when recent sleep data exists
const getRecoveryContext = () => {
  const log = DB.getLatestSleepLog();
  if (!log) return '';
  const age = daysSince(log.date);
  if (age > 1) return ''; // Only use today's or yesterday's data
  const level = calcRecoveryLevel(log);
  if (!level) return '';
  const parts = [];
  if (log.sleepDuration) parts.push(`${log.sleepDuration}h sleep`);
  if (log.sleepQuality)  parts.push(`quality ${log.sleepQuality}/100`);
  if (log.recovery)      parts.push(`recovery ${log.recovery}/100`);
  if (log.feelRating)    parts.push(`feels ${log.feelRating}/10`);
  const adjustments = {
    poor:      'REDUCE intensity ~15–20%. Avoid maximal efforts. Prioritize movement quality over load. Skip PRs — this is a maintenance day. Athlete still benefits from moving. Be supportive, NOT judgmental about the numbers.',
    moderate:  'Proceed as planned. Back off if something feels off during the session.',
    good:      'Athlete is well-recovered. Push for progressive overload, heavier loads, quality reps.',
    excellent: 'Athlete is fully charged. Push hard on compounds. Good day for PR attempts.',
  }[level];
  return `\nRECOVERY (${age === 0 ? 'this morning' : 'yesterday'}): ${parts.join(', ')} — Level: ${level.toUpperCase()}. ${adjustments}`;
};

// Pull sleep log data for a specific field, chart-ready
const getSLHistory = (field) =>
  DB.getSleepLogs()
    .filter(s => s[field] != null && !isNaN(s[field]))
    .map(s => ({ x: s.date, y: parseFloat(s[field]), label: fmtShortDate(s.date) }))
    .sort((a, b) => a.x.localeCompare(b.x));

// Simple trend for sleep metrics (no elite benchmarks, just up/down)
const sleepTrend = (points) => {
  if (points.length < 2) return { label: 'Log 2+ days', color: 'muted', arrow: '—' };
  const d   = points[points.length - 1].y - points[points.length - 2].y;
  const pct = Math.abs(d) / (Math.abs(points[points.length - 2].y) || 1);
  if (pct < 0.04) return { label: 'Consistent',  color: 'muted',  arrow: '→' };
  return d > 0
    ? { label: 'Improving', color: 'green', arrow: '↑' }
    : { label: 'Declining', color: 'red',   arrow: '↓' };
};

const renderSleepFeel = () => {
  const grid = document.getElementById('sl-feel-grid');
  if (!grid) return;
  const colors = ['#e63946','#e63946','#e07832','#e09a32','#ffd700','#c2c830','#8ac830','#2ecc71','#2ecc71','#1e9fff'];
  grid.innerHTML = [1,2,3,4,5,6,7,8,9,10].map((n, i) => {
    const sel = _sleepData.feelRating === n;
    const c   = colors[i];
    return `<button class="feel-num-opt${sel ? ' selected' : ''}"
      onclick="setSleepFeel(${n})"
      style="${sel ? `border-color:${c};background:${c}25;color:${c}` : ''}">${n}</button>`;
  }).join('');
  const lbl = document.getElementById('sl-feel-label');
  if (lbl) lbl.textContent = _sleepData.feelRating
    ? ` — ${_sleepData.feelRating}/10`
    : ' — tap to rate';
};

const setSleepFeel = (n) => {
  _sleepData.feelRating = n;
  renderSleepFeel();
};

const openSleepLog = () => {
  _sleepData = {};
  const dateEl   = document.getElementById('sl-date');
  const statusEl = document.getElementById('sl-scan-status');
  if (dateEl)   dateEl.value = today();
  if (statusEl) { statusEl.style.display = 'none'; statusEl.innerHTML = ''; }
  ['sleepDuration','sleepQuality','recovery'].forEach(k => {
    const el = document.getElementById('sl-' + k);
    if (el) el.value = '';
  });
  renderSleepFeel();
  show('screen-sleep');
};

const scanSleepScreenshot = async (input) => {
  const file = input.files[0];
  if (!file) return;
  const statusEl = document.getElementById('sl-scan-status');
  const btn      = document.getElementById('sl-scan-btn');
  statusEl.style.display = 'block';
  statusEl.innerHTML = `<div class="card" style="text-align:center;padding:16px"><span class="spinner"></span> Reading screenshot…</div>`;
  if (btn) btn.disabled = true;
  try {
    const base64 = await imageToJpeg(file);
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
            { type: 'text',  text: 'This is a health app sleep summary screenshot (could be Apple Health, Samsung Health, Garmin, Whoop, Oura, or any sleep tracker). Find: (1) total sleep duration in decimal hours (e.g. 7.5 for 7h 30m), (2) sleep quality or sleep score as a number 0–100 (may be labeled Score, Quality, Sleep Quality, Sleep Score, etc.), (3) recovery or readiness score as a number 0–100 (may be labeled Recovery, Readiness, Body Battery, HRV Score, Wellness, etc.). Return ONLY valid JSON: {"sleepDuration":null,"sleepQuality":null,"recovery":null}. Use null for anything not visible. JSON only, no other text.' }
          ]
        }]
      })
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const data  = await res.json();
    const raw   = data.content?.[0]?.text || '';
    const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
    if (start === -1) throw new Error('No data found in screenshot');
    const parsed = JSON.parse(raw.slice(start, end + 1));
    let found = 0;
    ['sleepDuration', 'sleepQuality', 'recovery'].forEach(k => {
      if (parsed[k] !== null && parsed[k] !== undefined) {
        _sleepData[k] = parsed[k];
        const el = document.getElementById('sl-' + k);
        if (el) el.value = parsed[k];
        found++;
      }
    });
    _sleepData.source = 'scan';
    statusEl.innerHTML = `<div class="card" style="padding:12px">
      <div style="color:var(--green);font-weight:700;margin-bottom:4px">✓ Scan done — ${found} value${found !== 1 ? 's' : ''} found</div>
      <div style="font-size:0.78rem;color:var(--muted)">Review below, add your feel rating, then save.</div>
    </div>`;
    toast(`${found} sleep values read`, 'ok');
  } catch (err) {
    statusEl.innerHTML = `<div class="card" style="padding:12px">
      <div style="color:var(--red);font-weight:700;margin-bottom:4px">Scan failed</div>
      <div style="font-size:0.78rem;color:var(--muted)">${err.message} — fill in manually below.</div>
    </div>`;
    toast('Scan failed', 'err');
  }
  if (btn) btn.disabled = false;
  input.value = '';
};

const saveSleepLog = () => {
  const hasAny = _sleepData.sleepDuration || _sleepData.sleepQuality || _sleepData.recovery || _sleepData.feelRating;
  if (!hasAny) { toast('Enter at least one value', 'err'); return; }
  const dateVal = document.getElementById('sl-date')?.value || today();
  DB.addSleepLog(Object.assign({ id: uid(), date: dateVal, source: _sleepData.source || 'manual' }, _sleepData));
  toast('Sleep logged! 😴', 'ok');
  _sleepData = {};
  renderDashboard();
  show('screen-home');
};

const expandSleepChart = (id, skipScroll = false) => {
  const m = _sleepMetrics.find(x => x.id === id);
  if (!m) return;
  if (_sleepSelected === id) {
    _sleepSelected = null;
    const box = document.getElementById('prog-sleep-chart-box');
    if (box) box.innerHTML = '';
    document.querySelectorAll('.sleep-tile').forEach(t => t.classList.remove('selected'));
    return;
  }
  _sleepSelected = id;
  document.querySelectorAll('.sleep-tile').forEach(t =>
    t.classList.toggle('selected', t.dataset.mid === id));
  const trend = sleepTrend(m.points);
  const tc    = trend.color === 'green' ? 'var(--green)' : trend.color === 'red' ? 'var(--red)' : 'var(--muted)';
  const last  = m.points.length ? m.points[m.points.length - 1] : null;
  const ago   = last ? daysSince(last.x) : null;
  const box   = document.getElementById('prog-sleep-chart-box');
  if (!box) return;
  box.innerHTML = `
    <div class="card mt8">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div class="card-label" style="margin-bottom:0">${m.cfg.label}</div>
        <div style="font-size:0.78rem;font-weight:700;color:${tc}">${trend.arrow} ${trend.label}</div>
      </div>
      ${buildSvgChart(id, m.points, m.benchVal)}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="display:inline-block;width:16px;height:2px;background:#ffd700;opacity:0.65;flex-shrink:0"></span>
          <span style="font-size:0.7rem;color:var(--muted)">Target: ${m.benchVal}${m.cfg.unit}</span>
        </div>
        ${ago !== null ? `<span style="font-size:0.68rem;color:var(--muted)">${ago === 0 ? 'today' : ago + 'd ago'}</span>` : ''}
      </div>
    </div>`;
  if (!skipScroll) {
    setTimeout(() => box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }
};

// ================================================================
// FEATURE 5 — NUTRITION TRACKER
// ================================================================

let _nutriDate     = today();
let _nutriEntry    = null;
let _nutriMode     = 'manual';
let _nutriFormData = { name:'', servingSize:'1 serving', servings:1, calories:'', protein:'', carbs:'', fat:'', fiber:'', sodium:'', note:'' };
let _nutriReviewScope   = null;
let _nutriReviewEntryId = null;
let _nutriReviewResult  = null;
let _nutriReviewBusy    = false;
let _nutriChatHist = [];
let _nutriChatBusy = false;

const escHtml = (s) => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const nutriTotals = (entries) => entries.reduce((t, e) => ({
  calories: t.calories + Math.round((e.perServing.calories || 0) * e.servings),
  protein:  +(t.protein  + (e.perServing.protein  || 0) * e.servings).toFixed(1),
  carbs:    +(t.carbs    + (e.perServing.carbs    || 0) * e.servings).toFixed(1),
  fat:      +(t.fat      + (e.perServing.fat      || 0) * e.servings).toFixed(1),
  fiber:    +(t.fiber    + (e.perServing.fiber    || 0) * e.servings).toFixed(1),
  sodium:   Math.round(t.sodium + (e.perServing.sodium || 0) * e.servings),
}), { calories:0, protein:0, carbs:0, fat:0, fiber:0, sodium:0 });

const renderNutritionScreen = () => {
  const entries   = DB.getNutriDay(_nutriDate);
  const targets   = DB.getNutriTargets();
  const totals    = nutriTotals(entries);
  const isToday   = _nutriDate === today();
  const dateLabel = isToday ? 'Today' : fmtDate(_nutriDate);

  const macroBar = (label, val, target, unit, color) => {
    const pct = Math.min((val / target) * 100, 100);
    return `<div class="macro-row">
      <div class="macro-label-row">
        <span class="macro-name">${label}</span>
        <span class="macro-vals">${val}${unit}<span class="macro-target"> / ${target}${unit}</span></span>
      </div>
      <div class="macro-track"><div class="macro-fill" style="width:${pct}%;background:${color}"></div></div>
    </div>`;
  };

  const entriesHtml = entries.length ? entries.map(e => {
    const cal  = Math.round((e.perServing.calories || 0) * e.servings);
    const pro  = +((e.perServing.protein || 0) * e.servings).toFixed(1);
    const carb = +((e.perServing.carbs   || 0) * e.servings).toFixed(1);
    const fat  = +((e.perServing.fat     || 0) * e.servings).toFixed(1);
    const badge = e.source === 'estimate'
      ? `<span class="nutr-badge estimate">~Est</span>`
      : e.source === 'label' ? `<span class="nutr-badge label">Label</span>` : '';
    return `<div class="nutr-entry-row" onclick="openNutritionAdd('${e.id}')">
      <div class="nutr-entry-left">
        <div class="nutr-entry-name">${escHtml(e.name)} ${badge}</div>
        <div class="nutr-entry-sub">${e.servings}× ${escHtml(e.servingSize)}</div>
      </div>
      <div class="nutr-entry-right">
        <div class="nutr-entry-cal">${cal} cal</div>
        <div class="nutr-entry-macros">${pro}P · ${carb}C · ${fat}F</div>
      </div>
    </div>`;
  }).join('') : `<div class="empty" style="padding:20px 0"><div class="empty-icon">🍽️</div><p>No food logged yet.</p></div>`;

  document.getElementById('nutr-content').innerHTML = `
    <div class="nutr-date-nav">
      <button class="cal-arrow" onclick="nutriDateNav(-1)">&#8249;</button>
      <span class="nutr-date-label">${dateLabel}</span>
      <button class="cal-arrow" onclick="nutriDateNav(1)"${isToday?' disabled style="opacity:0.3;pointer-events:none"':''}>&#8250;</button>
    </div>
    <div class="card nutr-summary-card">
      <div class="nutr-cal-hero">
        <div><span class="nutr-cal-num">${totals.calories}</span><span class="nutr-cal-label"> cal</span></div>
        <span class="nutr-cal-target">~${targets.calories.toLocaleString()} target</span>
      </div>
      ${macroBar('Protein', totals.protein, targets.protein, 'g',  'var(--red)')}
      ${macroBar('Carbs',   totals.carbs,   targets.carbs,   'g',  'var(--gold)')}
      ${macroBar('Fat',     totals.fat,     targets.fat,     'g',  'var(--green)')}
      ${macroBar('Fiber',   totals.fiber,   targets.fiber,   'g',  '#a78bfa')}
      ${macroBar('Sodium',  totals.sodium,  targets.sodium,  'mg', '#38bdf8')}
    </div>
    <div class="section-head" style="padding:0;margin:14px 0 8px">
      <h3>Food Log</h3>
      <button class="btn btn-primary btn-sm btn-inline" onclick="openNutritionAdd(null)" style="padding:7px 14px;font-size:0.8rem;min-height:auto">+ Add</button>
    </div>
    <div class="card" style="padding:0 16px">${entriesHtml}</div>

    <div class="card mt12" style="padding:14px 16px">
      <div style="font-size:0.82rem;font-weight:700;color:var(--text);margin-bottom:4px">AI Fuel Review</div>
      <div style="font-size:0.72rem;color:var(--muted);margin-bottom:10px">Supportive feedback on your fueling — focused on performance & recovery.</div>
      <div class="nutr-mode-row">
        <button class="nutr-mode-btn nutr-review-btn${_nutriReviewScope==='meal' ?' active':''}" onclick="setNutrReviewScope('meal')">Meal</button>
        <button class="nutr-mode-btn nutr-review-btn${_nutriReviewScope==='day'  ?' active':''}" onclick="setNutrReviewScope('day')">Today</button>
        <button class="nutr-mode-btn nutr-review-btn${_nutriReviewScope==='week' ?' active':''}" onclick="setNutrReviewScope('week')">This Week</button>
      </div>
      ${_nutriReviewScope === 'meal' ? (entries.length
        ? `<div style="margin-bottom:10px">${entries.map(e => `
            <div class="nutr-review-entry${_nutriReviewEntryId===e.id?' selected':''}" onclick="setNutrReviewEntry('${e.id}')">
              ${escHtml(e.name)} <span style="color:var(--muted);font-size:0.72rem">(${Math.round((e.perServing.calories||0)*e.servings)} cal)</span>
            </div>`).join('')}</div>`
        : `<p style="margin-bottom:10px">No food logged today to review.</p>`)
        : ''}
      ${_nutriReviewScope && (_nutriReviewScope !== 'meal' || _nutriReviewEntryId)
        ? `<button class="btn btn-primary btn-sm" onclick="runNutritionReview()" ${_nutriReviewBusy?'disabled':''} style="margin-bottom:${_nutriReviewResult?'10px':'0'}">
             ${_nutriReviewBusy ? '<span class="spinner"></span> Analyzing…' : 'Get Fuel Feedback'}
           </button>` : ''}
      ${_nutriReviewResult ? `
        <div class="nutr-review-result">${_nutriReviewResult.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>')}</div>
        <p style="font-size:0.64rem;color:var(--muted);margin-top:6px;line-height:1.4;opacity:0.7">General guidance only. For personalized nutrition advice, consult a Registered Sports Dietitian (RD) or your physician.</p>` : ''}
    </div>

    <div class="card mt12" style="padding:12px 16px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:0.82rem;font-weight:700;color:var(--text)">Fuel Coach Chat</div>
          <div style="font-size:0.72rem;color:var(--muted)">Open-ended fueling guidance</div>
        </div>
        <button class="btn btn-secondary btn-sm btn-inline" onclick="openNutritionChat()" style="padding:7px 14px;font-size:0.8rem;min-height:auto">Chat</button>
      </div>
    </div>
    <p class="nutr-disclaimer">Targets are general athletic reference ranges — not medical advice. Consult a Registered Sports Dietitian for personalized guidance.</p>
  `;
};

const nutriDateNav = (delta) => {
  const d = new Date(_nutriDate + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  const next = d.toISOString().slice(0, 10);
  if (next > today()) return;
  _nutriDate = next;
  renderNutritionScreen();
};

const openNutritionAdd = (entryId = null) => {
  _nutriEntry = entryId;
  if (entryId) {
    const e = DB.getNutriDay(_nutriDate).find(x => x.id === entryId);
    if (e) {
      _nutriMode = e.source || 'manual';
      _nutriFormData = { name:e.name, servingSize:e.servingSize, servings:e.servings,
        calories:e.perServing.calories||'', protein:e.perServing.protein||'',
        carbs:e.perServing.carbs||'', fat:e.perServing.fat||'',
        fiber:e.perServing.fiber||'', sodium:e.perServing.sodium||'', note:e.note||'' };
    }
  } else {
    _nutriMode = 'manual';
    _nutriFormData = { name:'', servingSize:'1 serving', servings:1, calories:'', protein:'', carbs:'', fat:'', fiber:'', sodium:'', note:'' };
  }
  renderNutritionAdd();
  document.getElementById('nutr-add-title').textContent = entryId ? 'Edit Food' : 'Add Food';
  show('screen-nutr-add');
};

const selectNutrMode = (mode) => {
  _nutriMode = mode;
  document.querySelectorAll('.nutr-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
  document.getElementById('nutr-scan-area').style.display  = mode === 'label'    ? 'block' : 'none';
  document.getElementById('nutr-photo-area').style.display = mode === 'estimate' ? 'block' : 'none';
};

const renderNutritionAdd = () => {
  const fd     = _nutriFormData;
  const isEdit = !!_nutriEntry;
  document.getElementById('nutr-add-content').innerHTML = `
    ${!isEdit ? `<div class="nutr-mode-row">
      <button class="nutr-mode-btn${_nutriMode==='manual'  ?' active':''}" data-mode="manual"   onclick="selectNutrMode('manual')">✍️ Manual</button>
      <button class="nutr-mode-btn${_nutriMode==='label'   ?' active':''}" data-mode="label"    onclick="selectNutrMode('label')">📷 Scan Label</button>
      <button class="nutr-mode-btn${_nutriMode==='estimate'?' active':''}" data-mode="estimate" onclick="selectNutrMode('estimate')">🤔 Photo Guess</button>
    </div>` : ''}
    <div id="nutr-scan-area" style="display:${_nutriMode==='label'&&!isEdit?'block':'none'}">
      <div class="card mb12" style="text-align:center;padding:16px">
        <p style="margin-bottom:10px">Point camera at the <strong>Nutrition Facts</strong> label — Claude reads the numbers.</p>
        <label class="btn btn-secondary btn-sm btn-inline" style="cursor:pointer">
          Take / Choose Photo
          <input type="file" accept="image/*" capture="environment" style="display:none" onchange="doLabelScan(this)">
        </label>
        <div id="scan-status" style="margin-top:8px;font-size:0.78rem;color:var(--muted)"></div>
      </div>
    </div>
    <div id="nutr-photo-area" style="display:${_nutriMode==='estimate'&&!isEdit?'block':'none'}">
      <div class="estimate-warning mb12">⚠️ <strong>ROUGH ESTIMATE ONLY</strong> — AI photo guesses are not precise and can be significantly off. Not for medical use.</div>
      <div style="text-align:center;margin-bottom:12px">
        <label class="btn btn-secondary btn-sm btn-inline" style="cursor:pointer">
          Take / Choose Food Photo
          <input type="file" accept="image/*" capture="environment" style="display:none" onchange="doPhotoEstimate(this)">
        </label>
        <div id="photo-status" style="margin-top:8px;font-size:0.78rem;color:var(--muted)"></div>
      </div>
    </div>
    <div class="form-group">
      <label>Food Name</label>
      <input id="nf-name" type="text" value="${escHtml(fd.name)}" placeholder="e.g. Grilled Chicken Breast">
    </div>
    <div class="hint mb8">Values below are <strong>per serving</strong></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group" style="margin-bottom:0"><label>Calories</label>
        <input id="nf-cal"   type="number" value="${fd.calories}" placeholder="0" min="0" inputmode="numeric" oninput="updateNutrTotals()"></div>
      <div class="form-group" style="margin-bottom:0"><label>Protein (g)</label>
        <input id="nf-pro"   type="number" value="${fd.protein}"  placeholder="0" min="0" step="0.1" inputmode="decimal" oninput="updateNutrTotals()"></div>
      <div class="form-group" style="margin-bottom:0"><label>Carbs (g)</label>
        <input id="nf-carb"  type="number" value="${fd.carbs}"    placeholder="0" min="0" step="0.1" inputmode="decimal" oninput="updateNutrTotals()"></div>
      <div class="form-group" style="margin-bottom:0"><label>Fat (g)</label>
        <input id="nf-fat"   type="number" value="${fd.fat}"      placeholder="0" min="0" step="0.1" inputmode="decimal" oninput="updateNutrTotals()"></div>
      <div class="form-group" style="margin-bottom:0"><label>Fiber (g)</label>
        <input id="nf-fiber" type="number" value="${fd.fiber}"    placeholder="0" min="0" step="0.1" inputmode="decimal" oninput="updateNutrTotals()"></div>
      <div class="form-group" style="margin-bottom:0"><label>Sodium (mg)</label>
        <input id="nf-sod"   type="number" value="${fd.sodium||''}"  placeholder="0" min="0" step="1" inputmode="numeric" oninput="updateNutrTotals()"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
      <div class="form-group" style="margin-bottom:0"><label>Serving Size</label>
        <input id="nf-size"     type="text"   value="${escHtml(fd.servingSize)}" placeholder="1 cup, 4 oz…"></div>
      <div class="form-group" style="margin-bottom:0"><label>Servings Eaten</label>
        <input id="nf-servings" type="number" value="${fd.servings}" placeholder="1" min="0.1" step="0.1" inputmode="decimal" oninput="updateNutrTotals()"></div>
    </div>
    <div id="nutr-totals-preview" class="nutr-totals-preview mt8"></div>
    ${fd.note ? `<div class="estimate-warning mt8">${escHtml(fd.note)}</div>` : ''}
    <div class="btn-row mt16">
      ${isEdit ? `<button class="btn btn-ghost" onclick="deleteNutritionEntry('${_nutriEntry}')">Delete</button>` : ''}
      <button class="btn btn-primary" onclick="saveNutritionEntry()">Save Food</button>
    </div>
  `;
  updateNutrTotals();
};

const updateNutrTotals = () => {
  const get = (id) => parseFloat(document.getElementById(id)?.value) || 0;
  const srv = Math.max(0.1, get('nf-servings') || 1);
  const cal = get('nf-cal'), pro = get('nf-pro'), carb = get('nf-carb'), fat = get('nf-fat'), sod = get('nf-sod');
  const box = document.getElementById('nutr-totals-preview');
  if (!box) return;
  if (srv !== 1 && cal) {
    box.innerHTML = `<div class="nutr-totals-row">
      <span>Total (${srv}× serving):</span>
      <strong>${Math.round(cal*srv)} cal · ${+(pro*srv).toFixed(1)}g P · ${+(carb*srv).toFixed(1)}g C · ${+(fat*srv).toFixed(1)}g F${sod?` · ${Math.round(sod*srv)}mg Na`:''}</strong>
    </div>`;
  } else { box.innerHTML = ''; }
};

const saveNutritionEntry = () => {
  const name = document.getElementById('nf-name')?.value.trim();
  if (!name) { toast('Enter a food name', 'err'); return; }
  const get  = (id) => parseFloat(document.getElementById(id)?.value) || 0;
  const size = document.getElementById('nf-size')?.value.trim() || '1 serving';
  const srv  = Math.max(0.1, get('nf-servings') || 1);
  const perServing = { calories:get('nf-cal'), protein:get('nf-pro'), carbs:get('nf-carb'), fat:get('nf-fat'), fiber:get('nf-fiber'), sodium:get('nf-sod') };
  const entries = DB.getNutriDay(_nutriDate);
  if (_nutriEntry) {
    const i = entries.findIndex(e => e.id === _nutriEntry);
    if (i >= 0) entries[i] = { ...entries[i], name, perServing, servingSize:size, servings:srv };
  } else {
    entries.push({ id:uid(), name, perServing, servingSize:size, servings:srv, source:_nutriMode,
      note:_nutriMode==='estimate'?'⚠️ AI photo estimate — values are approximate':'' });
  }
  DB.saveNutriDay(_nutriDate, entries);
  toast(_nutriEntry ? 'Entry updated' : 'Food logged!', 'ok');
  renderNutritionScreen();
  show('screen-nutrition');
};

const deleteNutritionEntry = (id) => {
  DB.saveNutriDay(_nutriDate, DB.getNutriDay(_nutriDate).filter(e => e.id !== id));
  toast('Entry deleted', 'ok');
  renderNutritionScreen();
  show('screen-nutrition');
};

const imageToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload  = e => {
    const [header, data] = e.target.result.split(',');
    resolve({ base64:data, mediaType:header.match(/:(.*?);/)?.[1] || 'image/jpeg' });
  };
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const doLabelScan = async (input) => {
  const file = input.files[0]; if (!file) return;
  const status = document.getElementById('scan-status');
  if (status) status.textContent = '🔍 Reading label…';
  try {
    const { base64, mediaType } = await imageToBase64(file);
    const raw = await callClaudeVision(base64, mediaType,
      'Read this nutrition facts label. Return ONLY valid JSON: name (string), calories (number per serving), protein_g, carbs_g, fat_g, fiber_g, sodium_mg, serving_size (string). Use 0 for missing values. No text outside the JSON.');
    const obj = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}')+1));
    document.getElementById('nf-name').value     = obj.name         || '';
    document.getElementById('nf-cal').value      = obj.calories     || 0;
    document.getElementById('nf-pro').value      = obj.protein_g    || 0;
    document.getElementById('nf-carb').value     = obj.carbs_g      || 0;
    document.getElementById('nf-fat').value      = obj.fat_g        || 0;
    document.getElementById('nf-fiber').value    = obj.fiber_g      || 0;
    document.getElementById('nf-sod').value      = obj.sodium_mg    || 0;
    document.getElementById('nf-size').value     = obj.serving_size || '1 serving';
    document.getElementById('nf-servings').value = 1;
    updateNutrTotals();
    if (status) status.textContent = '✅ Label read — review and adjust if needed.';
    _nutriMode = 'label';
  } catch { if (status) status.textContent = '❌ Could not read label — fill in manually.'; toast('Label scan failed','err'); }
};

const doPhotoEstimate = async (input) => {
  const file = input.files[0]; if (!file) return;
  const status = document.getElementById('photo-status');
  if (status) status.textContent = '🤔 Estimating… (rough guess only)';
  try {
    const { base64, mediaType } = await imageToBase64(file);
    const raw = await callClaudeVision(base64, mediaType,
      'Estimate nutrition for this food photo (approximate only). Return ONLY valid JSON: name (string), calories (number), protein_g, carbs_g, fat_g, fiber_g, sodium_mg, serving_size (string), confidence ("low","medium","high"), notes (one-sentence caveat). No text outside the JSON.');
    const obj = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}')+1));
    document.getElementById('nf-name').value     = (obj.name||'Food')+' (photo estimate)';
    document.getElementById('nf-cal').value      = obj.calories  || 0;
    document.getElementById('nf-pro').value      = obj.protein_g || 0;
    document.getElementById('nf-carb').value     = obj.carbs_g   || 0;
    document.getElementById('nf-fat').value      = obj.fat_g     || 0;
    document.getElementById('nf-fiber').value    = obj.fiber_g   || 0;
    document.getElementById('nf-sod').value      = obj.sodium_mg || 0;
    document.getElementById('nf-size').value     = obj.serving_size || '1 serving';
    document.getElementById('nf-servings').value = 1;
    updateNutrTotals();
    const conf = {low:'⚠️ Low confidence',medium:'⚠️ Medium confidence',high:'⚠️ Higher confidence (still estimate)'}[obj.confidence]||'⚠️ Rough estimate';
    if (status) status.textContent = `${conf}${obj.notes?' — '+obj.notes:''} Adjust as needed.`;
    _nutriMode = 'estimate';
  } catch { if (status) status.textContent = '❌ Estimate failed — fill in manually.'; toast('Photo estimate failed','err'); }
};

const setNutrReviewScope = (scope) => {
  _nutriReviewScope   = scope;
  _nutriReviewEntryId = null;
  _nutriReviewResult  = null;
  renderNutritionScreen();
};

const setNutrReviewEntry = (id) => {
  _nutriReviewEntryId = id;
  _nutriReviewResult  = null;
  renderNutritionScreen();
};

const buildNutritionReviewSystem = () => {
  const bw    = DB.getLatestBaseline()?.bodyweight || 260;
  const phase = determinePhase(DB.getWorkouts());
  return `You are a supportive sports fueling advisor reviewing nutrition data for a hard-training athlete.

ATHLETE: ~${bw} lbs, training for NASCAR pit crew (jackman/fueler) — focus on power, speed, explosiveness. Currently in training Phase ${phase}.

YOUR JOB: Give BRIEF, SUPPORTIVE performance-focused feedback on the nutrition data provided.

WHAT TO HIGHLIGHT (as relevant):
- Protein adequacy for muscle repair (athletes often benefit from ~0.7–1g per lb of bodyweight)
- Carbohydrate fueling for intense training
- Sodium/electrolyte intake — hard-training athletes can need 3000–5000mg/day due to sweat losses, this is important for performance and hydration
- Overall energy — is the athlete fueling enough for their training demands?
- Any clear wins or easy opportunities

TONE: Encouraging, brief, practical. Frame everything as fueling for PERFORMANCE, not weight or appearance.

FORMAT: 3–5 short sentences or a few bullet points. Use **bold** for key points. One practical takeaway at the end if relevant.

HARD RULES:
- Do NOT suggest eating less, cutting calories, or restricting food
- Do NOT give a score, grade, or rating
- Do NOT make clinical nutrition claims
- For any weight or body-composition questions: say "work with a Registered Sports Dietitian (RD) for personalized guidance" and move on
- This is general educational information, not medical/dietary advice${buildPrefsContext('nutrition')}`;
};

const buildNutritionReviewContext = () => {
  const entries = DB.getNutriDay(_nutriDate);
  const targets = DB.getNutriTargets();

  if (_nutriReviewScope === 'meal') {
    const e = entries.find(x => x.id === _nutriReviewEntryId);
    if (!e) return 'No meal selected.';
    const s = e.servings;
    const p = e.perServing;
    return `MEAL REVIEW REQUEST
Food: ${e.name} (${s}× ${e.servingSize})
Calories: ${Math.round((p.calories||0)*s)} | Protein: ${+((p.protein||0)*s).toFixed(1)}g | Carbs: ${+((p.carbs||0)*s).toFixed(1)}g | Fat: ${+((p.fat||0)*s).toFixed(1)}g | Fiber: ${+((p.fiber||0)*s).toFixed(1)}g | Sodium: ${Math.round((p.sodium||0)*s)}mg`;
  }

  if (_nutriReviewScope === 'day') {
    const tot = nutriTotals(entries);
    const list = entries.map(e => {
      const s = e.servings, p = e.perServing;
      return `  • ${e.name} (${s}× ${e.servingSize}): ${Math.round((p.calories||0)*s)} cal, ${+((p.protein||0)*s).toFixed(1)}g P, ${Math.round((p.sodium||0)*s)}mg Na`;
    }).join('\n');
    return `DAY REVIEW REQUEST — ${fmtDate(_nutriDate)}
Totals: ${tot.calories} cal | ${tot.protein}g protein | ${tot.carbs}g carbs | ${tot.fat}g fat | ${tot.fiber}g fiber | ${tot.sodium}mg sodium
Targets: ~${targets.calories} cal | ~${targets.protein}g protein | ~${targets.sodium}mg sodium

Foods logged:
${list || '(nothing logged)'}`;
  }

  if (_nutriReviewScope === 'week') {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      const dayEntries = DB.getNutriDay(ds);
      if (dayEntries.length) {
        const t = nutriTotals(dayEntries);
        days.push(`  ${fmtDate(ds)}: ${t.calories} cal | ${t.protein}g P | ${t.carbs}g C | ${t.sodium}mg Na`);
      }
    }
    if (!days.length) return 'No food logged in the past 7 days.';
    return `WEEK REVIEW REQUEST — last 7 days (${days.length} days with data)
Daily targets: ~${targets.calories} cal | ~${targets.protein}g protein | ~${targets.sodium}mg sodium

${days.join('\n')}`;
  }

  return '';
};

const runNutritionReview = async () => {
  if (_nutriReviewBusy) return;
  _nutriReviewBusy   = true;
  _nutriReviewResult = null;
  renderNutritionScreen();
  try {
    const res = await fetch('/api/claude', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model:'claude-sonnet-4-5', max_tokens:500,
        system: buildNutritionReviewSystem(),
        messages: [{ role:'user', content: buildNutritionReviewContext() }] })
    });
    if (!res.ok) throw new Error((await res.json().catch(()=>({}))).error || `HTTP ${res.status}`);
    const data = await res.json();
    _nutriReviewResult = data.content[0].text;
  } catch (err) {
    _nutriReviewResult = `Couldn't get feedback right now: ${err.message}`;
  }
  _nutriReviewBusy = false;
  renderNutritionScreen();
};

const buildNutritionChatSystem = () => {
  const bw = DB.getLatestBaseline()?.bodyweight || 260;
  return `You are a supportive sports fueling advisor for a serious athlete (~${bw} lbs) training to become a NASCAR over-the-wall pit crew member, focused on power, speed, and explosiveness.
ROLE: Give practical, evidence-based sports nutrition guidance centered on PERFORMANCE and RECOVERY. Adequate fueling is the priority.
MUST: Focus on fueling for training (protein timing, carb fueling, hydration, recovery nutrition). Be supportive. Keep responses concise.
MUST NOT: Set strict calorie limits, encourage restriction, or provide clinical dietary advice.
For any weight/body-comp question always add: "For personalized nutrition or body composition goals, work with a Registered Sports Dietitian (RD) or your physician."${buildPrefsContext('nutrition')}`;
};

const openNutritionChat = () => {
  _nutriChatHist = [{ role:'assistant', content:`Hi! I can give general sports fueling guidance — pre/post-workout nutrition, protein intake, carb timing, hydration for hard training.\n\n**Important:** For any personalized nutrition plan or health goals, work with a Registered Sports Dietitian (RD). I'm here for general guidance only.\n\nWhat would you like to know?` }];
  _nutriChatBusy = false;
  document.getElementById('nutr-chat-input').value = '';
  renderNutritionChat();
  show('screen-nutr-chat');
};

const renderNutritionChat = () => {
  const el = document.getElementById('nutr-chat-messages');
  el.innerHTML = _nutriChatHist.map(m => {
    const html = m.content.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
    return `<div class="chat-bubble ${m.role}">${m.role==='user'?'':'<div class="chat-avatar">Fuel</div>'}<div class="chat-text">${html}</div></div>`;
  }).join('') + (_nutriChatBusy?`<div class="chat-bubble assistant"><div class="chat-avatar">Fuel</div><div class="chat-text"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div></div>`:'');
  el.scrollTop = el.scrollHeight;
};

const sendNutritionChat = async () => {
  const input = document.getElementById('nutr-chat-input');
  const msg = input.value.trim();
  if (!msg || _nutriChatBusy) return;
  input.value = ''; input.style.height = 'auto';
  _nutriChatHist.push({ role:'user', content:msg });
  _nutriChatBusy = true; renderNutritionChat();
  try {
    const res = await fetch('/api/claude', { method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ model:'claude-sonnet-4-5', max_tokens:600, system:buildNutritionChatSystem(),
        messages:_nutriChatHist.map(m=>({ role:m.role, content:m.content })) }) });
    if (!res.ok) throw new Error((await res.json().catch(()=>({}))).error||`HTTP ${res.status}`);
    const data = await res.json();
    _nutriChatHist.push({ role:'assistant', content:data.content[0].text });
  } catch (err) { _nutriChatHist.push({ role:'assistant', content:`Sorry, error: ${err.message}` }); }
  _nutriChatBusy = false; renderNutritionChat();
};

const nutriChatKeydown = (e) => {
  if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendNutritionChat(); }
};

// ================================================================
// DATA BACKUP — Export / Import
// ================================================================
const exportData = () => {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('pr_')) {
      try { data[k.slice(3)] = JSON.parse(localStorage.getItem(k)); }
      catch { data[k.slice(3)] = localStorage.getItem(k); }
    }
  }
  const json = JSON.stringify({ version: 1, exported: today(), data }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `pitroad-backup-${today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Backup file saved!', 'ok');
};

const importData = (input) => {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      const data = parsed.data || parsed; // support both wrapped and flat formats
      if (typeof data !== 'object') throw new Error('Unrecognized file format');
      Object.entries(data).forEach(([k, v]) =>
        localStorage.setItem('pr_' + k, JSON.stringify(v))
      );
      toast('Data restored! Reloading…', 'ok');
      setTimeout(() => location.reload(), 1200);
    } catch (err) {
      toast('Import failed: ' + err.message, 'err');
    }
  };
  reader.readAsText(file);
  input.value = '';
};

// ================================================================
// PREFERENCES / PROFILE
// ================================================================
const openPrefs = () => {
  const p = DB.getPrefs();
  const fields = [
    'defaultGym', 'avoidExercises', 'injuryNotes', 'favoriteExercises',
    'equipmentNotes', 'trainingGoals', 'trainingNotes',
    'dietaryRestrictions', 'dietaryGoals', 'recoveryNotes', 'coachNotes',
  ];
  fields.forEach(k => {
    const el = document.getElementById('pref-' + k);
    if (el) el.value = p[k] || '';
  });
  show('screen-prefs');
};

const savePrefsForm = () => {
  const get = (id) => (document.getElementById(id)?.value || '').trim();
  DB.savePrefs({
    defaultGym:          get('pref-defaultGym'),
    avoidExercises:      get('pref-avoidExercises'),
    injuryNotes:         get('pref-injuryNotes'),
    favoriteExercises:   get('pref-favoriteExercises'),
    equipmentNotes:      get('pref-equipmentNotes'),
    trainingGoals:       get('pref-trainingGoals'),
    trainingNotes:       get('pref-trainingNotes'),
    dietaryRestrictions: get('pref-dietaryRestrictions'),
    dietaryGoals:        get('pref-dietaryGoals'),
    recoveryNotes:       get('pref-recoveryNotes'),
    coachNotes:          get('pref-coachNotes'),
  });
  // Sync default gym to train screen selection
  const prefGym = DB.getPrefs().defaultGym;
  if (prefGym) _trainGym = prefGym;
  toast('Preferences saved — all AI features updated ✓', 'ok');
  show('screen-home');
};

// ================================================================
// BUILD HTML
// ================================================================
const buildApp = () => `
  <div id="toast" class="toast"></div>

  <!-- ═══════ BASELINE WIZARD ═══════ -->
  <div id="screen-wizard" class="screen" style="padding-bottom:0">
    <div style="padding:16px 16px 12px;border-bottom:1px solid var(--border)">
      <div class="logo">PIT <span>ROAD</span></div>
      <div class="progress-track mt12"><div class="progress-fill" id="wiz-progress" style="width:0%"></div></div>
    </div>

    <div class="wizard-step active wizard-body" data-s="0">
      <div class="step-chip">Welcome</div>
      <div class="step-title">Establish your baseline.</div>
      <div class="instructions">
        <p>Before training, we need to know where you're starting. <strong>No bad scores exist here</strong> — these are just your starting point.</p>
        <p>This takes about <strong>30 minutes</strong> with proper rest. Do this on a fresh day, not after a hard workout.</p>
        <p><strong>You'll need:</strong> Flat surface for sprints, tape measure, phone timer, gym access for the lift.</p>
      </div>
      <p style="margin-bottom:20px">Tests: 10-yd sprint · Broad jump · Pro agility · Main lift · Bodyweight</p>
      <button class="btn btn-primary" onclick="wizardGo(1)">Let's Go →</button>
      <button class="btn btn-ghost mt8" onclick="wizardSkip()" style="opacity:0.6;font-size:0.85rem">Skip for now — go straight to app</button>
    </div>

    <div class="wizard-step wizard-body" data-s="1">
      <div class="step-chip">Test 1 of 5</div>
      <div class="step-title">10-Yard Sprint</div>
      <div class="instructions">
        <p><strong>Setup:</strong> Mark start and finish 10 yards (30 feet) apart on flat ground. Football yard lines work perfectly.</p>
        <p><strong>Execute:</strong> 2-point stance, standing still. Explode to the line on your own count. Start timer as you first move.</p>
        <p><strong>Rules:</strong> 2-3 tries, full rest between (2-3 min each). Record your <strong>best time</strong>. <em>This is speed — not conditioning.</em></p>
        <p><strong>Elite target: 1.7–1.9 seconds.</strong></p>
      </div>
      <div class="form-group">
        <label>Best time (seconds)</label>
        <input id="w-sprint" type="number" placeholder="e.g. 2.05" step="0.01" min="0.5" max="8" inputmode="decimal">
        <div class="hint">e.g. 2.05 — hundredths matter here</div>
      </div>
      <div class="btn-row mt16">
        <button class="btn btn-ghost" onclick="wizardGo(0)">← Back</button>
        <button class="btn btn-primary" onclick="wizNext[1]()">Next →</button>
      </div>
    </div>

    <div class="wizard-step wizard-body" data-s="2">
      <div class="step-chip">Test 2 of 5</div>
      <div class="step-title">Broad Jump</div>
      <div class="instructions">
        <p><strong>Setup:</strong> Tape a line. Measure from line to back of your nearest heel at landing.</p>
        <p><strong>Execute:</strong> Toes on line. Dip knees, swing arms back, then <strong>explode forward</strong>. Land on both feet.</p>
        <p><strong>Rules:</strong> 3 attempts, full rest. Record best. No stepping or rocking before jump.</p>
        <p><strong>Elite target: 8.5–9.5+ feet.</strong></p>
      </div>
      <div class="form-group">
        <label>Best jump distance</label>
        <div class="input-row">
          <div class="form-group"><input id="w-jump-ft" type="number" placeholder="7" min="2" max="12" inputmode="numeric"><div class="hint">feet</div></div>
          <div class="form-group"><input id="w-jump-in" type="number" placeholder="6" min="0" max="11" inputmode="numeric"><div class="hint">inches</div></div>
        </div>
      </div>
      <div class="btn-row mt16">
        <button class="btn btn-ghost" onclick="wizardGo(1)">← Back</button>
        <button class="btn btn-primary" onclick="wizNext[2]()">Next →</button>
      </div>
    </div>

    <div class="wizard-step wizard-body" data-s="3">
      <div class="step-chip">Test 3 of 5</div>
      <div class="step-title">Pro Agility (5-10-5)</div>
      <div class="instructions">
        <p><strong>Setup:</strong> 3 lines — center, 5 yards right, 5 yards left.</p>
        <p><strong>Execute:</strong> Straddle center. Sprint 5yd right → touch → sprint 10yd left → touch → sprint 5yd back through center.</p>
        <p><strong>Key:</strong> Stay low on cuts. Change-of-direction speed — critical for pit lane movement.</p>
        <p><strong>Rules:</strong> 2-3 tries, full rest. Record best.</p>
        <p><strong>Elite target: 4.4–4.7 seconds.</strong></p>
      </div>
      <div class="form-group">
        <label>Best time (seconds)</label>
        <input id="w-agility" type="number" placeholder="e.g. 5.1" step="0.01" min="2" max="12" inputmode="decimal">
      </div>
      <div class="btn-row mt16">
        <button class="btn btn-ghost" onclick="wizardGo(2)">← Back</button>
        <button class="btn btn-primary" onclick="wizNext[3]()">Next →</button>
      </div>
    </div>

    <div class="wizard-step wizard-body" data-s="4">
      <div class="step-chip">Test 4 of 5</div>
      <div class="step-title">Main Lift</div>
      <div class="instructions">
        <p><strong>Warm up first!</strong> 5 min easy movement + 2-3 warm-up sets before you test.</p>
        <p>Load a weight you can do <strong>3-5 reps with perfect form</strong>. Stop when form breaks. We'll calculate your estimated 1RM.</p>
        <p><strong>Trap-bar:</strong> flat back, drive through heels, full lockout. <strong>Leg press:</strong> full range, don't lock knees at top.</p>
        <p><strong>Elite target: 2× bodyweight trap-bar deadlift.</strong></p>
      </div>
      <div class="form-group">
        <label>Which lift?</label>
        <select id="w-lift-type">
          <option value="trap-bar">Trap-Bar Deadlift (UNOH)</option>
          <option value="leg-press">Leg Press (Planet Fitness)</option>
          <option value="barbell">Barbell Deadlift</option>
        </select>
      </div>
      <div class="input-row">
        <div class="form-group"><label>Weight (lbs)</label><input id="w-lift-wt" type="number" placeholder="225" min="0" inputmode="decimal"></div>
        <div class="form-group"><label>Reps (1-10)</label><input id="w-lift-reps" type="number" placeholder="5" min="1" max="20" inputmode="numeric"></div>
      </div>
      <div class="btn-row mt16">
        <button class="btn btn-ghost" onclick="wizardGo(3)">← Back</button>
        <button class="btn btn-primary" onclick="wizNext[4]()">Next →</button>
      </div>
    </div>

    <div class="wizard-step wizard-body" data-s="5">
      <div class="step-chip">Test 5 of 5</div>
      <div class="step-title">Bodyweight</div>
      <div class="instructions">
        <p>Weigh yourself — ideally <strong>morning, after bathroom, before eating</strong> for consistency.</p>
        <p>Goal: <strong>recomposition</strong>. Leaner and faster while keeping strength. Target ~240-255 lbs. We track performance, not just the scale.</p>
      </div>
      <div class="form-group">
        <label>Bodyweight (lbs)</label>
        <input id="w-bw" type="number" placeholder="260" min="80" max="500" inputmode="decimal">
      </div>
      <div class="btn-row mt16">
        <button class="btn btn-ghost" onclick="wizardGo(4)">← Back</button>
        <button class="btn btn-primary" onclick="wizNext[5]()">Review →</button>
      </div>
    </div>

    <div class="wizard-step wizard-body" data-s="6">
      <div class="step-chip">Summary</div>
      <div class="step-title">Your Starting Point</div>
      <div id="wiz-summary"></div>
      <button class="btn btn-primary mt16" onclick="wizardSave()">Save & Start Training 🏁</button>
      <button class="btn btn-ghost mt8" onclick="wizardGo(1)">← Redo Tests</button>
    </div>
  </div>

  <!-- ═══════ HOME / DASHBOARD ═══════ -->
  <div id="screen-home" class="screen">
    <div class="header">
      <div class="logo">PIT <span>ROAD</span></div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-primary btn-sm btn-inline" onclick="openTrainScreen()"
                style="font-size:0.8rem;padding:9px 18px;min-height:44px">⚡ Train</button>
        <button onclick="openPrefs()" title="Preferences"
                style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.18);border-radius:10px;padding:0;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;width:44px;height:44px;flex-shrink:0;-webkit-tap-highlight-color:transparent;touch-action:manipulation">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="pad">
      <div id="dash-today"></div>
      <div id="dash-stats"></div>
      <div id="dash-summary"></div>
      <div id="dash-calendar"></div>
    </div>
  </div>

  <!-- ═══════ TRAIN TODAY ═══════ -->
  <div id="screen-train" class="screen">
    <div class="header">
      <div class="logo">PIT <span>ROAD</span></div>
      <div class="header-title">Train Today</div>
    </div>
    <div class="pad">
      <h2 style="margin-bottom:6px">Build today's session.</h2>
      <p style="margin-bottom:24px">Tell me where you are and how you feel — I'll handle the rest.</p>

      <div class="form-group">
        <label>Gym</label>
        <div style="display:flex;gap:8px">
          <div class="gym-opt" data-gym="UNOH" onclick="selectTrainGym(this,'UNOH')">
            <span style="font-size:1.3rem">🏋️</span>
            <span class="gym-opt-name">UNOH</span>
            <span class="gym-opt-sub">Full weights</span>
          </div>
          <div class="gym-opt" data-gym="Planet Fitness" onclick="selectTrainGym(this,'Planet Fitness')">
            <span style="font-size:1.3rem">🟡</span>
            <span class="gym-opt-name">Planet Fitness</span>
            <span class="gym-opt-sub">Machines / DBs</span>
          </div>
        </div>
      </div>

      <div class="form-group">
        <label>Energy level</label>
        <div id="train-feel-row" class="feel-row">
          <div class="feel-opt" data-feel="low"    onclick="selectTrainFeel(this)"><span class="feel-icon">😴</span>Low</div>
          <div class="feel-opt" data-feel="medium" onclick="selectTrainFeel(this)"><span class="feel-icon">💪</span>Medium</div>
          <div class="feel-opt" data-feel="high"   onclick="selectTrainFeel(this)"><span class="feel-icon">🔥</span>High</div>
        </div>
      </div>

      <div class="form-group">
        <label>Time available</label>
        <select id="train-duration">
          <option value="30">30 minutes</option>
          <option value="45">45 minutes</option>
          <option value="60" selected>60 minutes</option>
          <option value="75">75 minutes</option>
          <option value="90">90 minutes</option>
        </select>
      </div>

      <button id="train-gen-btn" class="btn btn-primary mt8" onclick="generateWorkout()">Generate My Workout →</button>
      <button class="btn btn-ghost mt8" onclick="openLogScreen()">Log Manually Instead</button>
    </div>
  </div>

  <!-- ═══════ GENERATED WORKOUT ═══════ -->
  <div id="screen-generated" class="screen">
    <div class="header">
      <button class="back-btn" onclick="show('screen-train')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </button>
      <div class="header-title">Today's Session</div>
      <div style="width:56px"></div>
    </div>
    <div class="pad">
      <div id="generated-content"></div>
      <div class="divider"></div>
      <button class="btn btn-primary" onclick="logGeneratedWorkout()">Log This Workout →</button>
      <button class="btn btn-secondary mt8" onclick="openChat('screen-generated')">💬 Ask Coach to Adjust</button>
      <button class="btn btn-ghost mt8" onclick="openTrainScreen()">Regenerate</button>
    </div>
  </div>

  <!-- ═══════ LOG WORKOUT ═══════ -->
  <div id="screen-log" class="screen">
    <div class="header">
      <div class="logo">PIT <span>ROAD</span></div>
      <div class="header-title">Log Session</div>
    </div>
    <div class="pad">
      <div class="form-group"><label>Date</label><input id="log-date" type="date"></div>
      <div class="form-group">
        <label>Gym</label>
        <select id="log-gym">
          <option value="">— Select gym —</option>
          <option value="UNOH">UNOH Gym (barbell, trap bar, sleds)</option>
          <option value="Planet Fitness">Planet Fitness (machines, DBs, cables)</option>
          <option value="Other">Other / Outdoor</option>
        </select>
      </div>
      <div class="form-group">
        <label>Energy today</label>
        <div class="feel-row">
          <div class="feel-opt" data-feel="low"    onclick="selectFeel(this)"><span class="feel-icon">😴</span>Low</div>
          <div class="feel-opt" data-feel="medium" onclick="selectFeel(this)"><span class="feel-icon">💪</span>Medium</div>
          <div class="feel-opt" data-feel="high"   onclick="selectFeel(this)"><span class="feel-icon">🔥</span>High</div>
        </div>
      </div>
      <div class="form-group"><label>Duration (minutes)</label><input id="log-duration" type="number" value="60" min="5" max="300" inputmode="numeric"></div>
      <div class="divider"></div>
      <h3 class="mb12">Exercises</h3>
      <div id="exercises-list"></div>
      <div class="divider"></div>
      <div class="form-group"><label>Session Notes</label><textarea id="log-notes" placeholder="How did it go? PRs, soreness, modifications…"></textarea></div>
      <button class="btn btn-primary" onclick="saveWorkout()">Save Workout 💪</button>
      <button class="btn btn-ghost mt8" onclick="show('screen-home')">Cancel</button>
    </div>
  </div>

  <!-- ═══════ PROGRESS ═══════ -->
  <div id="screen-progress" class="screen">
    <div class="header">
      <div class="logo">PIT <span>ROAD</span></div>
      <div class="header-title">Progress</div>
    </div>
    <div class="pad">
      <div style="margin-bottom:16px">
        <h2 style="margin-bottom:4px">vs. Elite Benchmarks</h2>
        <p>Gold dashed line = elite pit-athlete target. No predictions — just honest trend direction.</p>
      </div>
      <div id="progress-content"></div>
      <button class="btn btn-secondary btn-sm mt8" onclick="wizardStart()">+ Add Baseline Test</button>
    </div>
  </div>

  <!-- ═══════ COACH CHAT ═══════ -->
  <div id="screen-chat" class="screen">
    <div class="header">
      <button class="back-btn" onclick="show(_chatReturnScreen)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </button>
      <div class="header-title">AI Coach</div>
      <button onclick="clearChat()" style="background:none;border:none;color:var(--muted);font-size:0.78rem;font-weight:700;cursor:pointer;padding:4px 8px;font-family:inherit">Clear</button>
    </div>
    <div id="chat-messages" class="chat-messages"></div>
    <div class="chat-bar">
      <button id="chat-apply-btn" class="apply-btn" onclick="applyWorkoutUpdate()">
        ✓ Apply Changes to Today's Workout
      </button>
      <div class="chat-input-row">
        <textarea id="chat-input" class="chat-input" rows="1"
          placeholder="'lower back tight' · 'sub the trap bar' · 'only 30 min left'"
          onkeydown="chatKeydown(event)"
          oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px'"></textarea>
        <button id="chat-send-btn" class="chat-send" onclick="sendChat()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>
  </div>

  <!-- ═══════ HISTORY ═══════ -->
  <div id="screen-history" class="screen">
    <div class="header">
      <div class="logo">PIT <span>ROAD</span></div>
      <div class="header-title">History</div>
    </div>
    <div class="pad"><div id="history-list"></div></div>
  </div>

  <!-- ═══════ WORKOUT DETAIL ═══════ -->
  <div id="screen-detail" class="screen">
    <div class="header">
      <button class="back-btn" onclick="show('screen-history')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </button>
      <div class="header-title" id="detail-header-date"></div>
      <div style="width:56px"></div>
    </div>
    <div class="pad"><div id="detail-content"></div></div>
  </div>

  <!-- ═══════ BODY LOG ═══════ -->
  <div id="screen-bodylog" class="screen">
    <div class="header">
      <button class="back-btn" onclick="show('screen-home')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </button>
      <div class="header-title">Body Check-In</div>
      <div style="width:56px"></div>
    </div>
    <div class="pad">
      <div class="form-group"><label>Date</label><input id="bl-date" type="date"></div>

      <div style="margin-bottom:20px">
        <button id="bl-scan-btn" class="btn btn-secondary" onclick="document.getElementById('bl-file').click()">
          📷  Scan Starfit Screenshot
        </button>
        <input id="bl-file" type="file" accept="image/*" style="display:none" onchange="scanBodyScreenshot(this)">
        <div class="hint" style="margin-top:6px;text-align:center">Screenshot your Starfit app and tap above — scan multiple times to capture all screens</div>
      </div>

      <div id="bl-scan-status" style="display:none"></div>

      <div class="divider"></div>
      <h3 class="mb12">Measurements</h3>
      <div id="bl-fields"></div>

      <button class="btn btn-primary mt16" onclick="saveBodyLog()">Save Check-In 💪</button>
      <button class="btn btn-ghost mt8" onclick="show('screen-home')">Cancel</button>
    </div>
  </div>

  <!-- ═══════ SLEEP & RECOVERY LOG ═══════ -->
  <div id="screen-sleep" class="screen">
    <div class="header">
      <button class="back-btn" onclick="show('screen-home')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </button>
      <div class="header-title">Sleep & Recovery</div>
      <div style="width:56px"></div>
    </div>
    <div class="pad">
      <div class="form-group"><label>Date</label><input id="sl-date" type="date"></div>

      <div style="margin-bottom:20px">
        <button id="sl-scan-btn" class="btn btn-secondary" onclick="document.getElementById('sl-file').click()">
          📷  Scan Health App Screenshot
        </button>
        <input id="sl-file" type="file" accept="image/*" style="display:none" onchange="scanSleepScreenshot(this)">
        <div class="hint" style="margin-top:6px;text-align:center">Works with Apple Health, Samsung, Garmin, Whoop, Oura &amp; similar apps</div>
      </div>

      <div id="sl-scan-status" style="display:none;margin-bottom:16px"></div>

      <div class="divider"></div>
      <h3 class="mb12">Sleep Data</h3>
      <p style="margin-bottom:14px">Fill in any values you have — all fields are optional.</p>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:20px">
        <div class="form-group" style="margin-bottom:0">
          <label style="font-size:0.68rem">Duration (hrs)</label>
          <input id="sl-sleepDuration" type="number" placeholder="7.5" step="0.25" min="0" max="24" inputmode="decimal"
                 oninput="_sleepData.sleepDuration = this.value ? parseFloat(this.value) : null">
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label style="font-size:0.68rem">Quality (0–100)</label>
          <input id="sl-sleepQuality" type="number" placeholder="72" step="1" min="0" max="100" inputmode="numeric"
                 oninput="_sleepData.sleepQuality = this.value ? parseFloat(this.value) : null">
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label style="font-size:0.68rem">Recovery (0–100)</label>
          <input id="sl-recovery" type="number" placeholder="68" step="1" min="0" max="100" inputmode="numeric"
                 oninput="_sleepData.recovery = this.value ? parseFloat(this.value) : null">
        </div>
      </div>

      <div class="form-group">
        <label>Morning Feel <span id="sl-feel-label" style="color:var(--muted);font-weight:400;font-size:0.8rem">— tap to rate</span></label>
        <div class="hint" style="margin-bottom:6px">1 = awful &nbsp;·&nbsp; 5 = okay &nbsp;·&nbsp; 10 = amazing</div>
        <div class="feel-num-grid" id="sl-feel-grid"></div>
      </div>

      <div class="divider" style="margin:20px 0 16px"></div>
      <button class="btn btn-primary" onclick="saveSleepLog()">Save 😴</button>
      <button class="btn btn-ghost mt8" onclick="show('screen-home')">Cancel</button>
    </div>
  </div>

  <!-- ═══════ NUTRITION ═══════ -->
  <div id="screen-nutrition" class="screen">
    <div class="header"><div class="logo">PIT <span>ROAD</span></div><div class="header-title">Fuel Log</div></div>
    <div class="pad" id="nutr-content"></div>
  </div>

  <!-- ═══════ NUTRITION ADD/EDIT ═══════ -->
  <div id="screen-nutr-add" class="screen">
    <div class="header">
      <button class="back-btn" onclick="renderNutritionScreen();show('screen-nutrition')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg> Back
      </button>
      <div class="header-title" id="nutr-add-title">Add Food</div>
      <div style="width:56px"></div>
    </div>
    <div class="pad" id="nutr-add-content"></div>
  </div>

  <!-- ═══════ NUTRITION CHAT ═══════ -->
  <div id="screen-nutr-chat" class="screen">
    <div class="header">
      <button class="back-btn" onclick="show('screen-nutrition')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg> Back
      </button>
      <div class="header-title">Fuel Coach</div>
      <div style="width:56px"></div>
    </div>
    <div id="nutr-chat-messages" class="chat-messages"></div>
    <div class="chat-bar">
      <div class="chat-input-row">
        <textarea id="nutr-chat-input" class="chat-input" rows="1"
          placeholder="Ask about fueling, protein, recovery…"
          onkeydown="nutriChatKeydown(event)"
          oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px'"></textarea>
        <button class="chat-send" onclick="sendNutritionChat()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>
  </div>

  <!-- ═══════ PREFERENCES / PROFILE ═══════ -->
  <div id="screen-prefs" class="screen">
    <div class="header">
      <button class="back-btn" onclick="show('screen-home')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </button>
      <div class="header-title">Preferences</div>
      <button onclick="savePrefsForm()" style="background:none;border:none;color:var(--red);font-size:0.88rem;font-weight:700;cursor:pointer;padding:4px 8px;font-family:inherit">Save</button>
    </div>
    <div class="pad">
      <p style="margin-bottom:20px">Everything here is private, stored on this device. Every AI feature reads these automatically — update anytime.</p>

      <!-- ── Training Setup ── -->
      <div class="section-head" style="padding:0;margin-bottom:12px"><h3>🏋️ Training Setup</h3></div>
      <div class="card mb12" style="padding:16px">
        <div class="form-group">
          <label>Default Gym</label>
          <select id="pref-defaultGym">
            <option value="">— No default —</option>
            <option value="UNOH">UNOH (full weights — barbell, trap bar, sleds)</option>
            <option value="Planet Fitness">Planet Fitness (machines &amp; dumbbells only)</option>
            <option value="Other">Other / Outdoor</option>
          </select>
          <div class="hint">Auto-selected when you open the Train screen</div>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label>Training Goals</label>
          <textarea id="pref-trainingGoals" rows="2" placeholder="e.g. hit a 400 lb trap-bar by June, sub-1.9s sprint, make the pit crew team"></textarea>
          <div class="hint">Specific targets you're chasing — the trainer keeps these in mind</div>
        </div>
      </div>

      <!-- ── Exercise Preferences ── -->
      <div class="section-head" style="padding:0;margin-bottom:12px"><h3>🚫 Exercises &amp; Injuries</h3></div>
      <div class="card mb12" style="padding:16px">
        <div class="form-group">
          <label>Exercises to Avoid</label>
          <textarea id="pref-avoidExercises" rows="2" placeholder="e.g. barbell back squat, overhead press, box jumps"></textarea>
          <div class="hint">The AI will NEVER program these — list anything you can't or don't want to do</div>
        </div>
        <div class="form-group">
          <label>Injury / Limitation Notes</label>
          <textarea id="pref-injuryNotes" rows="2" placeholder="e.g. right knee meniscus — avoid full squat depth and impact landings; lower back — no good mornings"></textarea>
          <div class="hint">Be specific — the trainer uses this to protect you every session</div>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label>Favorite / Preferred Exercises</label>
          <textarea id="pref-favoriteExercises" rows="2" placeholder="e.g. trap bar deadlift, farmer carries, battle ropes, hex bar jumps"></textarea>
          <div class="hint">When multiple exercises would work equally well, the trainer picks these first</div>
        </div>
      </div>

      <!-- ── Fueling ── -->
      <div class="section-head" style="padding:0;margin-bottom:12px"><h3>🥗 Fueling Preferences</h3></div>
      <div class="card mb12" style="padding:16px">
        <div class="form-group">
          <label>Dietary Restrictions &amp; Allergies</label>
          <textarea id="pref-dietaryRestrictions" rows="2" placeholder="e.g. lactose intolerant, no shellfish, gluten-free, vegetarian"></textarea>
          <div class="hint">Critical — the nutrition AI and Coach Chat always respect these</div>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label>Dietary Goals / Preferences</label>
          <textarea id="pref-dietaryGoals" rows="2" placeholder="e.g. high protein priority, prefer whole foods, intermittent fasting, avoid ultra-processed"></textarea>
        </div>
      </div>

      <!-- ── Notes & Style ── -->
      <div class="section-head" style="padding:0;margin-bottom:12px"><h3>💬 How You Like to Train</h3></div>
      <div class="card mb12" style="padding:16px">
        <div class="form-group">
          <label>Training Style Notes</label>
          <textarea id="pref-trainingNotes" rows="2" placeholder="e.g. prefer supersets, hate rest longer than 90s, like to finish with carries, don't enjoy machines"></textarea>
        </div>
        <div class="form-group">
          <label>Recovery &amp; Sleep Notes</label>
          <textarea id="pref-recoveryNotes" rows="2" placeholder="e.g. sleep poorly during exam weeks, do morning cold plunge, usually sore 2 days after leg day"></textarea>
        </div>
        <div class="form-group">
          <label>Equipment Notes</label>
          <textarea id="pref-equipmentNotes" rows="2" placeholder="e.g. have resistance bands and a pull-up bar at home, access to a pool"></textarea>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label>Coach Communication Style</label>
          <textarea id="pref-coachNotes" rows="2" placeholder="e.g. be direct and blunt, no motivational filler, tell me when I'm slacking, keep it short"></textarea>
          <div class="hint">How you want the AI Coach to talk to you</div>
        </div>
      </div>

      <button class="btn btn-primary mt8" onclick="savePrefsForm()">Save Preferences ✓</button>
      <button class="btn btn-ghost mt8" onclick="show('screen-home')">Cancel</button>

      <!-- ── Data Backup ── -->
      <div class="section-head" style="padding:0;margin:24px 0 12px"><h3>💾 Data Backup</h3></div>
      <div class="card mb12" style="padding:16px">
        <p style="margin-bottom:14px;font-size:0.85rem;line-height:1.5">Export all your training, nutrition, sleep, and body data to a file you can save off this device. Import it back anytime to restore everything.</p>
        <div style="display:flex;gap:10px">
          <button class="btn btn-secondary" style="flex:1" onclick="exportData()">⬇️ Export Backup</button>
          <button class="btn btn-secondary" style="flex:1" onclick="document.getElementById('import-file').click()">⬆️ Import Backup</button>
          <input id="import-file" type="file" accept=".json" style="display:none" onchange="importData(this)">
        </div>
      </div>

      <p style="margin-top:16px;font-size:0.68rem;color:var(--muted);text-align:center;line-height:1.5;opacity:0.7">All data stored locally on this device only. Nothing is sent to any server except as part of AI requests.</p>
    </div>
  </div>

  <!-- ═══════ MILESTONE BANNER ═══════ -->
  <div id="milestone-banner" style="display:none"></div>

  <!-- ═══════ BOTTOM NAV ═══════ -->
  <nav class="bottom-nav" id="bottom-nav">
    <button class="nav-btn" data-target="screen-home" onclick="renderDashboard();show('screen-home')">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      Home
    </button>
    <button class="nav-btn" data-target="screen-train" onclick="openTrainScreen()">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      Train
    </button>
    <button class="nav-btn" data-target="screen-progress" onclick="renderProgressScreen();show('screen-progress')">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      Progress
    </button>
    <button class="nav-btn" data-target="screen-chat" onclick="openChat('screen-home')">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
      Coach
    </button>
    <button class="nav-btn" data-target="screen-nutrition" onclick="renderNutritionScreen();show('screen-nutrition')">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2M7 2v20M21 15V2s-5 3-5 7v6h5zM16 22v-3"/></svg>
      Fuel
    </button>
  </nav>
`;

// ================================================================
// BOOT
// ================================================================
const boot = () => {
  document.getElementById('app').innerHTML = buildApp();
  if (DB.isFirstLaunch()) {
    wizardStart();
  } else {
    renderDashboard();
    show('screen-home');
  }
};

document.addEventListener('DOMContentLoaded', boot);
