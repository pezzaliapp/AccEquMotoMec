// =============================================================================
// AccEqu / MotoMec — app logic
// - carica Excel (foglio "02_Codici_unici", col. I = prezzi netti)
// - prezzi persistiti in localStorage (solo sul dispositivo)
// - search, filtri per albero, drawer dettaglio
// =============================================================================

(() => {
  "use strict";

  // ---------- STATE ----------------------------------------------------------
  const STORAGE_KEY = "accequ-motomec-prices-v1";

  /** @type {Record<string, number>} */
  let prices = {};           // { "21100022": 976, ... } (solo valori non 0)
  /** @type {Set<string>}   */
  let unavailable = new Set(); // codici con prezzo 0 (prodotto non fornibile)
  let search = "";
  let shaftFilter = "all";     // all | Ø14 | Ø18 | 3/4" | Ø40 | other

  // ---------- BOOT -----------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    loadPricesFromStorage();
    wireEvents();
    buildShaftChips();
    render();

    // Expose helpers for quote.js
    window.__getItem = (code) => CATALOG.items[code] || null;
    window.__getPrice = (code) => prices[code] || 0;
    window.__isUnavailable = (code) => unavailable.has(code);
    window.__toast = toast;
  });

  // ---------- STORAGE --------------------------------------------------------
  function loadPricesFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && typeof data === "object") {
        prices = data.prices || {};
        unavailable = new Set(data.unavailable || []);
      }
    } catch (e) {
      console.warn("Cannot read stored prices:", e);
    }
  }

  function savePricesToStorage() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          prices,
          unavailable: [...unavailable],
          ts: Date.now(),
        })
      );
    } catch (e) {
      console.warn("Cannot save prices:", e);
    }
  }

  function clearPrices() {
    prices = {};
    unavailable = new Set();
    localStorage.removeItem(STORAGE_KEY);
  }

  // ---------- EXCEL PARSING --------------------------------------------------
  /**
   * Reads the last sheet (must contain column A=Codice, column I=Prezzo listino netto).
   * Header row is row 3 (index 2) in the reference file. We auto-detect it anyway.
   */
  function parseWorkbook(wb) {
    // Prefer the last sheet as the user described ("Codici_unici")
    const sheetNames = wb.SheetNames;
    if (!sheetNames.length) {
      throw new Error("Il file non contiene fogli.");
    }
    const sheetName =
      sheetNames.find((n) => /codici_unici|codici unici|listino/i.test(n)) ||
      sheetNames[sheetNames.length - 1];
    const ws = wb.Sheets[sheetName];

    // Convert entire sheet to 2D array
    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: null,
    });

    // Find header row: the one containing both "Codice" and a price column
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const r = (rows[i] || []).map((c) => String(c ?? "").toLowerCase());
      const hasCode = r.some((c) => c.trim() === "codice");
      const hasPrice = r.some((c) => c.includes("prezzo") && c.includes("netto"));
      if (hasCode && hasPrice) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) {
      // fallback: assume row 3 (index 2)
      headerIdx = 2;
    }

    const header = (rows[headerIdx] || []).map((c) =>
      String(c ?? "").toLowerCase().trim()
    );
    const codeCol = header.findIndex((c) => c === "codice");
    let priceCol = header.findIndex(
      (c) => c.includes("prezzo") && c.includes("netto")
    );
    if (priceCol === -1) {
      // fallback to column I (index 8)
      priceCol = 8;
    }
    if (codeCol === -1) {
      throw new Error('Colonna "Codice" non trovata nel foglio.');
    }

    const nextPrices = {};
    const nextUnavailable = new Set();
    let parsed = 0;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const codeRaw = row[codeCol];
      if (codeRaw == null) continue;
      const code = String(codeRaw).trim();
      if (!code || !/^[0-9A-Za-z]/.test(code)) continue;

      const priceRaw = row[priceCol];
      const price = toNumber(priceRaw);

      if (price == null) {
        // empty -> treat as unavailable
        nextUnavailable.add(code);
      } else if (price <= 0) {
        nextUnavailable.add(code);
      } else {
        nextPrices[code] = price;
      }
      parsed++;
    }

    return { prices: nextPrices, unavailable: nextUnavailable, count: parsed, sheetName };
  }

  function toNumber(val) {
    if (val == null || val === "") return null;
    if (typeof val === "number") return val;
    const s = String(val).replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  async function handleFile(file) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const result = parseWorkbook(wb);

      prices = result.prices;
      unavailable = result.unavailable;
      savePricesToStorage();

      const ok = Object.keys(prices).length;
      const nf = unavailable.size;
      toast(`Listino caricato: ${ok} prezzi, ${nf} non fornibili`, "success");
      render();
    } catch (e) {
      console.error(e);
      toast("Errore: " + (e.message || "impossibile leggere il file"), "error");
    }
  }

  // ---------- RENDERING -----------------------------------------------------
  function render() {
    renderPriceBar();
    renderStats();
    renderCatalog();
  }

  function renderPriceBar() {
    const bar = $("#priceBar");
    const title = $("#pbTitle");
    const sub = $("#pbSub");
    const clearBtn = $("#btnClear");
    const okCount = Object.keys(prices).length;
    const nfCount = unavailable.size;
    const has = okCount + nfCount > 0;

    bar.setAttribute("data-has-prices", has ? "true" : "false");

    if (has) {
      title.textContent = "Listino caricato";
      sub.textContent = `${okCount} prezzi · ${nfCount} non fornibili`;
      clearBtn.hidden = false;
    } else {
      title.textContent = "Nessun listino caricato";
      sub.textContent = "Carica l'Excel per vedere i prezzi netti";
      clearBtn.hidden = true;
    }
  }

  function renderStats() {
    const total = Object.keys(CATALOG.items).length;
    const filtered = getFilteredItems().length;
    const el = $("#stats");
    el.innerHTML = `
      <span><strong>${filtered}</strong> di ${total} articoli</span>
      <span class="stat-dot">·</span>
      <span>Rev. ${escapeHtml(CATALOG.revision)}</span>
    `;
  }

  function renderCatalog() {
    const root = $("#catalog");
    const empty = $("#empty");
    const filtered = getFilteredItems();

    if (!filtered.length) {
      root.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    // Group filtered codes by section
    const sectionChunks = CATALOG.sections
      .map((s) => {
        const codes = s.codes.filter((c) => filtered.includes(c));
        return { ...s, codes };
      })
      .filter((s) => s.codes.length > 0);

    // Dedupe codes across sections (codes appearing in multiple sections only show first time)
    const seen = new Set();
    const chunks = sectionChunks.map((s) => {
      const uniq = s.codes.filter((c) => !seen.has(c) && (seen.add(c), true));
      return { ...s, codes: uniq };
    }).filter((s) => s.codes.length > 0);

    root.innerHTML = chunks
      .map(
        (s) => `
        <div class="section">
          <h2 class="section-title">
            <span class="num">${s.id}.</span>
            <span>${escapeHtml(s.title)}</span>
            <span class="count">${s.codes.length} ${s.codes.length === 1 ? "articolo" : "articoli"}</span>
          </h2>
          <div class="cards">
            ${s.codes.map(cardHtml).join("")}
          </div>
        </div>
      `
      )
      .join("");

    // wire card clicks
    $all(".card").forEach((el) => {
      el.addEventListener("click", () => openDrawer(el.dataset.code));
    });
  }

  function cardHtml(code) {
    const item = CATALOG.items[code];
    if (!item) return "";
    const status = priceStatus(code);
    const priceHtml =
      status === "ok"
        ? `<span class="card-price">${fmtPrice(prices[code])}</span>`
        : status === "nf"
        ? `<span class="card-price nf">prodotto non fornibile</span>`
        : `<span class="card-price none">prezzo non caricato</span>`;

    const imgSrc = `./img/${encodeURIComponent(code)}.jpg`;

    return `
      <article class="card" data-code="${escapeHtml(code)}" data-status="${status}">
        <div class="card-img">
          <img src="${imgSrc}" alt="${escapeHtml(item.title)}" loading="lazy"
               onerror="this.parentElement.classList.add('no-img')" />
        </div>
        <div class="card-body">
          <div class="card-head">
            <span class="card-code">${escapeHtml(code)}</span>
            ${item.shaft ? `<span class="card-shaft">${escapeHtml(item.shaft)}</span>` : ""}
          </div>
          <p class="card-desc">${escapeHtml(item.title)}</p>
          <p class="card-compat">${escapeHtml(item.compat || item.desc)}</p>
          <div class="card-footer">${priceHtml}</div>
        </div>
      </article>
    `;
  }

  function priceStatus(code) {
    if (prices[code] > 0) return "ok";
    if (unavailable.has(code)) return "nf";
    return "none";
  }

  function fmtPrice(v) {
    try {
      return (
        "€ " +
        new Intl.NumberFormat("it-IT", {
          maximumFractionDigits: 2,
          minimumFractionDigits: 0,
        }).format(v)
      );
    } catch {
      return "€ " + v;
    }
  }

  // ---------- FILTERS -------------------------------------------------------
  function getFilteredItems() {
    const q = search.trim().toLowerCase();
    const out = [];
    for (const code in CATALOG.items) {
      const item = CATALOG.items[code];
      if (!matchShaft(item)) continue;
      if (q && !matchesSearch(item, q)) continue;
      out.push(code);
    }
    return out;
  }

  function matchesSearch(item, q) {
    const hay = [
      item.code, item.title, item.desc, item.compat, item.shaft
    ].filter(Boolean).join(" ").toLowerCase();
    return q.split(/\s+/).every((tok) => hay.includes(tok));
  }

  function matchShaft(item) {
    if (shaftFilter === "all") return true;
    const s = (item.shaft || "").trim();
    if (shaftFilter === "Ø14") return s.includes("Ø14");
    if (shaftFilter === "Ø18") return s.includes("Ø18");
    if (shaftFilter === '3/4"') return s.includes('3/4');
    if (shaftFilter === "Ø40") return s.includes("Ø40");
    if (shaftFilter === "other") {
      return !/Ø14|Ø18|3\/4|Ø40/.test(s);
    }
    return true;
  }

  function buildShaftChips() {
    const root = $("#chips");
    const counts = { all: 0, "Ø14": 0, "Ø18": 0, '3/4"': 0, "Ø40": 0, other: 0 };
    for (const code in CATALOG.items) {
      const s = (CATALOG.items[code].shaft || "").trim();
      counts.all++;
      if (s.includes("Ø14")) counts["Ø14"]++;
      else if (s.includes("Ø18")) counts["Ø18"]++;
      else if (s.includes("3/4")) counts['3/4"']++;
      else if (s.includes("Ø40")) counts["Ø40"]++;
      else counts.other++;
    }
    const defs = [
      { key: "all",    label: "Tutti" },
      { key: "Ø14",    label: "Albero Ø14" },
      { key: "Ø18",    label: "Albero Ø18" },
      { key: '3/4"',   label: 'Albero 3/4"' },
      { key: "Ø40",    label: "Albero Ø40" },
      { key: "other",  label: "Altro" },
    ];
    root.innerHTML = defs
      .map(
        (d) => `
      <button class="chip ${shaftFilter === d.key ? "active" : ""}" data-k="${escapeAttr(d.key)}">
        ${escapeHtml(d.label)}
        <span class="count">${counts[d.key]}</span>
      </button>
    `
      )
      .join("");
    $all(".chip", root).forEach((c) => {
      c.addEventListener("click", () => {
        shaftFilter = c.dataset.k;
        buildShaftChips();
        render();
      });
    });
  }

  // ---------- DRAWER --------------------------------------------------------
  function openDrawer(code) {
    const item = CATALOG.items[code];
    if (!item) return;

    $("#dhCode").textContent = code;
    $("#dhDesc").textContent = item.title;

    const status = priceStatus(code);
    const priceHtml =
      status === "ok"
        ? `<span class="field-val price-ok">${fmtPrice(prices[code])}</span>`
        : status === "nf"
        ? `<span class="field-val price-nf">prodotto non fornibile</span>`
        : `<span class="field-val price-none">prezzo non caricato</span>`;

    $("#drawerBody").innerHTML = `
      <div class="drawer-hero">
        <img src="./img/${encodeURIComponent(code)}.jpg" alt="${escapeHtml(item.title)}"
             onerror="this.parentElement.classList.add('no-img')" />
      </div>
      <div class="field">
        <span class="field-label">Codice</span>
        <span class="field-val mono">${escapeHtml(code)}</span>
      </div>
      <div class="field">
        <span class="field-label">Descrizione</span>
        <span class="field-val">${escapeHtml(item.title)}</span>
      </div>
      <div class="field">
        <span class="field-label">Dettaglio</span>
        <span class="field-val">${escapeHtml(item.desc)}</span>
      </div>
      ${item.compat ? `
      <div class="field">
        <span class="field-label">Compatibilità</span>
        <span class="field-val">${escapeHtml(item.compat)}</span>
      </div>` : ""}
      ${item.shaft ? `
      <div class="field">
        <span class="field-label">Albero</span>
        <span class="field-val mono">${escapeHtml(item.shaft)}</span>
      </div>` : ""}
      ${item.page ? `
      <div class="field">
        <span class="field-label">Pagina catalogo</span>
        <span class="field-val">p. ${item.page}</span>
      </div>` : ""}
      <div class="field">
        <span class="field-label">Prezzo netto</span>
        ${priceHtml}
      </div>
      <div class="drawer-actions">
        <button class="btn-primary btn-wide" id="drawerAddToQuote" data-code="${escapeHtml(code)}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>Aggiungi al preventivo</span>
        </button>
      </div>
    `;
    show("#drawer");
    show("#drawerBackdrop");
    const btn = document.getElementById("drawerAddToQuote");
    if (btn) btn.addEventListener("click", () => {
      if (window.Quote) {
        window.Quote.add(btn.dataset.code, 1);
      }
    });
  }

  function closeDrawer() {
    hide("#drawer");
    hide("#drawerBackdrop");
  }

  // ---------- EVENTS --------------------------------------------------------
  function wireEvents() {
    // File
    const fi = $("#fileInput");
    fi.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) handleFile(f);
      fi.value = "";
    });

    // Clear prices
    $("#btnClear").addEventListener("click", () => {
      if (!confirm("Rimuovere il listino caricato?")) return;
      clearPrices();
      toast("Listino rimosso", "success");
      render();
    });

    // Search
    const s = $("#search");
    const xx = $("#clearSearch");
    s.addEventListener("input", () => {
      search = s.value;
      xx.hidden = !search;
      render();
    });
    xx.addEventListener("click", () => {
      s.value = "";
      search = "";
      xx.hidden = true;
      s.focus();
      render();
    });

    // Drawer
    $("#drawerClose").addEventListener("click", closeDrawer);
    $("#drawerBackdrop").addEventListener("click", closeDrawer);

    // Info
    $("#btnInfo").addEventListener("click", () => {
      show("#infoModal"); show("#infoBackdrop");
    });
    $("#infoClose").addEventListener("click", () => {
      hide("#infoModal"); hide("#infoBackdrop");
    });
    $("#infoBackdrop").addEventListener("click", () => {
      hide("#infoModal"); hide("#infoBackdrop");
    });

    // ESC
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeDrawer();
        hide("#infoModal"); hide("#infoBackdrop");
      }
    });
  }

  // ---------- HELPERS -------------------------------------------------------
  function $(sel, root = document) { return root.querySelector(sel); }
  function $all(sel, root = document) { return [...root.querySelectorAll(sel)]; }
  function show(sel) { const el = $(sel); if (el) el.hidden = false; }
  function hide(sel) { const el = $(sel); if (el) el.hidden = true; }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function escapeAttr(s) { return escapeHtml(s); }

  let toastTimer = null;
  function toast(msg, kind = "") {
    const t = $("#toast");
    t.className = "toast" + (kind ? " " + kind : "");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
  }
})();
