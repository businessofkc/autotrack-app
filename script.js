const N8N_CREATE_FILTER_URL = "https://n8n-production-ea51e.up.railway.app/webhook/25e0bf3a-647a-4ba3-918d-2dbf9fdfc30a";
const N8N_GET_STATISTICS_URL = "https://n8n-production-ea51e.up.railway.app/webhook/a639d7ad-a5f4-4d28-af1e-a5b591c6e9c9";
const N8N_WORKFLOW_CONTROL_URL = "https://n8n-production-ea51e.up.railway.app/webhook/3ad2930e-986e-4029-a6e5-c12d874b4057";

const MODEL_URL_MAP_API_URL = "https://script.google.com/macros/s/AKfycbyHhpA-NUSzPfeBzmum_wdYnDlQQU2150EMFVbIckmvLPxdQYbMlIesW_heb-jveMQoiA/exec";

const WORKFLOW_AUTO_REFRESH_MS = 15000;

let modelUrlMap = [];
let modelsByBrand = {};
let selectedFilterId = "";
const pollingControllers = new Map();
let workflowRefreshTimer = null;
let workflowsLoading = false;

const brandSelect = document.getElementById("brand");
const modelSelect = document.getElementById("model");
const yearFrom = document.getElementById("yearFrom");
const yearTo = document.getElementById("yearTo");
const filterForm = document.getElementById("filterForm");
const filtersTable = document.querySelector(".filters-table");
const filterFeedback = document.getElementById("filterFeedback");

const statsTitle = document.getElementById("statsTitle");
const statsSubtitle = document.getElementById("statsSubtitle");
const refreshSelectedStatsBtn = document.getElementById("refreshSelectedStatsBtn");
const statsEmptyState = document.getElementById("statsEmptyState");
const priceBarChart = document.getElementById("priceBarChart");
const priceLineChart = document.getElementById("priceLineChart");
const historyLineSvg = document.getElementById("historyLineSvg");
const historyTooltip = document.getElementById("historyTooltip");
const statsUpdatedLabel = document.getElementById("statsUpdatedLabel");

function normalizeModelValue(value) {
  if (value === null || value === undefined) return "";

  const text = String(value).trim();

  if (/^\d+\.0$/.test(text)) {
    return text.replace(/\.0$/, "");
  }

  return text;
}

function buildModelsByBrand(rows) {
  return rows.reduce((acc, item) => {
    const brand = normalizeModelValue(item.brand);
    const model = normalizeModelValue(item.model);

    if (!brand || !model) return acc;
    if (!acc[brand]) acc[brand] = [];

    const alreadyExists = acc[brand].some(existing => existing.model === model);
    if (alreadyExists) return acc;

    acc[brand].push({
      brand,
      model,
      autogidas_url: item.autogidas_url || "",
      autoplius_url: item.autoplius_url || "",
      mobile_de_url: item.mobile_de_url || ""
    });

    return acc;
  }, {});
}

async function loadModelUrlMap() {
  if (!MODEL_URL_MAP_API_URL || MODEL_URL_MAP_API_URL.includes("PAKEISK_I")) {
    throw new Error("Neįdėtas Google Apps Script Web App URL į MODEL_URL_MAP_API_URL.");
  }

  const response = await fetch(`${MODEL_URL_MAP_API_URL}?action=modelUrlMap`, {
    method: "GET",
    cache: "no-store"
  });

  const rawResult = await parseJsonResponse(response);
  const result = normalizeApiResult(rawResult);

  if (!response.ok || result.success === false) {
    throw new Error(result.message || "Nepavyko gauti ModelUrlMap duomenų.");
  }

  modelUrlMap = Array.isArray(result.data) ? result.data : [];
  modelsByBrand = buildModelsByBrand(modelUrlMap);
}

function fillYears() {
  if (!yearFrom || !yearTo || yearFrom.options.length || yearTo.options.length) return;

  const currentYear = new Date().getFullYear();

  for (let year = currentYear; year >= 1985; year--) {
    yearFrom.appendChild(new Option(year, year));
    yearTo.appendChild(new Option(year, year));
  }

  yearFrom.value = "2016";
  yearTo.value = String(currentYear);
}

function fillBrands() {
  if (!brandSelect) return;

  const currentValue = brandSelect.value;
  brandSelect.innerHTML = '<option value="">Pasirinkite markę</option>';

  Object.keys(modelsByBrand)
    .sort((a, b) => a.localeCompare(b, "lt"))
    .forEach(brand => {
      brandSelect.appendChild(new Option(brand, brand));
    });

  if (currentValue && modelsByBrand[currentValue]) {
    brandSelect.value = currentValue;
  }
}

