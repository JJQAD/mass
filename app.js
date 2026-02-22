"use strict";

const STORAGE_KEY = "mass_entries_v1";
const RANGES = ["7d", "1m", "6m", "1y"];
const DEFAULT_RANGE = "7d";

const RANGE_CONFIG = {
  "7d": { days: 7, label: "week", tickEvery: 1 },
  "1m": { days: 30, label: "month", tickEvery: 5 },
  "6m": { days: 182, label: "6 months", tickEvery: 28 },
  "1y": { days: 365, label: "year", tickEvery: 56 },
};

const els = {
  dateLabel: document.getElementById("dateLabel"),
  weightInput: document.getElementById("weightInput"),
  statusText: document.getElementById("statusText"),
  chartCanvas: document.getElementById("chart"),
  swipeStage: document.getElementById("swipeStage"),
  swipeTrack: document.getElementById("swipeTrack"),
  rangeLabel: document.getElementById("rangeLabel"),
  rangeSwipeStage: document.getElementById("rangeSwipeStage"),
  rangeSwipeTrack: document.getElementById("rangeSwipeTrack"),
};

let chart = null;
let entries = [];
let selectedISO = null;
let selectedRange = DEFAULT_RANGE;
let showGrid = true;

function todayISODate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoToMMDDYY(iso) {
  const [y, m, d] = iso.split("-");
  return `${m}.${d}.${y.slice(2)}`;
}

function shiftISO(iso, deltaDays) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function isFutureISODate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const selected = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return selected.getTime() > today.getTime();
}

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

function saveEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function sortEntries() {
  entries.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
}

function findEntry(iso) {
  return entries.find((e) => e.entryDate === iso) || null;
}

function upsertEntry(iso, weight) {
  entries = entries.filter((e) => e.entryDate !== iso);
  entries.push({ entryDate: iso, weight, createdAt: Date.now() });
  sortEntries();
  saveEntries();
}

function parseWeight(raw) {
  const normalized = raw.trim().replace(",", ".");
  if (!normalized) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0 || n > 1400) return null;
  return Math.round(n * 10) / 10;
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function autoSaveIfValid({ quiet = true } = {}) {
  const value = els.weightInput.value.trim();
  if (!value) {
    if (!quiet) setStatus("");
    return false;
  }

  const weight = parseWeight(value);
  if (weight === null) {
    if (!quiet) setStatus("Invalid weight.");
    return false;
  }

  upsertEntry(selectedISO, weight);
  renderChart();

  if (!quiet) setStatus("");
  return true;
}

function renderDate() {
  els.dateLabel.textContent = isoToMMDDYY(selectedISO);
}

function updateTodayColor() {
  els.weightInput.classList.toggle("is-today", selectedISO === todayISODate());
}

function fillWeightForSelectedDate() {
  const entry = findEntry(selectedISO);
  els.weightInput.value = entry ? String(entry.weight) : "";
}

function renderRangeLabel() {
  els.rangeLabel.textContent = RANGE_CONFIG[selectedRange].label;
}

function stepRange(delta) {
  const idx = RANGES.indexOf(selectedRange);
  const nextIdx = Math.min(RANGES.length - 1, Math.max(0, idx + delta));
  if (nextIdx === idx) return false;
  selectedRange = RANGES[nextIdx];
  renderRangeLabel();
  renderChart();
  return true;
}

function getSeries(endISO, rangeKey) {
  const { days, tickEvery } = RANGE_CONFIG[rangeKey] || RANGE_CONFIG[DEFAULT_RANGE];
  const dayList = [];
  for (let i = days - 1; i >= 0; i--) dayList.push(shiftISO(endISO, -i));

  const map = new Map(entries.map((e) => [e.entryDate, e.weight]));

  const values = [];
  let last = null;
  for (const iso of dayList) {
    const v = map.has(iso) ? map.get(iso) : null;
    if (typeof v === "number") {
      last = v;
      values.push(v);
    } else {
      values.push(last);
    }
  }

  const labels = dayList.map((iso, idx) => {
    if (idx !== 0 && idx !== dayList.length - 1 && idx % tickEvery !== 0) return "";
    const [, m, d] = iso.split("-");
    return `${Number(m)}/${Number(d)}`;
  });

  const numeric = values.filter((v) => typeof v === "number");
  const dataMin = numeric.length ? Math.min(...numeric) : 170;
  const dataMax = numeric.length ? Math.max(...numeric) : 171;

  return { labels, values, dataMin, dataMax };
}

