// app.js
const { ICAL, DateTime } = window._deps;
const LONDON = 'Europe/London';

// ----- Term helpers -----
const TERMS = {
  Michaelmas: { start: { month: 9,  day: 1  }, end: { month: 12, day: 31 } },
  Valentine:       { start: { month: 1,  day: 1  }, end: { month: 4,  day: 30 } },
  Petertide:  { start: { month: 5,  day: 1  }, end: { month: 8,  day: 31 } },
};

function termRange(year, termName) {
  const t = TERMS[termName];
  if (!t) throw new Error(`Unknown term: ${termName}`);
  const start = DateTime.fromObject({ year, ...t.start }, { zone: LONDON }).startOf('day');
  const end   = DateTime.fromObject({ year, ...t.end   }, { zone: LONDON }).endOf('day');
  return { start, end };
}

// Pick current term/year in Europe/London
function detectCurrentTermYear() {
  const now = window._deps.DateTime.now().setZone('Europe/London');
  const m = now.month;
  const term =
    m >= 9  ? 'Michaelmas' :
    m >= 5  ? 'Petertide'  :
              'Valentine';
  return { term, year: now.year };
}

// ----- ICS parsing & expansion (all-day only) -----
function isAllDayEvent(ev) {
  // ICAL.Event -> startDate.isDate means VALUE=DATE (all-day)
  return ev.startDate && ev.startDate.isDate === true;
}

function toLocalISODate(dt) {
  // dt is a JS Date
  return DateTime.fromJSDate(dt).setZone(LONDON).toISODate(); // 'YYYY-MM-DD'
}

function expandAllDayInstances(icalText, start, end) {
  const comp = new ICAL.Component(ICAL.parse(icalText));
  const events = [];
  const rangeStart = start.startOf('day');
  const rangeEnd = end.endOf('day');

  for (const ve of comp.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(ve);
    if (!isAllDayEvent(ev)) continue;

    const startJS = ev.startDate.toJSDate();
    const endJS   = ev.endDate ? ev.endDate.toJSDate() : new Date(+startJS + 24*3600*1000);

    // Recurring?
    if (ev.isRecurring()) {
      const iter = ev.iterator();
      let next;
      while ((next = iter.next())) {
        const occ = DateTime.fromJSDate(next.toJSDate()).setZone(LONDON);
        if (occ < rangeStart) continue;
        if (occ > rangeEnd) break;

        // For recurring all-day events, we treat each occurrence as one day.
        events.push({
          date: occ.toISODate(),
          title: ev.summary || '',
          location: ev.location || '',
          uid: ev.uid || ''
        });
      }
    } else {
      // Non-recurring all-day, may span multiple days via DTEND.
      const s = DateTime.fromJSDate(startJS).setZone(LONDON);
      const e = DateTime.fromJSDate(endJS).setZone(LONDON);
      let d = DateTime.max(s.startOf('day'), rangeStart.startOf('day'));
      const last = DateTime.min(e, rangeEnd.plus({ days: 1 }));
      while (d < last) {
        events.push({
          date: d.toISODate(),
          title: ev.summary || '',
          location: ev.location || '',
          uid: ev.uid || ''
        });
        d = d.plus({ days: 1 });
      }
    }
  }
  return events;
}

// ----- Rendering -----
function renderMonths(container, start, end, eventsByDate) {
  container.innerHTML = '';
  // Count how many months we'll render to set grid columns
  const monthCount = (end.year - start.year) * 12 + (end.month - start.month) + 1;
  document.documentElement.style.setProperty('--grid-columns', String(monthCount));

  let cur = start.startOf('month');
  const finalMonth = end.startOf('month');

  while (cur <= finalMonth) {
    const monthEl = document.createElement('div');
    monthEl.className = 'month';
    monthEl.innerHTML = `<h2>${cur.toFormat('LLLL yyyy')}</h2><table class="rows"></table>`;
    const tbody = monthEl.querySelector('.rows');

    let d = cur;
    const last = cur.endOf('month');
    while (d <= last && d <= end) {
      if (d < start) { d = d.plus({ days: 1 }); continue; }

      const isWeekend = d.weekday >= 6; // 6=Sat, 7=Sun (Luxon)
      const tr = document.createElement('tr');
      if (isWeekend) tr.classList.add('weekend');

      const wd = d.toFormat('ccc');
      const dn = d.day;
      const dayKey = d.toISODate();
      const events = eventsByDate.get(dayKey) || [];
      const evHTML = events.slice(0, 5).map(e => `<div class="ev">${escapeHTML(e.title)}</div>`).join('');

      const moonPhase = getMoonPhase(d);
      const moonHTML = moonPhase ? ` <span class="moon">${moonPhase}</span>` : '';
      tr.innerHTML = `
        <td class="dow"><span class="dow-d">${escapeHTML(wd)}</span> <span class="dow-n">${dn}</span>${moonHTML}</td>
        <td class="evs">${evHTML}</td>
      `;
      tbody.appendChild(tr);
      d = d.plus({ days: 1 });
    }

    container.appendChild(monthEl);
    cur = cur.plus({ months: 1 }).startOf('month');
  }
}