function fillModels(brand) {
  if (!modelSelect) return;

  modelSelect.innerHTML = '<option value="">Pasirinkite modelį</option>';
  modelSelect.disabled = !brand;

  if (!brand || !modelsByBrand[brand]) return;

  modelsByBrand[brand]
    .slice()
    .sort((a, b) => a.model.localeCompare(b.model, "lt", { numeric: true }))
    .forEach(item => {
      const option = new Option(item.model, item.model);
      option.dataset.autogidasUrl = item.autogidas_url || "";
      option.dataset.autopliusUrl = item.autoplius_url || "";
      option.dataset.mobileDeUrl = item.mobile_de_url || "";
      modelSelect.appendChild(option);
    });
}

function getSelectedModelData(brand, model) {
  return (modelsByBrand[brand] || []).find(item => item.model === model) || null;
}

function setFilterFeedback(message, type = "info") {
  if (!filterFeedback) {
    if (type === "error" || type === "duplicate") alert(message);
    return;
  }

  filterFeedback.textContent = message;
  filterFeedback.className = `filter-feedback ${type}`;
}

function clearFilterFeedback() {
  if (!filterFeedback) return;

  filterFeedback.textContent = "";
  filterFeedback.className = "filter-feedback";
}

function clearFieldErrors() {
  [brandSelect, modelSelect, yearFrom, yearTo].forEach(field => {
    if (!field) return;
    field.classList.remove("field-error");
    field.removeAttribute("aria-invalid");
  });
}

function setFieldError(field, message) {
  clearFieldErrors();

  if (field) {
    field.classList.add("field-error");
    field.setAttribute("aria-invalid", "true");
    field.focus();
  }

  setFilterFeedback(message, "error");
}

function setSubmitLoading(isLoading) {
  if (!filterForm) return;

  const submitButton = filterForm.querySelector("button[type='submit']");
  if (!submitButton) return;

  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Kuriama..." : "Kurti filtrą";
}

async function parseJsonResponse(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch (error) {
    return {
      success: false,
      message: text || "n8n grąžino neteisingą atsakymą."
    };
  }
}

function normalizeApiResult(result) {
  return Array.isArray(result) ? (result[0] || {}) : (result || {});
}

function normalizeFilterId(value) {
  let text = String(value || "").trim();

  // Apsauga nuo neteisingai n8n response body sugrąžinto '=FILTER-...'
  if (text.startsWith("=FILTER-")) {
    text = text.slice(1);
  }

  // Apsauga nuo literal n8n expression teksto.
  if (text.includes("{{") || text.includes("$json")) {
    return "";
  }

  return text;
}

function removeEmptyRows() {
  if (!filtersTable) return;
  filtersTable.querySelectorAll(".empty-row").forEach(row => row.remove());
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatEuro(value) {
  if (value === null || value === undefined || value === "") return "—";

  const number = Number(value);
  if (!Number.isFinite(number)) return "—";

  return new Intl.NumberFormat("lt-LT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0
  }).format(number);
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";

  return new Intl.NumberFormat("lt-LT", {
    maximumFractionDigits: 0
  }).format(number);
}