function computeAxis(dataMin, dataMax) {
  let range = dataMax - dataMin;
  if (range < 1) range = 1;
  const yMax = Math.ceil(dataMax + range * 0.22);
  const yMin = Math.floor(yMax - range * 3);
  const step = 1;
  return { yMin, yMax, step };
}

function computeGridLineWidth(value) {
  if (!Number.isFinite(value)) return 0.5;
  if (value % 10 === 0) return 1.4;
  if (value % 5 === 0) return 1;
  return 0.45;
}

function renderChart() {
  const series = getSeries(selectedISO, selectedRange);
  const axis = computeAxis(series.dataMin, series.dataMax);
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#e23b1f";

  const dataset = {
    data: series.values,
    borderColor: accent,
    borderWidth: 0,
    pointRadius: 0,
    tension: 0.2,
    fill: true,
    spanGaps: true,
    backgroundColor: accent,
  };

  if (!chart) {
    chart = new Chart(els.chartCanvas, {
      type: "line",
      data: { labels: series.labels, datasets: [dataset] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            grid: {
              display: showGrid,
              color: "rgba(255,255,255,0.92)",
              lineWidth: 0.45,
            },
            border: { display: false },
            ticks: { color: "#6b6b6b", maxRotation: 0, autoSkip: false },
          },
          y: {
            grid: {
              display: showGrid,
              color: "rgba(255,255,255,0.92)",
              lineWidth(context) {
                return computeGridLineWidth(context.tick.value);
              },
            },
            border: { display: false },
            min: axis.yMin,
            max: axis.yMax,
            ticks: {
              color: "#6b6b6b",
              stepSize: axis.step,
              maxTicksLimit: Math.min(14, Math.ceil(axis.yMax - axis.yMin) + 1),
            },
          },
        },
      },
    });
    return;
  }

  chart.data.labels = series.labels;
  chart.data.datasets[0] = dataset;
  chart.options.scales.x.grid.display = showGrid;
  chart.options.scales.y.grid.display = showGrid;
  chart.options.scales.y.min = axis.yMin;
  chart.options.scales.y.max = axis.yMax;
  chart.options.scales.y.ticks.stepSize = axis.step;
  chart.options.scales.y.ticks.maxTicksLimit = Math.min(14, Math.ceil(axis.yMax - axis.yMin) + 1);
  chart.update();
}

function renderAll() {
  renderDate();
  updateTodayColor();
  fillWeightForSelectedDate();
  renderRangeLabel();
  renderChart();
}

function shiftDay(delta) {
  const next = shiftISO(selectedISO, delta);
  if (isFutureISODate(next)) return;
  selectedISO = next;
  renderAll();
}

function addSwipe() {
  const touchsurface = els.swipeStage;
  const track = els.swipeTrack;

  const threshold = 70;
  const restraint = 90;
  const allowedTime = 450;

  let startX = 0;
  let startY = 0;
  let distX = 0;
  let distY = 0;
  let startTime = 0;
  let locked = false;
  let lockDir = null;

  function setTranslate(px) {
    track.style.transition = "none";
    track.style.transform = `translateX(${px}px)`;
  }

  function snapBack() {
    track.style.transition = "transform 180ms ease-out";
    track.style.transform = "translateX(0px)";
  }

  function commitSwipe(dir) {
    const width = touchsurface.clientWidth || 320;
    const off = dir === "left" ? -width : width;

    track.style.transition = "transform 160ms ease-out";
    track.style.transform = `translateX(${off}px)`;

    window.setTimeout(() => {
      autoSaveIfValid({ quiet: true });
      if (dir === "right") shiftDay(-1);
      else shiftDay(+1);

      track.style.transition = "none";
      track.style.transform = `translateX(${-off}px)`;

      window.setTimeout(() => {
        track.style.transition = "transform 160ms ease-out";
        track.style.transform = "translateX(0px)";
      }, 16);
    }, 165);
  }

  touchsurface.addEventListener("touchstart", (e) => {
    if (!e.changedTouches || e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0];
    startX = t.pageX;
    startY = t.pageY;
    distX = 0;
    distY = 0;
    startTime = Date.now();
    locked = false;
    lockDir = null;
  }, { passive: true });

  touchsurface.addEventListener("touchmove", (e) => {
    if (!e.changedTouches || e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0];
    distX = t.pageX - startX;
    distY = t.pageY - startY;

    if (!locked) {
      if (Math.abs(distX) < 10 && Math.abs(distY) < 10) return;
      locked = true;
      lockDir = Math.abs(distX) > Math.abs(distY) ? "h" : "v";
    }

    if (lockDir === "h") {
      e.preventDefault();
      setTranslate(distX);
    }
  }, { passive: false });

  touchsurface.addEventListener("touchend", () => {
    const elapsedTime = Date.now() - startTime;
    const absX = Math.abs(distX);
    const absY = Math.abs(distY);

    if (elapsedTime <= allowedTime && absX >= threshold && absY <= restraint) {
      commitSwipe(distX < 0 ? "left" : "right");
      return;
    }

    snapBack();
  }, { passive: true });

  touchsurface.addEventListener("touchcancel", snapBack, { passive: true });
}

