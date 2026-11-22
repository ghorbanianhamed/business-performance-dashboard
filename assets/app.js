/* Business Performance Dashboard: filters, KPIs, tier donut, MO combo chart, monthly trend, client table. */
(function () {
  "use strict";

  const RAW = (window.DASH_DATA || []).map((r) => ({
    ...r,
    month: r.production_end_date ? r.production_end_date.slice(0, 7) : "",
    year: r.production_end_date ? r.production_end_date.slice(0, 4) : "",
  }));

  const TIERS = [
    { key: "Highly profitable", rule: "GM above 30%", cls: "good", token: "--good" },
    { key: "Moderate margin", rule: "GM 0% to 30%", cls: "warn", token: "--warn" },
    { key: "Unprofitable", rule: "GM below 0%", cls: "bad", token: "--bad" },
  ];
  const TARGET = RAW.find((r) => r.target_margin != null)?.target_margin ?? 0.3;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const fmtMoney = (v) => (v < 0 ? "-$" : "$") + Math.abs(Math.round(v)).toLocaleString("en-US");
  const fmtMoney2 = (v) => (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtCompact = (v) => {
    const a = Math.abs(v);
    const s = a >= 1e6 ? (a / 1e6).toFixed(2) + "M" : a >= 1e3 ? (a / 1e3).toFixed(0) + "K" : a.toFixed(0);
    return (v < 0 ? "-$" : "$") + s;
  };
  const fmtPct = (v) => (v * 100).toFixed(0) + "%";
  const monthLabel = (m) => MONTHS[+m.slice(5, 7) - 1] + " " + m.slice(0, 4);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const tierOf = (gm) => (gm > 0.3 ? TIERS[0] : gm >= 0 ? TIERS[1] : TIERS[2]);
  const uniq = (arr) => [...new Set(arr)].filter((v) => v !== "" && v != null);

  /* ---------- Filters ---------- */
  const latestMonth = "2026-09";
  const FILTERS = [
    { key: "year", label: "Year", values: () => uniq(RAW.map((r) => r.year)).sort(), fmt: (v) => v },
    { key: "month", label: "Month", values: () => uniq(RAW.map((r) => r.month)).sort(), fmt: monthLabel },
    { key: "client", label: "Client", values: () => uniq(RAW.map((r) => r.client)).sort((a, b) => a.localeCompare(b, "en", { numeric: true })), fmt: (v) => v },
    { key: "product", label: "Product issued", values: () => uniq(RAW.map((r) => r.product)).sort((a, b) => a.localeCompare(b, "en", { numeric: true })), fmt: (v) => v },
    { key: "mo", label: "MO#", values: () => uniq(RAW.map((r) => String(r.mo))).sort((a, b) => a - b), fmt: (v) => v },
  ];
  const defaultState = () => ({ year: new Set(), month: new Set([latestMonth]), client: new Set(), product: new Set(), mo: new Set() });
  let state = defaultState();
  let sortBy = "mo";

  const filtersEl = document.getElementById("filters");
  let openMenu = null;

  function buildFilters() {
    filtersEl.textContent = "";
    FILTERS.forEach((f) => {
      const dd = document.createElement("div");
      dd.className = "dd";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dd-btn";
      btn.id = "f-" + f.key;
      btn.setAttribute("aria-haspopup", "true");
      btn.setAttribute("aria-expanded", "false");
      const lbl = document.createElement("span");
      lbl.className = "lbl";
      lbl.textContent = f.label;
      const val = document.createElement("span");
      val.className = "val";
      btn.append(lbl, val);
      dd.append(btn);

      const menu = document.createElement("div");
      menu.className = "dd-menu";
      menu.hidden = true;
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "clear";
      clear.textContent = "Show all";
      clear.addEventListener("click", () => { state[f.key].clear(); syncMenu(); render(); });
      menu.append(clear);
      const boxes = [];
      f.values().forEach((v) => {
        const l = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.id = "f-" + f.key + "-" + v;
        cb.value = v;
        cb.addEventListener("change", () => {
          cb.checked ? state[f.key].add(v) : state[f.key].delete(v);
          syncButton();
          render();
        });
        boxes.push(cb);
        l.append(cb, document.createTextNode(f.fmt(v)));
        menu.append(l);
      });
      dd.append(menu);
      filtersEl.append(dd);

      function syncButton() {
        const sel = [...state[f.key]];
        val.textContent = sel.length === 0 ? "All" : sel.length === 1 ? f.fmt(sel[0]) : sel.length + " selected";
        btn.classList.toggle("active", sel.length > 0);
      }
      function syncMenu() {
        boxes.forEach((cb) => { cb.checked = state[f.key].has(cb.value); });
        syncButton();
      }
      f.sync = syncMenu;
      syncMenu();

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const willOpen = menu.hidden;
        closeMenus();
        if (willOpen) { menu.hidden = false; btn.setAttribute("aria-expanded", "true"); openMenu = { menu, btn }; }
      });
      menu.addEventListener("click", (e) => e.stopPropagation());
    });
  }
  function closeMenus() {
    if (openMenu) { openMenu.menu.hidden = true; openMenu.btn.setAttribute("aria-expanded", "false"); openMenu = null; }
  }
  document.addEventListener("click", closeMenus);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenus(); });
  document.getElementById("reset").addEventListener("click", () => {
    state = defaultState();
    FILTERS.forEach((f) => f.sync());
    render();
  });

  const matches = (r, except) =>
    FILTERS.every((f) => f.key === except || state[f.key].size === 0 || state[f.key].has(String(r[f.key])));

  /* ---------- Aggregation ---------- */
  function totals(rows) {
    const rev = rows.reduce((s, r) => s + r.revenue, 0);
    const cost = rows.reduce((s, r) => s + r.mo_cost, 0);
    return { rev, cost, gp: rev - cost, gm: rev ? (rev - cost) / rev : 0, n: rows.length };
  }

  /* ---------- KPIs ---------- */
  function renderKpis(rows) {
    const t = totals(rows);
    document.getElementById("k-rev").textContent = fmtMoney2(t.rev);
    document.getElementById("k-cost").textContent = fmtMoney2(t.cost);
    document.getElementById("k-gp").textContent = fmtMoney2(t.gp);
    document.getElementById("k-gm").textContent = rows.length ? (t.gm * 100).toFixed(1) + "%" : "—";
    document.getElementById("k-n").textContent = t.n + " manufacturing order" + (t.n === 1 ? "" : "s");

    const gmD = document.getElementById("k-gm-d");
    gmD.textContent = "";
    if (rows.length) {
      const pill = document.createElement("span");
      pill.className = "pill " + (t.gm >= TARGET ? "good" : t.gm >= 0 ? "warn" : "bad");
      const diff = (t.gm - TARGET) * 100;
      pill.textContent = (diff >= 0 ? "+" : "") + diff.toFixed(1) + " pts vs " + fmtPct(TARGET) + " target";
      gmD.append(pill);
    }

    // Fixed-cost coverage: fixed cost is stored per month, so count each month once.
    const fixedByMonth = new Map();
    rows.forEach((r) => { if (r.monthly_fixed_cost != null) fixedByMonth.set(r.month, r.monthly_fixed_cost); });
    const fixed = [...fixedByMonth.values()].reduce((s, v) => s + v, 0);
    const onlyMonthFiltered = state.client.size === 0 && state.product.size === 0 && state.mo.size === 0;
    document.getElementById("k-be").textContent =
      fixed && onlyMonthFiltered ? "Covers " + fmtPct(t.gp / fixed) + " of " + fmtCompact(fixed) + " fixed cost" : "Revenue minus MO cost";
  }

  /* ---------- Donut ---------- */
  function renderDonut(rows) {
    const svg = document.getElementById("donut");
    const legend = document.getElementById("tier-legend");
    svg.textContent = "";
    legend.textContent = "";
    const ns = "http://www.w3.org/2000/svg";
    const counts = TIERS.map((t) => rows.filter((r) => r.margin_tier === t.key).length);
    const total = counts.reduce((a, b) => a + b, 0);
    const R = 50, r0 = 31, cx = 60, cy = 60;
    let a0 = -Math.PI / 2;

    if (!total) {
      const c = document.createElementNS(ns, "circle");
      Object.entries({ cx, cy, r: (R + r0) / 2, fill: "none", stroke: css("--line"), "stroke-width": R - r0 }).forEach(([k, v]) => c.setAttribute(k, v));
      svg.append(c);
    }
    TIERS.forEach((t, i) => {
      const share = total ? counts[i] / total : 0;
      if (share > 0) {
        const a1 = a0 + share * Math.PI * 2 - (share === 1 ? 1e-4 : 0);
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const p = (rad, ang) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
        const [x0, y0] = p(R, a0), [x1, y1] = p(R, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", `M${x0} ${y0}A${R} ${R} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`);
        path.setAttribute("fill", css(t.token));
        path.setAttribute("stroke", css("--surface"));
        path.setAttribute("stroke-width", "1.5");
        const title = document.createElementNS(ns, "title");
        title.textContent = `${t.key}: ${counts[i]} orders (${(share * 100).toFixed(1)}%)`;
        path.append(title);
        svg.append(path);
        a0 = a1;
      }
      const li = document.createElement("li");
      const sw = document.createElement("span");
      sw.className = "sw";
      sw.style.background = css(t.token);
      const name = document.createElement("span");
      name.textContent = t.key;
      const rule = document.createElement("span");
      rule.className = "rule";
      rule.textContent = t.rule + " · " + counts[i] + " MOs";
      name.append(rule);
      const pct = document.createElement("span");
      pct.className = "pct";
      pct.textContent = total ? (share * 100).toFixed(1) + "%" : "—";
      li.append(sw, name, pct);
      legend.append(li);
    });
    const txt = document.createElementNS(ns, "text");
    txt.setAttribute("x", cx); txt.setAttribute("y", cy + 5);
    txt.setAttribute("text-anchor", "middle"); txt.setAttribute("font-size", "15");
    txt.textContent = total;
    svg.append(txt);
  }

  /* ---------- Charts ---------- */
  let moChart, trendChart;

  // Draws the gross-margin label above (or below) each profit bar.
  const marginLabels = {
    id: "marginLabels",
    afterDatasetsDraw(chart) {
      const meta = chart.getDatasetMeta(0);
      if (!meta || meta.hidden) return;
      const { ctx } = chart;
      const rows = chart.$rows || [];
      const crowded = meta.data.length > 45;
      ctx.save();
      ctx.font = `600 ${crowded ? 9 : 11}px ${css("--font-ui")}`;
      ctx.fillStyle = css("--fg");
      ctx.textAlign = "center";
      meta.data.forEach((bar, i) => {
        const r = rows[i];
        if (!r) return;
        const neg = r.gross_profit < 0;
        ctx.textBaseline = neg ? "top" : "bottom";
        ctx.fillText(fmtPct(r.gross_margin), bar.x, bar.y + (neg ? 4 : -4));
      });
      ctx.restore();
    },
  };

  function baseOptions() {
    const muted = css("--muted"), grid = css("--line");
    Chart.defaults.font.family = css("--font-ui");
    Chart.defaults.color = muted;
    return { muted, grid };
  }

  function renderMoChart(rows) {
    const { muted, grid } = baseOptions();
    const sorted = [...rows].sort((a, b) =>
      sortBy === "gp" ? b.gross_profit - a.gross_profit : sortBy === "gm" ? b.gross_margin - a.gross_margin : a.mo - b.mo);

    const box = document.getElementById("mo-box");
    box.style.width = Math.max(sorted.length * 34, 0) + "px";
    box.style.minWidth = "100%";

    const data = {
      labels: sorted.map((r) => String(r.mo)),
      datasets: [
        {
          type: "bar", label: "Gross profit", yAxisID: "y", order: 2,
          data: sorted.map((r) => r.gross_profit),
          backgroundColor: sorted.map((r) => css(tierOf(r.gross_margin).token)),
          borderRadius: 2, maxBarThickness: 42,
        },
        {
          type: "line", label: "Units produced", yAxisID: "y1", order: 1,
          data: sorted.map((r) => r.sf_units),
          borderColor: css("--series-units"), backgroundColor: css("--series-units"),
          borderWidth: 1.5, pointRadius: 3, tension: 0,
        },
        {
          type: "line", label: "Cost per unit", yAxisID: "y2", order: 0,
          data: sorted.map((r) => r.unit_cost),
          borderColor: css("--series-cost"), backgroundColor: css("--series-cost"),
          borderWidth: 1.5, borderDash: [4, 3], pointRadius: 2.5, tension: 0,
        },
      ],
    };
    const options = {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 18 } },
      plugins: {
        legend: { position: "top", align: "start", labels: { boxWidth: 12, boxHeight: 12, sort: (a, b) => a.datasetIndex - b.datasetIndex } },
        tooltip: {
          callbacks: {
            title: (items) => {
              const r = sorted[items[0].dataIndex];
              return `MO ${r.mo} · ${r.client} · ${r.product}`;
            },
            afterTitle: (items) => {
              const r = sorted[items[0].dataIndex];
              return `Produced ${r.production_end_date} · ${r.margin_tier}`;
            },
            label: (item) => {
              const r = sorted[item.dataIndex];
              if (item.datasetIndex === 0) return [` Revenue ${fmtMoney(r.revenue)}`, ` MO cost ${fmtMoney(r.mo_cost)}`, ` Gross profit ${fmtMoney(r.gross_profit)} (${(r.gross_margin * 100).toFixed(1)}%)`];
              if (item.datasetIndex === 1) return ` Units produced ${r.sf_units.toLocaleString("en-US")}`;
              return ` Cost $${r.unit_cost.toFixed(2)}/unit · price $${r.unit_price.toFixed(2)}/unit`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: muted, maxRotation: 50, minRotation: 0, autoSkip: false, font: { size: 10 } }, title: { display: true, text: "Manufacturing order (MO#)", color: muted } },
        y: { position: "left", grid: { color: grid }, ticks: { color: muted, callback: (v) => fmtCompact(v) }, title: { display: true, text: "Gross profit", color: muted } },
        y1: { position: "right", grid: { display: false }, ticks: { color: muted, callback: (v) => (v >= 1000 ? v / 1000 + "K" : v) }, title: { display: true, text: "Units produced", color: muted }, beginAtZero: true },
        y2: { display: false, beginAtZero: true },
      },
    };
    if (moChart) moChart.destroy();
    moChart = new Chart(document.getElementById("mo-chart"), { data, options, plugins: [marginLabels] });
    moChart.$rows = sorted;
    moChart.update("none");
  }

  function renderTrend() {
    const { muted, grid } = baseOptions();
    const rows = RAW.filter((r) => matches(r, "month"));
    const months = uniq(RAW.map((r) => r.month)).sort();
    const agg = months.map((m) => totals(rows.filter((r) => r.month === m)));
    const selected = state.month;
    const accent = css("--accent");
    const data = {
      labels: months.map(monthLabel),
      datasets: [
        { type: "bar", label: "Revenue", yAxisID: "y", order: 2, data: agg.map((a) => a.rev),
          backgroundColor: months.map((m) => (selected.size === 0 || selected.has(m) ? accent : css("--line"))), borderRadius: 2 },
        { type: "bar", label: "MO cost", yAxisID: "y", order: 2, data: agg.map((a) => a.cost),
          backgroundColor: css("--series-units"), borderRadius: 2 },
        { type: "line", label: "Gross margin", yAxisID: "y1", order: 0, data: agg.map((a) => (a.n ? a.gm : null)),
          borderColor: css("--fg"), backgroundColor: css("--fg"), pointRadius: 3, borderWidth: 2, spanGaps: true },
        { type: "line", label: fmtPct(TARGET) + " target", yAxisID: "y1", order: 1, data: months.map(() => TARGET),
          borderColor: css("--good"), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 },
      ],
    };
    const options = {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", align: "start", labels: { boxWidth: 12, boxHeight: 12, sort: (a, b) => a.datasetIndex - b.datasetIndex } },
        tooltip: { callbacks: { label: (it) => " " + it.dataset.label + " " + (it.datasetIndex >= 2 ? (it.raw * 100).toFixed(1) + "%" : fmtMoney(it.raw)) } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: muted, font: { size: 10 } } },
        y: { grid: { color: grid }, ticks: { color: muted, callback: (v) => fmtCompact(v) } },
        y1: { position: "right", grid: { display: false }, min: 0, max: 0.5, ticks: { color: muted, callback: (v) => fmtPct(v) } },
      },
    };
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(document.getElementById("trend-chart"), { data, options });
  }

  /* ---------- Client table ---------- */
  function renderClients(rows) {
    const tbody = document.querySelector("#client-table tbody");
    tbody.textContent = "";
    const by = new Map();
    rows.forEach((r) => { if (!by.has(r.client)) by.set(r.client, []); by.get(r.client).push(r); });
    const list = [...by.entries()].map(([c, rs]) => ({ c, ...totals(rs) })).sort((a, b) => b.gp - a.gp);
    if (!list.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5; td.className = "empty";
      td.textContent = "No orders match these filters.";
      tr.append(td); tbody.append(tr);
      return;
    }
    list.forEach((x) => {
      const tr = document.createElement("tr");
      const cells = [x.c, x.n, fmtMoney(x.rev), fmtMoney(x.gp)];
      cells.forEach((v, i) => { const td = document.createElement("td"); td.textContent = v; if (i) td.className = "n"; tr.append(td); });
      const td = document.createElement("td");
      td.className = "n";
      const pill = document.createElement("span");
      pill.className = "pill " + tierOf(x.gm).cls;
      pill.textContent = (x.gm * 100).toFixed(1) + "%";
      td.append(pill);
      tr.append(td);
      tbody.append(tr);
    });
  }

  /* ---------- Render ---------- */
  function render() {
    const rows = RAW.filter((r) => matches(r));
    renderKpis(rows);
    renderDonut(rows);
    renderMoChart(rows);
    renderTrend();
    renderClients(rows);
  }

  document.querySelectorAll(".seg button").forEach((b) =>
    b.addEventListener("click", () => {
      sortBy = b.dataset.sort;
      document.querySelectorAll(".seg button").forEach((x) => x.classList.toggle("on", x === b));
      renderMoChart(RAW.filter((r) => matches(r)));
    }));

  // Redraw charts when the viewer's color scheme changes, so canvas colors follow the theme.
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  (mq.addEventListener ? mq.addEventListener.bind(mq, "change") : mq.addListener.bind(mq))(render);
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // Footer: describe the dataset from the data itself, so it stays right when the data is regenerated.
  const allMonths = uniq(RAW.map((r) => r.month)).sort();
  const rangeEl = document.getElementById("data-range");
  if (rangeEl && allMonths.length) {
    rangeEl.textContent = RAW.length + " manufacturing orders, " + monthLabel(allMonths[0]) + " – " + monthLabel(allMonths[allMonths.length - 1]);
  }

  buildFilters();
  render();
})();
