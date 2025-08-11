// app.js
const { ICAL, DateTime } = window._deps;
const LONDON = 'Europe/London';

// ----- Term helpers -----
const TERMS = {
  Michaelmas: { start: { month: 9,  day: 1  }, end: { month: 12, day: 31 } },
  Lent:       { start: { month: 1,  day: 1  }, end: { month: 4,  day: 30 } },
  Petertide:  { start: { month: 5,  day: 1  }, end: { month: 8,  day: 31 } },
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
};

const showBtn = document.getElementById('showToolbarBtn');
function setToolbarVisible(visible) {
  const tb = document.querySelector('.toolbar');
  if (!tb) return;
  if (visible) {
    tb.classList.remove('hidden');
    if (showBtn) showBtn.style.display = 'none';
  } else {
    tb.classList.add('hidden');
    if (showBtn) showBtn.style.display = 'inline-block';
  }
}
if (showBtn) {
  showBtn.addEventListener('click', () => setToolbarVisible(true));
}

// Auto-load ICS from URL parameter if provided
const params = new URLSearchParams(window.location.search);
const icsParamUrl = params.get('ics');
if (icsParamUrl) {
  if (els.url) els.url.value = icsParamUrl;
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
    const instances = expandAllDayInstances(icalText, start, end);
    const byDate = groupByDate(instances);

    setStatus(`Loaded ${instances.length} all-day instances.`);
    renderMonths(els.grid, start, end, byDate);

    // Hide toolbar after successful render
    setToolbarVisible(false);
  } catch (err) {
    console.error(err);
    setStatus(String(err.message || err));
  }
});

// Optional: load a default sample by dropping a file. Remote URLs are supported via CORS or proxy fallback.