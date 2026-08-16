import { workflow, node, trigger, sticky, newCredential, languageModel, expr } from '@n8n/workflow-sdk';

const introNote = sticky(
  '## StockChartAgent\n' +
  'Enter a stock ticker in the form.\n\n' +
  'Flow: Form Input -> Resolve TradingView Symbol -> Fetch Live TradingView Market Data (scanner.tradingview.com) -> Compute Analytics (today, 1w, 30d, 3m, 6m, 1y, YTD) -> AI Report Writer (Groq) -> Convert to .txt -> Save to Disk -> Email via Gmail -> Confirmation page.\n\n' +
  'All chart/performance data is pulled live from TradingView. The .txt report is saved on the n8n host under C:/Users/mohit/.n8n-files/StockChartAgent/ and emailed to madhurvwork@gmail.com as an attachment.',
  [],
  { color: 4, width: 400, height: 260 }
);

const stockForm = trigger({
  type: 'n8n-nodes-base.formTrigger',
  version: 2.6,
  config: {
    name: 'Enter Stock Symbol',
    parameters: {
      formTitle: 'Stock Chart Analysis Agent',
      formDescription: 'Enter a stock ticker symbol to generate a detailed, up-to-date technical and analytics report emailed to you as a .txt file.',
      formFields: {
        values: [
          {
            fieldLabel: 'Stock Ticker Symbol',
            fieldName: 'stockSymbol',
            fieldType: 'text',
            placeholder: 'e.g. AAPL, MSFT, TSLA, RELIANCE',
            requiredField: true,
          },
        ],
      },
      responseMode: 'lastNode',
      options: { appendAttribution: false, buttonLabel: 'Analyze Stock' },
    },
  },
  output: [{ stockSymbol: 'AAPL' }],
});

const resolveSymbol = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Resolve TradingView Symbol',
    parameters: {
      method: 'GET',
      url: 'https://symbol-search.tradingview.com/symbol_search/',
      authentication: 'none',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'text', value: expr('{{ $json.stockSymbol.trim() }}') },
          { name: 'type', value: 'stock' },
          { name: 'domain', value: 'production' },
          { name: 'lang', value: 'en' },
        ],
      },
      sendHeaders: true,
      specifyHeaders: 'keypair',
      // Full realistic UA + Origin/Accept are REQUIRED — a truncated UA gets a 403 from CloudFront.
      headerParameters: {
        parameters: [
          { name: 'User-Agent', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          { name: 'Referer', value: 'https://www.tradingview.com/' },
          { name: 'Origin', value: 'https://www.tradingview.com' },
          { name: 'Accept', value: 'application/json' },
        ],
      },
      options: { response: { response: { neverError: true, responseFormat: 'json' } } },
    },
  },
  output: [[{ symbol: 'AAPL', description: 'Apple Inc.', exchange: 'NASDAQ', type: 'stock' }]],
});

const pickBestMatch = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Pick Best Match',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      // NOTE: TradingView's symbol-search returns a raw JSON array, which n8n
      // auto-splits into one item per element. Must read $input.all(), not $json.
      jsCode: `
const requestedSymbol = ($('Enter Stock Symbol').item.json.stockSymbol || '').trim().toUpperCase();

let list = $input.all().map(item => item.json);
if (list.length === 1 && Array.isArray(list[0].symbols)) {
  list = list[0].symbols;
}
if (!Array.isArray(list)) list = [];

const stripTags = (s) => (s || '').toString().replace(/<[^>]*>/g, '');

const stockTypes = ['stock', 'dr', 'common stock', 'fund'];
const stockMatches = list.filter(i => stockTypes.includes((i.type || '').toLowerCase()));
const candidates = stockMatches.length ? stockMatches : list;
const best = candidates[0];

if (!best) {
  return [{ json: { error: true, requestedSymbol, errorMessage: \`No TradingView symbol found for "\${requestedSymbol}". Try a more specific or well-known ticker (e.g. AAPL, MSFT, RELIANCE).\` } }];
}

const exchange = (stripTags(best.exchange) || 'NASDAQ').toUpperCase();
const symbol = (stripTags(best.symbol) || requestedSymbol).toUpperCase();
const tvSymbol = exchange + ':' + symbol;

const regionMap = {
  NASDAQ: 'america', NYSE: 'america', AMEX: 'america', OTC: 'america',
  NSE: 'india', BSE: 'india',
  LSE: 'uk',
  TSX: 'canada', TSXV: 'canada',
  ASX: 'australia',
  XETR: 'germany', FWB: 'germany',
};
const region = regionMap[exchange] || 'america';

return [{ json: { tvSymbol, exchange, symbol, region, description: stripTags(best.description), requestedSymbol } }];
`.trim(),
    },
  },
  output: [{ tvSymbol: 'NASDAQ:AAPL', exchange: 'NASDAQ', symbol: 'AAPL', region: 'america', description: 'Apple Inc.' }],
});

