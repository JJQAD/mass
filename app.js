"use strict";

/**
 * Phase 1:
 * - LocalStorage persistence
 * - Swipe horizontally to change selected date
 * - One entry per day; overwrite on save
 * - No date picker UI
 * - Save via small checkmark button (and Enter key)
 * - Auto-fill input with saved weight for selected date
 */

const STORAGE_KEY = "weight_app_entries_v1";

const els = {
  dateLabel: document.getElementById("dateLabel"),
  weightInput: document.getElementById("weightInput"),
  checkButton: document.getElementById("checkButton"),
  statusText: document.getElementById("statusText"),
  chartCanvas: document.getElementById("chart"),
  swipeStage: document.getElementById("swipeStage"),
  swipeTrack: document.getElementById("swipeTrack"),
};

let chart = null;
let entries = [];      // { entryDate: "YYYY-MM-DD", weight: number, createdAt: number }
let selectedISO = null;

/* ---------- Date helpers ---------- */

function todayISODate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isoToMMDDYY(iso) {
  const [y, m, d] = iso.split("-");
  const yy = y.slice(2);
  return `${m}.${d}.${yy}`;
}

function isFutureISODate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const selected = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return selected.getTime() > today.getTime();
}

function shiftISO(iso, deltaDays) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/* ---------- Storage ---------- */

function loadEntries() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && typeof e.entryDate === "string" && typeof e.weight === "number")
      .map((e) => ({
        entryDate: e.entryDate,
        weight: e.weight,
        createdAt: typeof e.createdAt === "number" ? e.createdAt : Date.now(),
      }));
  } catch {
    return [];
  }
}

function saveEntries(nextEntries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextEntries));
}

/* ---------- Domain logic ---------- */

function sortByEntryDateAsc(list) {
  return [...list].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
}

function findEntryByDate(iso) {
  return entries.find((e) => e.entryDate === iso) || null;
}

function upsertEntry(entryDate, weight) {
  const next = entries.filter((e) => e.entryDate !== entryDate);
  next.push({ entryDate, weight, createdAt: Date.now() });
  entries = sortByEntryDateAsc(next);
  saveEntries(entries);
}

/* ---------- Input parsing ---------- */

function parseWeightInput(raw) {
  const normalized = raw.trim().replace(",", ".");
  if (!normalized) return null;

  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  if (n <= 0 || n > 1400) return null;

  return Math.round(n * 10) / 10;
}

/* ---------- UI state ---------- */

function setStatus(text) {
  els.statusText.textContent = text;
}

function setCheckState(state) {
  // state: "idle" | "active" | "saved" | "error"
  els.checkButton.classList.remove("is-active", "is-saved", "is-error");
  if (state === "active") els.checkButton.classList.add("is-active");
  if (state === "saved") els.checkButton.classList.add("is-saved");
  if (state === "error") els.checkButton.classList.add("is-error");
}

function renderDateLabel() {
  els.dateLabel.textContent = isoToMMDDYY(selectedISO);
}

function updateTodayColor() {
  const today = todayISODate();
  els.weightInput.classList.toggle("is-today", selectedISO === today);
}

function fillWeightForSelectedDate() {
  const e = findEntryByDate(selectedISO);
  if (!e) {
    els.weightInput.value = "";
    return;
  }
  els.weightInput.value = String(e.weight);
}

function renderChart() {
  const labels = entries.map((e) => isoToMMDDYY(e.entryDate));
  const data = entries.map((e) => e.weight);

  if (!chart) {
    chart = new Chart(els.chartCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            data,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: true },
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } },
          y: { grid: { display: false }, ticks: { maxTicksLimit: 5 } },
        },
      },
    });
    return;
  }

  chart.data.labels = labels;
  chart.data.datasets[0].data = data;
  chart.update();
}

function renderAll() {
  renderDateLabel();
  updateTodayColor();
  renderChart();
}

/* ---------- Swipe navigation ---------- */