function groupByDate(instances) {
  const map = new Map();
  for (const ev of instances) {
    if (!map.has(ev.date)) map.set(ev.date, []);
    map.get(ev.date).push(ev);
  }
  return map;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ----- Moon phase (Jean Meeus, Astronomical Algorithms ch.49) -----
function _moonPhaseJDE(k) {
  const T = k / 1236.85, T2 = T*T, T3 = T2*T, T4 = T3*T;
  const r = Math.PI / 180;
  let JDE = 2451550.09766 + 29.530588861*k + 0.00015437*T2 - 0.000000150*T3 + 0.00000000073*T4;
  const E  = 1 - 0.002516*T - 0.0000074*T2;
  const M  = (2.5534   +  29.10535670*k - 0.0000014*T2) * r;
  const Mp = (201.5643 + 385.81693528*k + 0.0107582*T2 + 0.00001238*T3) * r;
  const F  = (160.7108 + 390.67050284*k - 0.0016118*T2 - 0.00000227*T3) * r;
  const Om = (124.7746 -   1.56375588*k + 0.0020672*T2) * r;
  const frac = k - Math.floor(k);
  let c;
  if (frac < 0.01) {
    c = -0.40720*Math.sin(Mp) + 0.17241*E*Math.sin(M) + 0.01608*Math.sin(2*Mp)
      + 0.01039*Math.sin(2*F) + 0.00739*E*Math.sin(Mp-M) - 0.00514*E*Math.sin(Mp+M)
      + 0.00208*E*E*Math.sin(2*M) - 0.00111*Math.sin(Mp-2*F) - 0.00057*Math.sin(Mp+2*F)
      + 0.00056*E*Math.sin(2*Mp+M) - 0.00042*Math.sin(3*Mp) + 0.00042*E*Math.sin(M+2*F)
      + 0.00038*E*Math.sin(M-2*F) - 0.00024*E*Math.sin(2*Mp-M) - 0.00017*Math.sin(Om)
      - 0.00007*Math.sin(Mp+2*M) + 0.00004*Math.sin(2*Mp-2*F) + 0.00004*Math.sin(3*M)
      + 0.00003*Math.sin(Mp+M-2*F) + 0.00003*Math.sin(2*Mp+2*F) - 0.00003*Math.sin(Mp+M+2*F)
      + 0.00003*Math.sin(Mp-M+2*F) - 0.00002*Math.sin(Mp-M-2*F) - 0.00002*Math.sin(3*Mp+M)
      + 0.00002*Math.sin(4*Mp);
  } else if (Math.abs(frac - 0.5) < 0.01) {
    c = -0.40614*Math.sin(Mp) + 0.17302*E*Math.sin(M) + 0.01614*Math.sin(2*Mp)
      + 0.01043*Math.sin(2*F) + 0.00734*E*Math.sin(Mp-M) - 0.00515*E*Math.sin(Mp+M)
      + 0.00209*E*E*Math.sin(2*M) - 0.00111*Math.sin(Mp-2*F) - 0.00057*Math.sin(Mp+2*F)
      + 0.00056*E*Math.sin(2*Mp+M) - 0.00042*Math.sin(3*Mp) + 0.00042*E*Math.sin(M+2*F)
      + 0.00038*E*Math.sin(M-2*F) - 0.00024*E*Math.sin(2*Mp-M) - 0.00017*Math.sin(Om)
      - 0.00007*Math.sin(Mp+2*M) + 0.00004*Math.sin(2*Mp-2*F) + 0.00004*Math.sin(3*M)
      + 0.00003*Math.sin(Mp+M-2*F) + 0.00003*Math.sin(2*Mp+2*F) - 0.00003*Math.sin(Mp+M+2*F)
      + 0.00003*Math.sin(Mp-M+2*F) - 0.00002*Math.sin(Mp-M-2*F) - 0.00002*Math.sin(3*Mp+M)
      + 0.00002*Math.sin(4*Mp);
  } else {
    c = -0.62801*Math.sin(Mp) + 0.17172*E*Math.sin(M) - 0.01183*E*Math.sin(Mp+M)
      + 0.00862*Math.sin(2*Mp) + 0.00804*Math.sin(2*F) + 0.00454*E*Math.sin(Mp-M)
      + 0.00204*E*E*Math.sin(2*M) - 0.00180*Math.sin(Mp-2*F) - 0.00070*Math.sin(Mp+2*F)
      - 0.00040*Math.sin(3*Mp) - 0.00034*E*Math.sin(2*Mp-M) + 0.00032*E*Math.sin(M+2*F)
      + 0.00032*E*Math.sin(M-2*F) - 0.00028*E*E*Math.sin(Mp+2*M) + 0.00027*E*Math.sin(2*Mp+M)
      - 0.00017*Math.sin(Om) - 0.00005*Math.sin(Mp-M-2*F) + 0.00004*Math.sin(2*Mp+2*F)
      - 0.00004*Math.sin(Mp+M+2*F) + 0.00004*Math.sin(Mp-2*M) + 0.00003*Math.sin(Mp+M-2*F)
      + 0.00003*Math.sin(3*M) + 0.00002*Math.sin(2*Mp-2*F) + 0.00002*Math.sin(Mp-M+2*F)
      - 0.00002*Math.sin(3*Mp+M);
    const W = 0.00306 - 0.00038*E*Math.cos(M) + 0.00026*Math.cos(Mp)
      - 0.00002*Math.cos(Mp-M) + 0.00002*Math.cos(Mp+M) + 0.00002*Math.cos(2*F);
    c += frac < 0.3 ? W : -W;
  }
  for (const [deg, coeff] of [
    [299.77 + 0.107408*k - 0.009173*T2, 0.000325], [251.88 + 0.016321*k, 0.000165],
    [251.83 + 26.651886*k, 0.000164],  [349.42 + 36.412478*k, 0.000126],
    [84.66  + 18.206239*k, 0.000110],  [141.74 + 53.303771*k, 0.000062],
    [207.14 + 2.453732*k,  0.000060],  [154.84 + 7.306860*k,  0.000056],
    [34.52  + 27.261239*k, 0.000047],  [207.19 + 0.121824*k,  0.000042],
    [291.34 + 1.844379*k,  0.000040],  [161.72 + 24.198154*k, 0.000037],
    [239.56 + 25.513099*k, 0.000035],  [331.55 + 3.592518*k,  0.000023],
  ]) c += coeff * Math.sin(deg * r);
  return JDE + c;
}

function getMoonPhase(luxonDate) {
  const dayStartMs = luxonDate.startOf('day').toMillis();
  const dayEndMs   = luxonDate.endOf('day').toMillis();
  const kBase = Math.round((luxonDate.year + (luxonDate.month - 1) / 12 - 2000) * 12.3685);
  for (const [offset, emoji] of [[0,'🌑'],[0.25,'🌓'],[0.5,'🌕'],[0.75,'🌗']]) {
    for (const dk of [-1, 0, 1]) {
      const phaseMs = (_moonPhaseJDE(kBase + dk + offset) - 2440587.5) * 86400000;
      if (phaseMs >= dayStartMs && phaseMs <= dayEndMs) return emoji;
    }
  }
  return null;
}

// ----- UI wiring -----
const els = {
  file: document.getElementById('icsInput'),
  url: document.getElementById('icsUrl'),
  term: document.getElementById('term'),
  year: document.getElementById('year'),
  render: document.getElementById('renderBtn'),
  grid: document.getElementById('grid'),
  status: document.getElementById('status'),

  // NEW:
  toolbar: document.getElementById('toolbar'),
  showBtn: document.getElementById('showToolbarBtn'),
  metaRange: document.getElementById('metaRange'),
  metaTz: document.getElementById('metaTz'),
  printMeta: document.getElementById('printMeta'),
};

if (els.toolbar && els.showBtn) {
  if (els.toolbar.classList.contains('hidden')) {
    els.showBtn.textContent = '⚙︎ Show toolbar';
    els.showBtn.setAttribute('aria-label', 'Show toolbar');
    els.showBtn.title = 'Show toolbar';
    els.showBtn.setAttribute('aria-expanded', 'false');
  } else {
    els.showBtn.textContent = 'Hide toolbar';
    els.showBtn.setAttribute('aria-label', 'Hide toolbar');
    els.showBtn.title = 'Hide toolbar';
    els.showBtn.setAttribute('aria-expanded', 'true');
  }
}

function toDisplayDate(d) {
  try {
    if (d && typeof d.toFormat === 'function') return d.toFormat('LLL d, yyyy');
    const date = (d instanceof Date) ? d : new Date(d);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return String(d);
  }
}

function hideToolbar() {
  if (!els.toolbar || !els.showBtn) return;
  els.toolbar.classList.add('hidden');
  els.showBtn.textContent = '⚙︎ Show toolbar';
  els.showBtn.setAttribute('aria-label', 'Show toolbar');
  els.showBtn.title = 'Show toolbar';
  els.showBtn.setAttribute('aria-expanded', 'false');
  sessionStorage.setItem('toolbarHidden', '1');
}

function showToolbar() {
  if (!els.toolbar || !els.showBtn) return;
  els.toolbar.classList.remove('hidden');
  els.showBtn.textContent = 'Hide toolbar';
  els.showBtn.setAttribute('aria-label', 'Hide toolbar');
  els.showBtn.title = 'Hide toolbar';
  els.showBtn.setAttribute('aria-expanded', 'true');
  sessionStorage.setItem('toolbarHidden', '0');
}

function updateMeta({ source, allDayCount, multiDayCount, startDate, endDate, tz }) {
  if (els.metaRange) els.metaRange.textContent = `Range: ${toDisplayDate(startDate)} – ${toDisplayDate(endDate)}`;
  if (els.metaTz)    els.metaTz.textContent    = `TZ: ${tz || Intl.DateTimeFormat().resolvedOptions().timeZone}`;

if (els.printMeta) {
  const parts = [];
  if (els.metaRange && els.metaRange.textContent) parts.push(els.metaRange.textContent);
  if (els.metaTz && els.metaTz.textContent) parts.push(els.metaTz.textContent);
  els.printMeta.textContent = parts.join(' • ');
}
}

// Wire up buttons and keyboard shortcut
els.showBtn?.addEventListener('click', () => {
  if (els.toolbar?.classList.contains('hidden')) showToolbar(); else hideToolbar();
});
document.addEventListener('keydown', (e) => {
  if (e.key && e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (els.toolbar?.classList.contains('hidden')) showToolbar(); else hideToolbar();
  }
});

// Restore last state
if (sessionStorage.getItem('toolbarHidden') === '1') hideToolbar();


// ---- URL <-> state helpers ----
function readStateFromUrl() {
  const p = new URLSearchParams(location.search);
  const state = {
    ics: (p.get('ics') || '').trim(),
    term: (p.get('term') || '').trim(),
    year: p.get('year') ? Number(p.get('year')) : undefined,
    hide: p.get('hide') === '1',
  };
  // Normalize term casing to match our select values (Michaelmas/Valentine/Petertide)
  if (state.term) {
    const t = state.term.toLowerCase();
    if (t === 'michaelmas') state.term = 'Michaelmas';
    else if (t === 'valentine') state.term = 'Valentine';
    else if (t === 'petertide') state.term = 'Petertide';
    else state.term = undefined;
  }
  if (state.year && !Number.isFinite(state.year)) state.year = undefined;
  return state;
}

function writeStateToUrl(next, { replace = true } = {}) {
  const p = new URLSearchParams();
  if (next.ics) p.set('ics', next.ics);
  if (next.term) p.set('term', next.term);
  if (Number.isFinite(next.year)) p.set('year', String(next.year));
  if (next.hide) p.set('hide', '1');
  const qs = p.toString();
  const url = qs ? `?${qs}` : location.pathname;
  if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
}

function applyStateToForm(state) {
  if (state.ics != null && els.url) els.url.value = state.ics;
  if (state.term && els.term) els.term.value = state.term;
  if (state.year && els.year) els.year.value = state.year;
  if (state.hide) {
    if (!document.querySelector('.toolbar')?.classList.contains('hidden')) {
      (typeof hideToolbar === 'function') ? hideToolbar()
        : document.querySelector('.toolbar')?.classList.add('hidden');
    }
  }
}

function getStateFromForm() {
  return {
    ics: (els.url?.value || '').trim(),
    term: els.term?.value,
    year: els.year ? Number(els.year.value) : undefined,
    hide: document.querySelector('.toolbar')?.classList.contains('hidden') || false,
  };
}

// ---- Initial load from URL ----
window.addEventListener('DOMContentLoaded', () => {
  const state = readStateFromUrl();
  applyStateToForm(state);

  // If term or year are missing, default them to "current" and sync URL
  const needTerm = !state.term;
  const needYear = !Number.isFinite(state.year);
  if (needTerm || needYear) {
    const { term, year } = detectCurrentTermYear();
    if (needTerm && els.term) els.term.value = term;
    if (needYear && els.year) els.year.value = year;
    writeStateToUrl(getStateFromForm(), { replace: true });
  }

  // Only auto-render if we also have an ICS (keeps empty loads quiet)
  const finalState = readStateFromUrl();
  if (finalState.ics && finalState.term && Number.isFinite(finalState.year)) {
    els.render?.click();
  }
});

// Back/forward support: rehydrate + render
window.addEventListener('popstate', () => {
  const state = readStateFromUrl();
  applyStateToForm(state);
  if (state.ics && state.term && Number.isFinite(state.year)) {
    els.render?.click();
  }
});

// Keep URL in sync when user edits controls
let __writeTimer;
function scheduleWrite() {
  clearTimeout(__writeTimer);
  __writeTimer = setTimeout(() => writeStateToUrl(getStateFromForm(), { replace: true }), 120);
}
['input', 'change'].forEach(evt => {
  els.url?.addEventListener(evt, scheduleWrite);
  els.term?.addEventListener(evt, scheduleWrite);
  els.year?.addEventListener(evt, scheduleWrite);
});
// Also reflect toolbar visibility changes
els.showBtn?.addEventListener('click', scheduleWrite);

async function fetchICSFromUrl(remoteUrl) {
  // Try direct CORS fetch first
  try {
    const direct = await fetch(remoteUrl, { credentials: 'omit', mode: 'cors' });
    if (!direct.ok) throw new Error(`HTTP ${direct.status}`);
    const text = await direct.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      throw new Error('Not an ICS file (missing VCALENDAR header).');
    }
    console.log('Fetched ICS directly from', remoteUrl);
    return text;
  } catch (err) {
    // Fallback to a public CORS proxy (for public feeds only!)
    const proxied = `https://api.allorigins.win/raw?url=${encodeURIComponent(remoteUrl)}`;
    const r = await fetch(proxied, { credentials: 'omit', mode: 'cors' });
    if (!r.ok) throw new Error(`Proxy failed: HTTP ${r.status}`);
    const text = await r.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      throw new Error('Proxy returned non-ICS content.');
    }
    console.log('Direct fetch failed, using proxy for', remoteUrl, 'Error:', err.message || err);
    return text;
  }
}