const fetchTvData = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch TradingView Market Data',
    parameters: {
      method: 'POST',
      url: expr('https://scanner.tradingview.com/{{ $json.region }}/scan'),
      authentication: 'none',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'User-Agent', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          { name: 'Referer', value: 'https://www.tradingview.com/' },
          { name: 'Origin', value: 'https://www.tradingview.com' },
        ],
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ { "symbols": { "tickers": [$json.tvSymbol], "query": { "types": [] } }, "columns": ["description","close","change","change_abs","high","low","volume","average_volume_10d_calc","High.1M","Low.1M","High.3M","Low.3M","High.6M","Low.6M","price_52_week_high","price_52_week_low","Perf.W","Perf.1M","Perf.3M","Perf.6M","Perf.Y","Perf.YTD","SMA20","SMA50","SMA200","RSI","Volatility.D","market_cap_basic","sector","industry","currency"] } }}'),
      options: { response: { response: { neverError: true, responseFormat: 'json' } } },
    },
  },
  output: [{ data: [{ s: 'NASDAQ:AAPL', d: ['Apple Inc.', 305.93, 0.22, 0.67, 307.49, 304.3, 28229375, 46559299, 344.57, 300, 344.57, 273.75, 344.57, 245.51, 344.57, 223.78, -1.77, -3.68, 2.7, 16.76, 30.71, 12.37, 318.43, 309.19, 280.48, 43.67, 1.05, 4464797284906, 'Electronic Technology', 'Telecommunications Equipment', 'USD'] }] }],
});

const computeAnalytics = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Compute Stock Analytics',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `
const upstream = $('Pick Best Match').item.json;

if (upstream.error) {
  return [{ json: { symbol: upstream.requestedSymbol, error: true, errorMessage: upstream.errorMessage } }];
}

const body = $json;
const row = body && body.data && body.data[0];

if (!row || !row.d) {
  return [{ json: { symbol: upstream.tvSymbol, error: true, errorMessage: 'TradingView returned no live market data for ' + upstream.tvSymbol + '. The symbol/exchange combination may be unsupported on this data feed.' } }];
}

const d = row.d;
const col = (i) => (d[i] === undefined ? null : d[i]);
const round2 = (v) => (v == null ? null : +Number(v).toFixed(2));

const description = col(0);
const close = col(1);
const changePercent = col(2);
const changeAbs = col(3);
const high = col(4);
const low = col(5);
const volume = col(6);
const avgVolume10d = col(7);
const high1M = col(8);
const low1M = col(9);
const high3M = col(10);
const low3M = col(11);
const high6M = col(12);
const low6M = col(13);
const fiftyTwoWeekHigh = col(14);
const fiftyTwoWeekLow = col(15);
const perfW = col(16);
const perf1M = col(17);
const perf3M = col(18);
const perf6M = col(19);
const perfY = col(20);
const perfYTD = col(21);
const sma20 = col(22);
const sma50 = col(23);
const sma200 = col(24);
const rsi = col(25);
const volatilityDaily = col(26);
const marketCap = col(27);
const sector = col(28);
const industry = col(29);
const currency = col(30);

