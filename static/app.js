// --- State ---
var currentView = 'browser';
var keys = [];
var nextCursor = null;
var currentPrefix = '';
var activeChip = '';
var loading = false;
var errorMsg = '';
var detailData = null;
var keyTypes = [];
var selectedRow = -1;
var hasSearched = false;
var inlineFilter = '';
var maxSize = 0;
var jid = 0;

// --- Recent searches (localStorage) ---
var RECENT_KEY = 'pebbleui_recent';
var MAX_RECENT = 10;

function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; }
  catch(e) { return []; }
}

function addRecent(q) {
  if (!q) return;
  var list = getRecent().filter(function(x) { return x !== q; });
  list.unshift(q);
  if (list.length > MAX_RECENT) list = list.slice(0, MAX_RECENT);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch(e) {}
}

function clearRecent() {
  try { localStorage.removeItem(RECENT_KEY); } catch(e) {}
}

// --- URL state ---
function readHash() {
  var h = location.hash.slice(1);
  if (h) return decodeURIComponent(h);
  return '';
}

function writeHash(prefix) {
  if (prefix) location.hash = '#' + encodeURIComponent(prefix);
  else history.replaceState(null, '', location.pathname);
}

// --- Toast ---
var toastTimer;
function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { t.classList.remove('show'); }, 1800);
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(function() { showToast('Copied to clipboard'); });
}

// --- API ---
function apiFetch(url) {
  return fetch(url).then(function(res) {
    if (!res.ok) return res.text().then(function(body) { throw new Error(body || res.statusText); });
    return res.json();
  });
}

function apiListKeys(prefix, cursor, limit) {
  limit = limit || 50;
  var p = new URLSearchParams({limit: String(limit)});
  if (prefix) p.set('prefix', prefix);
  if (cursor) p.set('cursor', cursor);
  return apiFetch(BASE + '/keys?' + p);
}

function apiGetKey(key) {
  return apiFetch(BASE + '/key?' + new URLSearchParams({key: key}));
}

function apiDownloadURL(key) {
  return BASE + '/key/download?' + new URLSearchParams({key: key});
}

function loadKeyTypes() {
  return apiFetch(BASE + '/key-types').then(function(res) {
    keyTypes = res.key_types || [];
  }).catch(function() { keyTypes = []; });
}

function loadStats() {
  apiFetch(BASE + '/stats').then(function(res) {
    var el = document.getElementById('storeStatus');
    if (!el) return;
    if (res.store_available) {
      el.textContent = 'Store online';
      el.className = 'store-status online';
    } else {
      el.textContent = 'Store offline';
      el.className = 'store-status offline';
    }
  }).catch(function() {
    var el = document.getElementById('storeStatus');
    if (el) { el.textContent = 'Store offline'; el.className = 'store-status offline'; }
  });
}

// --- Search ---
function doSearch(query, append) {
  loading = true;
  errorMsg = '';
  hasSearched = true;
  inlineFilter = '';
  if (!append) { keys = []; nextCursor = null; selectedRow = -1; maxSize = 0; }
  render();

  var done = function() { loading = false; render(); };

  // Try exact key first
  var exactPromise = (query && !append)
    ? apiGetKey(query).then(function(data) {
        if (data && data.value !== undefined) {
          detailData = data;
          currentView = 'detail';
          addRecent(query);
          writeHash('key:' + query);
          loading = false;
          render();
          return true;
        }
        return false;
      }).catch(function() { return false; })
    : Promise.resolve(false);

  exactPromise.then(function(found) {
    if (found) return;
    var c = append ? nextCursor : undefined;
    return apiListKeys(query, c).then(function(res) {
      keys = append ? keys.concat(res.keys) : res.keys;
      nextCursor = res.next_cursor || null;
      currentPrefix = query;
      activeChip = query;
      maxSize = 0;
      keys.forEach(function(k) { if (k.value_size > maxSize) maxSize = k.value_size; });
      addRecent(query);
      writeHash(query);
      done();
    });
  }).catch(function(e) {
    errorMsg = e.message || 'Search failed';
    done();
  });
}

