// app.js
const { ICAL, DateTime } = window._deps;
const LONDON = 'Europe/London';

// ----- Term helpers -----
const TERMS = {
  Michaelmas: { start: { month: 9,  day: 1  }, end: { month: 12, day: 31 } },
  Lent:       { start: { month: 1,  day: 1  }, end: { month: 4,  day: 30 } },
  Summer:  { start: { month: 5,  day: 1  }, end: { month: 8,  day: 31 } },
};

function termRange(year, termName) {
  const t = TERMS[termName];
  if (!t) throw new Error(`Unknown term: ${termName}`);
  const start = DateTime.fromObject({ year, ...t.start }, { zone: LONDON }).startOf('day');
  const end   = DateTime.fromObject({ year, ...t.end   }, { zone: LONDON }).endOf('day');
  return { start, end };
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

function countMultiDayAllDayEvents(icalText, start, end) {
  const comp = new ICAL.Component(ICAL.parse(icalText));
  let multiDay = 0;
  for (const ve of comp.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(ve);
    if (!isAllDayEvent(ev)) continue;
    if (ev.isRecurring()) continue; // recurring handled as single-day occurrences
    const s = DateTime.fromJSDate(ev.startDate.toJSDate()).setZone(LONDON).startOf('day');
    const e = DateTime.fromJSDate((ev.endDate ? ev.endDate.toJSDate()
                    : new Date(+ev.startDate.toJSDate() + 24*3600*1000))).setZone(LONDON);
    if (e <= start || s >= end.endOf('day')) continue; // no overlap with our window
    if (e.diff(s, 'days').days > 1) multiDay++;
  }
  return multiDay;
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

      tr.innerHTML = `
        <td class="dow"><span class="dow-d">${escapeHTML(wd)}</span> <span class="dow-n">${dn}</span></td>
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
  toolbarToggle: document.getElementById('toolbarToggle'),
  showBtn: document.getElementById('showToolbarBtn'),
  metaSrc: document.getElementById('metaSrc'),
  metaStats: document.getElementById('metaStats'),
  metaRange: document.getElementById('metaRange'),
  metaTz: document.getElementById('metaTz')
};

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
  if (!els.toolbar) return;
  els.toolbar.classList.add('hidden');
  if (els.showBtn) {
    els.showBtn.style.display = 'inline-block';
    els.showBtn.setAttribute('aria-expanded', 'false');
  }
  sessionStorage.setItem('toolbarHidden', '1');
}

function showToolbar() {
  if (!els.toolbar) return;
  els.toolbar.classList.remove('hidden');
  if (els.showBtn) {
    els.showBtn.style.display = 'none';
    els.showBtn.setAttribute('aria-expanded', 'true');
  }
  sessionStorage.setItem('toolbarHidden', '0');
}

function updateMeta({ source, allDayCount, multiDayCount, startDate, endDate, tz }) {
  if (els.metaSrc)   els.metaSrc.textContent   = `Loaded: ${source || ''}`;
  if (els.metaStats) els.metaStats.textContent = `Days shown: ${Number(allDayCount||0)} (from ${Number(multiDayCount||0)} multi‑day events)`;
  if (els.metaRange) els.metaRange.textContent = `Range: ${toDisplayDate(startDate)} – ${toDisplayDate(endDate)}`;
  if (els.metaTz)    els.metaTz.textContent    = `TZ: ${tz || Intl.DateTimeFormat().resolvedOptions().timeZone}`;

}
// Wire up buttons and keyboard shortcut
els.toolbarToggle?.addEventListener('click', hideToolbar);
els.showBtn?.addEventListener('click', showToolbar);
document.addEventListener('keydown', (e) => {
  if (e.key && e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (els.toolbar?.classList.contains('hidden')) showToolbar(); else hideToolbar();
  }
});

// Restore last state
if (sessionStorage.getItem('toolbarHidden') === '1') hideToolbar();


// Auto-load ICS from URL parameter if provided
const params = new URLSearchParams(window.location.search);
let currentIcsSource = '';
const icsParamUrl = params.get('ics');
if (icsParamUrl) {
  if (els.url) els.url.value = icsParamUrl;
  let currentIcsSource = '';
  // Optionally auto-render
  window.addEventListener('DOMContentLoaded', () => {
    if (els.render) els.render.click();
  });
}

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

els.render.addEventListener('click', async () => {
  const urlVal = els.url && els.url.value.trim();
  const file = els.file && els.file.files && els.file.files[0];
  const year = Number(els.year.value);
  const termName = els.term.value;

  if (!urlVal && !file) {
    setStatus('Provide a remote ICS URL or choose a file.');
    return;
  }

  try {
    setStatus(urlVal ? 'Fetching remote ICS…' : 'Reading ICS file…');
    let icalText;
    if (urlVal) {
      icalText = await fetchICSFromUrl(urlVal);
    } else {
      icalText = await file.text();
    }

    const { start, end } = termRange(year, termName);
    const multiDayCount = countMultiDayAllDayEvents(icalText, start, end);
    const instances = expandAllDayInstances(icalText, start, end);
    const byDate = groupByDate(instances);

    setStatus(`Loaded ${instances.length} all-day instances.`);
    renderMonths(els.grid, start, end, byDate);
    if (urlVal) {
      icalText = await fetchICSFromUrl(urlVal);
      currentIcsSource = urlVal;
    } else {
      icalText = await file.text();
      currentIcsSource = file ? file.name : currentIcsSource;
    }
    updateMeta({
      source: (currentIcsSource ? (currentIcsSource.split('/').pop() || currentIcsSource) : ''),
      allDayCount: instances.length,
      multiDayCount,
      startDate: start,
      endDate: end,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone
    });

    // Hide toolbar after successful render
    hideToolbar();
  } catch (err) {
    console.error(err);
    setStatus(String(err.message || err));
  }
});

// Optional: load a default sample by dropping a file. Remote URLs are supported via CORS or proxy fallback.