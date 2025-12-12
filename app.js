// app.js

// IMPORTANT: this key is in client-side code, so treat this deployment as experimental.
// For production, route calls through a backend.
const API_KEY = "MQ2qInX7K7T26UMDJA2R9Q43zHccjTDn";

async function fetchJSON(url) {
  const res = await fetch(url);
  console.log("Request URL:", url, "Status:", res.status); // helps debug in browser console
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

async function getFinancials(symbol) {
  const base = "https://financialmodelingprep.com/api/v3";
  // 5 last annual statements as per FMP docs. [web:40][web:43]
  const [is, bs, cf] = await Promise.all([
    fetchJSON(
      `${base}/income-statement/${symbol}?period=annual&limit=5&apikey=${API_KEY}`
    ),
    fetchJSON(
      `${base}/balance-sheet-statement/${symbol}?period=annual&limit=5&apikey=${API_KEY}`
    ),
    fetchJSON(
      `${base}/cash-flow-statement/${symbol}?period=annual&limit=5&apikey=${API_KEY}`
    )
  ]);
  return { income: is, balance: bs, cashflow: cf };
}

function toYearsOrdered(data) {
  // FMP returns most recent first → reverse to chronological order. [web:43]
  return data.slice().reverse();
}

function computeRatios(fin) {
  const income = toYearsOrdered(fin.income);
  const balance = toYearsOrdered(fin.balance);
  const cashflow = toYearsOrdered(fin.cashflow);

  const years = income.map(r => r.calendarYear || r.date?.slice(0, 4));
  const ratios = years.map((y, i) => {
    const is = income[i];
    const bs = balance[i] || {};
    const cf = cashflow[i] || {};
    const revenue = is.revenue || 0;
    const netIncome = is.netIncome || 0;
    const totalAssets = bs.totalAssets || 0;
    const totalLiabilities = bs.totalLiabilities || 0;
    const totalEquity = bs.totalStockholdersEquity || bs.totalEquity || 0;
    const currentAssets = bs.totalCurrentAssets || 0;
    const currentLiabilities = bs.totalCurrentLiabilities || 0;
    const inventory = bs.inventory || 0;
    const receivables = bs.netReceivables || bs.accountsReceivable || 0;
    const payables = bs.accountPayables || 0;
    const cash =
      bs.cashAndCashEquivalents || bs.cashAndShortTermInvestments || 0;
    const opCF =
      cf.netCashProvidedByOperatingActivities || cf.operatingCashFlow || 0;

    return {
      year: y,
      revenue,
      netIncome,
      margin: revenue ? netIncome / revenue : null,
      roa: totalAssets ? netIncome / totalAssets : null,
      debtToEquity: totalEquity ? totalLiabilities / totalEquity : null,
      currentRatio: currentLiabilities ? currentAssets / currentLiabilities : null,
      cashToDebt: totalLiabilities ? cash / totalLiabilities : null,
      dso: revenue ? (receivables / revenue) * 365 : null,
      dio: revenue ? (inventory / revenue) * 365 : null,
      dpo: revenue ? (payables / revenue) * 365 : null,
      opCF,
      cash,
      totalEquity
    };
  });
  return ratios;
}

function computeGrowth(series) {
  return series.map((v, i) => {
    if (i === 0 || v == null || series[i - 1] == null || series[i - 1] === 0)
      return null;
    return (v - series[i - 1]) / Math.abs(series[i - 1]);
  });
}

function zScores(arr) {
  const vals = arr.filter(v => v != null);
  const n = vals.length;
  if (n < 2) return arr.map(() => null);
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const sd =
    Math.sqrt(
      vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1)
    ) || 0.000001;
  return arr.map(v => (v == null ? null : (v - mean) / sd));
}

