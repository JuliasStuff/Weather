// ============================================================
//  Weather App — app.js
//  Uses Open-Meteo (free, no API key) for weather data and
//  the Open-Meteo Geocoding API to search for cities.
// ============================================================

'use strict';

// ── Default locations ────────────────────────────────────────
const DEFAULT_LOCATIONS = [
  { name: 'Renton, WA', lat: 47.4829, lon: -122.2171 }
];

// ── State ────────────────────────────────────────────────────
let locations = [];
let selectedIndex = 0;
let weatherData = null;
let searchDebounceTimer = null;

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadLocations();
  renderLocationSelect();
  setupEventListeners();
  fetchWeather();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {/* non-critical */});
  }
});

// ============================================================
//  Persistence
// ============================================================

function loadLocations() {
  try {
    const raw = localStorage.getItem('wapp_locations');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        locations = parsed;
      } else {
        locations = cloneDefaults();
      }
    } else {
      locations = cloneDefaults();
    }

    const idx = parseInt(localStorage.getItem('wapp_index') || '0', 10);
    selectedIndex = isNaN(idx) ? 0 : Math.max(0, Math.min(idx, locations.length - 1));
  } catch {
    locations = cloneDefaults();
    selectedIndex = 0;
  }
}

function saveLocations() {
  localStorage.setItem('wapp_locations', JSON.stringify(locations));
  localStorage.setItem('wapp_index', String(selectedIndex));
}

function cloneDefaults() {
  return DEFAULT_LOCATIONS.map(l => ({ ...l }));
}

// ============================================================
//  Location Select
// ============================================================

