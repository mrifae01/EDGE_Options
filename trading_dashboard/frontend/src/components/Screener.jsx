import React, { useState, useEffect, useRef } from "react"
import { Search, X, Plus, AlertTriangle, ChevronUp, ChevronDown, ArrowRight, TrendingUp, TrendingDown, Loader2, Bookmark, GripVertical, Trash2 } from "lucide-react"
import "./Screener.css"

const API = "/api"


async function post(path, body) {
  const res = await fetch(`${API}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || res.statusText)
  return data
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmt(v, d)   { if (v == null) return "---"; return Number(v).toFixed(d != null ? d : 2) }
// String formatters used by OPT_COLS / STK_COLS column renderers
function fmtPct(v)   { if (v == null) return "---"; return (v * 100).toFixed(1) + "%" }
function fmtK(v)     { if (v == null) return "---"; if (v >= 1e6) return (v/1e6).toFixed(1)+"M"; if (v >= 1e3) return (v/1e3).toFixed(1)+"K"; return String(v) }
function fmtChg(v)   { if (v == null) return "---"; return (v > 0 ? "+" : "") + v.toFixed(2) + "%" }
function plClass(v)  { if (v == null) return ""; return v > 0 ? "green" : v < 0 ? "red" : "" }

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS SCREENER
// ─────────────────────────────────────────────────────────────────────────────
var OPT_FILTERS_DEFAULT = {
  option_type: "", expiry_date: "", dte_min: "", dte_max: "",
  delta_min: "", delta_max: "", iv_min: "", iv_max: "",
  strike_gte: "", strike_lte: "", volume_min: "", oi_min: "",
  premium_min: "", premium_max: "", sort_by: "volume", sort_desc: true, limit: 25,
}
var OPT_PRESETS = [
  { label: "0DTE Calls",  f: { option_type:"call", dte_max:"0", volume_min:"100" } },
  { label: "Weekly Puts", f: { option_type:"put",  dte_min:"1", dte_max:"7" } },
  { label: "High Delta",  f: { delta_min:"0.6" } },
  { label: "Cheap Calls", f: { option_type:"call", premium_max:"2.00" } },
  { label: "High IV",     f: { iv_min:"0.5" } },
  { label: "High Vol",    f: { volume_min:"1000", sort_by:"volume" } },
]
var OPT_SORT_OPTIONS = [
  { value:"volume", label:"Volume" }, { value:"open_interest", label:"OI" },
  { value:"iv",     label:"IV" },     { value:"delta", label:"Delta" },
  { value:"mid",    label:"Premium" },{ value:"dte",   label:"DTE" },
]

// ── Chart ─────────────────────────────────────────────────────────────────────
// Uses TradingView Lightweight Charts (open-source, MIT license)
// Loaded once from CDN, then reused for every ticker click.

var _lwcPromise = null
function loadLWC() {
  if (_lwcPromise) return _lwcPromise
  _lwcPromise = new Promise(function(resolve) {
    if (window.LightweightCharts) { resolve(window.LightweightCharts); return }
    var s = document.createElement("script")
    s.src = "https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"
    s.onload = function() { resolve(window.LightweightCharts) }
    document.head.appendChild(s)
  })
  return _lwcPromise
}

function calcSMA(bars, period) {
  return bars.map(function(_, i) {
    if (i < period - 1) return null
    var sum = 0
    for (var j = i - period + 1; j <= i; j++) sum += bars[j].c
    return sum / period
  })
}

// ── Company name lookup ───────────────────────────────────────────────────────
var COMPANY_NAMES = {
  "A":"Agilent","AAPL":"Apple","ABBV":"AbbVie","ABNB":"Airbnb","ABT":"Abbott",
  "ACGL":"Arch Capital","ACN":"Accenture","ADI":"Analog Devices","ADM":"Archer-Daniels",
  "ADP":"ADP","ADSK":"Autodesk","AEE":"Ameren","AEP":"AEP","AFL":"Aflac",
  "AIG":"AIG","AMAT":"Applied Materials","AMGN":"Amgen","AMP":"Ameriprise",
  "AMT":"American Tower","AMZN":"Amazon","ANET":"Arista Networks","AON":"Aon",
  "AOS":"A.O. Smith","APD":"Air Products","APH":"Amphenol","APTV":"Aptiv",
  "ARE":"Alexandria RE","AVB":"AvalonBay","AVGO":"Broadcom","AVY":"Avery Dennison",
  "AWK":"American Water","AXP":"American Express","AZO":"AutoZone",
  "BA":"Boeing","BABA":"Alibaba","BAC":"Bank of America","BAX":"Baxter",
  "BBWI":"Bath & Body Works","BBY":"Best Buy","BDX":"Becton Dickinson",
  "BEN":"Franklin Templeton","BIO":"Bio-Rad","BK":"BNY Mellon","BKNG":"Booking",
  "BKR":"Baker Hughes","BMY":"Bristol-Myers","BR":"Broadridge","BRK.B":"Berkshire",
  "BSX":"Boston Scientific","BWA":"BorgWarner",
  "C":"Citigroup","CAG":"Conagra","CAH":"Cardinal Health","CARR":"Carrier",
  "CAT":"Caterpillar","CB":"Chubb","CBOE":"Cboe Global","CBRE":"CBRE",
  "CCI":"Crown Castle","CCL":"Carnival","CDNS":"Cadence","CEG":"Constellation Energy",
  "CF":"CF Industries","CFG":"Citizens Financial","CHD":"Church & Dwight",
  "CHRW":"CH Robinson","CHTR":"Charter","CI":"Cigna","CINF":"Cincinnati Financial",
  "CL":"Colgate","CLX":"Clorox","CMA":"Comerica","CMCSA":"Comcast","CME":"CME Group",
  "CMG":"Chipotle","CMI":"Cummins","CMS":"CMS Energy","COF":"Capital One",
  "COO":"CooperSurgical","COP":"ConocoPhillips","COST":"Costco","CPB":"Campbell Soup",
  "CPRT":"Copart","CPT":"Camden Property","CRM":"Salesforce","CRWD":"CrowdStrike",
  "CSCO":"Cisco","CSGP":"CoStar","CSX":"CSX","CTAS":"Cintas","CTLT":"Catalent",
  "CTRA":"Coterra","CTSH":"Cognizant","CTVA":"Corteva","CVS":"CVS Health",
  "CVX":"Chevron","CVNA":"Carvana",
  "D":"Dominion Energy","DASH":"DoorDash","DAY":"Dayforce","DD":"DuPont",
  "DE":"John Deere","DELL":"Dell","DFS":"Discover Financial","DG":"Dollar General",
  "DGX":"Quest Diagnostics","DHI":"D.R. Horton","DHR":"Danaher","DIS":"Disney",
  "DLTR":"Dollar Tree","DOC":"Healthpeak","DOV":"Dover","DOW":"Dow",
  "DPZ":"Domino's","DRI":"Darden","DTE":"DTE Energy","DUK":"Duke Energy",
  "DVA":"DaVita","DVN":"Devon Energy","DXCM":"Dexcom",
  "EA":"Electronic Arts","EBAY":"eBay","ECL":"Ecolab","ED":"Con Edison",
  "EFX":"Equifax","EIX":"Edison Intl","EL":"Estee Lauder","EMN":"Eastman Chemical",
  "EMR":"Emerson Electric","ENPH":"Enphase","EOG":"EOG Resources","EPAM":"EPAM",
  "EQIX":"Equinix","EQR":"Equity Residential","EQT":"EQT","ES":"Eversource",
  "ESS":"Essex Property","ETN":"Eaton","ETR":"Entergy","ETSY":"Etsy","EVRG":"Evergy",
  "EW":"Edwards Lifesciences","EXC":"Exelon","EXPD":"Expeditors","EXPE":"Expedia",
  "EXR":"Extra Space Storage",
  "F":"Ford","FANG":"Diamondback","FAST":"Fastenal","FCX":"Freeport-McMoRan",
  "FDS":"FactSet","FDX":"FedEx","FE":"FirstEnergy","FFIV":"F5","FI":"Fiserv",
  "FICO":"FICO","FIS":"FIS","FITB":"Fifth Third","FLT":"Fleetcor","FMC":"FMC",
  "FOX":"Fox","FOXA":"Fox A","FRT":"Federal Realty","FSLR":"First Solar","FTNT":"Fortinet",
  "FTV":"Fortive",
  "GD":"General Dynamics","GE":"GE","GEHC":"GE HealthCare","GEN":"Gen Digital",
  "GILD":"Gilead","GIS":"General Mills","GL":"Globe Life","GLW":"Corning",
  "GM":"General Motors","GNRC":"Generac","GOOG":"Alphabet","GOOGL":"Alphabet A",
  "GPC":"Genuine Parts","GPN":"Global Payments","GRMN":"Garmin","GS":"Goldman Sachs",
  "GWW":"W.W. Grainger",
  "HAL":"Halliburton","HAS":"Hasbro","HBAN":"Huntington","HCA":"HCA Healthcare",
  "HD":"Home Depot","HES":"Hess","HIG":"Hartford Financial","HII":"Huntington Ingalls",
  "HLT":"Hilton","HOLX":"Hologic","HON":"Honeywell","Hood":"Robinhood","HOOD":"Robinhood",
  "HPE":"HP Enterprise","HPQ":"HP","HRL":"Hormel","HSIC":"Henry Schein",
  "HST":"Host Hotels","HSY":"Hershey","HUBB":"Hubbell","HUM":"Humana","HWM":"Howmet",
  "IBM":"IBM","ICE":"ICE","IDXX":"IDEXX","IEX":"IDEX","IFF":"IFF",
  "ILMN":"Illumina","INCY":"Incyte","INTC":"Intel","INTU":"Intuit",
  "INVH":"Invitation Homes","IP":"Intl Paper","IPG":"IPG","IQV":"IQVIA",
  "IR":"Ingersoll Rand","IRM":"Iron Mountain","ISRG":"Intuitive Surgical","IT":"Gartner",
  "ITW":"Illinois Tool","IVZ":"Invesco",
  "J":"Jacobs","JBHT":"J.B. Hunt","JBL":"Jabil","JCI":"Johnson Controls",
  "JKHY":"Jack Henry","JNJ":"Johnson & Johnson","JNPR":"Juniper","JPM":"JPMorgan",
  "K":"Kellanova","KDP":"Keurig Dr Pepper","KEY":"KeyCorp","KEYS":"Keysight",
  "KHC":"Kraft Heinz","KIM":"Kimco Realty","KLAC":"KLA","KMB":"Kimberly-Clark",
  "KMI":"Kinder Morgan","KMX":"CarMax","KO":"Coca-Cola","KR":"Kroger",
  "L":"Loews","LDOS":"Leidos","LEN":"Lennar","LH":"LabCorp","LHX":"L3Harris",
  "LIN":"Linde","LKQ":"LKQ","LLY":"Eli Lilly","LMT":"Lockheed Martin",
  "LNT":"Alliant Energy","LOW":"Lowe's","LRCX":"Lam Research","LULU":"Lululemon",
  "LUV":"Southwest","LVS":"Las Vegas Sands","LW":"Lamb Weston","LYB":"LyondellBasell",
  "LYV":"Live Nation",
  "MA":"Mastercard","MAA":"Mid-America","MAR":"Marriott","MAS":"Masco",
  "MCD":"McDonald's","MCHP":"Microchip","MCK":"McKesson","MCO":"Moody's",
  "MDLZ":"Mondelez","MDT":"Medtronic","MET":"MetLife","META":"Meta",
  "MGM":"MGM Resorts","MHK":"Mohawk","MKC":"McCormick","MKTX":"MarketAxess",
  "MLM":"Martin Marietta","MMC":"Marsh McLennan","MMM":"3M","MNST":"Monster Bev",
  "MO":"Altria","MOH":"Molina Healthcare","MOS":"Mosaic","MPC":"Marathon Petroleum",
  "MPWR":"Monolithic Power","MRK":"Merck","MRNA":"Moderna","MRO":"Marathon Oil",
  "MS":"Morgan Stanley","MSCI":"MSCI","MSFT":"Microsoft","MSI":"Motorola Solutions",
  "MTB":"M&T Bank","MTCH":"Match Group","MTD":"Mettler-Toledo","MU":"Micron",
  "NCLH":"Norwegian Cruise","NDAQ":"Nasdaq","NEE":"NextEra Energy","NEM":"Newmont",
  "NFLX":"Netflix","NI":"NiSource","NKE":"Nike","NOC":"Northrop Grumman",
  "NOW":"ServiceNow","NRG":"NRG Energy","NSC":"Norfolk Southern","NTAP":"NetApp",
  "NTRS":"Northern Trust","NUE":"Nucor","NVDA":"Nvidia","NVR":"NVR","NWS":"News Corp",
  "NWSA":"News Corp A",
  "O":"Realty Income","ODFL":"Old Dominion","OKE":"ONEOK","OMC":"Omnicom",
  "ON":"ON Semiconductor","ORCL":"Oracle","ORLY":"O'Reilly Auto","OXY":"Occidental",
  "PAYC":"Paycom","PAYX":"Paychex","PCAR":"PACCAR","PCG":"PG&E","PEAK":"Healthpeak",
  "PEG":"PSEG","PEP":"PepsiCo","PFE":"Pfizer","PFG":"Principal Financial",
  "PG":"Procter & Gamble","PGR":"Progressive","PH":"Parker Hannifin","PHM":"PulteGroup",
  "PKG":"Packaging Corp","PLD":"Prologis","PLTR":"Palantir","PM":"Philip Morris",
  "PNR":"Pentair","PNW":"Pinnacle West","POOL":"Pool","PPG":"PPG Industries",
  "PPL":"PPL","PRU":"Prudential","PSA":"Public Storage","PSX":"Phillips 66",
  "PTC":"PTC","PYPL":"PayPal",
  "QCOM":"Qualcomm","QRVO":"Qorvo",
  "RE":"Everest Group","REG":"Regency Centers","REGN":"Regeneron","RF":"Regions",
  "RJF":"Raymond James","RL":"Ralph Lauren","RMD":"ResMed","ROK":"Rockwell",
  "ROL":"Rollins","ROP":"Roper Technologies","ROST":"Ross Stores","RSG":"Republic Services",
  "RTX":"Raytheon","RTX":"RTX",
  "SBAC":"SBA Comm","SBUX":"Starbucks","SCHW":"Schwab","SHW":"Sherwin-Williams",
  "SJM":"Smucker","SLB":"Schlumberger","SMCI":"Super Micro","SNA":"Snap-on",
  "SNPS":"Synopsys","SO":"Southern Co","SOFI":"SoFi","SOLV":"Solventum",
  "SPG":"Simon Property","SPGI":"S&P Global","SPY":"S&P 500 ETF","SRE":"Sempra",
  "STE":"STERIS","STT":"State Street","STX":"Seagate","STZ":"Constellation Brands",
  "SWK":"Stanley Black & Decker","SWKS":"Skyworks","SYF":"Synchrony","SYK":"Stryker",
  "SYY":"Sysco",
  "T":"AT&T","TAP":"Molson Coors","TDG":"TransDigm","TDY":"Teledyne",
  "TELS":"Telos","TER":"Teradyne","TFC":"Truist Financial","TFX":"Teleflex",
  "TGT":"Target","TJX":"TJX","TMUS":"T-Mobile","TPR":"Tapestry",
  "TRGP":"Targa Resources","TRMB":"Trimble","TSCO":"Tractor Supply","TSLA":"Tesla",
  "TSN":"Tyson Foods","TT":"Trane Technologies","TTWO":"Take-Two","TXN":"Texas Instruments",
  "TXT":"Textron","TYL":"Tyler Technologies",
  "UAL":"United Airlines","UBER":"Uber","UDR":"UDR","UHS":"Universal Health",
  "ULTA":"Ulta Beauty","UNH":"UnitedHealth","UNP":"Union Pacific","UPS":"UPS",
  "URI":"United Rentals","USB":"US Bancorp",
  "V":"Visa","VFC":"VF Corp","VICI":"VICI Properties","VLO":"Valero","VMC":"Vulcan Materials",
  "VRSK":"Verisk","VRSN":"VeriSign","VRTX":"Vertex Pharma","VST":"Vistra",
  "VTR":"Ventas","VTRS":"Viatris",
  "WAB":"Wabtec","WAT":"Waters","WBA":"Walgreens","WBD":"Warner Bros Discovery",
  "WDC":"Western Digital","WEC":"WEC Energy","WELL":"Welltower","WFC":"Wells Fargo",
  "WHR":"Whirlpool","WM":"Waste Management","WMB":"Williams","WMT":"Walmart",
  "WRB":"W.R. Berkley","WST":"West Pharma","WTW":"Willis Towers Watson",
  "WY":"Weyerhaeuser",
  "XEL":"Xcel Energy","XLB":"Materials ETF","XLE":"Energy ETF","XLF":"Financials ETF",
  "XLI":"Industrials ETF","XLK":"Technology ETF","XLP":"Staples ETF","XLU":"Utilities ETF",
  "XLV":"Health Care ETF","XLY":"Consumer Disc ETF","XOM":"ExxonMobil",
  "XRAY":"Dentsply Sirona",
  "YUM":"Yum! Brands",
  "ZBH":"Zimmer Biomet","ZBRA":"Zebra Technologies","ZION":"Zions Bancorp","ZTS":"Zoetis",
  "AMD":"AMD","AMZN":"Amazon","AVGO":"Broadcom","BAC":"Bank of America",
  "SHOP":"Shopify","CRM":"Salesforce","DIS":"Disney","HOOD":"Robinhood",
  "MARA":"Marathon Digital","CRWD":"CrowdStrike","CVNA":"Carvana","DELL":"Dell",
  "QQQ":"Nasdaq 100 ETF","IWM":"Russell 2000 ETF","DIA":"Dow Jones ETF",
  "COIN":"Coinbase","SQ":"Block","SNAP":"Snap","ABNB":"Airbnb",
}

function getCompanyName(symbol) {
  return COMPANY_NAMES[symbol.toUpperCase()] || null
}


var TF_OPTIONS = [
  { label: "1W",   value: "1Week", lookback: 1825 },
  { label: "1D",   value: "1Day",  lookback: 1825 },
  { label: "4H",   value: "4Hour", lookback: 120  },
  { label: "1H",   value: "1Hour", lookback: 90   },
]

// Normalise bar timestamp to the key LWC expects.
// Daily/Weekly bars → date string "YYYY-MM-DD"
// Intraday bars    → unix timestamp (seconds)
function barTime(b, intraday) {
  if (!intraday) return b.t.slice(0, 10)
  var ms = new Date(b.t).getTime()
  return Math.floor(ms / 1000)
}

function StockChart({ symbol, onClose }) {
  var tf_s = useState("1Day"); var tf = tf_s[0]; var setTf = tf_s[1]
  var ds   = useState(null);   var bars    = ds[0]; var setBars    = ds[1]
  var ls   = useState(true);   var loading = ls[0]; var setLoading = ls[1]
  var es   = useState(null);   var error   = es[0]; var setError   = es[1]
  var rdy  = useState(false);  var lwcOk   = rdy[0]; var setLwcOk  = rdy[1]
  var earn_s = useState(null); var earnings = earn_s[0]; var setEarnings = earn_s[1]
  var containerRef = useRef(null)
  var chartRef     = useRef(null)

  var intraday = tf === "4Hour" || tf === "1Hour"

  // Load LWC script once
  useEffect(function() {
    loadLWC().then(function() { setLwcOk(true) })
  }, [])

  // Fetch earnings once per symbol
  useEffect(function() {
    setEarnings(null)
    fetch("/api/earnings?symbol=" + encodeURIComponent(symbol))
      .then(function(r) { return r.json() })
      .then(function(d) {
        console.log("[earnings]", symbol, d)
        setEarnings(d)
      })
      .catch(function(err) {
        console.log("[earnings]", symbol, "error:", err)
        setEarnings({ date: null, days_away: null })
      })
  }, [symbol])

  // Fetch bars whenever symbol or timeframe changes
  useEffect(function() {
    setLoading(true); setError(null); setBars(null)
    var opt = TF_OPTIONS.find(function(o){ return o.value === tf }) || TF_OPTIONS[1]
    var url = "/api/chart/bars?symbol=" + encodeURIComponent(symbol)
          + "&timeframe=" + encodeURIComponent(tf)
          + "&lookback_days=" + opt.lookback
    fetch(url)
      .then(function(r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json() })
      .then(function(data) {
        if (!data || !data.length) throw new Error("No data for " + symbol)
        setBars(data)
        setLoading(false)
      })
      .catch(function(e) { setError(e.message); setLoading(false) })
  }, [symbol, tf])

  // Build / rebuild chart whenever bars or LWC readiness changes
  useEffect(function() {
    if (!lwcOk || !bars || !containerRef.current) return

    var LWC = window.LightweightCharts
    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null }

    var chart = LWC.createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background: { type: "solid", color: "#080b0f" },
        textColor:  "#64748b",
        fontSize:   11,
        fontFamily: "monospace",
      },
      grid: {
        vertLines: { color: "#0f172a" },
        horzLines: { color: "#0f172a" },
      },
      crosshair: {
        mode: LWC.CrosshairMode.Normal,
        vertLine: { color: "#334155", labelBackgroundColor: "#1e293b" },
        horzLine: { color: "#334155", labelBackgroundColor: "#1e293b" },
      },
      rightPriceScale: {
        borderColor:  "#1e293b",
        scaleMargins: { top: 0.06, bottom: 0.28 },
      },
      timeScale: {
        borderColor:    "#1e293b",
        timeVisible:    intraday,
        secondsVisible: false,
        rightOffset:    60,
        barSpacing:     intraday ? 6 : 8,
        minBarSpacing:  2,
      },
    })

    var ro = new ResizeObserver(function(entries) {
      if (chartRef.current && entries[0]) {
        var r = entries[0].contentRect
        chartRef.current.resize(r.width, r.height)
      }
    })
    ro.observe(containerRef.current)

    var candles = chart.addCandlestickSeries({
      upColor: "#26a69a", downColor: "#ef5350",
      borderUpColor: "#26a69a", borderDownColor: "#ef5350",
      wickUpColor: "#26a69a", wickDownColor: "#ef5350",
    })
    var volume = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol" })
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })

    // SMAs — only meaningful on daily/weekly; skip on intraday for performance
    if (!intraday) {
      var sma10v  = calcSMA(bars, 10)
      var sma20v  = calcSMA(bars, 20)
      var sma200v = calcSMA(bars, 200)
      var sma10s  = chart.addLineSeries({ color: "#29b6f6", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: "10" })
      var sma20s  = chart.addLineSeries({ color: "#66bb6a", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: "20" })
      var sma200s = chart.addLineSeries({ color: "#ef5350", lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: "200" })
      sma10s.setData( bars.map(function(b,i){ return sma10v[i]  != null ? { time: barTime(b, false), value: sma10v[i]  } : null }).filter(Boolean))
      sma20s.setData( bars.map(function(b,i){ return sma20v[i]  != null ? { time: barTime(b, false), value: sma20v[i]  } : null }).filter(Boolean))
      sma200s.setData(bars.map(function(b,i){ return sma200v[i] != null ? { time: barTime(b, false), value: sma200v[i] } : null }).filter(Boolean))
    }

    candles.setData(bars.map(function(b) {
      return { time: barTime(b, intraday), open: b.o, high: b.h, low: b.l, close: b.c }
    }))
    volume.setData(bars.map(function(b) {
      return { time: barTime(b, intraday), value: b.v, color: b.c >= b.o ? "#26a69a30" : "#ef535030" }
    }))

    // Earnings — header badge only (no chart markers)

    setTimeout(function() {
      if (chartRef.current) chartRef.current.timeScale().scrollToPosition(30, false)
    }, 0)

    chartRef.current = chart
    return function() { ro.disconnect(); if (chartRef.current) { chartRef.current.remove(); chartRef.current = null } }
  }, [bars, lwcOk, earnings])

  var tfLabel = (TF_OPTIONS.find(function(o){ return o.value === tf }) || {}).label || "1D"

  var earnBadgeColor = null
  var earnLabel = null
  if (earnings && earnings.date) {
    var d = earnings.days_away
    earnBadgeColor = d <= 3 ? "#ef5350" : d <= 7 ? "#fbbf24" : "#a78bfa"
    earnLabel = d === 0 ? "Earnings TODAY"
              : d === 1 ? "Earnings tomorrow"
              : "Earnings in " + d + "d  ·  " + earnings.date.slice(5).replace("-", "/")
  }

  return (
    <div className="tv-chart-panel">
      <div className="tv-chart-hd">
        <div className="tv-chart-title">
          <span className="mono" style={{fontSize:18,fontWeight:700,letterSpacing:"0.06em"}}>{symbol}</span>
          {getCompanyName(symbol) && (
            <span className="mono dim" style={{fontSize:15}}>({getCompanyName(symbol)})</span>
          )}
          <span className="mono dim" style={{fontSize:13}}>{tfLabel} · scroll to zoom · drag to pan</span>
          {earnLabel && (
            <span className="earn-badge" style={{borderColor: earnBadgeColor, color: earnBadgeColor}}>
              ▲ {earnLabel}
            </span>
          )}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          {/* Timeframe buttons */}
          <div className="tf-row">
            {TF_OPTIONS.map(function(o) {
              return (
                <button
                  key={o.value}
                  className={"tf-btn" + (tf === o.value ? " tf-btn-on" : "")}
                  onClick={function(){ setTf(o.value) }}
                >{o.label}</button>
              )
            })}
          </div>
          {!intraday && (
            <div className="sma-legend-row">
              <span style={{color:"#29b6f6"}}>━ SMA 10</span>
              <span style={{color:"#66bb6a"}}>━ SMA 20</span>
              <span style={{color:"#ef5350"}}>━━ SMA 200</span>
            </div>
          )}
          <button className="btn btn-ghost tv-close-btn" onClick={onClose}><X size={13}/> Close</button>
        </div>
      </div>
      <div className="tv-chart-body">
        {(loading || !lwcOk) && (
          <div className="chart-loading">
            <Loader2 size={20} className="spin" style={{color:"var(--blue)"}}/>
            <span className="mono dim" style={{fontSize:12}}>
              {!lwcOk ? "Loading chart engine..." : "Fetching " + symbol + " " + tfLabel + "..."}
            </span>
          </div>
        )}
        {error && (
          <div className="chart-loading">
            <AlertTriangle size={16} color="#ef5350"/>
            <span className="mono" style={{color:"#ef5350",fontSize:12}}>{error}</span>
          </div>
        )}
        <div
          ref={containerRef}
          style={{width:"100%", height:"100%", display: (bars && lwcOk && !loading) ? "block" : "none"}}
        />
      </div>
    </div>
  )
}

var OPT_COLS = [
  { key:"symbol",       label:"Contract",   f: function(v){ return v } },
  { key:"type",         label:"Type",       f: function(v){ return v }, cls: function(r){ return r.type==="call"?"green":"red" } },
  { key:"strike",       label:"Strike",     f: function(v){ return v!=null?"$"+fmt(v):"---" } },
  { key:"expiry",       label:"Expiry",     f: function(v){ return v||"---" } },
  { key:"dte",          label:"DTE",        f: function(v){ return v!=null?v+"d":"---" } },
  { key:"stock_price",  label:"Stock",      f: function(v){ return v!=null?"$"+fmt(v):"---" } },
  { key:"mid",          label:"Premium",    f: function(v){ return v!=null?"$"+fmt(v):"---" } },
  { key:"delta",        label:"Δ Delta",    f: function(v){ return fmt(v,3) }, cls: function(r){ return r.type==="call"?"green":"red" } },
  { key:"theta",        label:"Θ Theta",    f: function(v){ return fmt(v,4) }, cls: function(r){ return r.theta!=null&&r.theta<0?"red":"" } },
  { key:"iv",           label:"IV",         f: fmtPct },
  { key:"volume",       label:"Volume",     f: fmtK },
  { key:"open_interest",label:"OI",         f: fmtK },
  { key:"moneyness",    label:"Moneyness",  f: function(v){ return v!=null?(v>0?"+":"")+fmt(v,1)+"%":"---" }, cls: function(r){ return plClass(r.moneyness) } },
]

// ─────────────────────────────────────────────────────────────────────────────
// STOCK SCREENER
// ─────────────────────────────────────────────────────────────────────────────
var STK_FILTERS_DEFAULT = {
  universe: "usa", price_min: "", price_max: "",
  volume_min: "", vol_ratio_min: "",
  change_pct_min: "", change_pct_max: "",
  change_5d_min: "", change_5d_max: "",
  rsi_min: "", rsi_max: "",
  atr_min: "", atr_max: "",
  sma_cross: "", sma_cross_dir: "",
  above_sma20: false, above_sma50: false, above_sma200: false,
  below_sma20: false, below_sma50: false,
  above_vwap: false, below_vwap: false,
  sort_by: "vol_ratio_20d", sort_desc: true, limit: 25,
}
var STK_PRESETS = [
  { label: "10/20 Golden Cross", f: { sma_cross:"10_x_20", sma_cross_dir:"golden", universe:"usa" } },
  { label: "50/200 Golden Cross",f: { sma_cross:"50_x_200", sma_cross_dir:"golden", universe:"usa" } },
  { label: "Death Cross",        f: { sma_cross:"50_x_200", sma_cross_dir:"death",  universe:"usa" } },
  { label: "Oversold RSI",       f: { rsi_max:"35", universe:"usa" } },
  { label: "Overbought RSI",     f: { rsi_min:"65", universe:"usa" } },
  { label: "Volume Surge",       f: { vol_ratio_min:"1.5", sort_by:"vol_ratio_20d" } },
  { label: "Momentum",           f: { change_pct_min:"1", sort_by:"change_pct", above_sma50:true } },
  { label: "Above 200 SMA",      f: { above_sma200:true, sort_by:"change_pct" } },
]
var STK_UNIVERSES = [
  { id:"usa",    label:"USA (broad)" },
  { id:"sp500",  label:"S&P 500" },
  { id:"mag7",   label:"Mag 7" },
  { id:"etfs",   label:"ETFs" },
  { id:"growth", label:"Growth" },
  { id:"meme",   label:"Meme / Beta" },
]
var STK_SORT_OPTIONS = [
  { value:"vol_ratio_20d", label:"Volume Ratio" },
  { value:"change_pct",    label:"1D Change" },
  { value:"change_5d",     label:"5D Change" },
  { value:"rsi14",         label:"RSI" },
  { value:"volume",        label:"Volume" },
  { value:"close",         label:"Price" },
  { value:"atr14",         label:"ATR" },
]
var STK_COLS = [
  { key:"ticker",       label:"Ticker",    f: function(v){ return v } },
  { key:"close",        label:"Price",     f: function(v){ return v!=null?"$"+fmt(v):"---" } },
  { key:"change_pct",   label:"1D Chg",   f: fmtChg, cls: function(r){ return plClass(r.change_pct) } },
  { key:"change_5d",    label:"5D Chg",   f: fmtChg, cls: function(r){ return plClass(r.change_5d) } },
  { key:"volume",       label:"Volume",    f: fmtK },
  { key:"vol_ratio_20d",label:"Vol Ratio", f: function(v){ return v!=null?v.toFixed(2)+"x":"---" }, cls: function(r){ return r.vol_ratio_20d>1.5?"amber":"" } },
  { key:"rsi14",        label:"RSI",       f: function(v){ return fmt(v,1) }, cls: function(r){ return r.rsi14!=null?(r.rsi14>65?"red":r.rsi14<35?"green":""):"" } },
  { key:"sma20",        label:"SMA20",     f: function(v){ return v!=null?"$"+fmt(v):"---" } },
  { key:"sma50",        label:"SMA50",     f: function(v){ return v!=null?"$"+fmt(v):"---" } },
  { key:"atr14",        label:"ATR",       f: function(v){ return fmt(v,2) } },
  { key:"sma_cross_10_20",  label:"10/20 Cross", f: function(v){ return v==="golden"?"🟢 Bull":v==="death"?"🔴 Bear":v==="none"?"—":"---" } },
  { key:"sma_cross_50_200", label:"50/200 Cross",f: function(v){ return v==="golden"?"🟢 Bull":v==="death"?"🔴 Bear":v==="none"?"—":"---" } },
  { key:"bar_date",     label:"As Of",     f: function(v){ return v||"---" } },
]

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-components
// ─────────────────────────────────────────────────────────────────────────────
function AIFilterPills({ filters }) {
  var skip = { tickers:1, universe:1, limit:1, sort_desc:1, lookback_days:1 }
  var names = {
    option_type:"Type", dte_min:"DTE≥", dte_max:"DTE≤", delta_min:"Δ≥", delta_max:"Δ≤",
    iv_min:"IV≥", iv_max:"IV≤", volume_min:"Vol≥", premium_max:"Prem≤", premium_min:"Prem≥",
    sort_by:"Sort", price_min:"Price≥", price_max:"Price≤", vol_ratio_min:"VolRatio≥",
    change_pct_min:"1D≥", change_pct_max:"1D≤", rsi_min:"RSI≥", rsi_max:"RSI≤",
    sma_cross:"Cross", sma_cross_dir:"Dir", above_sma200:"↑SMA200", above_sma50:"↑SMA50",
  }
  var pills = []
  Object.entries(filters).forEach(function(pair) {
    var k=pair[0]; var v=pair[1]
    if (skip[k] || v == null || v === false || v === "") return
    var label = names[k] || k
    var val   = (k==="iv_min"||k==="iv_max") ? (v*100).toFixed(0)+"%" : String(v)
    pills.push({ label, val })
  })
  if (!pills.length) return null
  return (
    <div className="ai-pills">
      {pills.map(function(p,i){ return <span key={i} className="ai-pill"><span className="dim">{p.label}</span> {p.val}</span> })}
    </div>
  )
}

function SortableTable({ cols, rows, onAdd, addLabel, onRowClick, selectedKey }) {
  var ss = useState(null); var sortCol = ss[0]; var setSortCol = ss[1]
  var sd = useState(true); var sortDesc = sd[0]; var setSortDesc = sd[1]

  function toggleSort(key) {
    if (sortCol === key) setSortDesc(function(d){ return !d })
    else { setSortCol(key); setSortDesc(true) }
  }

  var sorted = rows.slice()
  if (sortCol) {
    sorted.sort(function(a,b) {
      var av=a[sortCol]; var bv=b[sortCol]
      if (av==null&&bv==null) return 0
      if (av==null) return sortDesc?1:-1
      if (bv==null) return sortDesc?-1:1
      return sortDesc?bv-av:av-bv
    })
  }

  return (
    <div className="table-scroll">
      <table className="screener-table">
        <thead>
          <tr>
            {cols.map(function(col) {
              var active = sortCol===col.key
              return (
                <th key={col.key} onClick={function(){ toggleSort(col.key) }} className={active?"col-active":""}>
                  {col.label}
                  {active?(sortDesc?<ChevronDown size={10}/>:<ChevronUp size={10}/>):null}
                </th>
              )
            })}
            {onAdd && <th>Add</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map(function(row,i) {
            var rowKey = row.ticker || row.symbol || i
            var isSelected = selectedKey && selectedKey === rowKey
            return (
              <tr
                key={rowKey + i}
                className={"result-row" + (isSelected ? " row-selected" : "") + (onRowClick ? " row-clickable" : "")}
                onClick={function(){ if (onRowClick) onRowClick(row) }}
              >
                {cols.map(function(col) {
                  var val = row[col.key]
                  var display = col.f(val, row)
                  var cls = col.cls ? col.cls(row) : ""
                  return <td key={col.key} className={"mono "+cls}>{display}</td>
                })}
                {onAdd && (
                  <td onClick={function(e){ e.stopPropagation() }}>
                    <button className="add-btn" onClick={function(){ onAdd(row) }} title={addLabel||"Add"}>
                      <Plus size={12}/>
                    </button>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function FilterPresets({ presets, onApply, onClear, onSave, saved }) {
  return (
    <div className="preset-row">
      {presets.map(function(p) {
        return <button key={p.label} className="preset-btn" onClick={function(){ onApply(p.f) }}>{p.label}</button>
      })}
      <button className="preset-btn preset-clear" onClick={onClear}><X size={10}/> Clear</button>
      {onSave && (
        <button className={"preset-btn preset-save" + (saved ? " save-flash" : "")} onClick={onSave}>
          {saved ? "✓ Saved" : "Save Filters"}
        </button>
      )}
    </div>
  )
}

// ── Options Chain ─────────────────────────────────────────────────────────────
function getUpcomingFridays(n) {
  var fridays = []
  var today = new Date()
  var day   = today.getDay()
  var daysUntilFri = day <= 5 ? 5 - day : 6
  var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysUntilFri)
  for (var i = 0; i < n; i++) {
    var mm = String(d.getMonth()+1).padStart(2,"0")
    var dd = String(d.getDate()).padStart(2,"0")
    fridays.push(d.getFullYear()+"-"+mm+"-"+dd)
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)
  }
  return fridays
}
var FRIDAYS       = getUpcomingFridays(24)
var DEFAULT_EXPIRY= FRIDAYS[0]

function fmt2(v)    { return v != null ? parseFloat(v).toFixed(2) : "—" }
function fmt3(v)    { return v != null ? parseFloat(v).toFixed(3) : "—" }
function fmtPctC(v) { return v != null ? (parseFloat(v)*100).toFixed(1)+"%" : "—" }
function fmtKC(v)   { return v != null ? Number(v).toLocaleString() : "—" }
function fmtChgJSX(v){
  if (v == null) return <span className="mono dim">—</span>
  var n = parseFloat(v)
  return <span className={"mono " + (n>0?"green":n<0?"red":"dim")}>{n>0?"+":""}{n.toFixed(2)}</span>
}

function OptionsChain({ symbol, stockPrice }) {
  var rs  = useState([]);    var chain=rs[0];    var setChain=rs[1]
  var ls  = useState(false); var loading=ls[0];  var setLoading=ls[1]
  var es  = useState(null);  var error=es[0];    var setError=es[1]
  var exs = useState(DEFAULT_EXPIRY); var expiry=exs[0]; var setExpiry=exs[1]
  var sel = useState(null);  var selected=sel[0]; var setSelected=sel[1]
  var exp = useState(true);  var expanded=exp[0]; var setExpanded=exp[1]
  var pgs = useState(0);     var page=pgs[0];     var setPage=pgs[1]
  var dmin= useState("");    var deltaMin=dmin[0]; var setDeltaMin=dmin[1]
  var dmax= useState("");    var deltaMax=dmax[0]; var setDeltaMax=dmax[1]

  var CHAIN_PAGE = 15 // rows (each row = 1 strike = 1 call + 1 put)

  function runChain(exp) {
    setLoading(true); setError(null); setPage(0)
    var body = { tickers:[symbol], limit:500, sort_by:"strike", sort_desc:false }
    if (exp) body.expiry_date = exp
    fetch("/api/screener/run", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) })
      .then(function(r){ if(!r.ok) throw new Error("HTTP "+r.status); return r.json() })
      .then(function(d){ setChain(d.results||[]); setLoading(false) })
      .catch(function(e){ setError(e.message); setLoading(false) })
  }

  useEffect(function(){ runChain(DEFAULT_EXPIRY) }, [symbol])

  function handleExpiry(e) { setExpiry(e.target.value); runChain(e.target.value) }

  // Split into calls and puts, keyed by strike
  var calls = {}; var puts = {}
  chain.forEach(function(c) {
    var k = c.strike
    if (c.type === "call") calls[k] = c
    else puts[k] = c
  })

  // Apply delta filter client-side
  var dLo = deltaMin !== "" ? parseFloat(deltaMin) : null
  var dHi = deltaMax !== "" ? parseFloat(deltaMax) : null

  // Get sorted unique strikes
  var allStrikes = Array.from(new Set(
    chain.map(function(c){ return c.strike })
  )).sort(function(a,b){ return a-b })

  // Filter strikes by delta if set
  if (dLo !== null || dHi !== null) {
    allStrikes = allStrikes.filter(function(s) {
      var cd = calls[s] && calls[s].delta != null ? Math.abs(parseFloat(calls[s].delta)) : null
      var pd = puts[s]  && puts[s].delta  != null ? Math.abs(parseFloat(puts[s].delta))  : null
      var d  = cd ?? pd
      if (d == null) return true
      if (dLo !== null && d < dLo) return false
      if (dHi !== null && d > dHi) return false
      return true
    })
  }

  var totalPages = Math.ceil(allStrikes.length / CHAIN_PAGE)
  var pageStrikes = allStrikes.slice(page * CHAIN_PAGE, (page+1) * CHAIN_PAGE)

  // Jump to the page containing the ATM strike whenever the chain or stock price changes
  useEffect(function() {
    if (!allStrikes.length || !sp) return
    // Find index of strike closest to stock price
    var atmIdx = 0
    var minDiff = Infinity
    allStrikes.forEach(function(s, i) {
      var diff = Math.abs(s - sp)
      if (diff < minDiff) { minDiff = diff; atmIdx = i }
    })
    var atmPage = Math.floor(atmIdx / CHAIN_PAGE)
    setPage(atmPage)
  }, [allStrikes.length, sp])

  // Current stock price for ITM detection
  var sp = stockPrice || (chain.length > 0 && chain[0].stock_price ? parseFloat(chain[0].stock_price) : null)


  var CALL_COLS = ["vol","delta","iv","chg","bid","ask","last"]
  var PUT_COLS  = ["last","bid","ask","chg","iv","delta","vol"]
  var COL_HDR   = { oi:"OI", vol:"Vol", delta:"Delta", iv:"IV", chg:"Chg", bid:"Bid", ask:"Ask", last:"Last" }

  // Find index where we cross from ITM calls to OTM calls (above stock price)
  var stockPriceInserted = false

  return (
    <div className="chain-panel">
      {/* Header bar */}
      <div className="chain-hd" onClick={function(){ setExpanded(function(v){return !v}) }}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span className="mono" style={{fontWeight:700,fontSize:13}}>{symbol} — Options Chain</span>
          {chain.length>0 && <span className="mono dim" style={{fontSize:13}}>{allStrikes.length} strikes</span>}
          {sp && <span className="mono" style={{fontSize:11,color:"var(--blue)"}}>Stock: ${sp.toFixed(2)}</span>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {loading && <Loader2 size={13} className="spin" style={{color:"var(--blue)"}}/>}
          <span className="mono dim" style={{fontSize:13}}>{expanded?"▲":"▼"}</span>
        </div>
      </div>

      {expanded && (
        <div>
          {/* Filter bar */}
          <div className="chain-filters">
            {/* Row 1: Expiry dropdown + quick pills */}
            <div className="chain-filter-row">
              <div className="chain-fgroup">
                <label>Expiry</label>
                <select value={expiry} onChange={handleExpiry} style={{minWidth:160}}>
                  <option value="">All dates</option>
                  {FRIDAYS.map(function(f){
                    var parts=f.split("-")
                    var lbl=new Date(+parts[0],+parts[1]-1,+parts[2]).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})
                    return <option key={f} value={f}>{lbl}</option>
                  })}
                </select>
              </div>
              <div className="chain-expiry-pills">
                {FRIDAYS.slice(0,6).map(function(f){
                  var parts=f.split("-")
                  var lbl=new Date(+parts[0],+parts[1]-1,+parts[2]).toLocaleDateString("en-US",{month:"short",day:"numeric"})
                  return (
                    <button key={f}
                      className={"chain-expiry-pill" + (expiry===f?" chain-expiry-pill-on":"")}
                      onClick={function(){setExpiry(f);runChain(f)}}
                    >{lbl}</button>
                  )
                })}
              </div>
            </div>
            {/* Row 2: Delta filter */}
            <div className="chain-filter-row">
              <div className="chain-fgroup">
                <label>|Delta| filter</label>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <input type="number" placeholder="Min" step="0.01" min="0" max="1"
                    value={deltaMin} onChange={function(e){setDeltaMin(e.target.value)}} style={{width:64}}/>
                  <span className="mono dim" style={{fontSize:13}}>–</span>
                  <input type="number" placeholder="Max" step="0.01" min="0" max="1"
                    value={deltaMax} onChange={function(e){setDeltaMax(e.target.value)}} style={{width:64}}/>
                </div>
              </div>
            </div>
          </div>

          {error && <div className="mono" style={{color:"var(--red)",padding:"10px 20px",fontSize:12}}>{error}</div>}

          {/* Chain table */}
          {allStrikes.length > 0 && (
            <div className="table-scroll">
              <table className="chain-ladder">
                <colgroup>
                  {CALL_COLS.map(function(c){ return <col key={"cc"+c} className="call-col-w"/> })}
                  <col className="strike-col-w"/>
                  {PUT_COLS.map(function(c){ return <col key={"pc"+c} className="put-col-w"/> })}
                </colgroup>
                <thead>
                  <tr>
                    <th colSpan={CALL_COLS.length} className="chain-side-hd call-side-hd">Calls</th>
                    <th className="chain-strike-hd">Strike</th>
                    <th colSpan={PUT_COLS.length} className="chain-side-hd put-side-hd">Puts</th>
                  </tr>
                  <tr className="chain-col-hd">
                    {CALL_COLS.map(function(c){ return <th key={c} className="call-col">{COL_HDR[c]}</th> })}
                    <th className="strike-col"></th>
                    {PUT_COLS.map(function(c){ return <th key={c} className="put-col">{COL_HDR[c]}</th> })}
                  </tr>
                </thead>
                <tbody>
                  {pageStrikes.map(function(strike) {
                    var call   = calls[strike]
                    var put    = puts[strike]
                    var isItmCall = sp && strike < sp   // call ITM when strike < stock price
                    var isItmPut  = sp && strike > sp   // put ITM when strike > stock price
                    var isAtm     = sp && Math.abs(strike - sp) < 1.25

                    // Insert stock price row when we cross from ITM to OTM calls
                    var showPriceLine = false
                    if (sp && !stockPriceInserted && strike >= sp) {
                      showPriceLine = true
                      stockPriceInserted = true
                    }

                    return (
                      <React.Fragment key={strike}>
                        {showPriceLine && (
                          <tr className="chain-price-row">
                            <td colSpan={CALL_COLS.length + 1 + PUT_COLS.length} className="mono" style={{textAlign:"center",padding:"6px 0",fontSize:12,fontWeight:700,color:"var(--blue)"}}>
                              Underlying Share Price {sp ? sp.toFixed(2) : ""}
                            </td>
                          </tr>
                        )}
                        <tr className={"chain-row" + (isItmCall||isItmPut?" chain-itm":"") + (isAtm?" chain-atm":"")}>
                          {/* Call side */}
                          {CALL_COLS.map(function(col){
                            return (
                              <td key={col} className={"call-col" + (isItmCall?" itm-call":"")}
                                onClick={call ? function(){ setSelected(call) } : null}
                                style={call?{cursor:"pointer"}:{}}
                              >
                                {col==="bid" && call ? <span className="chain-bid">{fmt2(call.bid)}</span>
                                  : col==="ask" && call ? <span className="chain-ask">{fmt2(call.ask)}</span>
                                  : col==="chg" && call ? fmtChgJSX(call.chg)
                                  : col==="oi"  && call ? <span className="mono dim">{fmtKC(call.open_interest??call.oi)}</span>
                                  : col==="vol" && call ? <span className="mono dim">{fmtKC(call.volume)}</span>
                                  : col==="delta" && call ? <span className="mono">{fmt3(call.delta)}</span>
                                  : col==="iv"  && call ? <span className="mono dim">{fmtPctC(call.iv)}</span>
                                  : col==="last" && call ? <span className="mono">{fmt2(call.last)}</span>
                                  : <span className="mono dim">—</span>}
                              </td>
                            )
                          })}

                          {/* Strike center */}
                          <td className="strike-col mono">
                            {strike != null ? strike.toFixed(2) : "—"}
                          </td>

                          {/* Put side */}
                          {PUT_COLS.map(function(col){
                            return (
                              <td key={col} className={"put-col" + (isItmPut?" itm-put":"")}
                                onClick={put ? function(){ setSelected(put) } : null}
                                style={put?{cursor:"pointer"}:{}}
                              >
                                {col==="bid" && put ? <span className="chain-bid">{fmt2(put.bid)}</span>
                                  : col==="ask" && put ? <span className="chain-ask">{fmt2(put.ask)}</span>
                                  : col==="chg" && put ? fmtChgJSX(put.chg)
                                  : col==="oi"  && put ? <span className="mono dim">{fmtKC(put.open_interest??put.oi)}</span>
                                  : col==="vol" && put ? <span className="mono dim">{fmtKC(put.volume)}</span>
                                  : col==="delta" && put ? <span className="mono">{fmt3(put.delta)}</span>
                                  : col==="iv"  && put ? <span className="mono dim">{fmtPctC(put.iv)}</span>
                                  : col==="last" && put ? <span className="mono">{fmt2(put.last)}</span>
                                  : <span className="mono dim">—</span>}
                              </td>
                            )
                          })}
                        </tr>
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && allStrikes.length===0 && !error && (
            <div className="mono dim" style={{padding:"24px",textAlign:"center",fontSize:12}}>
              No contracts found — try selecting an expiry date
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination" style={{padding:"10px 16px"}}>
              <button className="page-btn" disabled={page===0} onClick={function(){setPage(0)}}>«</button>
              <button className="page-btn" disabled={page===0} onClick={function(){setPage(function(p){return p-1})}}>‹</button>
              <div className="page-numbers">
                {Array.from({length:totalPages},function(_,i){
                  var show = i===0||i===totalPages-1||Math.abs(i-page)<=1
                  if (!show) {
                    if (i===1&&page>3) return <span key={i} className="page-ellipsis">…</span>
                    if (i===totalPages-2&&page<totalPages-4) return <span key={i} className="page-ellipsis">…</span>
                    return null
                  }
                  return <button key={i} className={"page-num "+(page===i?"page-num-on":"")} onClick={function(){setPage(i)}}>{i+1}</button>
                })}
              </div>
              <button className="page-btn" disabled={page===totalPages-1} onClick={function(){setPage(function(p){return p+1})}}>›</button>
              <button className="page-btn" disabled={page===totalPages-1} onClick={function(){setPage(totalPages-1)}}>»</button>
              <span className="mono dim" style={{fontSize:11,marginLeft:6}}>
                strikes {page*CHAIN_PAGE+1}–{Math.min((page+1)*CHAIN_PAGE,allStrikes.length)} of {allStrikes.length}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Add to Plan modal — pre-populate with selected contract */}
      {selected && <AddToPlanModal contract={selected} chain={chain} onClose={function(){setSelected(null)}}/>}
    </div>
  )
}


var PAGE_SIZE = 5

// ── Filter persistence ─────────────────────────────────────────────────────────
function saveFilters(key, filters) {
  try { localStorage.setItem("screener_filters_" + key, JSON.stringify(filters)) } catch(e) {}
}
function loadFilters(key, defaults) {
  try {
    var raw = localStorage.getItem("screener_filters_" + key)
    if (!raw) return null
    var saved = JSON.parse(raw)
    // Merge with defaults so new keys added in future updates don't break
    return Object.assign({}, defaults, saved)
  } catch(e) { return null }
}

function ResultsCard({ results, errors, tickers_scanned, cols, onAdd, addLabel, chartSymbolKey, showChain, headerExtra }) {
  var cs  = useState(null); var chartSymbol  = cs[0]; var setChartSymbol  = cs[1]
  var ps  = useState(0);    var page         = ps[0]; var setPage         = ps[1]
  var si  = useState(-1);   var selectedIdx  = si[0]; var setSelectedIdx  = si[1]

  var totalPages = Math.ceil(results.length / PAGE_SIZE)
  var pageStart  = page * PAGE_SIZE
  var pageRows   = results.slice(pageStart, pageStart + PAGE_SIZE)

  function getSymbol(row) {
    return chartSymbolKey ? row[chartSymbolKey] : (row.ticker || row.underlying || row.symbol)
  }

  function selectIdx(idx) {
    if (idx < 0 || idx >= results.length) return
    var targetPage = Math.floor(idx / PAGE_SIZE)
    setPage(targetPage)
    setSelectedIdx(idx)
    var sym = getSymbol(results[idx])
    if (sym) setChartSymbol(sym)
  }

  function handleRowClick(row) {
    var sym = getSymbol(row)
    if (!sym) return
    // Find global index of this row
    var idx = results.findIndex(function(r){ return getSymbol(r) === sym })
    if (idx !== -1) setSelectedIdx(idx)
    setChartSymbol(function(prev){ return prev === sym ? null : sym })
  }

  // Keyboard navigation — up/down arrows move through results
  useEffect(function() {
    function onKey(e) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
      // Only intercept if chart is open or results are visible
      if (!results.length) return
      e.preventDefault()
      setSelectedIdx(function(cur) {
        var next = e.key === "ArrowDown"
          ? Math.min(cur + 1, results.length - 1)
          : Math.max(cur - 1, 0)
        if (next < 0) next = 0
        var targetPage = Math.floor(next / PAGE_SIZE)
        setPage(targetPage)
        var sym = getSymbol(results[next])
        if (sym) setChartSymbol(sym)
        return next
      })
    }
    window.addEventListener("keydown", onKey)
    return function() { window.removeEventListener("keydown", onKey) }
  }, [results])

  // Reset on new results
  useEffect(function() { setPage(0); setSelectedIdx(-1) }, [results.length])

  // selectedKey is the symbol of the globally selected row
  var selectedSymbol = selectedIdx >= 0 && results[selectedIdx] ? getSymbol(results[selectedIdx]) : chartSymbol

  return (
    <div>
      {/* Results table card */}
      <div className="card results-card">
        <div className="results-hd">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",flexWrap:"wrap",gap:8}}>
            <div className="card-title" style={{marginBottom:0}}>
              Results <span className="dim">({results.length})</span>
            </div>
            <div className="results-meta-row">
              {tickers_scanned && (
                <span className="mono dim" style={{fontSize:13}}>{tickers_scanned} tickers scanned</span>
              )}
              {headerExtra && <span>{headerExtra}</span>}
              <span className="mono dim" style={{fontSize:13}}>Click any row to open chart</span>
            </div>
          </div>
          {errors && errors.length > 0 && (
            <div className="results-warns">
              {errors.slice(0,4).map(function(e,i){ return <span key={i} className="warn-tag mono">{e}</span> })}
              {errors.length > 4 && <span className="warn-tag mono">+{errors.length-4} more</span>}
            </div>
          )}
        </div>

        <SortableTable
          cols={cols} rows={pageRows} onAdd={onAdd} addLabel={addLabel}
          onRowClick={handleRowClick} selectedKey={selectedSymbol}
        />

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="pagination">
            <button
              className="page-btn"
              disabled={page === 0}
              onClick={function(){ setPage(0) }}
            >«</button>
            <button
              className="page-btn"
              disabled={page === 0}
              onClick={function(){ setPage(function(p){ return p - 1 }) }}
            >‹</button>
            <div className="page-numbers">
              {Array.from({length: totalPages}, function(_, i) {
                // Show first, last, current ±1, and ellipsis
                var show = i === 0 || i === totalPages-1 || Math.abs(i - page) <= 1
                if (!show) {
                  if (i === 1 && page > 3) return <span key={i} className="page-ellipsis">…</span>
                  if (i === totalPages-2 && page < totalPages-4) return <span key={i} className="page-ellipsis">…</span>
                  return null
                }
                return (
                  <button
                    key={i}
                    className={"page-num " + (page === i ? "page-num-on" : "")}
                    onClick={function(){ setPage(i) }}
                  >{i + 1}</button>
                )
              })}
            </div>
            <button
              className="page-btn"
              disabled={page === totalPages - 1}
              onClick={function(){ setPage(function(p){ return p + 1 }) }}
            >›</button>
            <button
              className="page-btn"
              disabled={page === totalPages - 1}
              onClick={function(){ setPage(totalPages - 1) }}
            >»</button>
            <span className="mono dim" style={{fontSize:11,marginLeft:6}}>
              {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, results.length)} of {results.length}
            </span>
          </div>
        )}
      </div>

      {/* Chart panel — full width, below table */}
      {chartSymbol && (
        <StockChart
          symbol={chartSymbol}
          onClose={function(){ setChartSymbol(null); setSelectedIdx(-1) }}
        />
      )}

      {/* Options chain — below chart, only in stock screener context */}
      {chartSymbol && showChain && (
        <OptionsChain symbol={chartSymbol} stockPrice={null}/>
      )}
    </div>
  )
}

// ── Options: Add to Plan modal ────────────────────────────────────────────────
// ChainAddPanel — renders inline inside the chain panel, not as a modal overlay.
// This keeps the chart above fully interactive while filling in SL/TP.
function ChainAddPanel({ contract, chain, onClose }) {
  var qs=useState(1);    var qty=qs[0];  var setQty=qs[1]
  var ss=useState("");   var sl=ss[0];   var setSl=ss[1]
  var ts=useState("");   var tp=ts[0];   var setTp=ts[1]
  var ms=useState(null); var msg=ms[0];  var setMsg=ms[1]
  var bs=useState(false);var busy=bs[0]; var setBusy=bs[1]

  var isCall = contract.type === "call"
  var isPut  = contract.type === "put"
  var defaultMode = isCall ? "spread" : isPut ? "bearspread" : "single"
  var md=useState(defaultMode); var mode=md[0]; var setMode=md[1]
  var shs=useState(""); var selectedShortStrike=shs[0]; var setSelectedShortStrike=shs[1]

  var longStrike = parseFloat(contract.strike)

  // ── Bull spread leg candidates (calls above long strike) ──────────────────
  var callsAbove = (chain||[])
    .filter(function(c){ return c.type==="call" && c.expiry===contract.expiry && parseFloat(c.strike) > longStrike })
    .sort(function(a,b){ return parseFloat(a.strike) - parseFloat(b.strike) })
  var targetShort = longStrike * 1.075
  var autoShort = callsAbove.reduce(function(best, c) {
    if (!best) return c
    return Math.abs(parseFloat(c.strike) - targetShort) < Math.abs(parseFloat(best.strike) - targetShort) ? c : best
  }, null)
  var shortContract = selectedShortStrike
    ? (callsAbove.find(function(c){ return String(c.strike) === selectedShortStrike }) || autoShort)
    : autoShort

  // Bull spread metrics
  var longAsk   = contract.ask  != null ? parseFloat(contract.ask)  : null
  var shortBid  = shortContract && shortContract.bid != null ? parseFloat(shortContract.bid) : null
  var netDebit  = (longAsk != null && shortBid != null) ? parseFloat(Math.max(0, longAsk - shortBid).toFixed(2)) : null
  var width     = shortContract ? parseFloat((parseFloat(shortContract.strike) - longStrike).toFixed(2)) : null
  var maxGain   = (netDebit != null && width != null) ? Math.round((width - netDebit) * 100) : null
  var maxLoss   = netDebit != null ? Math.round(netDebit * 100) : null
  var breakeven = netDebit != null ? (longStrike + netDebit).toFixed(2) : null
  var rr        = (maxGain != null && maxLoss != null && maxLoss > 0) ? (maxGain / maxLoss).toFixed(2) : null

  // ── Bear spread leg candidates (puts below long strike) ───────────────────
  var putsBelow = (chain||[])
    .filter(function(c){ return c.type==="put" && c.expiry===contract.expiry && parseFloat(c.strike) < longStrike })
    .sort(function(a,b){ return parseFloat(b.strike) - parseFloat(a.strike) }) // desc — closest first
  var bearTargetShort = longStrike * 0.925
  var bearAutoShort = putsBelow.reduce(function(best, c) {
    if (!best) return c
    return Math.abs(parseFloat(c.strike) - bearTargetShort) < Math.abs(parseFloat(best.strike) - bearTargetShort) ? c : best
  }, null)
  var bearShortContract = selectedShortStrike && mode === "bearspread"
    ? (putsBelow.find(function(c){ return String(c.strike) === selectedShortStrike }) || bearAutoShort)
    : bearAutoShort

  // Bear spread metrics
  var bearLongAsk  = contract.ask != null ? parseFloat(contract.ask) : null
  var bearShortBid = bearShortContract && bearShortContract.bid != null ? parseFloat(bearShortContract.bid) : null
  var bearNetDebit = (bearLongAsk != null && bearShortBid != null) ? parseFloat(Math.max(0, bearLongAsk - bearShortBid).toFixed(2)) : null
  var bearWidth    = bearShortContract ? parseFloat((longStrike - parseFloat(bearShortContract.strike)).toFixed(2)) : null
  var bearMaxGain  = (bearNetDebit != null && bearWidth != null) ? Math.round((bearWidth - bearNetDebit) * 100) : null
  var bearMaxLoss  = bearNetDebit != null ? Math.round(bearNetDebit * 100) : null
  var bearBreakeven= bearNetDebit != null ? (longStrike - bearNetDebit).toFixed(2) : null
  var bearRR       = (bearMaxGain != null && bearMaxLoss != null && bearMaxLoss > 0) ? (bearMaxGain / bearMaxLoss).toFixed(2) : null

  async function save() {
    if (!sl || parseFloat(sl) <= 0) { setMsg("Error: Stop Loss is required"); return }
    if (!tp || parseFloat(tp) <= 0) { setMsg("Error: Take Profit is required"); return }
    setBusy(true)
    try {
      var res  = await fetch("/api/plans"); var existing = (await res.json()).plans || []
      var planType = contract.type === "put" ? "SHORT" : "LONG"
      var plan = { ticker:contract.underlying, contract:contract.symbol, qty:parseInt(qty), type:planType, sl_stock:parseFloat(sl), tp_stock:parseFloat(tp) }
      var saveRes = await fetch("/api/plans",{ method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(existing.concat([plan])) })
      if (!saveRes.ok) throw new Error((await saveRes.json()).detail)
      setMsg("Plan saved!")
      setQty(1); setSl(""); setTp("")
      setTimeout(function(){ setMsg(null) }, 3000)
    } catch(e){ setMsg("Error: "+e.message) } finally { setBusy(false) }
  }

  async function placeSpread() {
    var isBear = mode === "bearspread"
    var sc   = isBear ? bearShortContract : shortContract
    var nd   = isBear ? bearNetDebit      : netDebit
    var lAsk = isBear ? bearLongAsk       : longAsk
    var sBid = isBear ? bearShortBid      : shortBid
    var endpoint = isBear ? "/api/bps/place" : "/api/bcs/place"
    if (!sc) { setMsg("Error: No short leg available at this expiry"); return }
    if (nd == null || nd <= 0) { setMsg("Error: Could not compute net debit (check bid/ask)"); return }
    setBusy(true)
    try {
      var body = {
        ticker:         contract.underlying,
        long_contract:  contract.symbol,
        short_contract: sc.symbol,
        long_strike:    longStrike,
        short_strike:   parseFloat(sc.strike),
        expiry:         contract.expiry,
        net_debit:      nd,
        long_ask:       lAsk,
        short_bid:      sBid,
      }
      var res = await fetch(endpoint, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) })
      var data = await res.json()
      if (!res.ok) throw new Error(data.detail || res.statusText)
      setMsg("✓ Spread placed! Cost: $" + (data.total_debit != null ? parseFloat(data.total_debit).toFixed(2) : (nd * 100).toFixed(2)))
      setTimeout(function(){ setMsg(null); onClose() }, 3000)
    } catch(e){ setMsg("Error: "+e.message) } finally { setBusy(false) }
  }

  return (
    <div className="chain-add-panel">
      <div className="chain-add-hd">
        <div>
          <div className="mono" style={{fontWeight:700,fontSize:13,letterSpacing:"0.05em"}}>{contract.symbol}</div>
          <div className="mono dim" style={{fontSize:11,marginTop:2}}>
            {contract.underlying} {contract.type} · Strike ${fmt(contract.strike)} · Exp {contract.expiry}
            &nbsp;·&nbsp; Mid: {contract.mid!=null?"$"+fmt(contract.mid):"—"}
            &nbsp;·&nbsp; Δ {contract.delta!=null?parseFloat(contract.delta).toFixed(3):"—"}
            &nbsp;·&nbsp; IV: {fmtPct(contract.iv)}
          </div>
        </div>
        <button className="btn btn-ghost" style={{padding:"4px 10px",fontSize:13}} onClick={onClose}>✕</button>
      </div>

      {/* Mode tabs */}
      <div className="chain-mode-tabs">
        <button className={"chain-mode-tab"+(mode==="single"?" active":"")} onClick={function(){setMode("single")}}>Single Leg</button>
        {isCall && <button className={"chain-mode-tab"+(mode==="spread"?" active":"")} onClick={function(){setMode("spread")}}>Bull Spread</button>}
        {isPut  && <button className={"chain-mode-tab chain-mode-tab-bear"+(mode==="bearspread"?" active":"")} onClick={function(){setMode("bearspread")}}>Bear Spread</button>}
      </div>

      <div className="chain-add-body">

        {/* ── Single-leg mode ── */}
        {mode === "single" && (
          <div className="chain-add-fields">
            <div className="form-group">
              <label>Quantity</label>
              <input type="number" min="1" value={qty} onChange={function(e){setQty(e.target.value)}}/>
            </div>
            <div className="form-group">
              <label>Stop Loss (stock $)</label>
              <input type="number" step="0.01" placeholder="e.g. 185.00" value={sl} onChange={function(e){setSl(e.target.value)}}/>
            </div>
            <div className="form-group">
              <label>Take Profit (stock $)</label>
              <input type="number" step="0.01" placeholder="e.g. 200.00" value={tp} onChange={function(e){setTp(e.target.value)}}/>
            </div>
            <div style={{display:"flex",alignItems:"flex-end"}}>
              <button className="btn btn-blue" style={{width:"100%",justifyContent:"center",height:38}} onClick={save} disabled={busy}>
                <ArrowRight size={14}/> Add to Plans
              </button>
            </div>
          </div>
        )}

        {/* ── Bull Spread mode ── */}
        {mode === "spread" && (
          <div>
            <div className="chain-spread-legs">
              {/* Long leg */}
              <div className="chain-spread-leg chain-spread-leg-long">
                <div className="chain-spread-leg-label">BUY · long</div>
                <div className="mono" style={{fontSize:11,fontWeight:700,marginBottom:6,wordBreak:"break-all"}}>{contract.symbol}</div>
                <div className="chain-spread-leg-row">
                  <span className="dim">Strike</span>
                  <span className="mono">${fmt(contract.strike)}</span>
                </div>
                <div className="chain-spread-leg-row">
                  <span className="dim">Ask</span>
                  <span className="mono">{longAsk!=null?"$"+fmt2(longAsk):"—"}</span>
                </div>
                {contract.delta != null && (
                  <div className="chain-spread-leg-row">
                    <span className="dim">Delta</span>
                    <span className="mono">{parseFloat(contract.delta).toFixed(3)}</span>
                  </div>
                )}
              </div>

              {/* Short leg */}
              <div className="chain-spread-leg chain-spread-leg-short">
                <div className="chain-spread-leg-label">SELL · short</div>
                <div className="mono" style={{fontSize:11,fontWeight:700,marginBottom:6,wordBreak:"break-all"}}>{shortContract ? shortContract.symbol : "—"}</div>
                <div className="chain-spread-leg-row">
                  <span className="dim">Strike</span>
                  {callsAbove.length > 0 ? (
                    <select
                      className="chain-spread-strike-sel"
                      value={selectedShortStrike || (autoShort ? String(autoShort.strike) : "")}
                      onChange={function(e){ setSelectedShortStrike(e.target.value) }}
                    >
                      {callsAbove.map(function(c){
                        return <option key={c.strike} value={String(c.strike)}>${fmt(c.strike)}</option>
                      })}
                    </select>
                  ) : (
                    <span className="mono dim">none</span>
                  )}
                </div>
                <div className="chain-spread-leg-row">
                  <span className="dim">Bid</span>
                  <span className="mono">{shortBid!=null?"$"+fmt2(shortBid):"—"}</span>
                </div>
                {shortContract && shortContract.delta != null && (
                  <div className="chain-spread-leg-row">
                    <span className="dim">Delta</span>
                    <span className="mono">{parseFloat(shortContract.delta).toFixed(3)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Risk metrics */}
            <div className="chain-spread-risk">
              <div className="chain-spread-risk-cell">
                <div className="dim mono" style={{fontSize:10}}>NET DEBIT</div>
                <div className="mono amber">{netDebit!=null?"$"+fmt2(netDebit):"—"}</div>
              </div>
              <div className="chain-spread-risk-cell">
                <div className="dim mono" style={{fontSize:10}}>BREAKEVEN</div>
                <div className="mono">{breakeven!=null?"$"+breakeven:"—"}</div>
              </div>
              <div className="chain-spread-risk-cell">
                <div className="dim mono" style={{fontSize:10}}>MAX GAIN</div>
                <div className="mono green">{maxGain!=null?"$"+maxGain:"—"}</div>
              </div>
              <div className="chain-spread-risk-cell">
                <div className="dim mono" style={{fontSize:10}}>MAX LOSS</div>
                <div className="mono red">{maxLoss!=null?"$"+maxLoss:"—"}</div>
              </div>
              <div className="chain-spread-risk-cell">
                <div className="dim mono" style={{fontSize:10}}>WIDTH</div>
                <div className="mono">{width!=null?"$"+fmt2(width):"—"}</div>
              </div>
              <div className="chain-spread-risk-cell">
                <div className="dim mono" style={{fontSize:10}}>R / R</div>
                <div className="mono">{rr!=null?rr+"×":"—"}</div>
              </div>
            </div>

            {/* Qty + Place */}
            <div style={{display:"flex",gap:10,alignItems:"flex-end",marginTop:14}}>
              <div className="form-group" style={{flex:"0 0 80px",marginBottom:0}}>
                <label>Qty</label>
                <input type="number" min="1" value={qty} onChange={function(e){setQty(e.target.value)}} style={{height:38}}/>
              </div>
              <button
                className="btn btn-blue"
                style={{flex:1,justifyContent:"center",height:38}}
                onClick={placeSpread}
                disabled={busy || !shortContract || netDebit==null || netDebit<=0}
              >
                {busy ? "Placing…" : "Place Bull Spread"}
              </button>
            </div>
          </div>
        )}

        {/* ── Bear Spread mode (puts only) ── */}
        {mode === "bearspread" && (
          <div>
            <div className="chain-spread-legs">
              {/* Long put (higher strike — BUY) */}
              <div className="chain-spread-leg chain-spread-leg-long" style={{borderLeftColor:"var(--red-dim)"}}>
                <div className="chain-spread-leg-label" style={{color:"var(--red-dim)"}}>BUY · long put</div>
                <div className="mono" style={{fontSize:11,fontWeight:700,marginBottom:6,wordBreak:"break-all"}}>{contract.symbol}</div>
                <div className="chain-spread-leg-row">
                  <span className="dim">Strike</span>
                  <span className="mono">${fmt(contract.strike)}</span>
                </div>
                <div className="chain-spread-leg-row">
                  <span className="dim">Ask</span>
                  <span className="mono">{bearLongAsk!=null?"$"+fmt2(bearLongAsk):"—"}</span>
                </div>
                {contract.delta != null && (
                  <div className="chain-spread-leg-row">
                    <span className="dim">Delta</span>
                    <span className="mono">{parseFloat(contract.delta).toFixed(3)}</span>
                  </div>
                )}
              </div>

              {/* Short put (lower strike — SELL) */}
              <div className="chain-spread-leg chain-spread-leg-short">
                <div className="chain-spread-leg-label">SELL · short put</div>
                <div className="mono" style={{fontSize:11,fontWeight:700,marginBottom:6,wordBreak:"break-all"}}>{bearShortContract ? bearShortContract.symbol : "—"}</div>
                <div className="chain-spread-leg-row">
                  <span className="dim">Strike</span>
                  {putsBelow.length > 0 ? (
                    <select
                      className="chain-spread-strike-sel"
                      value={selectedShortStrike || (bearAutoShort ? String(bearAutoShort.strike) : "")}
                      onChange={function(e){ setSelectedShortStrike(e.target.value) }}
                    >
                      {putsBelow.map(function(c){
                        return <option key={c.strike} value={String(c.strike)}>${fmt(c.strike)}</option>
                      })}
                    </select>
                  ) : (
                    <span className="mono dim">none</span>
                  )}
                </div>
                <div className="chain-spread-leg-row">
                  <span className="dim">Bid</span>
                  <span className="mono">{bearShortBid!=null?"$"+fmt2(bearShortBid):"—"}</span>
                </div>
                {bearShortContract && bearShortContract.delta != null && (
                  <div className="chain-spread-leg-row">
                    <span className="dim">Delta</span>
                    <span className="mono">{parseFloat(bearShortContract.delta).toFixed(3)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Risk metrics */}
            <div className="chain-spread-risk">
              <div className="chain-spread-risk-cell">
                <div className="dim mono" style={{fontSize:10}}>NET DEBIT</div>
                <div className="mono amber">{bearNetDebit!=null?"$"+fmt2(bearNetDebit):"—"}</div>
              </div>
              <div className="chain-spread-risk-cell">
                <div className="dim mono" style={{fontSize:10}}>BREAKEVEN</div>
                <div className="mono">{bearBreakeven!=null?"$"+bearBreakeven:"—"}</div>
              </div>
              <div className="chain-spread-risk-cell">
                <div className="dim mono" style={{fontSize:10}}>MAX GAIN</div>
                <div className="mono green">{bearMaxGain!=null?"$"+bearMaxGain:"—"}</div>
              </div>
              <div className="chain-spread-risk-cell">
                <div className="dim mono" style={{fontSize:10}}>MAX LOSS</div>
                <div className="mono red">{bearMaxLoss!=null?"$"+bearMaxLoss:"—"}</div>
              </div>
              <div className="chain-spread-risk-cell">
                <div className="dim mono" style={{fontSize:10}}>WIDTH</div>
                <div className="mono">{bearWidth!=null?"$"+fmt2(bearWidth):"—"}</div>
              </div>
              <div className="chain-spread-risk-cell">
                <div className="dim mono" style={{fontSize:10}}>R / R</div>
                <div className="mono">{bearRR!=null?bearRR+"×":"—"}</div>
              </div>
            </div>

            {/* Qty + Place */}
            <div style={{display:"flex",gap:10,alignItems:"flex-end",marginTop:14}}>
              <div className="form-group" style={{flex:"0 0 80px",marginBottom:0}}>
                <label>Qty</label>
                <input type="number" min="1" value={qty} onChange={function(e){setQty(e.target.value)}} style={{height:38}}/>
              </div>
              <button
                className="btn"
                style={{flex:1,justifyContent:"center",height:38,background:"var(--red-mute)",color:"var(--red)",border:"1px solid var(--red-dim)"}}
                onClick={placeSpread}
                disabled={busy || !bearShortContract || bearNetDebit==null || bearNetDebit<=0}
              >
                {busy ? "Placing…" : "Place Bear Spread"}
              </button>
            </div>
          </div>
        )}

        {msg && <div className={"form-msg mono "+(msg.startsWith("Error")?"red":"green")} style={{marginTop:10}}>{msg}</div>}
      </div>
    </div>
  )
}

// Keep AddToPlanModal name as alias so the Options screener tab still works
function AddToPlanModal({ contract, chain, onClose }) {
  return <ChainAddPanel contract={contract} chain={chain} onClose={onClose}/>
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// STOCK SCREENER TAB
// ─────────────────────────────────────────────────────────────────────────────
function StockScreener() {
  var fs = useState(function(){ return loadFilters("stocks", STK_FILTERS_DEFAULT) || Object.assign({},STK_FILTERS_DEFAULT) })
  var filters=fs[0]; var setFilters=fs[1]
  var svs= useState(false); var stkSaved=svs[0]; var setStkSaved=svs[1]
  var rs = useState([]);  var results=rs[0];  var setResults=rs[1]
  var ls = useState(false);var loading=ls[0]; var setLoading=ls[1]
  var es = useState(null);var error=es[0];   var setError=es[1]
  var ews= useState([]);  var errors=ews[0];  var setErrors=ews[1]
  var tot= useState(null);var totalScanned=tot[0]; var setTotalScanned=tot[1]

  function setF(k,v){ setFilters(function(f){ var n=Object.assign({},f); n[k]=v; return n }) }

  function buildBody() {
    var body = {}
    Object.entries(filters).forEach(function(p) {
      var k=p[0]; var v=p[1]
      if (v===""||v===null||v===false) return
      if (["volume_min","limit"].indexOf(k)>-1) body[k]=parseInt(v)
      else if (["price_min","price_max","vol_ratio_min","change_pct_min","change_pct_max","change_5d_min","change_5d_max","rsi_min","rsi_max","atr_min","atr_max"].indexOf(k)>-1) body[k]=parseFloat(v)
      else body[k]=v
    })
    return body
  }

  async function runManual() {
    setLoading(true); setError(null); setResults([]); setErrors([]); setTotalScanned(null)
    try {
      var d=await post("/screener/stocks/run",buildBody())
      setResults(d.results||[]); setErrors(d.errors||[]); setTotalScanned(d.tickers_scanned)
    } catch(e){ setError(e.message) } finally{ setLoading(false) }
  }

  return (
    <div>
      <div className="card">
          <div className="filter-panel-hd">
            <div className="card-title" style={{marginBottom:0}}>Filters</div>
            <FilterPresets presets={STK_PRESETS}
              onApply={function(f){setFilters(function(p){return Object.assign({},p,f)})}}
              onClear={function(){setFilters(Object.assign({},STK_FILTERS_DEFAULT)); saveFilters("stocks", STK_FILTERS_DEFAULT)}}
              onSave={function(){ saveFilters("stocks", filters); setStkSaved(true); setTimeout(function(){ setStkSaved(false) }, 2000) }}
              saved={stkSaved}
            />
          </div>

          {/* Universe picker */}
          <div className="universe-row">
            <span className="filter-section-label mono">Universe</span>
            <div className="universe-chips">
              {STK_UNIVERSES.map(function(u){
                return <button key={u.id} className={"universe-chip "+(filters.universe===u.id?"uchip-on":"uchip-off")} onClick={function(){setF("universe",u.id)}}>{u.label}</button>
              })}
            </div>
          </div>

          <div className="filter-grid" style={{marginTop:16}}>
            <div className="filter-group"><label>Price Min ($)</label><input type="number" step="1" placeholder="5" value={filters.price_min} onChange={function(e){setF("price_min",e.target.value)}}/></div>
            <div className="filter-group"><label>Price Max ($)</label><input type="number" step="1" placeholder="500" value={filters.price_max} onChange={function(e){setF("price_max",e.target.value)}}/></div>
            <div className="filter-group"><label>Volume Min</label><input type="number" placeholder="500000" value={filters.volume_min} onChange={function(e){setF("volume_min",e.target.value)}}/></div>
            <div className="filter-group"><label>Vol Ratio Min (×avg)</label><input type="number" step="0.1" placeholder="1.5" value={filters.vol_ratio_min} onChange={function(e){setF("vol_ratio_min",e.target.value)}}/></div>
            <div className="filter-group"><label>1D Change Min (%)</label><input type="number" step="0.1" placeholder="-5" value={filters.change_pct_min} onChange={function(e){setF("change_pct_min",e.target.value)}}/></div>
            <div className="filter-group"><label>1D Change Max (%)</label><input type="number" step="0.1" placeholder="5" value={filters.change_pct_max} onChange={function(e){setF("change_pct_max",e.target.value)}}/></div>
            <div className="filter-group"><label>5D Change Min (%)</label><input type="number" step="0.5" placeholder="-10" value={filters.change_5d_min} onChange={function(e){setF("change_5d_min",e.target.value)}}/></div>
            <div className="filter-group"><label>5D Change Max (%)</label><input type="number" step="0.5" placeholder="10" value={filters.change_5d_max} onChange={function(e){setF("change_5d_max",e.target.value)}}/></div>
            <div className="filter-group"><label>RSI Min</label><input type="number" step="1" placeholder="30" value={filters.rsi_min} onChange={function(e){setF("rsi_min",e.target.value)}}/></div>
            <div className="filter-group"><label>RSI Max</label><input type="number" step="1" placeholder="70" value={filters.rsi_max} onChange={function(e){setF("rsi_max",e.target.value)}}/></div>
            <div className="filter-group"><label>ATR Min</label><input type="number" step="0.1" placeholder="0" value={filters.atr_min} onChange={function(e){setF("atr_min",e.target.value)}}/></div>
            <div className="filter-group"><label>ATR Max</label><input type="number" step="0.1" placeholder="20" value={filters.atr_max} onChange={function(e){setF("atr_max",e.target.value)}}/></div>
            <div className="filter-group"><label>MA Cross</label>
              <select value={filters.sma_cross} onChange={function(e){setF("sma_cross",e.target.value)}}>
                <option value="">Any / None</option>
                <option value="10_x_20">10 / 20 SMA</option>
                <option value="50_x_200">50 / 200 SMA</option>
              </select>
            </div>
            <div className="filter-group"><label>Cross Direction</label>
              <select value={filters.sma_cross_dir} onChange={function(e){setF("sma_cross_dir",e.target.value)}} disabled={!filters.sma_cross}>
                <option value="">Any Direction</option>
                <option value="golden">Golden (Bullish)</option>
                <option value="death">Death (Bearish)</option>
              </select>
            </div>
            <div className="filter-group"><label>Sort By</label>
              <select value={filters.sort_by} onChange={function(e){setF("sort_by",e.target.value)}}>
                {STK_SORT_OPTIONS.map(function(o){return <option key={o.value} value={o.value}>{o.label}</option>})}
              </select>
            </div>
            <div className="filter-group"><label>Results Limit</label><input type="number" placeholder="25" value={filters.limit} onChange={function(e){setF("limit",e.target.value)}}/></div>
          </div>

          {/* Boolean MA toggles */}
          <div className="bool-filters">
            <span className="filter-section-label mono">Price vs Moving Averages</span>
            <div className="bool-row">
              {[
                {k:"above_sma20",label:"↑ SMA 20"}, {k:"above_sma50",label:"↑ SMA 50"},
                {k:"above_sma200",label:"↑ SMA 200"},{k:"below_sma20",label:"↓ SMA 20"},
                {k:"below_sma50",label:"↓ SMA 50"}, {k:"above_vwap",label:"↑ VWAP"},
                {k:"below_vwap",label:"↓ VWAP"},
              ].map(function(item){
                var on = filters[item.k]===true
                return (
                  <button key={item.k} className={"bool-chip "+(on?"bool-chip-on":"bool-chip-off")}
                    onClick={function(){setF(item.k,on?false:true)}}>
                    {item.label}
                  </button>
                )
              })}
            </div>
          </div>

          <button className="btn btn-blue run-btn" style={{marginTop:20}} onClick={runManual} disabled={loading}>
            <Search size={14}/> {loading?"Scanning...":"Run Screener"}
          </button>
        </div>

      {error && <div className="card" style={{borderColor:"var(--red-dim)",display:"flex",gap:10,alignItems:"center"}}><AlertTriangle size={15} color="var(--red)"/><span className="mono" style={{color:"var(--red)",fontSize:12}}>{error}</span></div>}
      {loading && results.length===0 && (
        <div className="screener-loading">
          <div className="loading-pulse"/>
          <span className="mono dim">Fetching bars &amp; computing indicators...</span>
        </div>
      )}
      {results.length>0 && <ResultsCard results={results} errors={errors} tickers_scanned={totalScanned} cols={STK_COLS} chartSymbolKey="ticker" showChain={true}/>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY SCREENER
// ─────────────────────────────────────────────────────────────────────────────

var STRATEGY_COLS = [
  { key:"ticker",    label:"Ticker",    f: function(v){ return v } },
  { key:"signal",    label:"Signal",    f: function(v){ return v || "---" }, cls: function(r){ return r.signal==="CALL"?"green":r.signal==="PUT"?"red":"" } },
  { key:"price",     label:"Price",     f: function(v){ return v!=null?"$"+fmt(v,2):"---" } },
  { key:"rsi",       label:"RSI",       f: function(v){ return fmt(v,1) }, cls: function(r){ return r.rsi!=null?(r.rsi>65?"red":r.rsi<35?"green":""):"" } },
  { key:"adx",       label:"ADX",       f: function(v){ return fmt(v,1) } },
  { key:"vol_ratio", label:"Vol Ratio", f: function(v){ return v!=null?v.toFixed(2)+"x":"---" }, cls: function(r){ return r.vol_ratio>1.5?"amber":"" } },
  { key:"ema20",     label:"EMA 20",    f: function(v){ return v!=null?"$"+fmt(v,2):"---" } },
  { key:"sma50",     label:"SMA 50",    f: function(v){ return v!=null?"$"+fmt(v,2):"---" } },
]

function StrategyScreener() {
  var ss = useState([]); var strategies=ss[0]; var setStrategies=ss[1]
  var sel= useState(null); var selected=sel[0]; var setSelected=sel[1]
  var rs = useState([]); var results=rs[0]; var setResults=rs[1]
  var ls = useState(false); var loading=ls[0]; var setLoading=ls[1]
  var es = useState(null); var error=es[0]; var setError=es[1]
  var tot= useState(null); var totalScanned=tot[0]; var setTotalScanned=tot[1]
  var stratName = useState(""); var sn=stratName[0]; var setSn=stratName[1]
  var errs= useState([]); var scanErrors=errs[0]; var setScanErrors=errs[1]

  useEffect(function() {
    async function load() {
      try {
        var d = await fetch("/api/strategies").then(function(r){ return r.json() })
        setStrategies(d.strategies || [])
        if (d.strategies && d.strategies.length > 0) setSelected(d.strategies[0].id)
      } catch(e) {}
    }
    load()
  }, [])

  async function runStrategy() {
    if (!selected) return
    setLoading(true); setError(null); setResults([]); setScanErrors([]); setTotalScanned(null)
    try {
      var d = await fetch("/api/strategies/" + selected + "/run", { method: "POST" }).then(function(r){
        if (!r.ok) return r.json().then(function(e){ throw new Error(e.detail || r.statusText) })
        return r.json()
      })
      setResults(d.results || [])
      setScanErrors(d.errors || [])
      setTotalScanned(d.tickers_scanned)
      setSn(d.strategy_name || "")
    } catch(e) { setError(e.message) }
    finally { setLoading(false) }
  }

  var selectedStrat = strategies.find(function(s){ return s.id === selected })

  return (
    <div>
      <div className="card">
        <div className="filter-panel-hd">
          <div className="card-title" style={{marginBottom:0}}>Strategy</div>
        </div>

        <div style={{marginTop:16, display:"flex", flexDirection:"column", gap:12}}>
          {/* Strategy picker */}
          <div className="filter-group" style={{maxWidth:400}}>
            <label>Select Strategy</label>
            <select value={selected||""} onChange={function(e){ setSelected(e.target.value); setResults([]); setError(null) }}>
              {strategies.length === 0 && <option value="">Loading...</option>}
              {strategies.map(function(s){
                return <option key={s.id} value={s.id}>{s.name}</option>
              })}
            </select>
          </div>

          {/* Strategy description */}
          {selectedStrat && (
            <div className="strategy-desc">
              <span className="mono dim" style={{fontSize:13}}>{selectedStrat.description}</span>
              {selectedStrat.locked && (
                <span className="badge badge-blue" style={{fontSize:10, marginLeft:8}}>Built-in</span>
              )}
            </div>
          )}

          {/* Strategy params summary */}
          {selectedStrat && selectedStrat.params && (
            <div className="strategy-params">
              {Object.entries(selectedStrat.params).map(function(pair){
                return (
                  <span key={pair[0]} className="strategy-param-chip">
                    <span className="dim mono" style={{fontSize:12}}>{pair[0].replace(/_/g," ")}</span>
                    <span className="mono" style={{fontSize:15}}>{pair[1]}</span>
                  </span>
                )
              })}
            </div>
          )}
        </div>

        <button className="btn btn-blue run-btn" style={{marginTop:20}} onClick={runStrategy} disabled={loading||!selected}>
          <Search size={14}/> {loading ? "Scanning S\u0026P 500..." : "Run Screener"}
        </button>
      </div>

      {error && (
        <div className="card" style={{borderColor:"var(--red-dim)",display:"flex",gap:10,alignItems:"center"}}>
          <AlertTriangle size={15} color="var(--red)"/>
          <span className="mono" style={{color:"var(--red)",fontSize:12}}>{error}</span>
        </div>
      )}

      {loading && results.length === 0 && (
        <div className="screener-loading">
          <div className="loading-pulse"/>
          <span className="mono dim">Running {sn||"strategy"} across S&amp;P 500...</span>
        </div>
      )}

      {!loading && results.length === 0 && totalScanned != null && !error && (
        <div className="card" style={{textAlign:"center",padding:"32px 20px"}}>
          <div className="mono dim" style={{fontSize:13}}>No signals found</div>
          <div className="mono dim" style={{fontSize:11,marginTop:6}}>{totalScanned} tickers scanned — no stocks met all criteria today</div>
        </div>
      )}

      {results.length > 0 && (
        <ResultsCard
          results={results}
          errors={scanErrors}
          tickers_scanned={totalScanned}
          cols={STRATEGY_COLS}
          chartSymbolKey="ticker"
          showChain={true}
          headerExtra={
            <span className="mono dim" style={{fontSize:13}}>
              {results.filter(function(r){return r.signal==="CALL"}).length} calls · {results.filter(function(r){return r.signal==="PUT"}).length} puts
            </span>
          }
        />
      )}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// WATCHLIST
// ─────────────────────────────────────────────────────────────────────────────

var WATCHLIST_DEFAULT = [
  "SPY","PLTR","NVDA","AAPL","GOOG","MSFT","AMZN","META","TSLA","AVGO",
  "WMT","JPM","ORCL","V","XOM","JNJ","MA","NFLX","BAC","COST",
  "AMD","BABA","HD","CSCO","KO","MCD","CRM","SHOP","TMUS","QCOM",
  "DIS","INTC","PEP","T","CVX","HOOD","COF","TGT","MNST","KR",
  "HSY","DASH","NKE","ABNB","CVNA","IBM","NOW","UBER","CRWD","DELL",
  "SOFI","PYPL","MARA"
]

var WATCHLIST_STORAGE_KEY = "screener_watchlist_v1"

function loadWatchlist() {
  try {
    var raw = localStorage.getItem(WATCHLIST_STORAGE_KEY)
    if (raw) {
      var parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch(e) {}
  return WATCHLIST_DEFAULT.slice()
}

function saveWatchlist(list) {
  try { localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(list)) } catch(e) {}
}

// ── Shared spread quick-builder ── (used by both BullSpreadPanel & BearSpreadPanel)
function SpreadQuickPanel({ symbol, direction }) {
  var isBull = direction === "bull"
  var ss = useState(null);  var spread  = ss[0];  var setSpread  = ss[1]
  var ls = useState(false); var loading = ls[0];  var setLoading = ls[1]
  var es = useState(null);  var error   = es[0];  var setError   = es[1]
  var ps = useState(false); var placing = ps[0];  var setPlacing = ps[1]
  var ms = useState(null);  var msg     = ms[0];  var setMsg     = ms[1]

  useEffect(function() {
    setSpread(null); setError(null); setMsg(null)
  }, [symbol, direction])

  async function scan() {
    setLoading(true); setError(null); setSpread(null); setMsg(null)
    var endpoint = isBull ? "/api/bcs/scan" : "/api/bps/scan"
    try {
      var res  = await fetch(endpoint, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ tickers: [symbol] }) })
      var data = await res.json()
      if (!res.ok) throw new Error(data.detail || res.statusText)
      var candidates = data.candidates || []
      var match = candidates.find(function(c){ return c.ticker === symbol }) || candidates[0]
      if (!match) throw new Error("No valid " + (isBull ? "bull call" : "bear put") + " spread found for " + symbol + " — check trend and liquidity data.")
      setSpread(match)
    } catch(e) { setError(e.message) } finally { setLoading(false) }
  }

  async function place() {
    if (!spread) return
    setPlacing(true)
    var endpoint = isBull ? "/api/bcs/place" : "/api/bps/place"
    try {
      var body = {
        ticker: spread.ticker, long_contract: spread.long_contract,
        short_contract: spread.short_contract, long_strike: spread.long_strike,
        short_strike: spread.short_strike, expiry: spread.expiry,
        net_debit: spread.net_debit, long_ask: spread.long_ask, short_bid: spread.short_bid,
      }
      var res = await fetch(endpoint, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) })
      var data = await res.json()
      if (!res.ok) throw new Error(data.detail || res.statusText)
      setMsg("✓ Spread placed! Cost: $" + (data.total_debit != null ? parseFloat(data.total_debit).toFixed(2) : (spread.net_debit * 100).toFixed(2)))
      setTimeout(function(){ setMsg(null); setSpread(null) }, 4000)
    } catch(e) { setMsg("Error: " + e.message) } finally { setPlacing(false) }
  }

  // breakeven: bull = long_strike + debit, bear = long_strike − debit
  var be = spread && spread.long_strike != null && spread.net_debit != null
    ? isBull
      ? (spread.long_strike + spread.net_debit).toFixed(2)
      : (spread.long_strike - spread.net_debit).toFixed(2)
    : null

  var accentColor = isBull ? "var(--green-dim)" : "var(--red-dim)"
  var labelColor  = isBull ? "var(--green)"     : "var(--red)"
  var longLabel   = isBull ? "BUY · long call"  : "BUY · long put"
  var shortLabel  = isBull ? "SELL · short call" : "SELL · short put"
  var placeBtnCls = isBull ? "btn btn-ghost" : "btn btn-ghost"  // ghost for both; accent via border

  return (
    <div className="wl-bcs-panel" style={{ borderLeftColor: accentColor }}>
      <div className="wl-bcs-header">
        <div className="mono" style={{fontWeight:600, fontSize:12, letterSpacing:"0.06em", color:"var(--text-2)"}}>
          {isBull ? "BULL CALL SPREAD" : "BEAR PUT SPREAD"}
        </div>
        <button className="btn btn-ghost wl-bcs-scan-btn" onClick={scan} disabled={loading}>
          {loading
            ? <><Loader2 size={12} className="spin"/> Scanning…</>
            : isBull
              ? <><TrendingUp size={12}/> {spread ? "Rebuild" : "Build Spread"}</>
              : <><TrendingDown size={12}/> {spread ? "Rebuild" : "Build Spread"}</>
          }
        </button>
      </div>

      {!spread && !loading && !error && (
        <div className="mono dim wl-bcs-hint">
          Click <strong>Build Spread</strong> to auto-select contracts and price a {isBull ? "bull call" : "bear put"} spread on {symbol}.
        </div>
      )}

      {error && (
        <div className="wl-bcs-error">
          <AlertTriangle size={12}/> {error}
        </div>
      )}

      {spread && (
        <div className="wl-bcs-result">
          <div className="wl-bcs-legs">
            <div className="wl-bcs-leg" style={{ borderLeft: "3px solid " + accentColor }}>
              <div className="wl-bcs-leg-label" style={{ color: labelColor }}>{longLabel}</div>
              <div className="mono" style={{fontSize:12, fontWeight:700}}>${fmt(spread.long_strike)}</div>
              <div className="mono dim" style={{fontSize:10, marginBottom:4}}>{spread.expiry} · {spread.dte} DTE</div>
              <div className="mono dim" style={{fontSize:10, wordBreak:"break-all"}}>{spread.long_contract}</div>
              <div className="mono amber" style={{fontSize:12, marginTop:4}}>ask ${fmt2(spread.long_ask)}</div>
            </div>
            <div className="wl-bcs-divider mono dim">→</div>
            <div className="wl-bcs-leg" style={{ borderLeft: "3px solid var(--border-hi)" }}>
              <div className="wl-bcs-leg-label" style={{ color: "var(--text-3)" }}>{shortLabel}</div>
              <div className="mono" style={{fontSize:12, fontWeight:700}}>${fmt(spread.short_strike)}</div>
              <div className="mono dim" style={{fontSize:10, marginBottom:4}}>{spread.expiry} · {spread.dte} DTE</div>
              <div className="mono dim" style={{fontSize:10, wordBreak:"break-all"}}>{spread.short_contract}</div>
              <div className="mono amber" style={{fontSize:12, marginTop:4}}>bid ${fmt2(spread.short_bid)}</div>
            </div>
          </div>

          <div className="wl-bcs-risk">
            <div className="wl-bcs-metric">
              <span className="dim mono" style={{fontSize:9}}>NET DEBIT</span>
              <span className="mono amber">${fmt2(spread.net_debit)}</span>
            </div>
            <div className="wl-bcs-metric">
              <span className="dim mono" style={{fontSize:9}}>BREAKEVEN</span>
              <span className="mono">{be ? "$"+be : "—"}</span>
            </div>
            <div className="wl-bcs-metric">
              <span className="dim mono" style={{fontSize:9}}>MAX GAIN</span>
              <span className="mono green">${fmt(spread.max_gain_per_contract, 0)}</span>
            </div>
            <div className="wl-bcs-metric">
              <span className="dim mono" style={{fontSize:9}}>MAX LOSS</span>
              <span className="mono red">${fmt(spread.max_loss_per_contract, 0)}</span>
            </div>
            <div className="wl-bcs-metric">
              <span className="dim mono" style={{fontSize:9}}>DTE</span>
              <span className="mono">{spread.dte ?? "—"}</span>
            </div>
            <div className="wl-bcs-metric">
              <span className="dim mono" style={{fontSize:9}}>R / R</span>
              <span className="mono">{spread.risk_reward != null ? spread.risk_reward+"×" : "—"}</span>
            </div>
          </div>

          <button
            className="btn wl-bcs-place-btn"
            style={{ border: "1px solid " + accentColor, color: labelColor, background: "transparent" }}
            onClick={place}
            disabled={placing}
          >
            {placing ? "Placing…" : "Place " + (isBull ? "Bull" : "Bear") + " Spread"}
          </button>
        </div>
      )}

      {msg && (
        <div className={"mono wl-bcs-msg " + (msg.startsWith("Error") ? "red" : "green")}>
          {msg}
        </div>
      )}
    </div>
  )
}

// ── Bull / Bear spread panel wrappers ─────────────────────────────────────────
function BullSpreadPanel({ symbol }) { return <SpreadQuickPanel symbol={symbol} direction="bull"/> }
function BearSpreadPanel({ symbol }) { return <SpreadQuickPanel symbol={symbol} direction="bear"/> }

function WatchlistScreener() {
  var wl  = useState(function(){ return loadWatchlist() }); var tickers=wl[0]; var setTickers=wl[1]
  var ai  = useState(""); var addInput=ai[0]; var setAddInput=ai[1]
  var ae  = useState(null); var addError=ae[0]; var setAddError=ae[1]
  var si  = useState(-1); var selIdx=si[0]; var setSelIdx=si[1]

  var rowRefs  = useRef([])
  var drag     = useRef(null)
  var dragOver = useRef(null)
  var inputRef = useRef(null)

  var selected = selIdx >= 0 && selIdx < tickers.length ? tickers[selIdx] : null

  function updateTickers(next) { setTickers(next); saveWatchlist(next) }

  function addTicker() {
    var t = addInput.trim().toUpperCase()
    if (!t) return
    if (!/^[A-Z]{1,6}$/.test(t)) { setAddError("Invalid ticker: " + t); return }
    if (tickers.indexOf(t) !== -1) { setAddError(t + " already in watchlist"); return }
    setAddError(null)
    updateTickers(tickers.concat(t))
    setAddInput("")
  }

  function removeTicker(idx) {
    var next = tickers.filter(function(_, i){ return i !== idx })
    updateTickers(next)
    setSelIdx(function(cur) {
      if (cur === idx) return next.length > 0 ? Math.min(cur, next.length - 1) : -1
      if (cur > idx)   return cur - 1
      return cur
    })
  }

  function selectIdx(idx) {
    if (idx < 0 || idx >= tickers.length) return
    setSelIdx(idx)
    // Scroll row into view
    if (rowRefs.current[idx]) {
      rowRefs.current[idx].scrollIntoView({ block: "nearest", behavior: "smooth" })
    }
  }

  // Arrow key navigation — only when input is NOT focused
  useEffect(function() {
    function onKey(e) {
      if (document.activeElement === inputRef.current) return
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelIdx(function(cur) {
          var next = Math.min(cur + 1, tickers.length - 1)
          if (next < 0) next = 0
          if (rowRefs.current[next]) rowRefs.current[next].scrollIntoView({ block: "nearest", behavior: "smooth" })
          return next
        })
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelIdx(function(cur) {
          var next = Math.max(cur - 1, 0)
          if (rowRefs.current[next]) rowRefs.current[next].scrollIntoView({ block: "nearest", behavior: "smooth" })
          return next
        })
      } else if (e.key === "Escape") {
        setSelIdx(-1)
      }
    }
    window.addEventListener("keydown", onKey)
    return function() { window.removeEventListener("keydown", onKey) }
  }, [tickers.length])

  // HTML5 drag-to-reorder
  function onDragStart(e, idx) { drag.current = idx; e.dataTransfer.effectAllowed = "move" }
  function onDragOver(e, idx)  { e.preventDefault(); dragOver.current = idx }
  function onDrop(e, idx) {
    e.preventDefault()
    var from = drag.current
    if (from === null || from === idx) return
    var next = tickers.slice()
    var item = next.splice(from, 1)[0]
    next.splice(idx, 0, item)
    drag.current = null; dragOver.current = null
    updateTickers(next)
    // Keep selection on the moved item
    setSelIdx(idx)
  }
  function onDragEnd() { drag.current = null; dragOver.current = null }

  function handleAddKey(e) {
    if (e.key === "Enter") addTicker()
    else setAddError(null)
  }

  return (
    <div style={{display:"flex", gap:20, alignItems:"flex-start"}}>

      {/* Left column — list */}
      <div className="wl-list-col">
        {/* Add row */}
        <div className="wl-add-bar">
          <input
            ref={inputRef}
            className="wl-add-input"
            placeholder="Add ticker…"
            value={addInput}
            onChange={function(e){ setAddInput(e.target.value.toUpperCase()) }}
            onKeyDown={handleAddKey}
            maxLength={6}
          />
          <button className="btn btn-blue wl-add-btn" onClick={addTicker}>
            <Plus size={13}/>
          </button>
        </div>
        {addError && <div className="mono red" style={{fontSize:12, padding:"4px 2px"}}>{addError}</div>}

        {/* Count + hint */}
        <div className="wl-list-meta">
          <span className="mono dim">{tickers.length} tickers</span>
          <span className="mono dim">↑ ↓ to navigate</span>
        </div>

        {/* List */}
        <div className="wl-list">
          {tickers.map(function(ticker, idx) {
            var isSelected = selIdx === idx
            return (
              <div
                key={ticker}
                ref={function(el){ rowRefs.current[idx] = el }}
                className={"wl-row" + (isSelected ? " wl-row-selected" : "")}
                draggable
                onDragStart={function(e){ onDragStart(e, idx) }}
                onDragOver={function(e){ onDragOver(e, idx) }}
                onDrop={function(e){ onDrop(e, idx) }}
                onDragEnd={onDragEnd}
                onClick={function(){ selectIdx(idx) }}
              >
                <span className="wl-row-grip"><GripVertical size={13}/></span>
                <span className="wl-row-num mono dim">{idx + 1}</span>
                <span className="wl-row-ticker mono">{ticker}</span>
                <button
                  className="wl-row-remove"
                  onClick={function(e){ e.stopPropagation(); removeTicker(idx) }}
                  title={"Remove " + ticker}
                ><X size={11}/></button>
              </div>
            )
          })}
          {tickers.length === 0 && (
            <div className="wl-empty">
              <Bookmark size={24} color="var(--text-3)"/>
              <span className="mono dim" style={{fontSize:13}}>Watchlist is empty</span>
            </div>
          )}
        </div>
      </div>

      {/* Right column — chart + chain */}
      <div className="wl-detail-col">
        {selected ? (
          <>
            <StockChart symbol={selected} onClose={function(){ setSelIdx(-1) }}/>
            <BullSpreadPanel symbol={selected}/>
            <BearSpreadPanel symbol={selected}/>
            <OptionsChain symbol={selected} stockPrice={null}/>
          </>
        ) : (
          <div className="wl-detail-empty">
            <Bookmark size={28} color="var(--text-3)"/>
            <div className="mono dim">Select a ticker to view chart &amp; options</div>
            <div className="dim" style={{fontSize:12}}>Click a row or use ↑ ↓ arrow keys</div>
          </div>
        )}
      </div>

    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// ROOT SCREENER (toggle between Options / Stocks)
// ─────────────────────────────────────────────────────────────────────────────
export default function Screener() {
  var ms = useState("manual"); var mode=ms[0]; var setMode=ms[1]

  return (
    <div className="screener">
      {/* Mode toggle */}
      <div className="screener-mode-tabs" style={{marginBottom:20}}>
        <button
          className={"mode-tab " + (mode==="manual" ? "mode-tab-on" : "mode-tab-off")}
          onClick={function(){ setMode("manual") }}
        >
          <Search size={13}/> Manual Filters
        </button>
        <button
          className={"mode-tab " + (mode==="strategy" ? "mode-tab-on" : "mode-tab-off")}
          onClick={function(){ setMode("strategy") }}
        >
          <TrendingUp size={13}/> Strategy
        </button>
        <button
          className={"mode-tab " + (mode==="watchlist" ? "mode-tab-on" : "mode-tab-off")}
          onClick={function(){ setMode("watchlist") }}
        >
          <Bookmark size={13}/> Watchlist
        </button>
      </div>

      {mode === "manual"    && <StockScreener/>}
      {mode === "strategy"  && <StrategyScreener/>}
      {mode === "watchlist" && <WatchlistScreener/>}
    </div>
  )
}