function setStatus(msg) { els.status.textContent = msg; }

// Helper to update the on-page H1 and browser tab title
function setPlannerTitle(termName, year) {
  const h1 = document.querySelector('h1');
  const label = (termName && Number.isFinite(year)) ? `${termName} ${year}` : 'Term Planner';
  if (h1) h1.textContent = label;
  // Also update the browser tab's title for shareability
  document.title = label;
}

els.render.addEventListener('click', async () => {
  const urlVal = els.url && els.url.value.trim();
  const file = els.file && els.file.files && els.file.files[0];
  const year = Number(els.year.value);
  const termName = els.term.value;

  let currentIcsSource = '';

  if (!urlVal && !file) {
    setStatus('Provide a remote ICS URL or choose a file.');
    return;
  }

  try {
    setStatus(urlVal ? 'Fetching remote ICS…' : 'Reading ICS file…');
    let icalText;
    if (urlVal) {
      icalText = await fetchICSFromUrl(urlVal);
      currentIcsSource = urlVal;
    } else {
      icalText = await file.text();
      currentIcsSource = file ? file.name : currentIcsSource;
    }

    const { start, end } = termRange(year, termName);
    const instances = expandAllDayInstances(icalText, start, end);
    const byDate = groupByDate(instances);

    // Ensure URL reflects the current state used for this render
    writeStateToUrl({
      ics: (els.url?.value || '').trim(),
      term: termName,
      year: year,
      hide: document.querySelector('.toolbar')?.classList.contains('hidden') || false,
    }, { replace: true });

    setStatus(`Loaded ${instances.length} all-day instances.`);
    renderMonths(els.grid, start, end, byDate);
    updateMeta({
      startDate: start,
      endDate: end,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone
    });

    // Update page and tab titles to "Term Year"
    setPlannerTitle(termName, year);

    // Hide toolbar after successful render
    hideToolbar();
  } catch (err) {
    console.error(err);
    setStatus(String(err.message || err));
  }
});

// Optional: load a default sample by dropping a file. Remote URLs are supported via CORS or proxy fallback.