function animateSwipe(dir, commitFn) {
  const cls = dir === "right" ? "slide-right" : "slide-left";
  els.swipeTrack.classList.add(cls);

  window.setTimeout(() => {
    els.swipeTrack.classList.remove(cls);
    commitFn();
  }, 140);
}

function shiftSelectedDay(deltaDays) {
  const next = shiftISO(selectedISO, deltaDays);
  if (isFutureISODate(next)) return; // block future
  selectedISO = next;
  renderAll();
  fillWeightForSelectedDate();
  setCheckState("idle");
  setStatus("");
}

function addSwipeNavigation() {
  let startX = 0;
  let startY = 0;
  let tracking = false;
  let locked = false;      // direction lock
  let lockDir = null;      // "h" | "v"

  const threshold = 38;    // swipe commit threshold
  const lockThreshold = 10;

  els.swipeStage.addEventListener("touchstart", (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    tracking = true;
    locked = false;
    lockDir = null;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  els.swipeStage.addEventListener("touchmove", (e) => {
    if (!tracking || !e.touches || e.touches.length !== 1) return;

    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const dx = x - startX;
    const dy = y - startY;

    if (!locked) {
      if (Math.abs(dx) < lockThreshold && Math.abs(dy) < lockThreshold) return;
      locked = true;
      lockDir = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
    }

    if (lockDir === "h") {
      // We are handling horizontal swipe; prevent page scroll
      e.preventDefault();

      els.swipeTrack.classList.remove("slide-left", "slide-right");
      if (dx > 12) els.swipeTrack.classList.add("slide-right");
      if (dx < -12) els.swipeTrack.classList.add("slide-left");
    }
  }, { passive: false });

  els.swipeStage.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;

    els.swipeTrack.classList.remove("slide-left", "slide-right");
    if (lockDir !== "h") return;

    const touch = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : null;
    if (!touch) return;

    const dx = touch.clientX - startX;

    if (Math.abs(dx) < threshold) return;

    // Rule:
    // swipe right -> previous day
    // swipe left  -> next day (future blocked)
    if (dx > 0) {
      animateSwipe("right", () => shiftSelectedDay(-1));
    } else {
      animateSwipe("left", () => shiftSelectedDay(+1));
    }
  }, { passive: true });
}

/* ---------- Save ---------- */

function saveCurrent() {
  setCheckState("idle");
  setStatus("");

  const weight = parseWeightInput(els.weightInput.value);
  if (weight === null) {
    setCheckState("error");
    setStatus("Invalid weight.");
    window.setTimeout(() => setCheckState("idle"), 700);
    return;
  }

  upsertEntry(selectedISO, weight);
  renderAll();

  setCheckState("saved");
  setStatus(`Saved ${weight} for ${isoToMMDDYY(selectedISO)}.`);
  window.setTimeout(() => setCheckState("idle"), 900);
}

/* ---------- Init ---------- */

function init() {
  entries = sortByEntryDateAsc(loadEntries());

  const today = todayISODate();
  selectedISO = today;

  // Optional seed data if empty (delete if you want a blank start)
  if (entries.length === 0) {
    const seed = [
      { entryDate: shiftISO(today, -14), weight: 184.6, createdAt: Date.now() },
      { entryDate: shiftISO(today, -10), weight: 183.9, createdAt: Date.now() },
      { entryDate: shiftISO(today, -7), weight: 183.2, createdAt: Date.now() },
      { entryDate: shiftISO(today, -3), weight: 182.8, createdAt: Date.now() },
    ];
    entries = sortByEntryDateAsc(seed);
    saveEntries(entries);
  }

  renderAll();
  fillWeightForSelectedDate();
  setCheckState("idle");

  // Checkmark save
  els.checkButton.addEventListener("click", saveCurrent);

  // Enter saves
  els.weightInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveCurrent();
  });

  // Input changes: activate check if valid
  els.weightInput.addEventListener("input", () => {
    const ok = parseWeightInput(els.weightInput.value) !== null;
    setCheckState(ok ? "active" : "idle");
    setStatus("");
  });

  // Swipe
  addSwipeNavigation();
}

init();
