// =============================================================================
// AccEqu / MotoMec — modulo Preventivo
// - margine % (NON ricarico): vendita = netto / (1 - m/100)
// - salvataggio multi-bozza in localStorage
// - export TXT, invio WhatsApp, copia negli appunti
// =============================================================================

(() => {
  "use strict";

  const KEY_CURRENT = "accequ-quote-current-v1";
  const KEY_DRAFTS  = "accequ-quote-drafts-v1";

  /**
   * @typedef {Object} QuoteLine
   * @property {string} code
   * @property {number} qty
   * @property {number} marginPct   // margine sulla vendita (0..99)
   */

  /**
   * @typedef {Object} Quote
   * @property {string} customer
   * @property {string} ref
   * @property {QuoteLine[]} lines
   * @property {number} updatedAt
   */

  /** @type {Quote} */
  let quote = {
    customer: "",
    ref: "",
    lines: [],
    updatedAt: Date.now(),
  };

  // ---------- STORAGE --------------------------------------------------------
  function load() {
    try {
      const raw = localStorage.getItem(KEY_CURRENT);
      if (raw) {
        const q = JSON.parse(raw);
        if (q && Array.isArray(q.lines)) {
          quote = Object.assign({ customer: "", ref: "", lines: [], updatedAt: Date.now() }, q);
        }
      }
    } catch {}
  }
  function save() {
    quote.updatedAt = Date.now();
    try { localStorage.setItem(KEY_CURRENT, JSON.stringify(quote)); } catch {}
    updateBadge();
  }
  function loadDrafts() {
    try {
      const raw = localStorage.getItem(KEY_DRAFTS);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }
  function saveDrafts(list) {
    try { localStorage.setItem(KEY_DRAFTS, JSON.stringify(list)); } catch {}
  }

  // ---------- API PUBBLICA ---------------------------------------------------
  window.Quote = {
    add(code, qty = 1) {
      const ex = quote.lines.find(l => l.code === code);
      if (ex) {
        ex.qty += qty;
      } else {
        quote.lines.push({ code, qty, marginPct: getDefaultMargin() });
      }
      save(); renderPanel();
      toast(`Aggiunto ${code} al preventivo`, "success");
    },
    open() { openPanel(); },
    count() { return quote.lines.reduce((s, l) => s + l.qty, 0); },
    has(code) { return !!quote.lines.find(l => l.code === code); },
  };

  // default margin from settings (stored per-session)
  function getDefaultMargin() {
    const v = parseFloat(localStorage.getItem("accequ-default-margin") || "25");
    return isNaN(v) ? 25 : v;
  }
  function setDefaultMargin(v) {
    localStorage.setItem("accequ-default-margin", String(v));
  }

  // ---------- CALCOLI --------------------------------------------------------
  function linePrices(line) {
    const item = window.__getItem ? window.__getItem(line.code) : null;
    const net = window.__getPrice ? window.__getPrice(line.code) : 0;
    const unavailable = window.__isUnavailable ? window.__isUnavailable(line.code) : false;
    const m = Math.min(99, Math.max(0, Number(line.marginPct) || 0));
    const factor = 1 - m / 100;
    const sale = net > 0 && factor > 0 ? net / factor : 0;
    const marginEuro = sale - net;
    return {
      item, net, unavailable,
      marginPct: m,
      sale,
      marginEuro,
      lineNet: net * line.qty,
      lineSale: sale * line.qty,
      lineMargin: marginEuro * line.qty,
    };
  }
  function totals() {
    let tNet = 0, tSale = 0, tMargin = 0, anyMissingPrice = false;
    for (const l of quote.lines) {
      const p = linePrices(l);
      if (p.net <= 0) anyMissingPrice = true;
      tNet += p.lineNet;
      tSale += p.lineSale;
      tMargin += p.lineMargin;
    }
    return { tNet, tSale, tMargin, anyMissingPrice };
  }
  function fmtEur(v) {
    try {
      return "€ " + new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
    } catch {
      return "€ " + v.toFixed(2);
    }
  }
  function fmtDate(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ---------- RENDER PANEL ---------------------------------------------------
  function renderPanel() {
    updateBadge();
    const body = document.getElementById("quoteBody");
    if (!body) return;

    const t = totals();
    const n = quote.lines.length;
    const header = `
      <div class="q-meta">
        <label class="q-field">
          <span>Cliente / destinatario</span>
          <input id="qCustomer" type="text" value="${escapeAttr(quote.customer)}" placeholder="es. Officina Rossi" />
        </label>
        <label class="q-field">
          <span>Riferimento / nota</span>
          <input id="qRef" type="text" value="${escapeAttr(quote.ref)}" placeholder="es. preventivo 24/04" />
        </label>
        <label class="q-field small">
          <span>Margine % di default per nuove righe</span>
          <input id="qDefMargin" type="number" min="0" max="99" step="0.5" value="${getDefaultMargin()}" />
        </label>
      </div>
    `;

    const rows = quote.lines.length === 0
      ? `<div class="q-empty">
           <p>Nessun articolo nel preventivo.</p>
           <small>Tocca “+ Preventivo” su una scheda per aggiungerlo.</small>
         </div>`
      : quote.lines.map((l, i) => {
          const p = linePrices(l);
          const title = p.item ? p.item.title : l.code;
          const noPriceWarn = p.net <= 0
            ? `<div class="q-warn">⚠ ${p.unavailable ? "Prodotto non fornibile" : "Prezzo non caricato"} — aggiorna l’Excel del listino</div>`
            : "";
          return `
          <div class="q-line" data-idx="${i}">
            <div class="q-line-head">
              <div class="q-line-title">
                <span class="q-line-code">${escapeHtml(l.code)}</span>
                <span class="q-line-desc">${escapeHtml(title)}</span>
              </div>
              <button class="q-line-del" data-action="del" data-idx="${i}" aria-label="Rimuovi">✕</button>
            </div>
            ${noPriceWarn}
            <div class="q-line-grid">
              <label class="q-ctl">
                <span>Qtà</span>
                <input type="number" min="1" step="1" value="${l.qty}" data-action="qty" data-idx="${i}" />
              </label>
              <label class="q-ctl">
                <span>Netto (€)</span>
                <input type="text" value="${p.net > 0 ? fmtEur(p.net).replace('€ ', '') : '—'}" readonly />
              </label>
              <label class="q-ctl">
                <span>Margine %</span>
                <input type="number" min="0" max="99" step="0.5" value="${l.marginPct}" data-action="margin" data-idx="${i}" />
              </label>
              <label class="q-ctl">
                <span>Vendita unitaria</span>
                <input type="text" value="${p.sale > 0 ? fmtEur(p.sale).replace('€ ', '') : '—'}" readonly />
              </label>
              <label class="q-ctl wide">
                <span>Totale riga</span>
                <input type="text" class="q-total" value="${p.lineSale > 0 ? fmtEur(p.lineSale) : '—'}" readonly />
              </label>
            </div>
          </div>`;
        }).join("");

    const totalsHtml = `
      <div class="q-totals">
        <div class="q-tot-row">
          <span>Totale costo netto</span>
          <strong>${fmtEur(t.tNet)}</strong>
        </div>
        <div class="q-tot-row">
          <span>Totale margine</span>
          <strong class="pos">${fmtEur(t.tMargin)}</strong>
        </div>
        <div class="q-tot-row big">
          <span>Totale vendita</span>
          <strong>${fmtEur(t.tSale)}</strong>
        </div>
        ${t.anyMissingPrice ? '<div class="q-warn small">Alcuni articoli non hanno prezzo — il totale è parziale.</div>' : ''}
      </div>
    `;

    const actions = `
      <div class="q-actions">
        <button class="btn-primary q-btn" data-qact="whatsapp">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20.5 3.5A11.8 11.8 0 0 0 12 0C5.4 0 0 5.4 0 12c0 2.1.6 4.1 1.6 5.9L0 24l6.3-1.6A12 12 0 0 0 12 24c6.6 0 12-5.4 12-12 0-3.2-1.3-6.2-3.5-8.5zM12 22c-1.9 0-3.7-.5-5.3-1.4l-.4-.2-3.7 1 1-3.6-.2-.4A10 10 0 1 1 12 22zm5.5-7.5c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2s-.8 1-1 1.2c-.2.2-.4.2-.7 0a8 8 0 0 1-2.4-1.5 9 9 0 0 1-1.7-2.1c-.2-.3 0-.5.1-.7l.5-.6c.2-.2.2-.3.3-.5.1-.2.1-.4 0-.5l-1-2.3c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1 2.9 1.2 3.1c.1.2 2 3.1 5 4.3l1.6.6c.7.2 1.3.2 1.8.1.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3z"/></svg>
          <span>Invia WhatsApp</span>
        </button>
        <button class="btn-ghost-md q-btn" data-qact="txt">⬇ Scarica TXT</button>
        <button class="btn-ghost-md q-btn" data-qact="copy">⎘ Copia</button>
        <button class="btn-ghost-md q-btn" data-qact="save">💾 Salva bozza</button>
        <button class="btn-ghost-md q-btn" data-qact="drafts">📂 Bozze</button>
        <button class="btn-ghost-md q-btn danger" data-qact="clear">🗑 Svuota</button>
      </div>
    `;

    body.innerHTML = header + `<div class="q-lines">${rows}</div>` + totalsHtml + actions;

    // Wire inputs
    document.getElementById("qCustomer").addEventListener("input", e => { quote.customer = e.target.value; save(); });
    document.getElementById("qRef").addEventListener("input", e => { quote.ref = e.target.value; save(); });
    const dm = document.getElementById("qDefMargin");
    if (dm) dm.addEventListener("input", e => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v)) setDefaultMargin(v);
    });

    body.querySelectorAll('[data-action="qty"]').forEach(el => {
      el.addEventListener("input", e => {
        const idx = +e.target.dataset.idx;
        const v = Math.max(1, parseInt(e.target.value) || 1);
        quote.lines[idx].qty = v;
        save();
        // re-render only totals/row to avoid losing focus
        refreshLineTotals(idx);
        refreshTotals();
      });
    });
    body.querySelectorAll('[data-action="margin"]').forEach(el => {
      el.addEventListener("input", e => {
        const idx = +e.target.dataset.idx;
        const v = Math.max(0, Math.min(99, parseFloat(e.target.value) || 0));
        quote.lines[idx].marginPct = v;
        save();
        refreshLineTotals(idx);
        refreshTotals();
      });
    });
    body.querySelectorAll('[data-action="del"]').forEach(el => {
      el.addEventListener("click", e => {
        const idx = +e.currentTarget.dataset.idx;
        quote.lines.splice(idx, 1);
        save(); renderPanel();
      });
    });

    body.querySelectorAll('[data-qact]').forEach(el => {
      el.addEventListener("click", () => handleAction(el.dataset.qact));
    });
  }

  function refreshLineTotals(idx) {
    const l = quote.lines[idx];
    const p = linePrices(l);
    const row = document.querySelector(`.q-line[data-idx="${idx}"]`);
    if (!row) return;
    // Update the "Vendita unitaria" and "Totale riga" fields
    const inputs = row.querySelectorAll('input[readonly]');
    // fields in order: Netto, Vendita unitaria, Totale riga
    // inputs[0] = netto (constant), inputs[1] = vendita unitaria, inputs[2] = totale riga
    if (inputs.length >= 3) {
      inputs[1].value = p.sale > 0 ? fmtEur(p.sale).replace('€ ', '') : '—';
      inputs[2].value = p.lineSale > 0 ? fmtEur(p.lineSale) : '—';
    }
  }

  function refreshTotals() {
    const t = totals();
    const totsEl = document.querySelector(".q-totals");
    if (!totsEl) return;
    const rows = totsEl.querySelectorAll(".q-tot-row strong");
    if (rows.length >= 3) {
      rows[0].textContent = fmtEur(t.tNet);
      rows[1].textContent = fmtEur(t.tMargin);
      rows[2].textContent = fmtEur(t.tSale);
    }
  }

  // ---------- AZIONI ---------------------------------------------------------
  function buildTextQuote() {
    const t = totals();
    const lines = [];
    lines.push("PREVENTIVO — Accessori Equilibratura Moto (Cormach MEC)");
    lines.push("=".repeat(56));
    if (quote.customer) lines.push("Cliente:    " + quote.customer);
    if (quote.ref)      lines.push("Rif.:       " + quote.ref);
    lines.push("Data:       " + fmtDate(Date.now()));
    lines.push("");
    if (!quote.lines.length) {
      lines.push("(nessun articolo)");
    } else {
      for (const l of quote.lines) {
        const p = linePrices(l);
        const title = p.item ? p.item.title : l.code;
        lines.push(`• ${l.code} — ${title}`);
        if (p.net > 0) {
          lines.push(`  qty ${l.qty}  ·  netto ${fmtEur(p.net)}  ·  margine ${l.marginPct}%  ·  vendita ${fmtEur(p.sale)}  ·  totale ${fmtEur(p.lineSale)}`);
        } else {
          lines.push(`  qty ${l.qty}  ·  ${p.unavailable ? "PRODOTTO NON FORNIBILE" : "prezzo non disponibile"}`);
        }
      }
    }
    lines.push("");
    lines.push("-".repeat(56));
    lines.push(`Totale netto:   ${fmtEur(t.tNet)}`);
    lines.push(`Totale margine: ${fmtEur(t.tMargin)}`);
    lines.push(`TOTALE VENDITA: ${fmtEur(t.tSale)}`);
    if (t.anyMissingPrice) lines.push("(!) Alcuni articoli non hanno prezzo — totale parziale.");
    lines.push("");
    lines.push("Prezzi netti IVA esclusa. Documento indicativo.");
    return lines.join("\n");
  }

  function handleAction(act) {
    switch (act) {
      case "txt": {
        const text = buildTextQuote();
        const fname = `preventivo_${(quote.customer || 'cliente').replace(/[^\w-]+/g, '_')}_${Date.now()}.txt`;
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = fname;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
        toast("File TXT scaricato", "success");
        break;
      }
      case "whatsapp": {
        const text = buildTextQuote();
        const url = "https://wa.me/?text=" + encodeURIComponent(text);
        window.open(url, "_blank", "noopener");
        break;
      }
      case "copy": {
        const text = buildTextQuote();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            () => toast("Testo copiato", "success"),
            () => toast("Copia non riuscita", "error")
          );
        } else {
          // fallback
          const ta = document.createElement("textarea");
          ta.value = text; document.body.appendChild(ta);
          ta.select(); document.execCommand("copy"); ta.remove();
          toast("Testo copiato", "success");
        }
        break;
      }
      case "save": {
        if (!quote.lines.length) { toast("Preventivo vuoto", "error"); break; }
        const drafts = loadDrafts();
        const name = prompt("Nome bozza:",
          (quote.customer || "Bozza") + " — " + new Date().toLocaleDateString("it-IT"));
        if (!name) break;
        drafts.unshift({ name, quote: JSON.parse(JSON.stringify(quote)), ts: Date.now() });
        // keep last 20
        saveDrafts(drafts.slice(0, 20));
        toast("Bozza salvata", "success");
        break;
      }
      case "drafts": {
        openDraftsModal();
        break;
      }
      case "clear": {
        if (!quote.lines.length) break;
        if (!confirm("Svuotare il preventivo corrente?")) break;
        quote = { customer: "", ref: "", lines: [], updatedAt: Date.now() };
        save(); renderPanel();
        break;
      }
    }
  }

  // ---------- DRAFTS MODAL ---------------------------------------------------
  function openDraftsModal() {
    const drafts = loadDrafts();
    const backdrop = document.getElementById("draftsBackdrop");
    const modal = document.getElementById("draftsModal");
    const list = document.getElementById("draftsList");
    if (!backdrop || !modal || !list) return;

    if (!drafts.length) {
      list.innerHTML = '<p class="q-empty-sm">Nessuna bozza salvata.</p>';
    } else {
      list.innerHTML = drafts.map((d, i) => `
        <div class="draft-item">
          <div class="draft-info">
            <div class="draft-name">${escapeHtml(d.name)}</div>
            <div class="draft-meta">${d.quote.lines.length} articoli · ${fmtDate(d.ts)}</div>
          </div>
          <div class="draft-ops">
            <button class="btn-ghost-md" data-op="load" data-idx="${i}">Carica</button>
            <button class="btn-ghost-md danger" data-op="del" data-idx="${i}">Elimina</button>
          </div>
        </div>
      `).join("");
      list.querySelectorAll("[data-op]").forEach(el => {
        el.addEventListener("click", () => {
          const idx = +el.dataset.idx;
          const op  = el.dataset.op;
          const all = loadDrafts();
          if (op === "load") {
            quote = JSON.parse(JSON.stringify(all[idx].quote));
            save(); renderPanel();
            closeDrafts();
            toast("Bozza caricata", "success");
          } else if (op === "del") {
            if (!confirm("Eliminare questa bozza?")) return;
            all.splice(idx, 1);
            saveDrafts(all);
            openDraftsModal(); // refresh
          }
        });
      });
    }
    backdrop.hidden = false;
    modal.hidden = false;
  }
  function closeDrafts() {
    const b = document.getElementById("draftsBackdrop");
    const m = document.getElementById("draftsModal");
    if (b) b.hidden = true;
    if (m) m.hidden = true;
  }

  // ---------- PANEL OPEN/CLOSE ----------------------------------------------
  function openPanel() {
    const backdrop = document.getElementById("quoteBackdrop");
    const panel = document.getElementById("quotePanel");
    if (!backdrop || !panel) return;
    renderPanel();
    backdrop.hidden = false;
    panel.hidden = false;
  }
  function closePanel() {
    const backdrop = document.getElementById("quoteBackdrop");
    const panel = document.getElementById("quotePanel");
    if (backdrop) backdrop.hidden = true;
    if (panel) panel.hidden = true;
  }

  // ---------- FAB BADGE ------------------------------------------------------
  function updateBadge() {
    const fab = document.getElementById("quoteFab");
    if (!fab) return;
    const n = quote.lines.length;
    const totalItems = quote.lines.reduce((s, l) => s + l.qty, 0);
    fab.dataset.count = totalItems > 0 ? String(totalItems) : "";
    const badge = fab.querySelector(".fab-badge");
    if (badge) {
      badge.textContent = totalItems > 0 ? String(totalItems) : "";
      badge.hidden = totalItems === 0;
    }
  }

  // ---------- HELPERS --------------------------------------------------------
  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function escapeAttr(s) { return escapeHtml(s); }
  function toast(msg, kind) {
    if (window.__toast) window.__toast(msg, kind);
  }

  // ---------- BOOT -----------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    load();
    updateBadge();

    const fab = document.getElementById("quoteFab");
    if (fab) fab.addEventListener("click", openPanel);

    const close = document.getElementById("quoteClose");
    if (close) close.addEventListener("click", closePanel);

    const bd = document.getElementById("quoteBackdrop");
    if (bd) bd.addEventListener("click", closePanel);

    const dbd = document.getElementById("draftsBackdrop");
    if (dbd) dbd.addEventListener("click", closeDrafts);
    const dcl = document.getElementById("draftsClose");
    if (dcl) dcl.addEventListener("click", closeDrafts);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closePanel(); closeDrafts(); }
    });
  });
})();