function selectKey(key) {
  apiGetKey(key).then(function(data) {
    detailData = data;
    currentView = 'detail';
    writeHash('key:' + key);
    render();
  }).catch(function(e) {
    errorMsg = e.message || 'Failed to load key';
    render();
  });
}

function goBack() {
  currentView = 'browser';
  detailData = null;
  writeHash(currentPrefix);
  render();
}

function clearSearch() {
  currentPrefix = '';
  activeChip = '';
  keys = [];
  nextCursor = null;
  hasSearched = false;
  errorMsg = '';
  selectedRow = -1;
  inlineFilter = '';
  writeHash('');
  render();
  var inp = document.getElementById('searchInput');
  if (inp) inp.focus();
}

function refreshSearch() {
  if (currentPrefix || hasSearched) doSearch(currentPrefix, false);
}

// --- Export ---
function exportResults() {
  var data = keys.map(function(k) { return {key: k.key, size: k.value_size, preview: k.value_preview}; });
  var blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'pebble-keys-' + (currentPrefix || 'all').replace(/[^a-zA-Z0-9]/g, '_') + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported ' + keys.length + ' keys');
}

// --- Key display ---
function splitKey(key) {
  if (currentPrefix && key.startsWith(currentPrefix)) {
    return {prefix: currentPrefix, suffix: key.slice(currentPrefix.length)};
  }
  var sep = key.indexOf('/');
  if (sep === -1) sep = key.indexOf(':');
  if (sep === -1) return {prefix: '', suffix: key};
  return {prefix: key.slice(0, sep + 1), suffix: key.slice(sep + 1)};
}

// --- Rendering ---
function render() {
  var main = document.getElementById('main');
  if (currentView === 'detail' && detailData) {
    main.innerHTML = renderDetail(detailData);
    bindDetailEvents();
  } else {
    main.innerHTML = renderBrowser();
    bindBrowserEvents();
  }
}

