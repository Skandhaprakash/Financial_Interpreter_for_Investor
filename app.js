// app.js - CORRECTED VERSION with proper FMP API endpoints

const API_KEY = "MQ2qInX7K7T26UMDJA2R9Q43zHccjTDn";

async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    console.log("Request URL:", url, "Status:", res.status);
    if (!res.ok) {
      const text = await res.text();
      console.error("Error response:", text);
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    return data;
  } catch (e) {
    console.error("Fetch error:", e);
    throw e;
  }
}

async function getFinancials(symbol) {
  const base = "https://financialmodelingprep.com/stable";
  
  try {
    // Correct endpoints using /stable/ and period=FY for annual data
    const isData = await fetchJSON(
      `${base}/income-statement/${symbol}?period=FY&limit=5&apikey=${API_KEY}`
    );
    const bsData = await fetchJSON(
      `${base}/balance-sheet-statement/${symbol}?period=FY&limit=5&apikey=${API_KEY}`
    );
    const cfData = await fetchJSON(
      `${base}/cash-flow-statement/${symbol}?period=FY&limit=5&apikey=${API_KEY}`
    );
    
    // Validate responses
    if (!Array.isArray(isData) || !Array.isArray(bsData) || !Array.isArray(cfData)) {
      throw new Error("Invalid API responses - expected arrays");
    }
    
    return { income: isData, balance: bsData, cashflow: cfData };
  } catch (e) {
    console.error("getFinancials error:", e);
    throw e;
  }
}

function toYearsOrdered(data) {
  if (!Array.isArray(data) || data.length === 0) return [];
  return data.slice().reverse();
}

function computeRatios(fin) {
  const income = toYearsOrdered(fin.income);
  const balance = toYearsOrdered(fin.balance);
  const cashflow = toYearsOrdered(fin.cashflow);

  if (income.length === 0) {
    throw new Error("No financial data received from API");
  }

  const years = income.map((r, idx) => {
    return r.calendarYear || (r.date ? r.date.slice(0, 4) : `Year${idx}`);
  });

  const ratios = years.map((y, i) => {
    const is = income[i] || {};
    const bs = balance[i] || {};
    const cf = cashflow[i] || {};

    const revenue = is.revenue || 0;
    const netIncome = is.netIncome || 0;
    const grossProfit = is.grossProfit || 0;
    const operatingIncome = is.operatingIncome || 0;

    const totalAssets = bs.totalAssets || 0;
    const totalLiabilities = bs.totalLiabilities || 0;
    const totalEquity = bs.totalStockholdersEquity || bs.totalEquity || 0;
    const currentAssets = bs.totalCurrentAssets || 0;
    const currentLiabilities = bs.totalCurrentLiabilities || 0;
    const inventory = bs.inventory || 0;
    const netReceivables = bs.netReceivables || 0;
    const accountsReceivable = bs.accountsReceivable || 0;
    const accountPayables = bs.accountPayables || 0;
    const cash = bs.cashAndCashEquivalents || 0;

    const operatingCashFlow = cf.netCashProvidedByOperatingActivities || cf.operatingCashFlow || 0;

    const receivables = netReceivables || accountsReceivable || 0;
    const payables = accountPayables || 0;

    return {
      year: y,
      revenue,
      netIncome,
      grossProfit,
      operatingIncome,
      margin: revenue ? (netIncome / revenue) * 100 : null,
      grossMargin: revenue ? (grossProfit / revenue) * 100 : null,
      operatingMargin: revenue ? (operatingIncome / revenue) * 100 : null,
      roa: totalAssets ? (netIncome / totalAssets) * 100 : null,
      debtToEquity: totalEquity ? totalLiabilities / totalEquity : null,
      currentRatio: currentLiabilities ? currentAssets / currentLiabilities : null,
      quickRatio: currentLiabilities ? (currentAssets - inventory) / currentLiabilities : null,
      cashToDebt: totalLiabilities ? cash / totalLiabilities : null,
      dso: revenue ? (receivables / revenue) * 365 : null,
      dio: revenue ? (inventory / revenue) * 365 : null,
      dpo: revenue ? (payables / revenue) * 365 : null,
      operatingCashFlow,
      cash,
      totalEquity,
      totalAssets,
      totalLiabilities
    };
  });

  return ratios;
}

function computeGrowth(series) {
  return series.map((v, i) => {
    if (i === 0 || v == null || series[i - 1] == null || series[i - 1] === 0) {
      return null;
    }
    return ((v - series[i - 1]) / Math.abs(series[i - 1])) * 100;
  });
}

function zScores(arr) {
  const vals = arr.filter(v => v != null && !isNaN(v));
  const n = vals.length;
  if (n < 2) return arr.map(() => null);
  
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1);
  const sd = Math.sqrt(variance) || 0.000001;
  
  return arr.map(v => (v == null || isNaN(v) ? null : (v - mean) / sd));
}