function renderLocationSelect() {
  const sel = document.getElementById('location-select');
  sel.innerHTML = '';
  locations.forEach((loc, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = loc.name;
    if (i === selectedIndex) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ============================================================
//  Event Listeners
// ============================================================

function setupEventListeners() {
  document.getElementById('location-select').addEventListener('change', e => {
    selectedIndex = parseInt(e.target.value, 10);
    saveLocations();
    fetchWeather();
  });

  document.getElementById('add-city-btn').addEventListener('click', openAddModal);
  document.getElementById('del-city-btn').addEventListener('click', deleteCurrentCity);
  document.getElementById('refresh-btn').addEventListener('click', fetchWeather);

  document.getElementById('cancel-add').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  document.getElementById('city-input').addEventListener('input', e => {
    clearTimeout(searchDebounceTimer);
    const q = e.target.value.trim();
    if (q.length < 2) {
      document.getElementById('search-results').innerHTML = '';
      return;
    }
    searchDebounceTimer = setTimeout(() => searchCity(q), 380);
  });

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Swipe left/right on main to switch tabs
  const mainEl = document.querySelector('main');
  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeFromScroll = false;

  mainEl.addEventListener('touchstart', e => {
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
    swipeFromScroll = document.getElementById('hourly-scroll').contains(e.target);
  }, { passive: true });

  mainEl.addEventListener('touchend', e => {
    if (swipeFromScroll) {
      return;
    }
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const dy = e.changedTouches[0].clientY - swipeStartY;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) {
      return;
    }
    if (dx < 0) {
      switchTab('forecast');
    } else {
      switchTab('today');
    }
  }, { passive: true });
}

function switchTab(tabId) {
  document.querySelectorAll('.tab').forEach(t => {
    const active = t.dataset.tab === tabId;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.id === tabId + '-tab');
  });
}

function openAddModal() {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('city-input').value = '';
  document.getElementById('search-results').innerHTML = '';
  setTimeout(() => document.getElementById('city-input').focus(), 80);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

function deleteCurrentCity() {
  if (locations.length <= 1) {
    showToast('You must keep at least one location.');
    return;
  }
  const name = locations[selectedIndex].name;
  if (!confirm(`Remove "${name}"?`)) return;
  locations.splice(selectedIndex, 1);
  selectedIndex = Math.max(0, selectedIndex - 1);
  saveLocations();
  renderLocationSelect();
  fetchWeather();
}

// ============================================================
//  City Search (Geocoding)
// ============================================================

async function searchCity(query) {
  const resultsEl = document.getElementById('search-results');
  resultsEl.innerHTML = '<div class="search-status">Searching…</div>';

  try {
    const url =
      'https://geocoding-api.open-meteo.com/v1/search?' +
      `name=${encodeURIComponent(query)}&count=8&language=en&format=json`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.results || data.results.length === 0) {
      resultsEl.innerHTML = '<div class="search-status">No results found</div>';
      return;
    }

    resultsEl.innerHTML = '';
    data.results.forEach(place => {
      const div = document.createElement('div');
      div.className = 'result-item';
      div.setAttribute('role', 'option');

      const detail = [place.admin1, place.country].filter(Boolean).join(', ');
      div.innerHTML =
        `<span class="result-name">${esc(place.name)}</span>` +
        `<span class="result-detail">${esc(detail)}</span>`;

      div.addEventListener('click', () => addCity(place));
      resultsEl.appendChild(div);
    });
  } catch {
    resultsEl.innerHTML = '<div class="search-status">Search failed — check connection</div>';
  }
}

function addCity(place) {
  // Build a concise display name
  const parts = [place.name];
  if (place.admin1) parts.push(place.admin1);
  if (place.country_code) parts.push(place.country_code);
  const displayName = parts.join(', ');

  // Skip if already saved (within ~1 km)
  const exists = locations.some(
    l => Math.abs(l.lat - place.latitude) < 0.01 && Math.abs(l.lon - place.longitude) < 0.01
  );

  if (!exists) {
    locations.push({ name: displayName, lat: place.latitude, lon: place.longitude });
  }

  selectedIndex = exists
    ? locations.findIndex(l => Math.abs(l.lat - place.latitude) < 0.01)
    : locations.length - 1;

  saveLocations();
  renderLocationSelect();
  closeModal();
  fetchWeather();
}

// ============================================================
//  Weather API  (Open-Meteo, no key required)
// ============================================================

async function fetchWeather() {
  const loc = locations[selectedIndex];
  if (!loc) return;

  setLoading(true);
  hideError();

  try {
    const params = new URLSearchParams({
      latitude:          loc.lat,
      longitude:         loc.lon,
      current:          'temperature_2m,apparent_temperature,precipitation,weathercode,windspeed_10m',
      hourly:           'temperature_2m,precipitation_probability,windspeed_10m,weathercode',
      daily:            'weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      temperature_unit: 'fahrenheit',
      windspeed_unit:   'mph',
      precipitation_unit: 'inch',
      timezone:         'auto',
      forecast_days:    10
    });

    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    weatherData = await res.json();
    renderWeather();
  } catch {
    showError('Could not load weather data.\nCheck your internet connection and try again.');
  } finally {
    setLoading(false);
  }
}

// ============================================================
//  Rendering
// ============================================================

function renderWeather() {
  if (!weatherData) return;
  renderCurrentCard();
  renderHourly();
  renderForecast();
}

// ── Current conditions ───────────────────────────────────────
function renderCurrentCard() {
  const c = weatherData.current;
  const d = weatherData.daily;
  const card = document.getElementById('current-card');

  const icon = weatherIcon(c.weathercode);
  const desc = weatherDesc(c.weathercode);
  const hi   = Math.round(d.temperature_2m_max[0]);
  const lo   = Math.round(d.temperature_2m_min[0]);

  card.innerHTML = `
    <div class="current-icon">${icon}</div>
    <div class="current-temp">${Math.round(c.temperature_2m)}°</div>
    <div class="current-desc">${desc}</div>
    <div class="current-highlow">H: ${hi}°  ·  L: ${lo}°</div>
    <div class="current-details">
      <div class="current-detail-item">
        <span class="detail-label">Feels Like</span>
        <span class="detail-val">${Math.round(c.apparent_temperature)}°</span>
      </div>
      <div class="current-detail-item">
        <span class="detail-label">Wind</span>
        <span class="detail-val">${Math.round(c.windspeed_10m)} mph</span>
      </div>
      <div class="current-detail-item">
        <span class="detail-label">Precip</span>
        <span class="detail-val">${c.precipitation.toFixed(2)}"</span>
      </div>
    </div>
  `;
}

// ── Hourly forecast ──────────────────────────────────────────
function renderHourly() {
  const h   = weatherData.hourly;
  const container = document.getElementById('hourly-scroll');
  container.innerHTML = '';

  // Use current.time from the API (in location's local timezone)
  const nowHour = weatherData.current.time.slice(0, 13) + ':00'; // "YYYY-MM-DDTHH:00"
  let startIdx = h.time.findIndex(t => t >= nowHour);
  if (startIdx < 0) startIdx = 0;

  const endIdx = Math.min(startIdx + 24, h.time.length);

  for (let i = startIdx; i < endIdx; i++) {
    const isNow = (i === startIdx);

    const card = document.createElement('div');
    card.className = 'hourly-card' + (isNow ? ' now' : '');
    card.setAttribute('role', 'listitem');

    const timeLabel = isNow ? 'Now' : formatHourStr(h.time[i]);
    const rain  = h.precipitation_probability[i] ?? 0;
    const wind  = Math.round(h.windspeed_10m[i]);

    card.innerHTML = `
      <div class="hourly-time">${timeLabel}</div>
      <div class="hourly-icon">${weatherIcon(h.weathercode[i], rain)}</div>
      <div class="hourly-temp">${Math.round(h.temperature_2m[i])}°</div>
      <div class="hourly-rain">💧 ${rain}%</div>
      <div class="hourly-wind">💨 ${wind}</div>
    `;
    container.appendChild(card);
  }
}

// ── 10-day forecast ──────────────────────────────────────────
function renderForecast() {
  const d    = weatherData.daily;
  const list = document.getElementById('daily-list');
  list.innerHTML = '';

  d.time.forEach((dateStr, i) => {
    const dayLabel = i === 0 ? 'Today'
                   : i === 1 ? 'Tomorrow'
                   : new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });

    const hi   = Math.round(d.temperature_2m_max[i]);
    const lo   = Math.round(d.temperature_2m_min[i]);
    const rain = d.precipitation_probability_max[i] ?? 0;

    const row = document.createElement('div');
    row.className = 'daily-row';
    row.setAttribute('role', 'listitem');

    row.innerHTML = `
      <div class="daily-day">${dayLabel}</div>
      <div class="daily-icon">${weatherIcon(d.weathercode[i], rain)}</div>
      <div class="daily-rain">💧 ${rain}%</div>
      <div class="daily-temps">
        <span class="high">${hi}°</span>
        <span class="sep">/</span>
        <span class="low">${lo}°</span>
      </div>
    `;
    list.appendChild(row);
  });
}