function renderBrowser() {
  var html = '';
  var recent = getRecent();

  // Search row
  html += '<div class="search-row"><div class="search-wrap">';
  html += '<input type="text" id="searchInput" placeholder="Search by key prefix or exact key..." value="' + esc(currentPrefix) + '" autocomplete="off">';
  html += '<button class="search-clear" id="searchClear" style="' + (currentPrefix ? 'display:block' : 'display:none') + '">&times;</button>';
  // Recent suggestions dropdown
  if (recent.length > 0) {
    html += '<div class="search-suggestions" id="suggestions">';
    recent.forEach(function(r) {
      html += '<div class="suggestion" data-q="' + esc(r) + '">' + esc(r) + '<span class="suggestion-label">recent</span></div>';
    });
    html += '<div class="suggestion" id="clearRecent" style="color:#f85149;justify-content:center">Clear history</div>';
    html += '</div>';
  }
  html += '</div>';
  html += '<button class="btn-search" id="searchBtn">Search</button>';
  html += '<button class="btn-icon" id="refreshBtn" title="Refresh">&#x21bb;</button>';
  html += '</div>';

  // Filters
  if (keyTypes.length > 0) {
    html += '<div class="key-type-filter"><span class="filter-label">Filters</span><div class="filter-chips">';
    keyTypes.forEach(function(kt, i) {
      var isActive = activeChip === kt.prefix;
      html += '<div class="chip-wrapper" data-idx="' + i + '">';
      html += '<button class="chip' + (isActive ? ' chip-active' : '') + '" data-prefix="' + esc(kt.prefix) + '">' + esc(kt.label) + '</button>';
      html += '<div class="chip-tooltip" style="display:none">';
      html += '<div class="chip-desc">' + esc(kt.description) + '</div>';
      html += '<code class="chip-example">' + esc(kt.example) + '</code></div></div>';
    });
    html += '</div></div>';
  }

  // Error
  if (errorMsg) {
    html += '<div class="error-banner">' + esc(errorMsg);
    html += '<button class="error-dismiss" id="errorDismiss">&times;</button></div>';
  }

  // Loading
  if (loading) {
    html += '<div class="loading"><span class="loading-spinner"></span>Scanning keys...</div>';
    return html;
  }

  // Welcome
  if (!hasSearched && keys.length === 0) {
    html += '<div class="welcome"><h2>Browse your Pebble store</h2>';
    html += '<p>Search by key prefix, click a quick filter, or browse all keys to get started.</p>';
    html += '<div class="welcome-actions"><button class="welcome-btn" id="browseAll">Browse all keys</button></div></div>';
    return html;
  }

  // Empty
  if (keys.length === 0) {
    html += '<div class="empty">No keys found for <code>' + esc(currentPrefix) + '</code></div>';
    return html;
  }

  // Toolbar
  html += '<div class="toolbar"><div class="toolbar-left">';
  html += '<span class="status-count">' + keys.length + (nextCursor ? '+' : '') + ' keys</span>';
  if (currentPrefix) html += '<span class="status-prefix">' + esc(currentPrefix) + '*</span>';
  html += '</div><div class="toolbar-right">';
  html += '<input type="text" class="inline-filter" id="inlineFilter" placeholder="Filter results..." value="' + esc(inlineFilter) + '">';
  html += '<button class="toolbar-btn" id="exportBtn">Export JSON</button>';
  html += '</div></div>';

  // Table
  html += '<div class="key-list"><table><thead><tr>';
  html += '<th class="th-num">#</th><th class="th-key">Key</th><th class="th-size">Size</th><th class="th-preview">Preview</th><th class="th-actions"></th>';
  html += '</tr></thead><tbody>';
  keys.forEach(function(entry, i) {
    var parts = splitKey(entry.key);
    var sel = i === selectedRow ? ' selected' : '';
    var filtered = inlineFilter && entry.key.toLowerCase().indexOf(inlineFilter.toLowerCase()) === -1;
    var barW = maxSize > 0 ? Math.max(2, (entry.value_size / maxSize) * 100) : 0;
    html += '<tr class="key-row' + sel + (filtered ? ' filtered-out' : '') + '" data-key="' + esc(entry.key) + '" data-idx="' + i + '">';
    html += '<td class="row-num">' + (i + 1) + '</td>';
    html += '<td class="key-cell" title="' + esc(entry.key) + '"><span class="key-prefix">' + esc(parts.prefix) + '</span><span class="key-suffix">' + esc(parts.suffix) + '</span></td>';
    html += '<td class="size-cell">' + formatSize(entry.value_size) + '<div class="size-bar" style="width:' + barW.toFixed(0) + '%"></div></td>';
    html += '<td class="preview-cell" title="' + esc(entry.value_preview) + '">' + esc(entry.value_preview) + '</td>';
    html += '<td><button class="copy-btn" data-copy="' + esc(entry.key) + '" title="Copy key">&#x2398;</button></td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  if (nextCursor) html += '<button class="load-more" id="loadMore">Load more keys</button>';
  html += '</div>';
  return html;
}

function renderDetail(data) {
  var html = '';

  // Breadcrumb
  html += '<div class="detail-nav"><a id="navHome">Pebble UI</a><span>/</span>';
  var keyParts = data.key.split(/[/:]/);
  if (keyParts.length > 1) html += '<a id="navPrefix">' + esc(keyParts[0]) + '</a><span>/</span>';
  html += '<span style="color:#8b949e">' + esc(keyParts[keyParts.length - 1] || data.key) + '</span></div>';

  // Header card
  html += '<div class="detail-header"><div class="detail-key-row">';
  html += '<span class="detail-key">' + esc(data.key) + '</span>';
  html += '<button class="detail-copy-btn" id="copyKey">Copy key</button></div>';
  html += '<div class="detail-tags">';
  html += '<span class="tag tag-encoding">' + esc(data.encoding) + '</span>';
  html += '<span class="tag tag-size">' + formatSize(data.size) + '</span>';
  if (data.truncated) html += '<span class="tag tag-warn">truncated</span>';
  html += '</div><div class="detail-actions">';
  html += '<button class="detail-btn" id="backBtn">Back</button>';
  html += '<button class="detail-btn" id="copyValue">' + (data.encoding === 'json' ? 'Copy JSON' : 'Copy value') + '</button>';
  if (data.size > 0) html += '<a href="' + apiDownloadURL(data.key) + '" class="detail-btn detail-btn-primary" download>Download raw</a>';
  html += '</div></div>';

  // Body
  html += '<div class="detail-body"><div class="detail-body-toolbar">';
  html += '<span>' + esc(data.encoding) + ' viewer</span>';
  if (data.encoding === 'json') {
    html += '<div class="toolbar-right">';
    html += '<button class="toolbar-btn" id="expandAll">Expand all</button>';
    html += '<button class="toolbar-btn" id="collapseAll">Collapse all</button>';
    html += '</div>';
  }
  html += '</div><div class="detail-body-content">';

  jid = 0;
  if (data.encoding === 'json') {
    html += '<div class="json-viewer">' + renderJSON(data.value, 0) + '</div>';
  } else if (data.encoding === 'base64') {
    html += '<pre class="hex-viewer">' + renderHex(data.value) + '</pre>';
  } else {
    html += '<pre class="text-viewer">' + esc(String(data.value)) + '</pre>';
  }
  html += '</div></div>';
  return html;
}

// --- JSON tree ---
function renderJSON(val, depth) {
  if (val === null) return '<span class="json-null">null</span>';
  if (typeof val === 'boolean') return '<span class="json-bool">' + val + '</span>';
  if (typeof val === 'number') return '<span class="json-num">' + val + '</span>';
  if (typeof val === 'string') return '<span class="json-str">"' + esc(val) + '"</span>';

  if (Array.isArray(val)) {
    if (val.length === 0) return '<span>[]</span>';
    var id = 'j' + (++jid), col = depth >= 2;
    var h = '<span class="json-toggle" data-target="' + id + '">' + (col ? '\u25b6' : '\u25bc') + '</span>[';
    h += '<span class="json-summary" id="' + id + '-s"' + (col ? '' : ' style="display:none"') + '>' + val.length + ' items]</span>';
    h += '<div id="' + id + '"' + (col ? ' class="json-collapsed"' : '') + ' style="margin-left:18px">';
    for (var i = 0; i < val.length; i++) {
      h += '<div>' + renderJSON(val[i], depth + 1) + (i < val.length - 1 ? ',' : '') + '</div>';
    }
    h += '</div>]';
    return h;
  }

  if (typeof val === 'object') {
    var ks = Object.keys(val);
    if (ks.length === 0) return '<span>{}</span>';
    var id = 'j' + (++jid), col = depth >= 2;
    var h = '<span class="json-toggle" data-target="' + id + '">' + (col ? '\u25b6' : '\u25bc') + '</span>{';
    h += '<span class="json-summary" id="' + id + '-s"' + (col ? '' : ' style="display:none"') + '>' + ks.length + ' keys}</span>';
    h += '<div id="' + id + '"' + (col ? ' class="json-collapsed"' : '') + ' style="margin-left:18px">';
    for (var i = 0; i < ks.length; i++) {
      h += '<div><span class="json-key">"' + esc(ks[i]) + '"</span>: ' + renderJSON(val[ks[i]], depth + 1) + (i < ks.length - 1 ? ',' : '') + '</div>';
    }
    h += '</div>}';
    return h;
  }
  return esc(String(val));
}

// --- Hex viewer ---
function renderHex(b64) {
  try {
    var raw = atob(b64), bytes = new Uint8Array(raw.length), lines = [];
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    for (var i = 0; i < bytes.length; i += 16) {
      var slice = bytes.slice(i, i + 16);
      var hex = Array.from(slice).map(function(b) { return '<span class="hex-byte">' + b.toString(16).padStart(2, '0') + '</span>'; }).join(' ');
      var ascii = '<span class="hex-ascii">' + Array.from(slice).map(function(b) { return (b >= 32 && b < 127) ? esc(String.fromCharCode(b)) : '.'; }).join('') + '</span>';
      lines.push('<span class="hex-offset">' + i.toString(16).padStart(8, '0') + '</span>  ' + hex + '  ' + ascii);
    }
    return lines.join('\n');
  } catch(e) { return esc(b64); }
}

// --- Events: Browser ---
function bindBrowserEvents() {
  var inp = document.getElementById('searchInput');
  var suggestions = document.getElementById('suggestions');

  // Search submit
  var searchBtn = document.getElementById('searchBtn');
  if (searchBtn) searchBtn.onclick = function() { doSearch(inp.value.trim(), false); };
  if (inp) inp.onkeydown = function(e) {
    if (e.key === 'Enter') { e.preventDefault(); doSearch(inp.value.trim(), false); }
  };

  // Clear
  var clearBtn = document.getElementById('searchClear');
  if (clearBtn) clearBtn.onclick = clearSearch;

  // Recent suggestions
  if (inp && suggestions) {
    inp.onfocus = function() { if (inp.value === '' || inp.value === currentPrefix) suggestions.classList.add('show'); };
    inp.oninput = function() { suggestions.classList.remove('show'); };
    document.addEventListener('click', function handler(e) {
      if (!e.target.closest('.search-wrap')) { suggestions.classList.remove('show'); document.removeEventListener('click', handler); }
    });
  }
  document.querySelectorAll('.suggestion[data-q]').forEach(function(s) {
    s.onclick = function() { inp.value = s.dataset.q; doSearch(s.dataset.q, false); };
  });
  var clrRecent = document.getElementById('clearRecent');
  if (clrRecent) clrRecent.onclick = function() { clearRecent(); suggestions.classList.remove('show'); render(); };

  // Refresh
  var refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) refreshBtn.onclick = refreshSearch;

  // Browse all
  var browseAll = document.getElementById('browseAll');
  if (browseAll) browseAll.onclick = function() { doSearch('', false); };

  // Error dismiss
  var errDismiss = document.getElementById('errorDismiss');
  if (errDismiss) errDismiss.onclick = function() { errorMsg = ''; render(); };

  // Chips
  document.querySelectorAll('.chip').forEach(function(btn) {
    btn.onclick = function() { var p = btn.dataset.prefix; if (inp) inp.value = p; doSearch(p, false); };
  });
  document.querySelectorAll('.chip-wrapper').forEach(function(wrap) {
    var tip = wrap.querySelector('.chip-tooltip');
    if (!tip) return;
    wrap.onmouseenter = function() { tip.style.display = 'block'; };
    wrap.onmouseleave = function() { tip.style.display = 'none'; };
  });

  // Row clicks
  document.querySelectorAll('.key-row').forEach(function(row) {
    row.onclick = function(e) {
      if (e.target.classList.contains('copy-btn')) return;
      selectKey(row.dataset.key);
    };
  });

  // Copy buttons
  document.querySelectorAll('.copy-btn').forEach(function(btn) {
    btn.onclick = function(e) { e.stopPropagation(); copyText(btn.dataset.copy); };
  });

  // Load more
  var loadMore = document.getElementById('loadMore');
  if (loadMore) loadMore.onclick = function() { doSearch(currentPrefix, true); };

  // Inline filter
  var filterInp = document.getElementById('inlineFilter');
  if (filterInp) filterInp.oninput = function() {
    inlineFilter = filterInp.value;
    document.querySelectorAll('.key-row').forEach(function(row) {
      var match = !inlineFilter || row.dataset.key.toLowerCase().indexOf(inlineFilter.toLowerCase()) !== -1;
      row.classList.toggle('filtered-out', !match);
    });
  };

  // Export
  var exportBtn = document.getElementById('exportBtn');
  if (exportBtn) exportBtn.onclick = exportResults;

  // Focus search on welcome
  if (inp && !hasSearched) inp.focus();
}

// --- Events: Detail ---
function bindDetailEvents() {
  var backBtn = document.getElementById('backBtn');
  if (backBtn) backBtn.onclick = goBack;

  var navHome = document.getElementById('navHome');
  if (navHome) navHome.onclick = clearSearch;

  var navPrefix = document.getElementById('navPrefix');
  if (navPrefix) navPrefix.onclick = function() {
    var prefix = detailData.key.split(/[/:]/)[0];
    var sep = detailData.key[prefix.length] || '/';
    goBack();
    doSearch(prefix + sep, false);
  };

  var copyKey = document.getElementById('copyKey');
  if (copyKey) copyKey.onclick = function() { copyText(detailData.key); };

  var copyValue = document.getElementById('copyValue');
  if (copyValue) copyValue.onclick = function() {
    var v = detailData.value;
    copyText(typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v));
  };

  // Expand / Collapse all
  var expandAll = document.getElementById('expandAll');
  if (expandAll) expandAll.onclick = function() { toggleAllJSON(true); };
  var collapseAll = document.getElementById('collapseAll');
  if (collapseAll) collapseAll.onclick = function() { toggleAllJSON(false); };

  // JSON toggles
  document.querySelectorAll('.json-toggle').forEach(function(toggle) {
    toggle.onclick = function() { toggleJSONNode(toggle); };
  });
}

