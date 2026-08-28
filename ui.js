/**
 * Redlines: Spec Sheet — ui.js (iframe context, no direct `penpot` access)
 *
 * Собирает "спек-лист": клон выделенного элемента, размещённый рядом с оригиналом,
 * обвешанный замерами (ширина/высота/padding/gap — та же логика, что в Redlines: Measures)
 * и списком существующих аннотаций (если они есть — по данным Redlines: Annotations).
 * Итоговая SVG-выноска и позиция клона отправляются в plugin.js, который делает
 * shape.clone() + createShapeFromSvg + penpot.group().
 */

// ---------------------------------------------------------------------------
// Токены (та же логика сопоставления, что в Measures)
// ---------------------------------------------------------------------------

const TOKEN_MATCH_EPSILON = 0.5;

function matchToken(px, tokens) {
  if (!tokens || !tokens.length) return null;
  let best = null;
  let bestDiff = TOKEN_MATCH_EPSILON;
  tokens.forEach((t) => {
    const diff = Math.abs(t.resolvedValue - px);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = t;
    }
  });
  return best;
}

function formatPx(px) {
  const rounded = Math.round(px * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatLabel(px, tokens) {
  const token = matchToken(px, tokens);
  return token ? `${formatPx(px)}px (${token.name})` : `${formatPx(px)}px`;
}

// ---------------------------------------------------------------------------
// Замеры клона (ширина/высота/padding/gap) — портировано из Redlines: Measures
// ---------------------------------------------------------------------------

function measureDimensions(shape, tokens) {
  return [
    {
      kind: "line", orientation: "h",
      x1: shape.x, y1: shape.y + shape.height, x2: shape.x + shape.width, y2: shape.y + shape.height,
      label: formatLabel(shape.width, tokens),
    },
    {
      kind: "line", orientation: "v",
      x1: shape.x + shape.width, y1: shape.y, x2: shape.x + shape.width, y2: shape.y + shape.height,
      label: formatLabel(shape.height, tokens),
    },
  ];
}

function paddingLine(shape, side, value, tokens) {
  const midY = shape.y + shape.height / 2;
  const midX = shape.x + shape.width / 2;
  let geom;
  if (side === "top") geom = { x1: midX, y1: shape.y, x2: midX, y2: shape.y + value, orientation: "v" };
  if (side === "bottom") geom = { x1: midX, y1: shape.y + shape.height - value, x2: midX, y2: shape.y + shape.height, orientation: "v" };
  if (side === "left") geom = { x1: shape.x, y1: midY, x2: shape.x + value, y2: midY, orientation: "h" };
  if (side === "right") geom = { x1: shape.x + shape.width - value, y1: midY, x2: shape.x + shape.width, y2: midY, orientation: "h" };
  return { kind: "line", ...geom, label: formatLabel(value, tokens) };
}

function measurePadding(shape, tokens) {
  if (!shape.flex) return [];
  const f = shape.flex;
  const out = [];
  if (f.topPadding > 0) out.push(paddingLine(shape, "top", f.topPadding, tokens));
  if (f.rightPadding > 0) out.push(paddingLine(shape, "right", f.rightPadding, tokens));
  if (f.bottomPadding > 0) out.push(paddingLine(shape, "bottom", f.bottomPadding, tokens));
  if (f.leftPadding > 0) out.push(paddingLine(shape, "left", f.leftPadding, tokens));
  return out;
}

function measureGaps(shape, tokens) {
  if (!shape.flex || !shape.children || shape.children.length < 2) return [];
  const isColumn = shape.flex.dir === "column";
  const gapValue = isColumn ? shape.flex.rowGap : shape.flex.columnGap;
  if (!gapValue) return [];
  const sorted = [...shape.children].sort((a, b) => (isColumn ? a.y - b.y : a.x - b.x));
  const out = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (isColumn) {
      const midX = (Math.max(a.x, b.x) + Math.min(a.x + a.width, b.x + b.width)) / 2;
      const value = b.y - (a.y + a.height);
      out.push({ kind: "line", orientation: "v", x1: midX, y1: a.y + a.height, x2: midX, y2: b.y, label: formatLabel(value, tokens) });
    } else {
      const midY = (Math.max(a.y, b.y) + Math.min(a.y + a.height, b.y + b.height)) / 2;
      const value = b.x - (a.x + a.width);
      out.push({ kind: "line", orientation: "h", x1: a.x + a.width, y1: midY, x2: b.x, y2: midY, label: formatLabel(value, tokens) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Позиция клона относительно оригинала
// ---------------------------------------------------------------------------

function computeCloneOffset(shape, direction, gap) {
  if (direction === "below") {
    return { x: shape.x, y: shape.y + shape.height + gap };
  }
  return { x: shape.x + shape.width + gap, y: shape.y }; // 'right' (по умолчанию)
}

// ---------------------------------------------------------------------------
// Сборка полного списка элементов оверлея: замеры + заголовок + список аннотаций
// ---------------------------------------------------------------------------

function buildSpecElements(cloneBounds, tokens, annotations, options) {
  const opts = options || {};
  const elements = [];

  if (opts.showDimensions !== false) elements.push(...measureDimensions(cloneBounds, tokens));
  if (opts.showPadding !== false) elements.push(...measurePadding(cloneBounds, tokens));
  if (opts.showGaps !== false) elements.push(...measureGaps(cloneBounds, tokens));

  elements.push({
    kind: "title",
    x: cloneBounds.x,
    y: cloneBounds.y - 16,
    text: `${cloneBounds.name || "Элемент"} — Spec`,
  });

  if (opts.includeAnnotations !== false && annotations && annotations.length) {
    const lines = ["Аннотации:"].concat(annotations.map((a) => `${a.number}. ${a.text}`));
    elements.push({
      kind: "text-block",
      x: cloneBounds.x,
      y: cloneBounds.y + cloneBounds.height + 40,
      lines,
    });
  }

  return elements;
}

// ---------------------------------------------------------------------------
// Рендер SVG
// ---------------------------------------------------------------------------

const LINE_COLOR = "#FF3366";
const LABEL_BG = "#1A1A1E";
const LABEL_TEXT = "#FFFFFF";
const TITLE_COLOR = "#1A1A1E";
const BLOCK_TEXT_COLOR = "#1A1A1E";
const TICK = 4;
const OVERLAY_PADDING = 24;
const CHAR_W = 6.2;
const LINE_HEIGHT = 15;

function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function lineWithTicks(x1, y1, x2, y2, orientation) {
  const tickA = orientation === "h" ? `M${x1},${y1 - TICK} L${x1},${y1 + TICK}` : `M${x1 - TICK},${y1} L${x1 + TICK},${y1}`;
  const tickB = orientation === "h" ? `M${x2},${y2 - TICK} L${x2},${y2 + TICK}` : `M${x2 - TICK},${y2} L${x2 + TICK},${y2}`;
  return `<path d="M${x1},${y1} L${x2},${y2} ${tickA} ${tickB}" stroke="${LINE_COLOR}" stroke-width="1" fill="none"/>`;
}

function labelBadge(cx, cy, text) {
  const paddingX = 5, paddingY = 3, fontSize = 10;
  const w = Math.max(text.length * (CHAR_W - 0.6) + paddingX * 2, 20);
  const h = fontSize + paddingY * 2;
  const x = cx - w / 2, y = cy - h / 2;
  return (
    `<g><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="3" fill="${LABEL_BG}"/>` +
    `<text x="${cx.toFixed(1)}" y="${(cy + 3).toFixed(1)}" font-family="ui-monospace,Menlo,monospace" font-size="${fontSize}" ` +
    `fill="${LABEL_TEXT}" text-anchor="middle">${escapeXml(text)}</text></g>`
  );
}

function renderTitle(x, y, text) {
  return (
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="-apple-system,BlinkMacSystemFont,sans-serif" ` +
    `font-size="13" font-weight="700" fill="${TITLE_COLOR}">${escapeXml(text)}</text>`
  );
}

function renderTextBlock(x, y, lines) {
  const tspans = lines
    .map((line, i) => `<tspan x="${x.toFixed(1)}" ${i === 0 ? "" : `dy="${LINE_HEIGHT}"`}>${escapeXml(line)}</tspan>`)
    .join("");
  return (
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="-apple-system,BlinkMacSystemFont,sans-serif" ` +
    `font-size="12" fill="${BLOCK_TEXT_COLOR}">${tspans}</text>`
  );
}

function elementBounds(el) {
  if (el.kind === "line") {
    return { minX: Math.min(el.x1, el.x2), maxX: Math.max(el.x1, el.x2), minY: Math.min(el.y1, el.y2), maxY: Math.max(el.y1, el.y2) };
  }
  if (el.kind === "title") {
    const w = el.text.length * (CHAR_W + 1.2);
    return { minX: el.x, maxX: el.x + w, minY: el.y - 14, maxY: el.y + 4 };
  }
  if (el.kind === "text-block") {
    const longest = Math.max(...el.lines.map((l) => l.length), 1);
    const w = longest * CHAR_W;
    const h = el.lines.length * LINE_HEIGHT;
    return { minX: el.x, maxX: el.x + w, minY: el.y - 12, maxY: el.y + h };
  }
  return { minX: el.x, maxX: el.x, minY: el.y, maxY: el.y };
}

function buildOverlaySvg(elements) {
  if (!elements || !elements.length) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  elements.forEach((el) => {
    const b = elementBounds(el);
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minY = Math.min(minY, b.minY);
    maxY = Math.max(maxY, b.maxY);
  });
  minX -= OVERLAY_PADDING;
  minY -= OVERLAY_PADDING;
  maxX += OVERLAY_PADDING;
  maxY += OVERLAY_PADDING;
  const width = maxX - minX;
  const height = maxY - minY;

  const parts = elements.map((el) => {
    if (el.kind === "line") {
      const x1 = el.x1 - minX, y1 = el.y1 - minY, x2 = el.x2 - minX, y2 = el.y2 - minY;
      return lineWithTicks(x1, y1, x2, y2, el.orientation) + labelBadge((x1 + x2) / 2, (y1 + y2) / 2, el.label);
    }
    if (el.kind === "title") return renderTitle(el.x - minX, el.y - minY, el.text);
    if (el.kind === "text-block") return renderTextBlock(el.x - minX, el.y - minY, el.lines);
    return "";
  });

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(1)}" height="${height.toFixed(1)}" ` +
    `viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}">${parts.join("")}</svg>`;

  return { svg, anchor: { x: minX, y: minY } };
}


// ---------------------------------------------------------------------------
// UI-обвязка (iframe, обычный DOM). Не выполняется в Node без document.
// ---------------------------------------------------------------------------
if (typeof document !== "undefined") {

console.log("[Redlines: Spec Sheet] ui.js loaded");

const els = {
  targetInfo: document.getElementById("target-info"),
  refreshSelectionBtn: document.getElementById("refresh-selection-btn"),
  directionSelect: document.getElementById("direction-select"),
  gapInput: document.getElementById("gap-input"),
  optDimensions: document.getElementById("opt-dimensions"),
  optPadding: document.getElementById("opt-padding"),
  optGaps: document.getElementById("opt-gaps"),
  optAnnotations: document.getElementById("opt-annotations"),
  status: document.getElementById("status"),
  statusText: document.getElementById("status-text"),
  preview: document.getElementById("preview"),
  previewEmpty: document.getElementById("preview-empty"),
  createBtn: document.getElementById("create-btn"),
};

let target = null;
let tokens = [];
let tokensRequested = false;
let annotationsForTarget = [];
let currentOverlay = null;
let cloneOffset = null;

function setStatus(text, mode) {
  els.statusText.textContent = text;
  els.status.classList.toggle("is-loading", mode === "loading");
  els.status.classList.toggle("is-success", mode === "success");
  els.status.classList.toggle("is-error", mode === "error");
}

function currentOptions() {
  return {
    showDimensions: els.optDimensions.checked,
    showPadding: els.optPadding.checked,
    showGaps: els.optGaps.checked,
    includeAnnotations: els.optAnnotations.checked,
  };
}

function recompute() {
  if (!target) {
    currentOverlay = null;
    cloneOffset = null;
    els.preview.innerHTML = "";
    els.previewEmpty.style.display = "block";
    els.previewEmpty.textContent = "Выделите один элемент в макете.";
    els.createBtn.disabled = true;
    return;
  }

  const gap = Number(els.gapInput.value) || 80;
  cloneOffset = computeCloneOffset(target, els.directionSelect.value, gap);
  const cloneBounds = Object.assign({}, target, cloneOffset, { name: target.name, flex: target.flex, children: (target.children || []).map((c) => ({
    x: c.x - target.x + cloneOffset.x,
    y: c.y - target.y + cloneOffset.y,
    width: c.width,
    height: c.height,
  })) });

  const elements = buildSpecElements(cloneBounds, tokens, annotationsForTarget, currentOptions());
  currentOverlay = buildOverlaySvg(elements);

  if (!currentOverlay) {
    els.preview.innerHTML = "";
    els.previewEmpty.style.display = "block";
    els.previewEmpty.textContent = "Нечего показать — включите хотя бы одну опцию.";
    els.createBtn.disabled = true;
    return;
  }

  els.preview.innerHTML = currentOverlay.svg;
  els.previewEmpty.style.display = "none";
  els.createBtn.disabled = false;
}

[els.directionSelect, els.gapInput, els.optDimensions, els.optPadding, els.optGaps, els.optAnnotations].forEach((el) => {
  el.addEventListener("change", recompute);
  el.addEventListener("input", recompute);
});

els.refreshSelectionBtn.addEventListener("click", () => {
  setStatus("Обновляю выделение…", "loading");
  window.parent.postMessage({ type: "request-selection" }, "*");
});

els.createBtn.addEventListener("click", () => {
  if (!target || !currentOverlay || !cloneOffset) return;
  setStatus("Собираю Spec Sheet…", "loading");
  window.parent.postMessage(
    {
      type: "create-spec",
      targetId: target.id,
      offsetX: cloneOffset.x,
      offsetY: cloneOffset.y,
      overlaySvg: currentOverlay.svg,
      overlayAnchor: currentOverlay.anchor,
    },
    "*"
  );
});

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === "selection-data") {
    const shapes = msg.shapes || [];
    if (shapes.length === 1) {
      target = shapes[0];
      els.targetInfo.textContent = `Цель: ${target.name} (${Math.round(target.width)}×${Math.round(target.height)})`;
      setStatus("Выделен элемент: " + target.name, "success");
      window.parent.postMessage({ type: "request-annotations-for", targetId: target.id }, "*");
      if (!tokensRequested) {
        tokensRequested = true;
        window.parent.postMessage({ type: "request-tokens" }, "*");
      }
    } else {
      target = null;
      els.targetInfo.textContent = shapes.length === 0 ? "Выделите один элемент в макете." : "Выделено больше одного элемента — выберите ровно один.";
      if (shapes.length > 1) setStatus("Выделите ровно один элемент.", "error");
    }
    recompute();
    return;
  }
  if (msg.type === "selection-error") {
    setStatus("Ошибка получения выделения: " + msg.message, "error");
    return;
  }
  if (msg.type === "annotations-for-data") {
    annotationsForTarget = msg.annotations || [];
    recompute();
    return;
  }
  if (msg.type === "tokens-data") {
    tokens = msg.tokens || [];
    recompute();
    return;
  }
  if (msg.type === "tokens-error") {
    console.warn("[Redlines: Spec Sheet] tokens-error:", msg.message);
    return;
  }
  if (msg.type === "create-spec-result") {
    if (msg.ok) setStatus("Spec Sheet создан.", "success");
    else setStatus("Не удалось создать Spec Sheet: " + msg.message, "error");
  }
});

window.parent.postMessage({ type: "request-selection" }, "*");
recompute();

} // end DOM guard

if (typeof module !== "undefined") {
  module.exports = {
    matchToken, formatPx, formatLabel,
    measureDimensions, measurePadding, measureGaps,
    computeCloneOffset, buildSpecElements, buildOverlaySvg,
  };
}