// ============================================================
//  Helpers
// ============================================================

/** Format "YYYY-MM-DDTHH:MM" → "9AM", "12PM", etc. */
function formatHourStr(timeStr) {
  const h = parseInt(timeStr.slice(11, 13), 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 || 12;
  return `${display}${ampm}`;
}

/** WMO weather codes → emoji.
 *  Optional rainPct: if very low, suppress rain icons (Open-Meteo can
 *  report a daily "rain showers" code while the peak probability for
 *  the day is only a few percent).
 */
function weatherIcon(code, rainPct) {
  if (typeof rainPct === 'number' && rainPct < 20) {
    const isRainy = (code >= 51 && code <= 67)
                 || (code >= 80 && code <= 82)
                 || (code >= 95 && code <= 99);
    if (isRainy) {
      return '☁️';
    }
  }
  if (code === 0)            return '☀️';
  if (code <= 2)             return '🌤️';
  if (code === 3)            return '☁️';
  if (code <= 48)            return '🌫️';
  if (code <= 55)            return '🌦️';
  if (code <= 67)            return '🌧️';
  if (code <= 77)            return '🌨️';
  if (code <= 82)            return '🌦️';
  if (code <= 86)            return '🌨️';
  /* 95–99 */                return '⛈️';
}

/** WMO weather codes → description */
function weatherDesc(code) {
  const MAP = {
     0: 'Clear Sky',
     1: 'Mainly Clear',      2: 'Partly Cloudy',   3: 'Overcast',
    45: 'Fog',               48: 'Icy Fog',
    51: 'Light Drizzle',     53: 'Drizzle',         55: 'Heavy Drizzle',
    56: 'Freezing Drizzle',  57: 'Heavy Freezing Drizzle',
    61: 'Light Rain',        63: 'Rain',            65: 'Heavy Rain',
    66: 'Freezing Rain',     67: 'Heavy Freezing Rain',
    71: 'Light Snow',        73: 'Snow',            75: 'Heavy Snow',
    77: 'Snow Grains',
    80: 'Rain Showers',      81: 'Rain Showers',    82: 'Heavy Rain Showers',
    85: 'Snow Showers',      86: 'Heavy Snow Showers',
    95: 'Thunderstorm',      96: 'Thunderstorm',    99: 'Thunderstorm'
  };
  return MAP[code] ?? 'Unknown';
}

function setLoading(on) {
  document.getElementById('loading-overlay').classList.toggle('hidden', !on);
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideError() {
  document.getElementById('error-msg').classList.add('hidden');
}

/** Sanitize for innerHTML insertion */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg) {
  // Simple fallback toast using alert on mobile
  alert(msg);
}