function toggleJSONNode(toggle) {
  var target = document.getElementById(toggle.dataset.target);
  var summary = document.getElementById(toggle.dataset.target + '-s');
  if (!target) return;
  var hidden = target.classList.contains('json-collapsed');
  if (hidden) {
    target.classList.remove('json-collapsed');
    target.style.display = '';
    if (summary) summary.style.display = 'none';
    toggle.textContent = '\u25bc';
  } else {
    target.classList.add('json-collapsed');
    target.style.display = 'none';
    if (summary) summary.style.display = '';
    toggle.textContent = '\u25b6';
  }
}

function toggleAllJSON(expand) {
  document.querySelectorAll('.json-toggle').forEach(function(toggle) {
    var target = document.getElementById(toggle.dataset.target);
    var summary = document.getElementById(toggle.dataset.target + '-s');
    if (!target) return;
    if (expand) {
      target.classList.remove('json-collapsed');
      target.style.display = '';
      if (summary) summary.style.display = 'none';
      toggle.textContent = '\u25bc';
    } else {
      target.classList.add('json-collapsed');
      target.style.display = 'none';
      if (summary) summary.style.display = '';
      toggle.textContent = '\u25b6';
    }
  });
}

// --- Keyboard shortcuts ---
document.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    if (currentView === 'detail') goBack();
    var inp = document.getElementById('searchInput');
    if (inp) { inp.focus(); inp.select(); }
    return;
  }
  if (e.key === 'Escape') {
    if (currentView === 'detail') { goBack(); return; }
    var inp = document.getElementById('searchInput');
    if (inp && document.activeElement === inp && currentPrefix) clearSearch();
    return;
  }
  if (currentView === 'browser' && keys.length > 0 && document.activeElement.tagName !== 'INPUT') {
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedRow = Math.min(selectedRow + 1, keys.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectedRow = Math.max(selectedRow - 1, 0); render(); }
    else if (e.key === 'Enter' && selectedRow >= 0) { e.preventDefault(); selectKey(keys[selectedRow].key); }
  }
});

// --- Helpers ---
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function esc(s) {
  var d = document.createElement('div');
  d.appendChild(document.createTextNode(String(s)));
  return d.innerHTML;
}

// --- Init ---
function navigateFromHash() {
  var h = readHash();
  if (!h) { if (hasSearched) clearSearch(); return; }
  if (h.indexOf('key:') === 0) {
    var k = h.slice(4);
    if (detailData && detailData.key === k) return;
    selectKey(k);
  } else {
    if (h !== currentPrefix) doSearch(h, false);
  }
}

window.addEventListener('hashchange', navigateFromHash);

loadKeyTypes().then(function() {
  loadStats();
  var h = readHash();
  if (h && h.indexOf('key:') === 0) selectKey(h.slice(4));
  else if (h) doSearch(h, false);
  else render();
});