function formatDateTime(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("lt-LT", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setStatsLoading(isLoading) {
  if (refreshSelectedStatsBtn) {
    refreshSelectedStatsBtn.disabled = isLoading || !selectedFilterId;
    refreshSelectedStatsBtn.textContent = isLoading
      ? "Tikrinama statistika..."
      : "Patikrinti / atnaujinti statistiką";
  }

  document.querySelectorAll(".refresh-stats-btn").forEach(button => {
    button.disabled = isLoading;
  });
}

function showStatsMessage(message, details = "") {
  if (statsEmptyState) {
    statsEmptyState.hidden = false;
    statsEmptyState.innerHTML = `
      <strong>${escapeHtml(message)}</strong>
      <p>${escapeHtml(details || "Sukurkite filtrą arba pasirinkite filtrą ir patikrinkite statistiką.")}</p>
    `;
  }

  if (priceBarChart) priceBarChart.hidden = true;
  if (priceLineChart) priceLineChart.hidden = true;
}

function getFilterRow(filterId) {
  if (!filtersTable || !filterId) return null;
  return filtersTable.querySelector(`[data-filter-id="${CSS.escape(filterId)}"]`);
}

function updateFilterRowStatus(filterId, label, status = "pending") {
  const row = getFilterRow(filterId);
  if (!row) return;

  const badge = row.querySelector(".filter-status-badge");
  if (!badge) return;

  badge.textContent = label;
  badge.className = `badge filter-status-badge ${status}`;
}

function markFilterAsSelected(filterId) {
  selectedFilterId = filterId || selectedFilterId;

  document.querySelectorAll(".filter-data-row").forEach(row => {
    row.classList.toggle("selected", row.dataset.filterId === selectedFilterId);
  });

  if (refreshSelectedStatsBtn) {
    refreshSelectedStatsBtn.disabled = !selectedFilterId;
  }
}

function numberFromHistoryPoint(point, key) {
  const value = Number(point?.[key]);
  return Number.isFinite(value) ? value : null;
}

function normalizeHistory(history, stats) {
  const normalized = Array.isArray(history)
    ? history
        .map(item => ({
          created_at: item.created_at || item.date || item.updated_at || "",
          min_price: numberFromHistoryPoint(item, "min_price"),
          avg_price: numberFromHistoryPoint(item, "avg_price"),
          max_price: numberFromHistoryPoint(item, "max_price"),
          listing_count: numberFromHistoryPoint(item, "listing_count")
        }))
        .filter(item => item.created_at && item.min_price !== null && item.avg_price !== null && item.max_price !== null)
    : [];

  if (normalized.length > 0) return normalized;

  const fallbackStats = stats || {};
  const minPrice = Number(fallbackStats.min_price);
  const avgPrice = Number(fallbackStats.avg_price);
  const maxPrice = Number(fallbackStats.max_price);
  const listingCount = Number(fallbackStats.listing_count);

  if ([minPrice, avgPrice, maxPrice].every(Number.isFinite)) {
    return [{
      created_at: new Date().toISOString(),
      min_price: minPrice,
      avg_price: avgPrice,
      max_price: maxPrice,
      listing_count: Number.isFinite(listingCount) ? listingCount : 0
    }];
  }

  return [];
}

function buildPolyline(points) {
  return points.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
}

function renderHistoryLineChart(history) {
  if (!priceLineChart || !historyLineSvg) return;

  const width = 920;
  const height = 340;
  const padding = { top: 28, right: 34, bottom: 56, left: 78 };

  historyLineSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  historyLineSvg.innerHTML = "";

  if (!history.length) {
    priceLineChart.hidden = true;
    return;
  }

  const values = history.flatMap(item => [item.min_price, item.avg_price, item.max_price]).filter(Number.isFinite);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = Math.max(1, maxValue - minValue);

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const xFor = index => {
    if (history.length === 1) return padding.left + plotWidth / 2;
    return padding.left + (index / (history.length - 1)) * plotWidth;
  };

  const yFor = value => padding.top + plotHeight - ((value - minValue) / range) * plotHeight;

  const makeSvg = (tag, attrs = {}) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  };

  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (plotHeight / 4) * i;
    const value = maxValue - (range / 4) * i;

    historyLineSvg.appendChild(makeSvg("line", {
      x1: padding.left,
      y1: y,
      x2: width - padding.right,
      y2: y,
      class: "history-grid-line"
    }));

    const label = makeSvg("text", {
      x: padding.left - 12,
      y: y + 4,
      class: "history-axis-label",
      "text-anchor": "end"
    });
    label.textContent = formatEuro(value);
    historyLineSvg.appendChild(label);
  }

  const series = [
    { key: "min_price", label: "Min", className: "line-min" },
    { key: "avg_price", label: "Vidurkis", className: "line-avg" },
    { key: "max_price", label: "Maks", className: "line-max" }
  ];

  series.forEach(item => {
    const points = history.map((row, index) => ({
      x: xFor(index),
      y: yFor(Number(row[item.key]))
    }));

    const polyline = makeSvg("polyline", {
      points: buildPolyline(points),
      class: `history-line ${item.className}`
    });

    historyLineSvg.appendChild(polyline);

    points.forEach((point, index) => {
      const circle = makeSvg("circle", {
        cx: point.x,
        cy: point.y,
        r: 5,
        class: `history-dot ${item.className}`,
        tabindex: "0"
      });

      circle.addEventListener("mouseenter", () => showHistoryTooltip(history[index], point.x, point.y));
      circle.addEventListener("focus", () => showHistoryTooltip(history[index], point.x, point.y));
      circle.addEventListener("mouseleave", hideHistoryTooltip);
      circle.addEventListener("blur", hideHistoryTooltip);

      historyLineSvg.appendChild(circle);
    });
  });

  const firstDate = history[0]?.created_at;
  const lastDate = history[history.length - 1]?.created_at;

  if (firstDate) {
    const label = makeSvg("text", {
      x: padding.left,
      y: height - 20,
      class: "history-axis-label",
      "text-anchor": "start"
    });
    label.textContent = formatDateTime(firstDate);
    historyLineSvg.appendChild(label);
  }

  if (lastDate && lastDate !== firstDate) {
    const label = makeSvg("text", {
      x: width - padding.right,
      y: height - 20,
      class: "history-axis-label",
      "text-anchor": "end"
    });
    label.textContent = formatDateTime(lastDate);
    historyLineSvg.appendChild(label);
  }

  if (history.length === 1) {
    const label = makeSvg("text", {
      x: width / 2,
      y: height - 20,
      class: "history-axis-label",
      "text-anchor": "middle"
    });
    label.textContent = "Pirmas istorijos taškas";
    historyLineSvg.appendChild(label);
  }

  priceLineChart.hidden = false;
}

