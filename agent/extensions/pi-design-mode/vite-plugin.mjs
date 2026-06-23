import path from 'node:path';

function escapeAttr(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function lineStartsOf(code) {
  const starts = [0];
  for (let i = 0; i < code.length; i += 1) {
    if (code.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function positionFor(starts, index) {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (starts[mid] <= index) low = mid + 1;
    else high = mid - 1;
  }
  const lineIndex = Math.max(0, high);
  return { line: lineIndex + 1, column: index - starts[lineIndex] + 1 };
}

function nearestComponentName(code, index) {
  const prefix = code.slice(0, index);
  const patterns = [
    /(?:export\s+)?function\s+([A-Z][A-Za-z0-9_$]*)\s*\(/g,
    /(?:export\s+)?(?:const|let|var)\s+([A-Z][A-Za-z0-9_$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/g,
    /(?:export\s+)?(?:const|let|var)\s+([A-Z][A-Za-z0-9_$]*)\s*=\s*(?:forwardRef|memo|React\.forwardRef|React\.memo)\s*\(/g,
  ];
  let best = { index: -1, name: '' };
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(prefix))) {
      if (match.index > best.index) best = { index: match.index, name: match[1] };
    }
  }
  return best.name || path.basename('component');
}

function isNameStart(ch) {
  return /[A-Za-z]/.test(ch);
}

const hostTags = new Set([
  'a','abbr','address','area','article','aside','audio','b','base','bdi','bdo','blockquote','body','br','button','canvas','caption','cite','code','col','colgroup','data','datalist','dd','del','details','dfn','dialog','div','dl','dt','em','embed','fieldset','figcaption','figure','footer','form','h1','h2','h3','h4','h5','h6','head','header','hgroup','hr','html','i','iframe','img','input','ins','kbd','label','legend','li','link','main','map','mark','menu','meta','meter','nav','noscript','object','ol','optgroup','option','output','p','picture','portal','pre','progress','q','rp','rt','ruby','s','samp','script','search','section','select','slot','small','source','span','strong','style','sub','summary','sup','table','tbody','td','template','textarea','tfoot','th','thead','time','title','tr','track','u','ul','var','video','wbr',
  'svg','animate','animateMotion','animateTransform','circle','clipPath','defs','desc','ellipse','feBlend','feColorMatrix','feComponentTransfer','feComposite','feConvolveMatrix','feDiffuseLighting','feDisplacementMap','feDistantLight','feDropShadow','feFlood','feFuncA','feFuncB','feFuncG','feFuncR','feGaussianBlur','feImage','feMerge','feMergeNode','feMorphology','feOffset','fePointLight','feSpecularLighting','feSpotLight','feTile','feTurbulence','filter','foreignObject','g','image','line','linearGradient','marker','mask','metadata','mpath','path','pattern','polygon','polyline','radialGradient','rect','set','stop','switch','symbol','text','textPath','tspan','use','view'
]);

function isNameChar(ch) {
  return /[A-Za-z0-9:_.$-]/.test(ch);
}

function isCustomComponentTag(tag) {
  if (tag === 'Fragment' || tag === 'React.Fragment' || tag === 'Comp') return false;
  return /^[A-Z][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(tag);
}

function isLikelyJsxStart(code, index) {
  const before = code.slice(0, index).replace(/\s+$/g, '');
  if (!before) return true;
  if (/\breturn$/.test(before)) return true;
  const last = before.at(-1) || '';
  return '({[=,:;!&|?>'.includes(last);
}

function isProbablyInsideStringOrComment(code, index) {
  // Cheap guard: enough for avoiding most JSX-in-string false positives without parsing TS.
  const lineStart = code.lastIndexOf('\n', index - 1) + 1;
  const before = code.slice(lineStart, index);
  const single = (before.match(/'/g) || []).length;
  const double = (before.match(/"/g) || []).length;
  const tick = (before.match(/`/g) || []).length;
  if (single % 2 || double % 2 || tick % 2) return true;
  const comment = before.indexOf('//');
  return comment !== -1;
}

function injectSourceAttributes(code, id, projectRoot) {
  const rel = path.relative(projectRoot, id).replaceAll(path.sep, '/');
  const starts = lineStartsOf(code);
  const edits = [];

  for (let i = 0; i < code.length - 1; i += 1) {
    if (code[i] !== '<') continue;
    const next = code[i + 1];
    if (!isNameStart(next)) continue;
    if (isProbablyInsideStringOrComment(code, i)) continue;

    let nameEnd = i + 2;
    while (nameEnd < code.length && isNameChar(code[nameEnd])) nameEnd += 1;
    const tag = code.slice(i + 1, nameEnd);
    const isHostTag = hostTags.has(tag);
    const isCustomTag = isCustomComponentTag(tag) && isLikelyJsxStart(code, i);
    if (!tag || tag.includes(':') || (!isHostTag && !isCustomTag)) continue;
    if (isCustomTag && code.slice(nameEnd).trimStart().startsWith('<')) continue;

    let j = nameEnd;
    let quote = '';
    let braceDepth = 0;
    for (; j < code.length; j += 1) {
      const ch = code[j];
      if (quote) {
        if (ch === '\\') j += 1;
        else if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch === '{') {
        braceDepth += 1;
        continue;
      }
      if (ch === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
        continue;
      }
      if (ch === '>' && braceDepth === 0) break;
    }
    if (j >= code.length) continue;

    const openTag = code.slice(i, j + 1);
    if (openTag.includes('data-pi-source=')) continue;

    const pos = positionFor(starts, i);
    const component = isCustomTag ? tag.split('.').at(-1) : nearestComponentName(code, i);
    const attrs =
      ` data-pi-source="${escapeAttr(`${rel}:${pos.line}:${pos.column}`)}"` +
      ` data-pi-component="${escapeAttr(component)}"` +
      ` data-pi-tag="${escapeAttr(tag)}"`;
    const insertAt = code[j - 1] === '/' ? j - 1 : j;
    edits.push({ index: insertAt, text: attrs });
    i = j;
  }

  if (!edits.length) return null;
  let out = code;
  for (let i = edits.length - 1; i >= 0; i -= 1) {
    const edit = edits[i];
    out = out.slice(0, edit.index) + edit.text + out.slice(edit.index);
  }
  return { code: out, map: null };
}

function clientScript({ bridgeUrl, token }) {
  const runtime = function piDesignModeRuntime(bridgeUrl, token) {
    if (window.__PI_DESIGN_MODE__) return;
    window.__PI_DESIGN_MODE__ = true;
    let selecting = false;
    let altActive = false;
    let current = null;
    let selectedPayload = null;
    let currentTargets = [];
    let suppressNextClick = false;
    let referencePollId = 0;
    let pointCycle = { x: -1, y: -1, index: -1 };
    let bridgeOnline = false;
    let bridgeStatus = 'Bridge unknown';
    let refsProgressStartedAt = 0;
    let refsProgressTimer = 0;
    let refsProgressDetail = null;

    const style = document.createElement('style');
    style.textContent = '.pi-design-outline{position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #22c55e;background:transparent;box-shadow:0 0 0 1px rgba(34,197,94,.75);border-radius:4px;display:none}'
      + '.pi-design-chip{position:fixed;z-index:2147483647;pointer-events:none;background:#0b1220;color:#e5e7eb;border:1px solid rgba(34,197,94,.65);box-shadow:0 10px 30px rgba(0,0,0,.35);border-radius:8px;padding:6px 8px;font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;max-width:min(720px,calc(100vw - 24px));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:none}'
      + '.pi-design-badge{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;border:1px solid rgba(255,255,255,.18);background:rgba(15,23,42,.92);color:white;border-radius:999px;padding:8px 14px;font:600 13px system-ui,-apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 8px 25px rgba(0,0,0,.25);cursor:pointer;user-select:none}'
      + '.pi-design-badge[data-selecting="true"]{border-color:rgba(34,197,94,.75)}'
      + '.pi-design-target-box{position:fixed;z-index:2147483645;pointer-events:none;border:1.5px solid rgba(96,165,250,.85);background:transparent;border-radius:4px;box-shadow:0 0 0 1px rgba(15,23,42,.18)}'
      + '.pi-design-target-box[data-selected="true"]{border-color:#22c55e;background:transparent;box-shadow:0 0 0 1px rgba(34,197,94,.75)}'
      + '.pi-design-target-label{position:absolute;left:-1px;top:-20px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#1d4ed8;color:white;font:700 11px/18px ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;text-align:center;box-shadow:0 3px 12px rgba(0,0,0,.25);pointer-events:auto;cursor:pointer}'
      + '.pi-design-target-box[data-selected="true"] .pi-design-target-label{background:#16a34a}'
      + '.pi-design-panel{position:fixed;right:20px;bottom:92px;z-index:2147483647;display:none;width:min(560px,calc(100vw - 40px));max-height:min(420px,calc(100vh - 160px));overflow:auto;background:rgba(15,23,42,.96);color:#e5e7eb;border:1px solid rgba(34,197,94,.55);border-radius:12px;box-shadow:0 18px 45px rgba(0,0,0,.35);font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}'
      + '.pi-design-panel-header{position:sticky;top:0;background:rgba(15,23,42,.98);display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.12);font:700 12px system-ui,-apple-system,BlinkMacSystemFont,sans-serif}'
      + '.pi-design-section{padding:8px 10px 4px;color:#93c5fd;font:700 11px system-ui,-apple-system,BlinkMacSystemFont,sans-serif;text-transform:uppercase;letter-spacing:.04em}'
      + '.pi-design-ref{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid rgba(255,255,255,.08);background:transparent;color:#d1d5db;padding:8px 10px;cursor:pointer;font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}'
      + '.pi-design-ref:hover{background:rgba(34,197,94,.14);color:white}'
      + '.pi-design-ref[aria-current="true"]{background:rgba(34,197,94,.18);color:white}'
      + '.pi-design-ref-path{color:#86efac;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      + '.pi-design-ref-text{color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      + '.pi-design-progress{display:flex;align-items:center;gap:8px;color:#fbbf24}'
      + '.pi-design-spinner{width:12px;height:12px;border:2px solid rgba(251,191,36,.25);border-top-color:#fbbf24;border-radius:999px;animation:pi-design-spin .75s linear infinite;display:inline-block;flex:0 0 auto}'
      + '@keyframes pi-design-spin{to{transform:rotate(360deg)}}'
      + '.pi-design-pulse{animation:pi-design-pulse 1s ease-in-out infinite}'
      + '@keyframes pi-design-pulse{0%,100%{opacity:.45}50%{opacity:1}}'
      + '.pi-design-ask{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;display:none;gap:8px;width:min(720px,calc(100vw - 32px));background:rgba(15,23,42,.94);border:1px solid rgba(34,197,94,.55);border-radius:12px;padding:10px;box-shadow:0 18px 45px rgba(0,0,0,.35)}'
      + '.pi-design-ask input{flex:1;min-width:0;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:rgba(255,255,255,.08);color:white;padding:9px 10px;font:13px system-ui,-apple-system,BlinkMacSystemFont,sans-serif;outline:none}'
      + '.pi-design-ask button{border:0;border-radius:8px;background:#22c55e;color:#052e16;font:700 13px system-ui,-apple-system,BlinkMacSystemFont,sans-serif;padding:9px 12px;cursor:pointer}';
    document.documentElement.appendChild(style);

    const outline = document.createElement('div');
    outline.className = 'pi-design-outline';
    const chip = document.createElement('div');
    chip.className = 'pi-design-chip';
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'pi-design-badge';
    const targetLayer = document.createElement('div');
    const refPanel = document.createElement('div');
    refPanel.className = 'pi-design-panel';
    const ask = document.createElement('form');
    ask.className = 'pi-design-ask';
    const askInput = document.createElement('input');
    askInput.placeholder = 'Ask Pi about selected element…';
    const askButton = document.createElement('button');
    askButton.type = 'submit';
    askButton.textContent = 'Ask';
    ask.append(askInput, askButton);
    document.documentElement.append(outline, chip, badge, targetLayer, refPanel, ask);

    function isSelectorActive() {
      return selecting || altActive;
    }

    function updateBadge() {
      const active = isSelectorActive();
      badge.dataset.selecting = String(active);
      const modeText = active ? (altActive && !selecting ? '◐ Hold Select' : '● Selector on') : '○ Browse mode';
      badge.textContent = modeText + ' · ' + (bridgeOnline ? 'Bridge on' : 'Bridge off');
      badge.title = bridgeOnline
        ? 'Bridge connected. Click to toggle. Hold Option/Alt to select temporarily. Esc clears selection.'
        : 'Bridge offline. Run /design-connect ' + token.replace('deck-dev-', '') + ' in Pi, then hard reload if needed.';
    }

    async function checkBridgeHealth() {
      try {
        const response = await fetch(bridgeUrl + '/health?token=' + encodeURIComponent(token), { cache: 'no-store' });
        if (response.ok || response.status === 404) {
          bridgeOnline = true;
          bridgeStatus = response.ok ? 'Bridge connected' : 'Bridge connected (legacy)';
        } else {
          bridgeOnline = false;
          bridgeStatus = 'Bridge rejected health check: ' + response.status;
        }
      } catch {
        bridgeOnline = false;
        bridgeStatus = 'Bridge offline. Run /design-connect ' + token.replace('deck-dev-', '') + ' in Pi.';
      }
      updateBadge();
    }

    function setSelecting(value) {
      selecting = value;
      updateBadge();
      if (!selecting && !altActive) hide();
    }

    function hide() {
      outline.style.display = 'none';
      chip.style.display = 'none';
      clearTargetBoxes();
      refPanel.style.display = 'none';
      ask.style.display = 'none';
      current = null;
      selectedPayload = null;
      currentTargets = [];
    }

    function styleSummary(el) {
      const style = getComputedStyle(el);
      return {
        display: style.display,
        position: style.position,
        width: style.width,
        height: style.height,
        margin: style.margin,
        padding: style.padding,
        gap: style.gap,
        color: style.color,
        backgroundColor: style.backgroundColor,
        border: style.border,
        borderRadius: style.borderRadius,
        font: style.font,
        alignItems: style.alignItems,
        justifyContent: style.justifyContent,
      };
    }

    function attributeSummary(el) {
      const attrs = {};
      for (const name of ['role', 'type', 'aria-label', 'aria-disabled', 'disabled', 'data-slot', 'data-variant', 'data-size', 'data-tone', 'data-sidebar', 'data-active']) {
        const value = el.getAttribute(name);
        if (value !== null) attrs[name] = value;
      }
      return attrs;
    }

    function targetPayload(el) {
      const rect = el.getBoundingClientRect();
      return {
        source: el.dataset.piSource || '',
        component: el.dataset.piComponent || '',
        tag: el.dataset.piTag || el.tagName.toLowerCase(),
        className: typeof el.className === 'string' ? el.className : '',
        text: (el.innerText || el.textContent || '').trim().slice(0, 500),
        url: location.href,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        attributes: attributeSummary(el),
        styles: styleSummary(el),
      };
    }

    const interactiveSelector = 'button[data-pi-source],a[data-pi-source],input[data-pi-source],select[data-pi-source],textarea[data-pi-source],[role="button"][data-pi-source],[role="menuitem"][data-pi-source],[role="tab"][data-pi-source]';

    function sourceElementFrom(event) {
      const path = event.composedPath ? event.composedPath() : [];
      for (const item of path) {
        if (item && item.nodeType === 1 && item.dataset && item.dataset.piSource) return item;
      }
      const el = document.elementFromPoint(event.clientX, event.clientY);
      return (el && el.closest && el.closest('[data-pi-source]')) || null;
    }

    function selectionElementFrom(event) {
      const path = event.composedPath ? event.composedPath() : [];
      for (const item of path) {
        if (item && item.nodeType === 1 && item.matches && item.matches(interactiveSelector)) return item;
        if (item && item.nodeType === 1 && item.closest) {
          const interactive = item.closest(interactiveSelector);
          if (interactive) return interactive;
        }
      }
      const el = document.elementFromPoint(event.clientX, event.clientY);
      return (el && el.closest && el.closest(interactiveSelector)) || sourceElementFrom(event);
    }

    function uniquePayloads(items) {
      const seen = new Set();
      const result = [];
      for (const payload of items) {
        const key = payload.source + '|' + payload.component + '|' + payload.tag + '|' + Math.round(payload.rect.x) + '|' + Math.round(payload.rect.y) + '|' + Math.round(payload.rect.width) + '|' + Math.round(payload.rect.height);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(payload);
      }
      return result;
    }

    function componentTargets(el) {
      const ancestors = [];
      for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
        if (!node.dataset || !node.dataset.piSource) continue;
        ancestors.push(targetPayload(node));
      }
      const allDescendants = Array.from(el.querySelectorAll ? el.querySelectorAll('[data-pi-source]') : [])
        .filter((node) => node !== el);
      const interactiveDescendants = allDescendants
        .filter((node) => node.matches && node.matches(interactiveSelector))
        .map((node) => targetPayload(node))
        .filter((payload) => payload.rect.width > 0 && payload.rect.height > 0)
        .sort((left, right) => left.rect.y - right.rect.y || left.rect.x - right.rect.x);
      const descendants = allDescendants
        .map((node) => targetPayload(node))
        .filter((payload) => payload.rect.width > 0 && payload.rect.height > 0)
        .sort((left, right) => left.rect.width * left.rect.height - right.rect.width * right.rect.height);
      const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
      const smallDescendants = descendants.filter((payload) => (payload.rect.width * payload.rect.height) / viewportArea < 0.35);
      return uniquePayloads([...interactiveDescendants, ...smallDescendants, ...ancestors].filter(Boolean)).slice(0, 30);
    }

    function truncate(value, max) {
      value = String(value || '');
      return value.length > max ? value.slice(0, max - 1) + '…' : value;
    }

    async function openReference(hit) {
      const response = await fetch(bridgeUrl + '/open?token=' + encodeURIComponent(token), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: hit.path, line: hit.line }),
      });
      if (!response.ok) throw new Error(await response.text() || response.statusText);
    }

    async function openSource(payload) {
      const response = await fetch(bridgeUrl + '/open-source?token=' + encodeURIComponent(token), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: payload.source }),
      });
      if (!response.ok) throw new Error(await response.text() || response.statusText);
    }

    function clearTargetBoxes() {
      targetLayer.replaceChildren();
    }

    function renderTargetBoxes(targets, selected) {
      currentTargets = targets;
      clearTargetBoxes();
      for (const [index, item] of targets.entries()) {
        const rect = item.rect;
        if (!rect || rect.width <= 0 || rect.height <= 0) continue;
        const box = document.createElement('button');
        box.type = 'button';
        box.className = 'pi-design-target-box';
        if (selected && item.source === selected.source && item.component === selected.component && item.tag === selected.tag) box.dataset.selected = 'true';
        box.style.left = Math.max(0, rect.x) + 'px';
        box.style.top = Math.max(0, rect.y) + 'px';
        box.style.width = Math.max(0, rect.width) + 'px';
        box.style.height = Math.max(0, rect.height) + 'px';
        const label = document.createElement('span');
        label.className = 'pi-design-target-label';
        label.textContent = String(index + 1);
        box.append(label);
        label.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await selectPayload(item, targets);
        });
        targetLayer.appendChild(box);
      }
    }

    function addSection(title) {
      const section = document.createElement('div');
      section.className = 'pi-design-section';
      section.textContent = title;
      refPanel.appendChild(section);
    }

    function addInfoRow(titleText, detailText) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pi-design-ref';
      row.disabled = true;
      const title = document.createElement('div');
      title.className = 'pi-design-ref-path';
      title.textContent = titleText;
      const detail = document.createElement('div');
      detail.className = 'pi-design-ref-text';
      detail.textContent = detailText;
      row.append(title, detail);
      refPanel.appendChild(row);
      return row;
    }

    function styleLine(styles) {
      if (!styles) return '';
      return [
        'display=' + styles.display,
        'size=' + styles.width + '×' + styles.height,
        'color=' + styles.color,
        'bg=' + styles.backgroundColor,
        'radius=' + styles.borderRadius,
      ].join(' · ');
    }

    function updateRefsProgress() {
      if (!refsProgressDetail || !refsProgressStartedAt) return;
      const seconds = Math.max(0, Math.floor((Date.now() - refsProgressStartedAt) / 1000));
      refsProgressDetail.textContent = seconds === 0
        ? 'Starting TypeScript worker…'
        : 'Still calculating… ' + seconds + 's elapsed';
    }

    function startRefsProgress() {
      refsProgressStartedAt = Date.now();
      if (refsProgressTimer) clearInterval(refsProgressTimer);
      refsProgressTimer = setInterval(updateRefsProgress, 500);
    }

    function stopRefsProgress() {
      if (refsProgressTimer) clearInterval(refsProgressTimer);
      refsProgressTimer = 0;
      refsProgressStartedAt = 0;
      refsProgressDetail = null;
    }

    function renderPanel(references, chain, selected, statusMessage) {
      const loading = references === null;
      const hits = Array.isArray(references) ? references : [];
      const path = Array.isArray(chain) ? chain : [];
      if (loading && !refsProgressStartedAt) startRefsProgress();
      if (!loading) stopRefsProgress();
      refPanel.textContent = '';
      const header = document.createElement('div');
      header.className = 'pi-design-panel-header';
      header.innerHTML = '<span>' + (selected && selected.component ? selected.component : 'Selected element') + '</span><span>' + (loading ? 'Calculating refs…' : 'Refs ' + hits.length) + '</span>';
      refPanel.appendChild(header);

      renderTargetBoxes(path, selected);
      addSection('Selected · click to open source');
      if (selected && selected.source) {
        const sourceButton = document.createElement('button');
        sourceButton.type = 'button';
        sourceButton.className = 'pi-design-ref';
        const title = document.createElement('div');
        title.className = 'pi-design-ref-path';
        title.textContent = '↗ Open source';
        const source = document.createElement('div');
        source.className = 'pi-design-ref-text';
        source.textContent = selected.source;
        sourceButton.append(title, source);
        sourceButton.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          try {
            await openSource(selected);
            title.textContent = '↗ Opened source';
          } catch (error) {
            title.textContent = 'Open failed: ' + (error && error.message ? error.message : 'unknown');
          }
        });
        refPanel.appendChild(sourceButton);
      }

      addSection('Targets · click row/box, 1-9, [ ] cycle');
      for (const [index, item] of path.slice(0, 14).entries()) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pi-design-ref';
        if (selected && item.source === selected.source && item.component === selected.component && item.tag === selected.tag) button.setAttribute('aria-current', 'true');
        const title = document.createElement('div');
        title.className = 'pi-design-ref-path';
        title.textContent = (index + 1) + '. ' + (item.component || '?') + ' · <' + (item.tag || '?') + '>';
        const source = document.createElement('div');
        source.className = 'pi-design-ref-text';
        source.textContent = item.source || '';
        button.append(title, source);
        button.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          moveOverlayToPayload(item);
          await selectPayload(item, path);
        });
        refPanel.appendChild(button);
      }

      addSection('Styles');
      addInfoRow('className', truncate((selected && selected.className) || '(none)', 220));
      addInfoRow('computed', truncate(styleLine(selected && selected.styles), 220));
      if (selected && selected.attributes && Object.keys(selected.attributes).length) {
        addInfoRow('attributes', truncate(JSON.stringify(selected.attributes), 220));
      }

      addSection('References · click to open VS Code');
      if (statusMessage) {
        const status = document.createElement('button');
        status.type = 'button';
        status.className = 'pi-design-ref';
        status.textContent = statusMessage;
        status.disabled = true;
        refPanel.appendChild(status);
      }
      if (!hits.length) {
        const empty = document.createElement('button');
        empty.type = 'button';
        empty.className = 'pi-design-ref';
        empty.disabled = true;
        if (loading) {
          const progress = document.createElement('div');
          progress.className = 'pi-design-progress';
          const spinner = document.createElement('span');
          spinner.className = 'pi-design-spinner';
          const text = document.createElement('span');
          text.className = 'pi-design-pulse';
          refsProgressDetail = text;
          progress.append(spinner, text);
          empty.appendChild(progress);
          updateRefsProgress();
        } else {
          empty.textContent = 'No references found';
        }
        refPanel.appendChild(empty);
      }
      for (const hit of hits.slice(0, 12)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pi-design-ref';
        const pathLine = document.createElement('div');
        pathLine.className = 'pi-design-ref-path';
        pathLine.textContent = hit.path + ':' + hit.line;
        const text = document.createElement('div');
        text.className = 'pi-design-ref-text';
        text.textContent = truncate(hit.text, 140);
        button.append(pathLine, text);
        button.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          try {
            await openReference(hit);
            pathLine.textContent = '↗ ' + hit.path + ':' + hit.line;
          } catch (error) {
            pathLine.textContent = 'Open failed: ' + (error && error.message ? error.message : 'unknown');
          }
        });
        refPanel.appendChild(button);
      }
      refPanel.style.display = 'block';
    }

    async function pollReferences(payload, chain) {
      const pollId = ++referencePollId;
      for (let attempt = 0; attempt < 45; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt < 5 ? 500 : 1000));
        if (referencePollId !== pollId || selectedPayload !== payload) return;
        let response;
        try {
          response = await fetch(bridgeUrl + '/references?token=' + encodeURIComponent(token));
        } catch {
          bridgeOnline = false;
          updateBadge();
          renderPanel([], chain, payload, bridgeStatus);
          return;
        }
        if (!response.ok) {
          renderPanel([], chain, payload, 'Reference polling failed: ' + response.status);
          return;
        }
        bridgeOnline = true;
        bridgeStatus = 'Bridge connected';
        updateBadge();
        const result = await response.json();
        if (referencePollId !== pollId || selectedPayload !== payload) return;
        if (!result.pending) {
          renderPanel(result.references, chain, payload);
          return;
        }
      }
      renderPanel([], chain, payload, 'Reference calculation timed out after ~45s. Try reselecting or /reload + /design-connect.');
    }

    async function selectPayload(payload, chain) {
      referencePollId += 1;
      selectedPayload = payload;
      selecting = false;
      updateBadge();
      moveOverlayToPayload(payload);
      chip.textContent = '✓ Selected · ' + (payload.component || '?') + ' · ' + payload.source;
      renderPanel(null, chain, payload);
      ask.style.display = 'flex';

      let response;
      try {
        response = await fetch(bridgeUrl + '/select?token=' + encodeURIComponent(token), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {
        bridgeOnline = false;
        bridgeStatus = 'Bridge offline. Run /design-connect ' + token.replace('deck-dev-', '') + ' in Pi.';
        updateBadge();
        renderPanel([], chain, payload, bridgeStatus);
        return;
      }
      if (!response.ok) throw new Error(await response.text() || response.statusText);
      bridgeOnline = true;
      bridgeStatus = 'Bridge connected';
      updateBadge();
      const result = await response.json();
      if (selectedPayload !== payload) return;
      if (result.pending) {
        void pollReferences(payload, chain);
        return;
      }
      renderPanel(result.references, chain, payload);
    }

    function moveOverlayToPayload(payload) {
      const rect = payload && payload.rect;
      if (!rect) return;
      outline.style.display = 'block';
      outline.style.left = Math.max(0, rect.x) + 'px';
      outline.style.top = Math.max(0, rect.y) + 'px';
      outline.style.width = Math.max(0, rect.width) + 'px';
      outline.style.height = Math.max(0, rect.height) + 'px';
      chip.textContent = (payload.component || '?') + ' · <' + (payload.tag || '?') + '> · ' + (payload.source || '');
      chip.style.display = 'block';
      chip.style.left = Math.min(window.innerWidth - 12, Math.max(12, rect.x)) + 'px';
      chip.style.top = Math.max(12, rect.y - 34) + 'px';
    }

    function moveOverlay(el) {
      moveOverlayToPayload(targetPayload(el));
    }

    let raf = 0;
    window.addEventListener('mousemove', (event) => {
      altActive = event.altKey;
      updateBadge();
      if (!isSelectorActive()) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = sourceElementFrom(event);
        if (!el) return hide();
        current = el;
        moveOverlay(el);
      });
    }, true);

    function targetsAtPoint(x, y) {
      return currentTargets
        .filter((item) => {
          const rect = item.rect;
          return rect && x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
        })
        .sort((left, right) => (left.rect.width * left.rect.height) - (right.rect.width * right.rect.height));
    }

    function targetAtPoint(x, y, cycle = false) {
      const candidates = targetsAtPoint(x, y);
      if (!candidates.length) return null;
      if (!cycle) return candidates[0];
      const samePoint = Math.abs(pointCycle.x - x) < 4 && Math.abs(pointCycle.y - y) < 4;
      pointCycle = {
        x,
        y,
        index: samePoint ? (pointCycle.index + 1) % candidates.length : 0,
      };
      return candidates[pointCycle.index] || candidates[0];
    }

    function cycleSelectedTarget(direction) {
      if (!currentTargets.length) return;
      const currentIndex = Math.max(0, currentTargets.findIndex((item) => selectedPayload && item.source === selectedPayload.source && item.component === selectedPayload.component && item.tag === selectedPayload.tag));
      const nextIndex = (currentIndex + direction + currentTargets.length) % currentTargets.length;
      void selectPayload(currentTargets[nextIndex], currentTargets);
    }

    function setPointerFromEvent(event) {
      const el = sourceElementFrom(event);
      if (!el) return;
      current = el;
      moveOverlay(el);
    }

    function isDesignChromeEvent(event) {
      const path = event.composedPath ? event.composedPath() : [];
      return path.some((item) => item === refPanel || item === ask || item === badge || item === chip || item === outline || (item.classList && item.classList.contains('pi-design-target-label')));
    }

    async function selectFromPointerEvent(event) {
      altActive = event.altKey;
      updateBadge();
      const boxedTarget = selectedPayload && currentTargets.length && !isDesignChromeEvent(event)
        ? targetAtPoint(event.clientX, event.clientY, true)
        : null;
      if (!isSelectorActive() && !boxedTarget) return false;
      const el = boxedTarget ? null : (selectionElementFrom(event) || current);
      if (!boxedTarget && !el) return false;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const payload = boxedTarget || targetPayload(el);
      const chain = boxedTarget ? currentTargets : componentTargets(el);
      try {
        await selectPayload(payload, chain);
      } catch (error) {
        const message = error && error.message ? error.message : 'unknown';
        chip.textContent = 'Selection failed: ' + message;
        renderPanel([], chain, payload, 'Selection failed: ' + message);
      }
      return true;
    }

    window.addEventListener('pointerdown', (event) => {
      if (!event.altKey && !selecting) return;
      setPointerFromEvent(event);
      suppressNextClick = true;
      void selectFromPointerEvent(event);
    }, true);

    window.addEventListener('click', async (event) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
      await selectFromPointerEvent(event);
    }, true);

    ask.addEventListener('submit', async (event) => {
      event.preventDefault();
      const question = askInput.value.trim();
      const payload = selectedPayload || (current ? targetPayload(current) : undefined);
      if (!question) return;
      askButton.textContent = 'Sending…';
      askButton.disabled = true;
      try {
        const response = await fetch(bridgeUrl + '/ask?token=' + encodeURIComponent(token), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question, target: payload }),
        });
        if (!response.ok) throw new Error(await response.text() || response.statusText);
        askInput.value = '';
        askButton.textContent = 'Sent';
        setTimeout(() => { askButton.textContent = 'Ask'; askButton.disabled = false; }, 800);
      } catch (error) {
        askButton.textContent = error && error.message ? truncate(error.message, 32) : 'Send failed';
        setTimeout(() => { askButton.textContent = 'Ask'; askButton.disabled = false; }, 1800);
      }
    });

    function isEditableEvent(event) {
      const el = event.target;
      return Boolean(el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)));
    }

    window.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        event.stopPropagation();
        setSelecting(!selecting);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && ask.style.display !== 'none') {
        ask.requestSubmit();
      }
      if (!isEditableEvent(event) && !isSelectorActive() && /^[1-9]$/.test(event.key) && currentTargets.length) {
        const item = currentTargets[Number(event.key) - 1];
        if (item) {
          event.preventDefault();
          event.stopPropagation();
          void selectPayload(item, currentTargets);
          return;
        }
      }
      if (!isEditableEvent(event) && !isSelectorActive() && currentTargets.length && (event.key === '[' || event.key === ']')) {
        event.preventDefault();
        event.stopPropagation();
        cycleSelectedTarget(event.key === ']' ? 1 : -1);
        return;
      }
      if (event.key === 'Alt') {
        altActive = true;
        updateBadge();
      }
      if (event.key === 'Escape') setSelecting(false);
    }, true);
    window.addEventListener('keyup', (event) => {
      if (event.key === 'Alt') {
        altActive = false;
        updateBadge();
        if (!selecting && !selectedPayload) hide();
      }
    }, true);
    window.addEventListener('blur', () => {
      altActive = false;
      updateBadge();
      if (!selecting && !selectedPayload) hide();
    });
    badge.addEventListener('click', () => setSelecting(!selecting));
    void checkBridgeHealth();
    setInterval(() => { void checkBridgeHealth(); }, 3000);
    setSelecting(false);
  };
  return `(${runtime.toString()})(${JSON.stringify(bridgeUrl)}, ${JSON.stringify(token)});`;
}

export function piDesignModePlugin(options) {
  const projectRoot = options.projectRoot;
  let command = 'serve';
  return {
    name: 'pi-design-mode',
    enforce: 'pre',
    configResolved(config) {
      command = config.command;
    },
    transform(code, id) {
      if (command !== 'serve') return null;
      const cleanId = id.split('?')[0];
      if (!/\.[jt]sx$/.test(cleanId)) return null;
      if (cleanId.includes('/node_modules/')) return null;
      return injectSourceAttributes(code, cleanId, projectRoot);
    },
    transformIndexHtml(html) {
      if (command !== 'serve') return html;
      return html.replace('</body>', `<script type="module">${clientScript(options)}</script></body>`);
    },
  };
}