function detectAnomalies(ratios) {
  const margin = ratios.map(r => r.margin);
  const debtEq = ratios.map(r => r.debtToEquity);
  const opCF = ratios.map(r => r.opCF);
  const netIncome = ratios.map(r => r.netIncome);
  const equity = ratios.map(r => r.totalEquity);
  const cash = ratios.map(r => r.cash);

  const marginZ = zScores(margin);
  const debtEqZ = zScores(debtEq);

  const flags = [];
  ratios.forEach((r, i) => {
    const yearFlags = [];
    if (marginZ[i] != null && marginZ[i] < -1.5) {
      yearFlags.push("Sharp margin deterioration vs 5Y mean");
    }
    if (debtEqZ[i] != null && debtEqZ[i] > 1.5) {
      yearFlags.push("Leverage spike vs 5Y mean");
    }
    if (netIncome[i] < 0 && opCF[i] < 0) {
      yearFlags.push("Both net income and operating cash flow negative");
    }
    if (equity[i] != null && cash[i] != null) {
      const eqGr = i > 0 && equity[i - 1] ? equity[i] - equity[i - 1] : null;
      const cashGr = i > 0 && cash[i - 1] ? cash[i] - cash[i - 1] : null;
      if (eqGr < 0 && cashGr < 0) {
        yearFlags.push(
          "Equity and cash declining together (value erosion + cash burn)"
        );
      }
    }
    flags.push(yearFlags);
  });

  return flags;
}

function renderRatiosTable(ratios, flags) {
  if (!ratios.length) {
    document.getElementById("ratiosTable").innerHTML = "<span>No data.</span>";
    return;
  }
  const headerYears = ratios.map(r => `<th>${r.year}</th>`).join("");
  function row(label, key, fmtPct = false) {
    const cells = ratios
      .map((r, i) => {
        let v = r[key];
        if (v == null) return "<td>-</td>";
        const formatted = fmtPct
          ? (v * 100).toFixed(1) + "%"
          : Math.abs(v) > 1e9
          ? (v / 1e9).toFixed(2) + "B"
          : Math.abs(v) > 1e6
          ? (v / 1e6).toFixed(2) + "M"
          : v.toFixed(2);
        const f = flags[i] || [];
        const hasNeg = f.some(
          s =>
            s.toLowerCase().includes("negative") ||
            s.toLowerCase().includes("deterioration") ||
            s.toLowerCase().includes("declin")
        );
        const cls = hasNeg ? "anomaly-neg" : "";
        return `<td class="${cls}">${formatted}</td>`;
      })
      .join("");
    return `<tr><td>${label}</td>${cells}</tr>`;
  }

  const html = `
    <table>
      <tr><th>Metric</th>${headerYears}</tr>
      ${row("Revenue", "revenue")}
      ${row("Net income", "netIncome")}
      ${row("Net margin", "margin", true)}
      ${row("ROA", "roa", true)}
      ${row("Debt / Equity", "debtToEquity")}
      ${row("Current ratio", "currentRatio")}
      ${row("Cash / Debt", "cashToDebt")}
      ${row("DSO (days)", "dso")}
      ${row("DIO (days)", "dio")}
      ${row("DPO (days)", "dpo")}
      ${row("Operating CF", "opCF")}
      ${row("Cash", "cash")}
      ${row("Total equity", "totalEquity")}
    </table>
  `;
  document.getElementById("ratiosTable").innerHTML = html;
}

let revNiChart, cashNiChart;

function renderCharts(ratios) {
  const ctx1 = document.getElementById("revNiChart").getContext("2d");
  const ctx2 = document.getElementById("cashNiChart").getContext("2d");
  const labels = ratios.map(r => r.year);
  const rev = ratios.map(r => r.revenue);
  const ni = ratios.map(r => r.netIncome);
  const cash = ratios.map(r => r.cash);
  const opCF = ratios.map(r => r.opCF);

  if (revNiChart) revNiChart.destroy();
  if (cashNiChart) cashNiChart.destroy();

  revNiChart = new Chart(ctx1, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Revenue",
          data: rev,
          borderColor: "#00bcd4",
          backgroundColor: "transparent"
        },
        {
          label: "Net Income",
          data: ni,
          borderColor: "#8bc34a",
          backgroundColor: "transparent"
        }
      ]
    },
    options: {
      plugins: { legend: { labels: { color: "#f2f2f2" } } },
      scales: {
        x: { ticks: { color: "#f2f2f2" } },
        y: { ticks: { color: "#f2f2f2" } }
      }
    }
  });

  cashNiChart = new Chart(ctx2, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Cash",
          data: cash,
          borderColor: "#ffca28",
          backgroundColor: "transparent"
        },
        {
          label: "Operating CF",
          data: opCF,
          borderColor: "#ff7043",
          backgroundColor: "transparent"
        }
      ]
    },
    options: {
      plugins: { legend: { labels: { color: "#f2f2f2" } } },
      scales: {
        x: { ticks: { color: "#f2f2f2" } },
        y: { ticks: { color: "#f2f2f2" } }
      }
    }
  });
}