function showHistoryTooltip(point, x, y) {
  if (!historyTooltip || !priceLineChart) return;

  historyTooltip.innerHTML = `
    <strong>${escapeHtml(formatDateTime(point.created_at))}</strong>
    <div><span>Min</span><b>${formatEuro(point.min_price)}</b></div>
    <div><span>Vidurkis</span><b>${formatEuro(point.avg_price)}</b></div>
    <div><span>Maks</span><b>${formatEuro(point.max_price)}</b></div>
    <div><span>Skelbimų</span><b>${formatNumber(point.listing_count)}</b></div>
  `;

  const chartRect = priceLineChart.getBoundingClientRect();
  const svgRect = historyLineSvg.getBoundingClientRect();
  const left = ((x / 920) * svgRect.width) + (svgRect.left - chartRect.left);
  const top = ((y / 340) * svgRect.height) + (svgRect.top - chartRect.top);

  historyTooltip.style.left = `${Math.min(Math.max(12, left + 14), chartRect.width - 240)}px`;
  historyTooltip.style.top = `${Math.max(12, top - 20)}px`;
  historyTooltip.hidden = false;
}

function hideHistoryTooltip() {
  if (historyTooltip) historyTooltip.hidden = true;
}

function renderStatistics(rawResult) {
  const result = normalizeApiResult(rawResult);
  const stats = result.stats || {};

  const minPrice = Number(stats.min_price || 0);
  const avgPrice = Number(stats.avg_price || 0);
  const maxPrice = Number(stats.max_price || 0);
  const listingCount = Number(stats.listing_count || 0);
  const history = normalizeHistory(result.history, stats);

  if (statsTitle) {
    const titleBrand = result.brand || "";
    const titleModel = result.model || "";
    statsTitle.textContent = `${titleBrand} ${titleModel} kainų statistika`.trim() || "Kainų statistika";
  }

  if (statsSubtitle) {
    const yearRange = result.year_from && result.year_to
      ? `${result.year_from}–${result.year_to}`
      : "pasirinktas intervalas";

    const historyLabel = history.length === 1
      ? "1 istorijos taškas"
      : `${history.length} istorijos taškai`;

    statsSubtitle.textContent = `${yearRange} · ${result.source || "autogidas"} · ${listingCount} skelb. · ${historyLabel}`;
  }

  setText("minPriceValue", formatEuro(minPrice));
  setText("avgPriceValue", formatEuro(avgPrice));
  setText("maxPriceValue", formatEuro(maxPrice));
  setText("listingCountValue", formatNumber(listingCount));

  renderHistoryLineChart(history);

  if (statsEmptyState) statsEmptyState.hidden = true;
  if (priceBarChart) priceBarChart.hidden = true;

  if (statsUpdatedLabel) {
    statsUpdatedLabel.textContent = `Atnaujinta: ${formatDateTime(result.updated_at)} ↻`;
  }
}

async function fetchStatistics(filterId) {
  const response = await fetch(N8N_GET_STATISTICS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ filter_id: filterId })
  });

  const result = normalizeApiResult(await parseJsonResponse(response));

  return {
    ok: response.ok,
    result
  };
}