function addRangeSwipe() {
  const touchsurface = els.rangeSwipeStage;
  const track = els.rangeSwipeTrack;

  const threshold = 60;
  const restraint = 90;
  const allowedTime = 450;

  let startX = 0;
  let startY = 0;
  let distX = 0;
  let distY = 0;
  let startTime = 0;
  let locked = false;
  let lockDir = null;

  function setTranslate(px) {
    track.style.transition = "none";
    track.style.transform = `translateX(${px}px)`;
  }

  function snapBack() {
    track.style.transition = "transform 160ms ease-out";
    track.style.transform = "translateX(0px)";
  }

  function commitSwipe(dir) {
    const width = touchsurface.clientWidth || 260;
    const off = dir === "left" ? -width : width;

    track.style.transition = "transform 140ms ease-out";
    track.style.transform = `translateX(${off}px)`;

    window.setTimeout(() => {
      if (dir === "left") stepRange(+1);
      else stepRange(-1);

      track.style.transition = "none";
      track.style.transform = `translateX(${-off}px)`;

      window.setTimeout(() => {
        track.style.transition = "transform 140ms ease-out";
        track.style.transform = "translateX(0px)";
      }, 16);
    }, 145);
  }

  touchsurface.addEventListener("touchstart", (e) => {
    if (!e.changedTouches || e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0];
    startX = t.pageX;
    startY = t.pageY;
    distX = 0;
    distY = 0;
    startTime = Date.now();
    locked = false;
    lockDir = null;
  }, { passive: true });

  touchsurface.addEventListener("touchmove", (e) => {
    if (!e.changedTouches || e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0];
    distX = t.pageX - startX;
    distY = t.pageY - startY;

    if (!locked) {
      if (Math.abs(distX) < 8 && Math.abs(distY) < 8) return;
      locked = true;
      lockDir = Math.abs(distX) > Math.abs(distY) ? "h" : "v";
    }

    if (lockDir === "h") {
      e.preventDefault();
      setTranslate(distX);
    }
  }, { passive: false });

  touchsurface.addEventListener("touchend", () => {
    const elapsedTime = Date.now() - startTime;
    const absX = Math.abs(distX);
    const absY = Math.abs(distY);

    if (elapsedTime <= allowedTime && absX >= threshold && absY <= restraint) {
      commitSwipe(distX < 0 ? "left" : "right");
      return;
    }

    snapBack();
  }, { passive: true });

  touchsurface.addEventListener("touchcancel", snapBack, { passive: true });
}

function seedDummyDataIfEmpty() {
  if (entries.length > 0) return;
  const end = todayISODate();
  const seeded = [];
  const totalDays = 365;
  const startWeight = 210;
  const endWeight = 180;

  for (let i = totalDays - 1; i >= 0; i--) {
    const iso = shiftISO(end, -i);
    const dayIndex = totalDays - 1 - i;
    const progress = dayIndex / (totalDays - 1);
    const trend = startWeight + (endWeight - startWeight) * progress;
    const waveA = Math.sin(dayIndex / 11) * 1.6;
    const waveB = Math.sin(dayIndex / 33) * 0.9;
    const jitter = (Math.random() - 0.5) * 0.8;
    const weight = Math.max(170, Math.min(214, trend + waveA + waveB + jitter));
    seeded.push({ entryDate: iso, weight: Math.round(weight * 10) / 10, createdAt: Date.now() });
  }

  entries = seeded;
  sortEntries();
  saveEntries();
}

function init() {
  entries = loadEntries();
  sortEntries();
  seedDummyDataIfEmpty();

  selectedISO = todayISODate();
  selectedRange = DEFAULT_RANGE;
  renderAll();

  els.weightInput.addEventListener("blur", () => autoSaveIfValid({ quiet: false }));
  els.weightInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") els.weightInput.blur();
  });

  addSwipe();
  addRangeSwipe();

  els.chartCanvas.addEventListener("click", () => {
    showGrid = !showGrid;
    renderChart();
  });
}

init();
