/**
 * Redlines: Spec Sheet — plugin.js (sandbox context)
 *
 * Единственное место с доступом к `penpot`. По запросу от ui.js:
 *  - "request-selection"           -> геометрия текущего выделения (для выбора цели)
 *  - "request-annotations-for"     -> существующие аннотации (Redlines: Annotations),
 *                                      привязанные к конкретной фигуре (ddx-target-id)
 *  - "request-tokens"              -> spacing-подобные токены (для подписей замеров)
 *  - "create-spec"                 -> shape.clone() + createShapeFromSvg(оверлей) +
 *                                      penpot.group() в одну фигуру спек-листа
 */

console.log("[Redlines: Spec Sheet] plugin.js loaded");

penpot.ui.open("Redlines: Spec Sheet", "index.html", { width: 420, height: 700 });

const SPACING_LIKE_TYPES = new Set(["spacing", "dimension", "sizing", "borderRadius", "borderWidth"]);
const DDX_ANNOTATION = "ddx-annotation";
const DDX_NUMBER = "ddx-number";
const DDX_TEXT = "ddx-text";
const DDX_TARGET_ID = "ddx-target-id";
const DDX_SPEC_SHEET = "ddx-spec-sheet";
const DDX_SPEC_SOURCE_ID = "ddx-spec-source-id";

// ---------------------------------------------------------------------------
// Обход дерева фигур текущей страницы
// ---------------------------------------------------------------------------

function walkTree(shape, cb) {
  if (!shape) return;
  cb(shape);
  (shape.children || []).forEach((child) => walkTree(child, cb));
}

function findShapeById(id) {
  let found = null;
  walkTree(penpot.root, (shape) => {
    if (!found && shape.id === id) found = shape;
  });
  return found;
}

function safeGetData(shape, key) {
  try {
    return shape.getPluginData(key);
  } catch (e) {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Сканирование
// ---------------------------------------------------------------------------

function serializeFlex(shape) {
  try {
    if (!shape.flex) return null;
    return {
      topPadding: shape.flex.topPadding,
      rightPadding: shape.flex.rightPadding,
      bottomPadding: shape.flex.bottomPadding,
      leftPadding: shape.flex.leftPadding,
      columnGap: shape.flex.columnGap,
      rowGap: shape.flex.rowGap,
      dir: shape.flex.dir,
    };
  } catch (e) {
    return null;
  }
}

function serializeShape(shape) {
  return {
    id: shape.id,
    name: shape.name,
    type: shape.type,
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
    flex: serializeFlex(shape),
    children: (shape.children || []).map((c) => ({ x: c.x, y: c.y, width: c.width, height: c.height })),
  };
}

function scanSelection() {
  return (penpot.selection || []).map(serializeShape);
}

function scanAnnotationsFor(targetId) {
  const out = [];
  walkTree(penpot.root, (shape) => {
    if (safeGetData(shape, DDX_ANNOTATION) === "true" && safeGetData(shape, DDX_TARGET_ID) === targetId) {
      out.push({ number: Number(safeGetData(shape, DDX_NUMBER)), text: safeGetData(shape, DDX_TEXT) });
    }
  });
  out.sort((a, b) => a.number - b.number);
  return out;
}

function serializeSpacingTokens() {
  const catalog = penpot.library.local.tokens;
  if (!catalog || !catalog.sets) return [];
  const out = [];
  catalog.sets.forEach((set) => {
    set.tokens.forEach((t) => {
      if (SPACING_LIKE_TYPES.has(t.type) && typeof t.resolvedValue === "number") {
        out.push({ name: t.name, set: set.name, type: t.type, resolvedValue: t.resolvedValue });
      }
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Создание спек-листа
// ---------------------------------------------------------------------------

function createSpec(msg) {
  const original = findShapeById(msg.targetId);
  if (!original) {
    throw new Error("Исходная фигура не найдена (возможно, выделение изменилось).");
  }
  if (typeof original.clone !== "function") {
    throw new Error("Эта фигура не поддерживает клонирование (shape.clone недоступен).");
  }

  const clone = original.clone();
  clone.x = msg.offsetX;
  clone.y = msg.offsetY;

  const overlayGroup = penpot.createShapeFromSvg(msg.overlaySvg);
  if (!overlayGroup) {
    throw new Error("Penpot не смог создать фигуры из SVG-оверлея (createShapeFromSvg вернул null).");
  }
  if (msg.overlayAnchor && typeof overlayGroup.x === "number") {
    overlayGroup.x = msg.overlayAnchor.x;
    overlayGroup.y = msg.overlayAnchor.y;
  }

  const specGroup = penpot.group([clone, overlayGroup]);
  if (!specGroup) {
    throw new Error("Не удалось сгруппировать клон и оверлей (penpot.group вернул null).");
  }
  specGroup.name = `${original.name || "Element"} — Spec Sheet`;
  specGroup.setPluginData(DDX_SPEC_SHEET, "true");
  specGroup.setPluginData(DDX_SPEC_SOURCE_ID, original.id);

  return { id: specGroup.id };
}

// ---------------------------------------------------------------------------
// Роутинг сообщений
// ---------------------------------------------------------------------------

penpot.ui.onMessage((message) => {
  if (!message || !message.type) return;
  console.log("[Redlines: Spec Sheet] plugin.js received message:", message.type);

  try {
    if (message.type === "request-selection") {
      penpot.ui.sendMessage({ type: "selection-data", shapes: scanSelection() });
      return;
    }
    if (message.type === "request-annotations-for") {
      penpot.ui.sendMessage({ type: "annotations-for-data", annotations: scanAnnotationsFor(message.targetId) });
      return;
    }
    if (message.type === "request-tokens") {
      penpot.ui.sendMessage({ type: "tokens-data", tokens: serializeSpacingTokens() });
      return;
    }
    if (message.type === "create-spec") {
      const result = createSpec(message);
      penpot.ui.sendMessage({ type: "create-spec-result", ok: true, ...result });
    }
  } catch (err) {
    console.error("[Redlines: Spec Sheet] handler failed:", err);
    penpot.ui.sendMessage({ type: message.type + "-result", ok: false, message: String((err && err.message) || err) });
  }
});