function renderAnomalySummary(ratios, flags) {
  const container = document.getElementById("anomalySummary");
  let html = "";
  flags.forEach((f, i) => {
    if (!f.length) return;
    html += `<div class="interpretation"><strong>${ratios[i].year}:</strong> `;
    html += f
      .map(s => `<span class="badge badge-red">⚠ ${s}</span>`)
      .join(" ");
    html += "</div>";
  });
  if (!html)
    html =
      "<span>No major statistical anomalies detected over the last 5 years (given current rules).</span>";
  container.innerHTML = html;
}

function renderInterpretation(ratios, flags, symbol) {
  const latest = ratios[ratios.length - 1];
  const latestFlags = flags[flags.length - 1] || [];
  const gRev = computeGrowth(ratios.map(r => r.revenue));
  const gNi = computeGrowth(ratios.map(r => r.netIncome));
  const gOp = computeGrowth(ratios.map(r => r.opCF));

  const lastRevGr = gRev[gRev.length - 1];
  const lastNiGr = gNi[gNi.length - 1];
  const lastOpGr = gOp[gOp.length - 1];

  function pct(v) {
    return v == null ? "n/a" : (v * 100).toFixed(1) + "%";
  }

  let html = "";
  html += `<div class="interpretation"><strong>Growth profile:</strong> Latest year revenue growth ${pct(
    lastRevGr
  )}, net income growth ${pct(
    lastNiGr
  )}, operating cash flow growth ${pct(
    lastOpGr
  )}. Divergence between revenue and cash flow growth highlights potential earnings‑quality issues.</div>`;
  html += `<div class="interpretation"><strong>Quality & leverage:</strong> Net margin in the latest year is ${pct(
    latest.margin
  )} with ROA ${pct(
    latest.roa
  )}; debt‑to‑equity is ${
    latest.debtToEquity?.toFixed(2) ?? "n/a"
  }, which you can compare with sector medians when extending the app.</div>`;
  if (latestFlags.length) {
    html += `<div class="interpretation"><strong>Key concerns in latest year for ${symbol.toUpperCase()}:</strong> ${latestFlags.join(
      "; "
    )}. These patterns warrant deeper note‑level review before an investment decision.</div>`;
  } else {
    html += `<div class="interpretation"><strong>Key concerns in latest year for ${symbol.toUpperCase()}:</strong> No rule‑based anomalies flagged, but investors should still review footnotes, competitive dynamics, and valuation before investing.</div>`;
  }

  document.getElementById("interpretationBlock").innerHTML = html;
}

async function runAnalysis() {
  const symbol = document.getElementById("symbolInput").value.trim();
  if (!symbol) {
    alert("Enter a symbol.");
    return;
  }
  document.getElementById("status").textContent = "Loading 5‑year financials...";
  try {
    const fin = await getFinancials(symbol);
    const ratios = computeRatios(fin);
    const flags = detectAnomalies(ratios);
    renderRatiosTable(ratios, flags);
    renderCharts(ratios);
    renderAnomalySummary(ratios, flags);
    renderInterpretation(ratios, flags, symbol);
    document.getElementById("status").textContent = "";
  } catch (e) {
    console.error(e);
    document.getElementById("status").textContent =
      "Error fetching data. Check symbol or API key.";
  }
}
