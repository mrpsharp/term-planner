# Term Planner

A client-side web app that reads all-day events from an ICS (iCalendar) file or URL and renders a clean, four-month planner grid for easy printing in A4 landscape.

- **No server required** — runs entirely in your browser.
- Load local `.ics` files or fetch remote calendars (with CORS proxy fallback).
- Prints beautifully with weekend shading.
- Uses [ical.js](https://github.com/mozilla-comm/ical.js) and [luxon](https://moment.github.io/luxon/).

---

## ✨ Features

- Load calendar data via file upload **or** remote URL.
- Expands recurring all-day events automatically.
- Subtle weekend banding for clarity.
- Toolbar auto-hides after rendering, with a “⚙︎ Show toolbar” toggle that never appears in print.
- Auto-load calendar by passing `?ics=...` in the URL.

---

## 🚀 Usage

### Option 1: Open locally

1. Serve the files from a simple HTTP server:

   ```bash
   python3 -m http.server 8000
   ```

2. Navigate to:  
   [http://localhost:8000](http://localhost:8000)

3. Upload an ICS file **or** enter a remote URL, then click **Render** → **Print**.

### Option 2: URL auto-load

Append an `ics` parameter to the page URL:

```
index.html?ics=https://example.com/calendar.ics
```

The planner will fetch and render automatically.

---

## 📂 Project Structure

```
/
├── index.html    # Main client UI
├── app.js        # Parsing, rendering, toolbar behavior
├── style.css     # Layout + print styles
└── README.md     # This file
```

---

## 📜 License

**Recommended:** MIT License — simple, permissive, and protects you from liability while allowing anyone to use, modify, and share the code.

### Example LICENSE file:

```
MIT License

Copyright (c) 2025 [Your Name]

Permission is hereby granted, free of charge, to any person obtaining a copy...
```

---

## 💡 Future Enhancements

- Support timed events alongside all-day events.
- Add event filtering, color-coding, or theming.
- Convert to a Progressive Web App (PWA) for offline use.
- Provide a small server-side proxy for private calendars.

---

## 🤝 Contributing

Pull requests, feature suggestions, and styling improvements are welcome!  
Please open an issue to discuss significant changes before submitting.