function detectAnomalies(ratios) {
  const margin = ratios.map(r => r.margin);
  const debtEq = ratios.map(r => r.debtToEquity);
  const opCF = ratios.map(r => r.operatingCashFlow);
  const netIncome = ratios.map(r => r.netIncome);
  const equity = ratios.map(r => r.totalEquity);
  const cash = ratios.map(r => r.cash);

  const marginZ = zScores(margin);
  const debtEqZ = zScores(debtEq);

  const flags = [];
  ratios.forEach((r, i) => {
    const yearFlags = [];
    
    if (marginZ[i] != null && marginZ[i] < -1.5) {
      yearFlags.push("⚠ Sharp margin deterioration vs 5Y mean");
    }
    
    if (debtEqZ[i] != null && debtEqZ[i] > 1.5) {
      yearFlags.push("⚠ Leverage spike vs 5Y mean");
    }
    
    if (netIncome[i] < 0 && opCF[i] < 0) {
      yearFlags.push("⚠ Both net income and operating cash flow negative");
    }
    
    if (equity[i] != null && cash[i] != null) {
      const eqGr = i > 0 && equity[i - 1] ? equity[i] - equity[i - 1] : null;
      const cashGr = i > 0 && cash[i - 1] ? cash[i] - cash[i - 1] : null;
      if (eqGr != null && cashGr != null && eqGr < 0 && cashGr < 0) {
        yearFlags.push("⚠ Equity and cash declining together (value erosion + cash burn)");
      }
    }
    
    flags.push(yearFlags);
  });

  return flags;
}

function renderRatiosTable(ratios, flags) {
  if (!ratios || ratios.length === 0) {
    document.getElementById("ratiosTable").innerHTML = "<span>No data.</span>";
    return;
  }
  
  const headerYears = ratios.map(r => `<th>${r.year}</th>`).join("");
  
  function row(label, key, fmtPct = false) {
    const cells = ratios
      .map((r, i) => {
        let v = r[key];
        if (v == null || isNaN(v)) return "<td>-</td>";
        
        let formatted;
        if (fmtPct) {
          formatted = parseFloat(v).toFixed(2) + "%";
        } else {
          const abs = Math.abs(v);
          if (abs > 1e9) {
            formatted = (v / 1e9).toFixed(2) + "B";
          } else if (abs > 1e6) {
            formatted = (v / 1e6).toFixed(2) + "M";
          } else if (abs > 1e3) {
            formatted = (v / 1e3).toFixed(2) + "K";
          } else {
            formatted = v.toFixed(2);
          }
        }
        
        const f = flags[i] || [];
        const hasNeg = f.some(s => s.includes("deterioration") || s.includes("declining"));
        const cls = hasNeg ? "anomaly-neg" : "";
        return `<td class="${cls}">${formatted}</td>`;
      })
      .join("");
    
    return `<tr><td><strong>${label}</strong></td>${cells}</tr>`;
  }

  const html = `
    <table>
      <tr><th>Metric</th>${headerYears}</tr>
      ${row("Revenue ($)", "revenue")}
      ${row("Net Income ($)", "netIncome")}
      ${row("Gross Profit ($)", "grossProfit")}
      ${row("Net Margin (%)", "margin", true)}
      ${row("Gross Margin (%)", "grossMargin", true)}
      ${row("Operating Margin (%)", "operatingMargin", true)}
      ${row("ROA (%)", "roa", true)}
      ${row("Debt / Equity", "debtToEquity")}
      ${row("Current Ratio", "currentRatio")}
      ${row("Quick Ratio", "quickRatio")}
      ${row("Cash / Debt", "cashToDebt")}
      ${row("DSO (days)", "dso")}
      ${row("DIO (days)", "dio")}
      ${row("DPO (days)", "dpo")}
      ${row("Operating CF ($)", "operatingCashFlow")}
      ${row("Cash ($)", "cash")}
      ${row("Total Equity ($)", "totalEquity")}
    </table>
  `;
  
  document.getElementById("ratiosTable").innerHTML = html;
}

let revNiChart, cashNiChart;

function renderCharts(ratios) {
  if (!ratios || ratios.length === 0) return;
  
  const ctx1 = document.getElementById("revNiChart").getContext("2d");
  const ctx2 = document.getElementById("cashNiChart").getContext("2d");
  
  const labels = ratios.map(r => r.year);
  const rev = ratios.map(r => r.revenue / 1e9);
  const ni = ratios.map(r => r.netIncome / 1e9);
  const cash = ratios.map(r => r.cash / 1e9);
  const opCF = ratios.map(r => r.operatingCashFlow / 1e9);

  if (revNiChart) revNiChart.destroy();
  if (cashNiChart) cashNiChart.destroy();

  revNiChart = new Chart(ctx1, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Revenue ($B)",
          data: rev,
          borderColor: "#00bcd4",
          backgroundColor: "transparent",
          tension: 0.3,
          fill: false
        },
        {
          label: "Net Income ($B)",
          data: ni,
          borderColor: "#8bc34a",
          backgroundColor: "transparent",
          tension: 0.3,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { 
        legend: { labels: { color: "#f2f2f2" } },
        title: { display: false }
      },
      scales: {
        x: { ticks: { color: "#f2f2f2" }, grid: { color: "#333" } },
        y: { ticks: { color: "#f2f2f2" }, grid: { color: "#333" } }
      }
    }
  });

  cashNiChart = new Chart(ctx2, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Cash ($B)",
          data: cash,
          borderColor: "#ffca28",
          backgroundColor: "transparent",
          tension: 0.3,
          fill: false
        },
        {
          label: "Operating CF ($B)",
          data: opCF,
          borderColor: "#ff7043",
          backgroundColor: "transparent",
          tension: 0.3,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { 
        legend: { labels: { color: "#f2f2f2" } },
        title: { display: false }
      },
      scales: {
        x: { ticks: { color: "#f2f2f2" }, grid: { color: "#333" } },
        y: { ticks: { color: "#f2f2f2" }, grid: { color: "#333" } }
      }
    }
  });
}

function renderAnomalySummary(ratios, flags) {
  const container = document.getElementById("anomalySummary");
  let html = "";
  
  flags.forEach((f, i) => {
    if (!f || f