async function loadStatistics(filterId, options = {}) {
  const cleanFilterId = normalizeFilterId(filterId);

  if (!cleanFilterId) {
    showStatsMessage("Trūksta filtro ID.", "Svetainė negavo tikro filtro ID iš n8n atsakymo.");
    return false;
  }

  markFilterAsSelected(cleanFilterId);
  setStatsLoading(true);
  showStatsMessage("Statistika kraunama...", "Tikrinami Google Sheets duomenys per 03 workflow.");

  try {
    const { ok, result } = await fetchStatistics(cleanFilterId);

    if (!ok || result.success === false) {
      showStatsMessage(result.message || "Statistikos šiam filtrui dar nėra.", "Jeigu scraper workflow dar veikia, pabandykite dar kartą po kelių sekundžių.");
      return false;
    }

    renderStatistics(result);
    updateFilterRowStatus(cleanFilterId, "Statistika paruošta", "ready");

    if (options.scroll !== false) {
      const statsSection = document.getElementById("stats");
      if (statsSection) {
        statsSection.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }

    return true;
  } catch (error) {
    console.error(error);
    showStatsMessage("Nepavyko gauti statistikos iš n8n webhook.", "Patikrinkite 03 workflow Production URL ir CORS nustatymus.");
    return false;
  } finally {
    setStatsLoading(false);
  }
}

async function waitForStatistics(filterId, options = {}) {
  const cleanFilterId = normalizeFilterId(filterId);
  if (!cleanFilterId) return false;

  const previousController = pollingControllers.get(cleanFilterId);
  if (previousController) previousController.abort = true;

  const controller = { abort: false };
  pollingControllers.set(cleanFilterId, controller);

  const attempts = options.attempts || 36;
  const delayMs = options.delayMs || 5000;

  markFilterAsSelected(cleanFilterId);
  showStatsMessage("Renkami duomenys...", "Autogidas scraper workflow paleistas. Statistika bus parodyta automatiškai, kai 02 workflow įrašys duomenis į Google Sheets.");

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (controller.abort) return false;

    updateFilterRowStatus(cleanFilterId, `Renkami duomenys (${attempt}/${attempts})`, "pending");

    try {
      const { ok, result } = await fetchStatistics(cleanFilterId);

      if (ok && result.success === true) {
        renderStatistics(result);
        updateFilterRowStatus(cleanFilterId, "Statistika paruošta", "ready");
        pollingControllers.delete(cleanFilterId);
        return true;
      }
    } catch (error) {
      console.warn("Statistics polling failed", error);
    }

    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  updateFilterRowStatus(cleanFilterId, "Dar ruošiama", "pending");
  showStatsMessage("Duomenys dar ruošiami.", "02 workflow dar gali veikti. Spauskite „Patikrinti statistiką“ po kelių minučių.");
  pollingControllers.delete(cleanFilterId);
  return false;
}

function resetStatisticsIfSelected(filterId) {
  if (selectedFilterId !== filterId) return;

  selectedFilterId = "";
  if (refreshSelectedStatsBtn) refreshSelectedStatsBtn.disabled = true;

  setText("minPriceValue", "—");
  setText("avgPriceValue", "—");
  setText("maxPriceValue", "—");
  setText("listingCountValue", "—");

  if (statsTitle) statsTitle.textContent = "Kainų statistika";
  if (statsSubtitle) statsSubtitle.textContent = "Pasirinkite sukurtą filtrą ir spauskite „Patikrinti statistiką“.";
  if (statsUpdatedLabel) statsUpdatedLabel.textContent = "Atnaujinta: —";

  showStatsMessage("Filtras pašalintas iš vaizdo.", "Tai tik frontend veiksmas. Google Sheets įrašas nebuvo ištrintas.");
}

function addFilterRow(filterId, brand, model, from, to, options = {}) {
  if (!filtersTable) return null;

  const cleanFilterId = normalizeFilterId(filterId);
  removeEmptyRows();

  if (cleanFilterId) {
    const existingRow = getFilterRow(cleanFilterId);
    if (existingRow) {
      updateFilterRowStatus(cleanFilterId, options.statusLabel || "Esamas filtras", options.status || "existing");
      markFilterAsSelected(cleanFilterId);
      return existingRow;
    }
  }

  const row = document.createElement("div");
  row.className = "table-row filter-data-row";
  row.dataset.filterId = cleanFilterId || "";

  const statusLabel = options.statusLabel || "Renkami duomenys";
  const status = options.status || "pending";
  const safeFilterId = escapeHtml(cleanFilterId || "");

  row.innerHTML = `
    <span>${escapeHtml(brand)} ${escapeHtml(model)}</span>
    <span>${escapeHtml(from)}–${escapeHtml(to)}</span>
    <span class="filter-id-text" title="${safeFilterId}">${safeFilterId || "Laukiama ID"}</span>
    <span class="badge filter-status-badge ${status}">${escapeHtml(statusLabel)}</span>
    <span class="filter-actions">
      <button type="button" class="btn btn-secondary stats-action-btn refresh-stats-btn" data-filter-id="${safeFilterId}">
        Patikrinti statistiką
      </button>
      <button type="button" class="btn btn-secondary stats-action-btn delete-filter-btn" data-filter-id="${safeFilterId}">
        Ištrinti filtrą
      </button>
    </span>
  `;

  filtersTable.appendChild(row);

  row.addEventListener("click", event => {
    if (event.target.closest("button")) return;
    if (cleanFilterId) {
      markFilterAsSelected(cleanFilterId);
      loadStatistics(cleanFilterId);
    }
  });

  const refreshButton = row.querySelector(".refresh-stats-btn");
  if (refreshButton) {
    refreshButton.addEventListener("click", () => loadStatistics(cleanFilterId));
  }

  const deleteButton = row.querySelector(".delete-filter-btn");
  if (deleteButton) {
    deleteButton.addEventListener("click", () => {
      if (cleanFilterId && pollingControllers.has(cleanFilterId)) {
        pollingControllers.get(cleanFilterId).abort = true;
        pollingControllers.delete(cleanFilterId);
      }

      row.remove();
      resetStatisticsIfSelected(cleanFilterId);
    });
  }

  if (cleanFilterId && !selectedFilterId) {
    markFilterAsSelected(cleanFilterId);
  }

  return row;
}

if (brandSelect) {
  brandSelect.addEventListener("change", () => {
    fillModels(brandSelect.value);
    clearFilterFeedback();
  });
}

if (filterForm) {
  filterForm.addEventListener("submit", async event => {
    event.preventDefault();
    clearFieldErrors();
    clearFilterFeedback();

    const brand = brandSelect?.value || "";
    const model = modelSelect?.value || "";
    const from = Number(yearFrom?.value);
    const to = Number(yearTo?.value);

    if (!brand) {
      setFieldError(brandSelect, "Pasirink automobilio markę.");
      return;
    }

    if (!model) {
      setFieldError(modelSelect, "Pasirink automobilio modelį.");
      return;
    }

    if (!from) {
      setFieldError(yearFrom, "Pasirink metus nuo.");
      return;
    }

    if (!to) {
      setFieldError(yearTo, "Pasirink metus iki.");
      return;
    }

    if (from > to) {
      setFieldError(yearFrom, "Metai nuo negali būti didesni už metus iki.");
      return;
    }

    const selectedModelData = getSelectedModelData(brand, model);

    const payload = {
      brand,
      model,
      year_from: from,
      year_to: to,
      autogidas_url: selectedModelData?.autogidas_url || "",
      autoplius_url: selectedModelData?.autoplius_url || "",
      mobile_de_url: selectedModelData?.mobile_de_url || "",
      created_by: window.autoTrackCurrentUserEmail || "website"
    };

    setSubmitLoading(true);
    setFilterFeedback("Filtras siunčiamas į n8n...", "info");

    try {
      const response = await fetch(N8N_CREATE_FILTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const result = normalizeApiResult(await parseJsonResponse(response));

      if (response.status === 409 || result.duplicate) {
        const existingFilterId = normalizeFilterId(result.existing_filter_id || result.filter_id);

        setFilterFeedback(result.message || "Toks aktyvus filtras jau egzistuoja. Įkeliu jo statistiką.", "duplicate");

        if (existingFilterId) {
          addFilterRow(existingFilterId, brand, model, from, to, {
            statusLabel: "Esamas filtras",
            status: "existing"
          });

          await loadStatistics(existingFilterId);
        } else {
          setFilterFeedback("Filtras jau egzistuoja, bet n8n negrąžino tikro filter_id.", "error");
        }

        return;
      }

      if (!response.ok || result.success === false) {
        setFilterFeedback(result.message || "Nepavyko sukurti filtro.", "error");
        return;
      }

      const filterId = normalizeFilterId(result.filter_id || result.existing_filter_id);

      if (!filterId) {
        setFilterFeedback("Filtras sukurtas, bet n8n negrąžino filter_id.", "error");
        return;
      }

      addFilterRow(filterId, brand, model, from, to, {
        statusLabel: "Renkami duomenys",
        status: "pending"
      });

      filterForm.reset();
      fillModels("");
      yearFrom.value = "2016";
      yearTo.value = String(new Date().getFullYear());

      setFilterFeedback("Filtras sukurtas. Duomenys renkami automatiškai, statistika atsiras kai 02 workflow baigs darbą.", "success");

      const createdFilters = document.getElementById("createdFilters");
      if (createdFilters) {
        createdFilters.scrollIntoView({ behavior: "smooth", block: "center" });
      }

      waitForStatistics(filterId);
    } catch (error) {
      console.error(error);
      setFilterFeedback("Nepavyko prisijungti prie n8n webhook. Patikrinkite Production URL, workflow aktyvumą ir CORS nustatymus.", "error");
    } finally {
      setSubmitLoading(false);
    }
  });
}

[brandSelect, modelSelect, yearFrom, yearTo].forEach(field => {
  if (!field) return;

  field.addEventListener("change", () => {
    field.classList.remove("field-error");
    field.removeAttribute("aria-invalid");
    clearFilterFeedback();
  });
});

if (refreshSelectedStatsBtn) {
  refreshSelectedStatsBtn.textContent = "Patikrinti / atnaujinti statistiką";
  refreshSelectedStatsBtn.addEventListener("click", () => {
    if (!selectedFilterId) {
      showStatsMessage("Pasirinkite filtrą iš sukurtų filtrų lentelės.");
      return;
    }

    loadStatistics(selectedFilterId);
  });
}

function workflowIcon(type, name) {
  const normalized = String(type || name || '').toLowerCase();

  if (normalized.includes('scraper')) return '◎';
  if (normalized.includes('frontend')) return '⌘';
  if (normalized.includes('stat')) return '↗';

  return '▤';
}

function setWorkflowFeedback(message, type = 'info') {
  const element = document.getElementById('workflowFeedback');
  if (!element) return;

  element.textContent = message || '';
  element.className = `workflow-feedback ${type}`;
}

function normalizeWorkflowList(result) {
  const data = normalizeApiResult(result);
  return Array.isArray(data.workflows) ? data.workflows : [];
}

function updateWorkflowSummary(workflows) {
  const active = workflows.filter(workflow => workflow.enabled).length;
  const inactive = workflows.length - active;

  setText('workflowActiveCount', formatNumber(active));
  setText('workflowInactiveCount', formatNumber(inactive));
  setText('workflowTotalCount', formatNumber(workflows.length));

  const systemStatusTitle = document.getElementById('workflowSystemStatusTitle');
  const systemStatusText = document.getElementById('workflowSystemStatusText');

  if (systemStatusTitle) {
    systemStatusTitle.innerHTML = inactive === 0
      ? '<i></i> Viskas veikia'
      : '<i></i> Yra išjungtų workflow';
  }

  if (systemStatusText) {
    const refreshedAt = formatDateTime(new Date().toISOString());
    const refreshInfo = `Automatinis atnaujinimas kas ${Math.round(WORKFLOW_AUTO_REFRESH_MS / 1000)} sek. · Atnaujinta: ${refreshedAt}`;

    systemStatusText.textContent = inactive === 0
      ? `Visi workflow šiuo metu įjungti. ${refreshInfo}`
      : `Išjungta workflow: ${inactive}. ${refreshInfo}`;
  }
}

function renderWorkflowList(workflows) {
  const list = document.getElementById('workflowList');
  if (!list) return;

  list.innerHTML = '';

  if (!workflows.length) {
    list.innerHTML = `
      <div class="workflow-empty-state">
        <strong>Nėra workflow duomenų</strong>
        <p>Patikrinkite 04 - Workflow Control API ir Google Sheets lentelę.</p>
      </div>
    `;
    updateWorkflowSummary([]);
    return;
  }

  workflows.forEach(workflow => {
    const enabled = Boolean(workflow.enabled);
    const row = document.createElement('div');
    row.className = `workflow-item dynamic-workflow-item ${enabled ? 'is-on' : 'is-off'}`;
    row.dataset.workflowId = workflow.id;

    row.innerHTML = `
      <div class="workflow-copy">
        <span class="workflow-icon">${escapeHtml(workflowIcon(workflow.type, workflow.name))}</span>
        <div>
          <strong>${escapeHtml(workflow.name || `Workflow ${workflow.id}`)}</strong>
          <p>${escapeHtml(workflow.description || 'Aprašymas nepateiktas.')}</p>
          <small class="workflow-meta">Tipas: ${escapeHtml(workflow.type || '—')} · Atnaujinta: ${escapeHtml(formatDateTime(workflow.updated_at))}</small>
        </div>
      </div>
      <span class="status-pill ${enabled ? 'on' : 'off'}">${enabled ? 'ON' : 'OFF'}</span>
      <label class="switch" title="Įjungti / išjungti workflow">
        <input type="checkbox" ${enabled ? 'checked' : ''}>
        <span></span>
      </label>
    `;

    const input = row.querySelector('input[type="checkbox"]');
    input.addEventListener('change', () => toggleWorkflow(workflow, input, row));

    list.appendChild(row);
  });

  updateWorkflowSummary(workflows);
}

async function fetchWorkflowControl(payload) {
  const response = await fetch(N8N_WORKFLOW_CONTROL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const result = normalizeApiResult(await parseJsonResponse(response));

  if (!response.ok || result.success === false) {
    throw new Error(result.message || 'Workflow Control API grąžino klaidą.');
  }

  return result;
}

function setWorkflowRowLoading(row, isLoading) {
  if (!row) return;

  const input = row.querySelector('input[type="checkbox"]');
  const pill = row.querySelector('.status-pill');

  if (input) input.disabled = isLoading;

  row.classList.toggle('is-loading', isLoading);

  if (pill && isLoading) {
    pill.textContent = '...';
    pill.classList.remove('on', 'off');
    pill.classList.add('pending');
  }
}

function updateWorkflowRowVisual(row, enabled) {
  if (!row) return;

  const input = row.querySelector('input[type="checkbox"]');
  const pill = row.querySelector('.status-pill');

  row.classList.toggle('is-on', enabled);
  row.classList.toggle('is-off', !enabled);

  if (input) {
    input.checked = enabled;
    input.disabled = false;
  }

  if (pill) {
    pill.textContent = enabled ? 'ON' : 'OFF';
    pill.className = `status-pill ${enabled ? 'on' : 'off'}`;
  }
}

async function toggleWorkflow(workflow, input, row) {
  const nextEnabled = input.checked;
  const action = nextEnabled ? 'activate' : 'deactivate';
  const previousEnabled = !nextEnabled;

  setWorkflowRowLoading(row, true);
  setWorkflowFeedback(`${workflow.name} ${nextEnabled ? 'įjungiamas' : 'išjungiamas'}...`, 'info');

  try {
    const result = await fetchWorkflowControl({
      action,
      id: workflow.id
    });

    const enabled = Boolean(result.enabled ?? nextEnabled);
    updateWorkflowRowVisual(row, enabled);
    setWorkflowFeedback(`${workflow.name} ${enabled ? 'įjungtas' : 'išjungtas'}.`, 'success');

    await loadWorkflows({ silent: true });
  } catch (error) {
    console.error(error);
    updateWorkflowRowVisual(row, previousEnabled);
    setWorkflowFeedback(error.message || 'Nepavyko pakeisti workflow būsenos.', 'error');
  }
}

async function loadWorkflows(options = {}) {
  const list = document.getElementById('workflowList');
  if (!list) return;

  if (workflowsLoading) return;
  workflowsLoading = true;

  if (!options.silent) {
    list.innerHTML = `
      <div class="workflow-empty-state">
        <strong>Kraunami workflow...</strong>
        <p>Skaitoma Google Sheets WorkflowControl lentelė per 04 workflow.</p>
      </div>
    `;
    setWorkflowFeedback('Workflow būsenos kraunamos...', 'info');
  }

  try {
    const result = await fetchWorkflowControl({ action: 'list' });
    const workflows = normalizeWorkflowList(result);
    renderWorkflowList(workflows);

    if (!options.silent) {
      setWorkflowFeedback('Workflow būsenos atnaujintos.', 'success');
    } else if (options.auto) {
      setWorkflowFeedback(`Būsenos automatiškai atnaujintos: ${formatDateTime(new Date().toISOString())}.`, 'info');
    }
  } catch (error) {
    console.error(error);
    if (list) {
      list.innerHTML = `
        <div class="workflow-empty-state error">
          <strong>Nepavyko užkrauti workflow</strong>
          <p>${escapeHtml(error.message || 'Patikrinkite 04 workflow Production URL.')}</p>
        </div>
      `;
    }
    setWorkflowFeedback(error.message || 'Nepavyko užkrauti workflow būsenų.', 'error');
  } finally {
    workflowsLoading = false;
  }
}

function startWorkflowAutoRefresh() {
  if (!document.getElementById('workflowList')) return;
  if (workflowRefreshTimer) window.clearInterval(workflowRefreshTimer);

  workflowRefreshTimer = window.setInterval(() => {
    if (document.hidden) return;
    loadWorkflows({ silent: true, auto: true });
  }, WORKFLOW_AUTO_REFRESH_MS);
}

async function initializePage() {
  if (!filterForm) return;

  fillYears();

  if (modelSelect) {
    modelSelect.disabled = true;
  }

  try {
    setFilterFeedback('Markės ir modeliai kraunami iš Google Sheets...', 'info');
    await loadModelUrlMap();
    fillBrands();
    fillModels(brandSelect?.value || '');
    clearFilterFeedback();
  } catch (error) {
    console.error(error);
    setFilterFeedback(error.message || 'Nepavyko užkrauti markių ir modelių iš Google Sheets.', 'error');
  }
}

initializePage();

if (document.getElementById('workflowList')) {
  loadWorkflows();
  startWorkflowAutoRefresh();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      loadWorkflows({ silent: true, auto: true });
    }
  });
}