const analytics = {
  symbol: upstream.symbol,
  tvSymbol: upstream.tvSymbol,
  companyName: description || upstream.symbol,
  exchange: upstream.exchange,
  sector: sector || null,
  industry: industry || null,
  currency: currency || null,
  marketCap: marketCap || null,
  generatedAt: new Date().toISOString(),
  latestPrice: round2(close),
  todayChangePercent: round2(changePercent),
  todayChangeAbsolute: round2(changeAbs),
  todayHigh: round2(high),
  todayLow: round2(low),
  todayVolume: volume,
  averageVolume10Day: avgVolume10d ? Math.round(avgVolume10d) : null,
  fiftyTwoWeekHigh: round2(fiftyTwoWeekHigh),
  fiftyTwoWeekLow: round2(fiftyTwoWeekLow),
  sma20: round2(sma20),
  sma50: round2(sma50),
  sma200: round2(sma200),
  rsi14: round2(rsi),
  volatilityDailyPercent: round2(volatilityDaily),
  last1Week: { percentChange: round2(perfW) },
  last30Days: { percentChange: round2(perf1M), periodHigh: round2(high1M), periodLow: round2(low1M) },
  last3Months: { percentChange: round2(perf3M), periodHigh: round2(high3M), periodLow: round2(low3M) },
  last6Months: { percentChange: round2(perf6M), periodHigh: round2(high6M), periodLow: round2(low6M) },
  last1Year: { percentChange: round2(perfY) },
  yearToDate: { percentChange: round2(perfYTD) },
  dataSource: 'TradingView live market data (scanner.tradingview.com)',
};

return [{ json: analytics }];
`.trim(),
    },
  },
  output: [{ symbol: 'AAPL', tvSymbol: 'NASDAQ:AAPL', companyName: 'Apple Inc.', latestPrice: 305.93, todayChangePercent: 0.22 }],
});

const groqModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatGroq',
  version: 1,
  config: {
    name: 'Groq Model',
    parameters: {
      model: 'llama-3.3-70b-versatile',
      options: { maxTokensToSample: 4096, temperature: 0.4 },
    },
    credentials: { groqApi: newCredential('Groq account') },
  },
});

const stockReportAgent = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Generate Stock Analysis Report',
    parameters: {
      promptType: 'define',
      text: expr('Write a detailed, up-to-date stock analysis report using ONLY the JSON analytics data below (sourced live from TradingView). Do not invent numbers not present in the data.\n\nAnalytics JSON:\n{{ JSON.stringify($json, null, 2) }}'),
      hasOutputParser: false,
      options: {
        systemMessage: 'You are a professional equity research analyst. You write clear, well-structured plain-text stock analysis reports suitable for saving as a .txt file (no markdown symbols like # or **, use plain headers, dashes and line breaks instead). All data in the JSON comes from live TradingView market data (scanner.tradingview.com) - treat it as current, real market figures, not placeholders.\n\nIf the input JSON has "error": true, output only a short plain-text explanation of the error and stop.\n\nOtherwise structure the report with these sections, each with a clear ALL-CAPS header line followed by a line of dashes:\n1. REPORT HEADER - company name, symbol (tvSymbol), exchange, sector/industry, currency, market cap, report generated timestamp, and a note that data is sourced live from TradingView\n2. TODAY\'S SNAPSHOT - latest price, today change (percent and absolute), today high/low, today volume vs the 10-day average volume, and whether the stock is up or down today\n3. KEY TECHNICAL PARAMETERS - 20/50/200-day simple moving averages and what the price position relative to them implies (uptrend/downtrend/neutral), 14-period RSI and whether it signals overbought/oversold/neutral, 52-week high/low and where the current price sits in that range, daily volatility and what it implies about risk\n4. PERIOD PERFORMANCE - a clear breakdown of performance over Last 1 Week, Last 30 Days (with period high/low), Last 3 Months (with period high/low), Last 6 Months (with period high/low), Last 1 Year, and Year-to-Date\n5. DETAILED NARRATIVE ANALYSIS - a multi-paragraph written analysis synthesizing all the above: trend direction, momentum, RSI-based overbought/oversold read, volatility/risk profile, support/resistance approximated from period highs/lows, and volume behavior\n6. SUMMARY & OUTLOOK - a concise closing summary of the overall technical picture (not investment advice; include a short disclaimer that this is for informational purposes only and not financial advice)\n\nBe specific and quantitative, referencing the actual numbers from the JSON throughout. Keep the tone professional and objective.',
        maxIterations: 5,
      },
    },
    subnodes: { model: groqModel },
  },
  output: [{ output: 'AAPL STOCK ANALYSIS REPORT\n--------------------------\n...' }],
});

const convertReportToTxt = node({
  type: 'n8n-nodes-base.convertToFile',
  version: 1.1,
  config: {
    name: 'Convert Report to TXT',
    parameters: {
      operation: 'toText',
      sourceProperty: 'output',
      binaryPropertyName: 'data',
      options: {
        fileName: expr("{{ $('Compute Stock Analytics').item.json.symbol }}_analysis_{{ $now.toFormat('yyyy-MM-dd') }}.txt"),
      },
    },
  },
  output: [{}],
});

const saveReportToDisk = node({
  type: 'n8n-nodes-base.readWriteFile',
  version: 1.1,
  config: {
    name: 'Save Report to Disk',
    parameters: {
      operation: 'write',
      // MUST stay under C:/Users/mohit/.n8n-files/ — this n8n install's
      // SecurityConfig.restrictFileAccessTo whitelists ONLY that directory.
      // MUST use forward slashes — backslashes break n8n's {{ }} expression parsing on Windows.
      fileName: expr("C:/Users/mohit/.n8n-files/StockChartAgent/{{ $('Compute Stock Analytics').item.json.symbol }}_analysis_{{ $now.toFormat('yyyy-MM-dd') }}.txt"),
      dataPropertyName: 'data',
    },
  },
  output: [{}],
});

const sendReportViaGmail = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Send Report via Gmail',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: 'madhurvwork@gmail.com',
      subject: expr("Stock Analysis Report - {{ $('Compute Stock Analytics').item.json.symbol }} - {{ $now.toFormat('yyyy-MM-dd') }}"),
      emailType: 'text',
      message: expr("Attached is the detailed stock analysis report for {{ $('Compute Stock Analytics').item.json.symbol }}, generated on {{ $now.toFormat('yyyy-MM-dd HH:mm') }} using live TradingView market data.\n\nThis report is for informational purposes only and is not financial advice."),
      options: {
        appendAttribution: false,
        attachmentsUi: { attachmentsBinary: [{ property: 'data' }] },
      },
    },
    credentials: { gmailOAuth2: newCredential('Gmail account') },
  },
  output: [{ id: '18c1a2b3d4e5f6' }],
});

const deliverReport = node({
  type: 'n8n-nodes-base.form',
  version: 2.5,
  config: {
    name: 'Deliver Report',
    parameters: {
      operation: 'completion',
      respondWith: 'text',
      completionTitle: 'Report Emailed',
      completionMessage: expr("Your detailed stock analysis report for {{ $('Compute Stock Analytics').item.json.symbol }} was generated from live TradingView data and emailed to madhurvwork@gmail.com."),
    },
  },
  output: [{}],
});

export default workflow('stock-chart-agent', 'StockChartAgent - Stock Analysis Report Generator')
  .add(stockForm)
  .to(resolveSymbol)
  .to(pickBestMatch)
  .to(fetchTvData)
  .to(computeAnalytics)
  .to(stockReportAgent)
  .to(convertReportToTxt)
  .to(saveReportToDisk)
  .to(sendReportViaGmail)
  .to(deliverReport)
  .add(introNote);
