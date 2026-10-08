const KEY = 'btc-monitor-paper-live-v2';
const storage = window.coinStore || localStorage;
const SESSION_KEY = 'btc-monitor-session-v1';
const INITIAL = 10000;
const FEE = 0.001;
const fresh = () => ({ cash: INITIAL, btc: 0, trades: [] });
const RULE_KEY = 'btc-monitor-rule-v1';
const strategies = {
  trend: { name: 'Theo xu hướng SMA 10/30', description: 'Theo đà tăng sau khi đường trung bình ngắn hạn vượt đường dài hạn.', entry: 'Mua khi SMA của 10 giá đóng nến vượt SMA của 30 giá đóng nến; ở nến trước SMA10 chưa vượt SMA30. Chỉ dùng nến 15 phút đã đóng.', exit: 'Bán toàn bộ vị thế khi giá trực tiếp đạt chốt lời hoặc cắt lỗ tính từ giá mua.', risk: 'Giao cắt có độ trễ; thị trường đi ngang dễ tạo tín hiệu nhiễu.' },
  breakout: { name: 'Phá đỉnh 20 nến', description: 'Tìm nhịp tăng khi giá thoát khỏi vùng đỉnh gần đây.', entry: 'Mua khi giá đóng nến 15 phút mới nhất cao hơn giá cao nhất của 20 nến trước đó. Hiện chưa có bộ lọc khối lượng.', exit: 'Bán khi đạt chốt lời hoặc cắt lỗ. Không mua lại trong cùng nến vừa thoát.', risk: 'Giá có thể phá đỉnh rồi quay đầu; bot không xác nhận phá đỉnh bằng khối lượng.' },
  reversion: { name: 'Hồi về trung bình 20 nến', description: 'Tìm nhịp hồi sau khi giá giảm dưới vùng trung bình.', entry: 'Nến trước đóng thấp hơn SMA20 của 20 nến trước ít nhất 1,5%; nến mới nhất đóng cao hơn nến trước. Mua theo giá trực tiếp sau tín hiệu.', exit: 'Bán khi đạt chốt lời hoặc cắt lỗ; chưa dùng SMA20 làm mục tiêu thoát.', risk: 'Trong xu hướng giảm mạnh, tín hiệu hồi có thể xuất hiện trước khi giá tiếp tục giảm.' },
  threshold: { name: 'Ngưỡng giá cố định', description: 'Tự mua và bán tại mức giá bạn cấu hình.', entry: 'Mua một lần khi giá trực tiếp nhỏ hơn hoặc bằng ngưỡng mua. Chỉ có một vị thế tự động tại một thời điểm.', exit: 'Bán khi chạm ngưỡng bán, chốt lời hoặc cắt lỗ, điều kiện nào đến trước.', risk: 'Ngưỡng cố định không tự điều chỉnh theo thị trường; giá có thể không chạm ngưỡng trong thời gian dài.' }
};
let rule = null;
let autoEnabled = false;
let autoQuantity = 0;
let entryPrice = 0;
let strategyCandles = [];
let candleFetchedAt = 0;
let strategyLoading = false;
let lastDecision = 0;
let totalRuntimeMs = 0;
try {
  const saved = JSON.parse(storage.getItem(RULE_KEY));
  if (saved && Number.isFinite(saved.amount) && saved.amount >= 1) rule = { ...saved, mode: saved.mode || 'threshold', takeProfit: saved.takeProfit || 2, stopLoss: saved.stopLoss || 1 };
} catch {}
let wallet = fresh();
try {
  const saved = JSON.parse(storage.getItem(KEY));
  if (saved && Number.isFinite(saved.cash) && saved.cash >= 0 && Number.isFinite(saved.btc) && saved.btc >= 0 && Array.isArray(saved.trades)) wallet = saved;
} catch {}
// Recover the outstanding automatic position before restoring the saved session.
for (const trade of wallet.trades) {
  if (trade.origin === 'auto') { autoQuantity += trade.side === 'buy' ? trade.quantity : -trade.quantity; if (trade.side === 'buy') entryPrice = trade.price; }
}
autoQuantity = Math.max(0, Math.min(wallet.btc, autoQuantity));
try {
  const session = JSON.parse(storage.getItem(SESSION_KEY));
  if (session && rule) {
    if (Number.isFinite(session.totalRuntimeMs) && session.totalRuntimeMs >= 0) totalRuntimeMs = session.totalRuntimeMs;
    autoEnabled = session.enabled === true;
    lastDecision = Number.isFinite(session.lastDecision) ? session.lastDecision : 0;
    if (Number.isFinite(session.quantity) && session.quantity >= 0 && session.quantity <= wallet.btc) autoQuantity = session.quantity;
    if (Number.isFinite(session.entryPrice) && session.entryPrice > 0) entryPrice = session.entryPrice;
  }
} catch {}
const runtimeCacheKey = window.coinRuntimeKey || 'btc-monitor-runtime-local-v1';
try {
  const cached = Number(localStorage.getItem(runtimeCacheKey));
  if (Number.isFinite(cached) && cached > totalRuntimeMs) totalRuntimeMs = cached;
} catch {}
let runtimeLastTick = performance.now();
let runtimeWasEnabled = autoEnabled;
function updateRuntime(now = performance.now()) {
  const elapsed = now - runtimeLastTick;
  // Large heartbeat gaps indicate a suspended tab or sleeping computer.
  if (runtimeWasEnabled && elapsed >= 0 && elapsed <= 10000) totalRuntimeMs += elapsed;
  runtimeLastTick = now;
  runtimeWasEnabled = autoEnabled;
  try { localStorage.setItem(runtimeCacheKey, String(totalRuntimeMs)); } catch {}
  return totalRuntimeMs;
}
function formatRuntime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(seconds / 86400);
  const clock = [Math.floor(seconds % 86400 / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
  return (days ? days + ' ngày ' : '') + clock;
}
function persistSession() {
  updateRuntime();
  storage.setItem(SESSION_KEY, JSON.stringify({enabled:autoEnabled,lastDecision,quantity:autoQuantity,entryPrice,totalRuntimeMs}));
}
let price = null;
let updatedAt = 0;
let connected = false;
let loading = false;
let points = [];
const ranges = { '1h': { interval: '1m', count: 60, ms: 60000 }, '24h': { interval: '15m', count: 96, ms: 900000 }, '7d': { interval: '1h', count: 168, ms: 3600000 }, '30d': { interval: '4h', count: 180, ms: 14400000 } };
let range = '24h';
let historyEnd = null;
let historyRequest = 0;
let historyBusy = false;
let selectedPoint = null;
let chartBounds = null;
const API = 'https://data-api.binance.vision/api/v3';
const STREAM = 'wss://data-stream.binance.vision/stream?streams=btcusdt@aggTrade/btcusdt@kline_1m/btcusdt@kline_15m/btcusdt@kline_1h/btcusdt@kline_4h';
let socket = null;
let streamUpdatedAt = 0;
let latestCandle = new Map();
let streamRenderTimer = null;
const streamFresh = () => Date.now() - streamUpdatedAt < 15000;
function applyLiveCandle(candle, interval) {
  latestCandle.set(interval, candle);
  if (historyEnd !== null || ranges[range].interval !== interval || !points.length) return;
  const last = points.at(-1);
  if (candle.time < last.time) return;
  if (candle.time === last.time) points[points.length - 1] = candle;
  else {
    if (candle.time - last.time > ranges[range].ms) { if (!historyBusy) loadHistory(); return; }
    points.push(candle);
    if (points.length > ranges[range].count) points.shift();
  }
}
function connectStream() {
  if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;
  socket = new WebSocket(STREAM);
  socket.addEventListener('message', event => {
    try {
      const data = JSON.parse(event.data).data;
      if (data?.s !== 'BTCUSDT') return;
      if (data.e === 'aggTrade') {
        const nextPrice = Number(data.p), tradeTime = Number(data.T);
        if (!Number.isFinite(nextPrice) || nextPrice <= 0 || !Number.isFinite(tradeTime) || Math.abs(Date.now() - tradeTime) > 15000) return;
        price = nextPrice; updatedAt = Date.now(); streamUpdatedAt = updatedAt; connected = true;
        runAutomation();
      } else if (data.e === 'kline') {
        const k = data.k;
        const candle = parseCandles([[k.t,k.o,k.h,k.l,k.c,k.v,k.T]])[0];
        applyLiveCandle(candle, k.i);
      } else return;
      if (!streamRenderTimer) streamRenderTimer = setTimeout(() => { streamRenderTimer = null; render(); renderPriceHistory(); }, 250);
    } catch { /* Ignore malformed market messages. */ }
  });
  socket.addEventListener('error', () => socket.close());
  socket.addEventListener('close', () => { streamUpdatedAt = 0; renderConnection(); setTimeout(connectStream, 3000); });
}
const isFresh = () => connected && price !== null && Date.now() - updatedAt < 15000;
const el = id => document.getElementById(id);
const money = n => n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const connectionInfo = document.querySelector('.connection-info');
const connectionTrigger = el('connection-trigger');
function closeConnectionInfo() {
  connectionInfo.classList.remove('is-open');
  connectionTrigger.setAttribute('aria-expanded', 'false');
  connectionTrigger.blur();
}
connectionTrigger.addEventListener('click', () => {
  const open = connectionInfo.classList.toggle('is-open');
  connectionTrigger.setAttribute('aria-expanded', String(open));
  if (!open) connectionTrigger.blur();
});
document.addEventListener('pointerdown', event => {
  if (!connectionInfo.contains(event.target)) closeConnectionInfo();
});
connectionInfo.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeConnectionInfo();
});
function persist() {
  try {
    storage.setItem(KEY, JSON.stringify(wallet));
    storage.setItem(RULE_KEY, JSON.stringify(rule));
    persistSession();
  }
  catch { el('message').textContent = 'Không lưu được ví trên thiết bị. Ví vẫn hoạt động trong phiên này.'; }
}
function render() {
  el('price').textContent = price === null ? 'Đang tải…' : money(price) + ' USDT';
  el('cash').textContent = money(wallet.cash);
  el('btc').textContent = wallet.btc.toFixed(8);
  const pnl = wallet.cash + wallet.btc * (price || 0) - INITIAL;
  el('pnl').textContent = price === null ? 'Chờ giá thị trường' : (pnl >= 0 ? '+' : '') + money(pnl) + ' USDT';
  el('pnl').className = pnl >= 0 ? 'positive' : 'negative';
  el('trades').replaceChildren();
  if (!wallet.trades.length) {
    const row = el('trades').insertRow();
    const cell = row.insertCell(); cell.colSpan = 8; cell.className = 'empty';
    cell.textContent = 'Chưa có giao dịch';
  }
  for (const trade of wallet.trades.slice().reverse()) {
    const row = el('trades').insertRow();
    const values = [new Date(trade.time).toLocaleString('vi-VN'), trade.side === 'buy' ? 'Mua' : 'Bán', money(trade.price), trade.quantity.toFixed(8), money(trade.amount), money(trade.fee), trade.origin === 'auto' ? 'Tự động' : 'Thủ công', strategies[trade.strategy]?.name || (trade.origin === 'auto' ? 'Chưa ghi nhận (lệnh cũ)' : 'Thủ công')];
    values.forEach((value, index) => { const cell = row.insertCell(); cell.textContent = value; if (index === 1) cell.className = trade.side === 'buy' ? 'positive' : 'negative'; });
  }
  draw();
  renderConnection();
}
function renderConnection() {
  updateRuntime();
  el('job-runtime').textContent = formatRuntime(totalRuntimeMs);
  const fresh = isFresh();
  el('connection').textContent = fresh ? streamFresh() ? 'Đã kết nối · Real-time' : 'Đã kết nối · dự phòng 5 giây' : loading ? 'Đang kết nối…' : 'Mất kết nối · đang thử lại';
  el('connection').className = fresh ? 'positive' : 'negative';
  el('updated').textContent = updatedAt ? 'Cập nhật: ' + new Date(updatedAt).toLocaleTimeString('vi-VN') + (fresh ? '' : ' · giá cũ') : 'Chưa nhận được giá';
  el('auto-enabled').checked = autoEnabled;
  el('stop-strategy').disabled = !autoEnabled;
  el('resume-strategy').disabled = autoEnabled || !rule;
  el('bot-state').textContent = autoEnabled ? fresh ? 'Đang chạy' : 'Chờ kết nối' : 'Đã dừng';
  el('bot-state').className = autoEnabled ? 'badge' : 'badge bot-stopped';
  el('bot-setup').hidden = autoEnabled;
  el('strategy-detail').hidden = autoEnabled;
  el('strategy-monitor').hidden = !autoEnabled;
  el('applied-config').hidden = !autoEnabled || !rule;
  el('stop-strategy').hidden = !autoEnabled;
  el('resume-strategy').hidden = autoEnabled || !rule;
  el('signal-status').hidden = !autoEnabled;
  if (autoEnabled && rule) renderAppliedConfig();
  el('active-strategy').textContent = rule ? (autoEnabled ? 'Đang chạy: ' : 'Đã áp dụng · đang tắt: ') + (strategies[rule.mode]?.name || rule.mode) : 'Chưa áp dụng chiến lược';
  el('auto-status').textContent = !autoEnabled ? 'Tự động đang tắt.' : !fresh ? 'Tạm chờ giá mới và kết nối.' : autoQuantity > 0 ? 'Đang giữ ' + autoQuantity.toFixed(8) + ' BTC · Chốt lời: ' + money(entryPrice * (1 + rule.takeProfit / 100)) + ' · Cắt lỗ: ' + money(entryPrice * (1 - rule.stopLoss / 100)) + ' USDT.' : 'Đang chạy · chờ tín hiệu mua.';
  renderStrategyMonitor();
}
function renderAppliedConfig() {
  const panel = el('applied-config'); panel.replaceChildren();
  const values = [['Vốn mỗi lệnh', money(rule.amount) + ' USDT'], ['Chốt lời', rule.takeProfit + '%'], ['Cắt lỗ', rule.stopLoss + '%'], ['Tín hiệu', rule.mode === 'threshold' ? 'Giá trực tiếp' : 'Nến 15 phút đã đóng']];
  if (rule.mode === 'threshold') values.push(['Ngưỡng mua', money(rule.buy) + ' USDT'], ['Ngưỡng bán', money(rule.sell) + ' USDT']);
  for (const [label, value] of values) {
    const row = document.createElement('div'); const term = document.createElement('dt'); const detail = document.createElement('dd');
    term.textContent = label; detail.textContent = value; row.append(term, detail); panel.append(row);
  }
}
function strategySnapshot() {
  if (!rule) return null;
  const sum = values => values.reduce((a,b) => a+b,0);
  const average = values => sum(values)/values.length;
  const closes = strategyCandles.map(c => c.close);
  const candlesReady = closes.length >= 31 && Date.now() - candleFetchedAt < 90000;
  const checks = [{ label: 'Giá trực tiếp còn mới', met: isFresh() }];
  let buyTarget = null, buyText = '', signal = false;
  if (rule.mode === 'threshold') {
    buyTarget = rule.buy; signal = price !== null && price <= rule.buy;
    buyText = 'Mua khi giá trực tiếp ≤ ' + money(buyTarget) + ' USDT.';
    checks.push({label: 'Giá ≤ ngưỡng mua ' + money(rule.buy) + ' USDT', met: signal});
  } else {
    checks.push({label:'Dữ liệu nến 15 phút còn mới và đủ 31 nến',met:candlesReady});
    if (candlesReady) {
      signal = strategySignal(strategyCandles,rule.mode);
      if (rule.mode === 'trend') {
        const fast = average(closes.slice(-10)), slow = average(closes.slice(-30));
        checks.push({label:'SMA10 ' + money(fast) + ' > SMA30 ' + money(slow),met:fast>slow});
        checks.push({label:'Nến trước chưa có SMA10 vượt SMA30',met:average(closes.slice(-11,-1))<=average(closes.slice(-31,-1))});
        buyTarget = (sum(closes.slice(-29)) - 3 * sum(closes.slice(-9))) / 2;
        buyText = fast<=slow ? 'Nến kế tiếp phải đóng > ' + money(buyTarget) + ' USDT để SMA10 cắt lên SMA30.' : 'SMA10 đã trên SMA30. Chờ giao cắt lên mới; vượt một mức giá đơn lẻ chưa đủ để mua.';
      } else if (rule.mode === 'breakout') {
        const evaluatedTarget = Math.max(...strategyCandles.slice(-21,-1).map(c=>c.high));
        checks.push({label:'Nến đã đóng ' + money(closes.at(-1)) + ' > đỉnh trước ' + money(evaluatedTarget),met:signal});
        buyTarget = Math.max(...strategyCandles.slice(-20).map(c=>c.high));
        buyText = 'Nến kế tiếp phải đóng > ' + money(buyTarget) + ' USDT (đỉnh 20 nến gần nhất).';
      } else if (rule.mode === 'reversion') {
        const previousLimit=average(closes.slice(-21,-1))*.985;
        checks.push({label:'Nến trước ' + money(closes.at(-2)) + ' < 98,5% SMA20 (' + money(previousLimit) + ')',met:closes.at(-2)<previousLimit});
        checks.push({label:'Nến mới ' + money(closes.at(-1)) + ' > nến trước ' + money(closes.at(-2)),met:closes.at(-1)>closes.at(-2)});
        buyTarget=closes.at(-1);
        const setup = closes.at(-1)<average(closes.slice(-20))*.985;
        buyText = setup ? 'Nến kế tiếp phải đóng > ' + money(buyTarget) + ' USDT để xác nhận hồi.' : 'Chưa có nhịp giảm đủ sâu. Chờ giá đóng dưới ' + money(average(closes.slice(-20))*.985) + ' USDT, sau đó một nến hồi tăng.';
      }
      checks.push({label:'Nến tín hiệu chưa được xử lý',met:lastDecision!==strategyCandles.at(-1).time});
    } else buyText='Chờ tải đủ nến mới để tính mức mua.';
  }
  checks.push({label:'USDT đủ vốn và phí: ' + money(rule.amount*(1+FEE)),met:wallet.cash>=rule.amount*(1+FEE)});
  const entry=autoQuantity>0?entryPrice:price;
  const target=entry===null?null:entry*(1+rule.takeProfit/100);
  const stop=entry===null?null:entry*(1-rule.stopLoss/100);
  const sellTarget=rule.mode==='threshold'&&target!==null?Math.min(rule.sell,target):target;
  return {checks,buyTarget,buyText,signal,sellTarget,stop,percent:Math.round(checks.filter(c=>c.met).length/checks.length*100)};
}
function renderStrategyMonitor() {
  const panel=el('strategy-monitor');
  panel.replaceChildren();
  const snapshot=strategySnapshot();
  if(!snapshot){panel.textContent='Áp dụng chiến lược để xem tín hiệu và mức giá giao dịch.';return;}
  const add=(tag,text,className='')=>{
    const element=document.createElement(tag);element.className=className;
    if(tag==='p') {
      const tokens=text.split(/(\d+(?:[.,]\d+)*(?:%|\/\d+)?)/g);
      tokens.forEach((token,index)=>{if(index%2){const strong=document.createElement('strong');strong.className='key-value';strong.textContent=token;element.append(strong);}else element.append(document.createTextNode(token));});
    } else element.textContent=text;
    panel.append(element);return element;
  };
  add('h3','Theo dõi: '+strategies[rule.mode].name);
  if(autoQuantity>0){
    add('p','Đã mua tại '+money(entryPrice)+' USDT · Giữ '+autoQuantity.toFixed(8)+' BTC.');
    add('p','Bán toàn bộ khi giá ≥ '+money(snapshot.sellTarget)+' USDT hoặc ≤ '+money(snapshot.stop)+' USDT.');
    const gain=(price/entryPrice-1)*100;
    add('p',price===null?'Chờ giá mới.':'Biến động từ giá mua: '+money(gain)+'% · Chốt lời '+rule.takeProfit+'% / Cắt lỗ '+rule.stopLoss+'% (chưa trừ phí).');
  }else{
    add('p','Điều kiện mua đã đạt: '+snapshot.percent+'% · '+snapshot.checks.filter(c=>c.met).length+'/'+snapshot.checks.length+' điều kiện.', 'signal-progress');
    const progress=add('progress','');progress.max=100;progress.value=snapshot.percent;progress.setAttribute('aria-label','Tỷ lệ điều kiện mua đã đạt');
    for(const check of snapshot.checks)add('p',(check.met?'Đạt · ':'Chờ · ')+check.label,check.met?'positive':'negative');
    add('p',snapshot.buyText);
    add('p','Vốn mua: '+money(rule.amount)+' USDT + phí '+money(rule.amount*FEE)+' USDT'+(price!==null?' · Khoảng '+(rule.amount/price).toFixed(8)+' BTC theo giá hiện tại.':'.'));
    if(snapshot.sellTarget!==null)add('p','Nếu mua tại giá hiện tại '+money(price)+' USDT: bán khi ≥ '+money(snapshot.sellTarget)+' hoặc cắt lỗ khi ≤ '+money(snapshot.stop)+' USDT. Mức bán chính thức tính lại theo giá khớp mua.');
    add('p','Phần trăm là số điều kiện đã đạt, không phải xác suất thắng. Mức giá cho nến kế tiếp chỉ là điều kiện dự kiến, không phải lệnh chờ.', 'fee');
  }
  if(!autoEnabled)add('p','Bot đang tắt: không tự mua hoặc bán.', 'negative');
  else if(!isFresh())add('p','Tạm dừng giao dịch vì giá cũ hoặc mất kết nối.', 'negative');
}
async function getJSON(path) {
  const response = await fetch(API + path, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}
async function updatePrice() {
  if (loading) return;
  loading = true; renderConnection();
  try {
    if (streamFresh()) return;
    const data = await getJSON('/ticker/price?symbol=BTCUSDT');
    const nextPrice = Number(data.price);
    if (data.symbol !== 'BTCUSDT' || !Number.isFinite(nextPrice) || nextPrice <= 0) throw new Error('Invalid price');
    if (streamFresh()) return;
    price = nextPrice; updatedAt = Date.now(); connected = true;
    if (historyEnd === null && !historyBusy) loadHistory();
    runAutomation();
  } catch {
    if (!streamFresh()) connected = false;
  } finally {
    loading = false; render();
    setTimeout(updatePrice, connected ? 5000 : 10000);
  }
}
function parseCandles(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Empty history');
  return rows.map(row => {
    if (!Array.isArray(row) || row.length < 7) throw new Error('Invalid candle');
    const [time, open, high, low, close, , closeTime] = row.map(Number);
    if (![time, open, high, low, close, closeTime].every(Number.isFinite) || low <= 0 || high < low || open < low || open > high || close < low || close > high) throw new Error('Invalid candle');
    return { time, open, high, low, close, closeTime };
  }).sort((a, b) => a.time - b.time);
}
async function loadHistory() {
  const request = ++historyRequest;
  historyBusy = true;
  el('chart-previous').disabled = true;
  el('chart-status').textContent = 'Đang tải lịch sử giá…';
  const config = ranges[range];
  const path = '/klines?symbol=BTCUSDT&interval=' + config.interval + '&limit=' + config.count + (historyEnd === null ? '' : '&endTime=' + historyEnd);
  try {
    const data = parseCandles(await getJSON(path));
    if (request !== historyRequest) return;
    points = data; selectedPoint = null;
    const live = latestCandle.get(config.interval);
    if (historyEnd === null && live) applyLiveCandle(live, config.interval);
    el('chart-status').textContent = 'Binance · ' + config.interval + (historyEnd === null ? ' · nến trực tiếp' : ' · lịch sử') + ' · giờ địa phương';
    renderPriceHistory(); draw();
  } catch {
    if (request !== historyRequest) return;
    points = []; selectedPoint = null;
    el('chart-status').textContent = 'Không tải được lịch sử. Chọn lại khoảng thời gian để thử lại.';
    renderPriceHistory(); draw();
  } finally {
    if (request === historyRequest) { historyBusy = false; el('chart-previous').disabled = !points.length; }
  }
}
function renderPriceHistory() {
  el('price-history').replaceChildren();
  for (const point of points.slice().reverse()) {
    const row = el('price-history').insertRow();
    [new Date(point.time).toLocaleString('vi-VN'), money(point.open), money(point.high), money(point.low), money(point.close) + (point.closeTime >= Date.now() ? ' *' : '')].forEach(value => { row.insertCell().textContent = value; });
  }
}
function candleTiming(point, now = Date.now()) {
  const boundary = point.closeTime + 1;
  const remaining = Math.max(0, Math.ceil((boundary - now) / 1000));
  const hours = Math.floor(remaining / 3600), minutes = Math.floor(remaining % 3600 / 60), seconds = remaining % 60;
  const countdown = [hours, minutes, seconds].map(n => String(n).padStart(2, '0')).join(':');
  return { closed: now >= boundary, boundary, countdown };
}
function renderCandleClock() {
  const clock = el('candle-clock');
  if (!points.length) { clock.textContent = 'Đang chờ thời gian nến…'; el('chart-detail').textContent = ''; return; }
  const point = points[selectedPoint === null ? points.length - 1 : Math.min(selectedPoint, points.length - 1)];
  const timing = candleTiming(point);
  const format = timestamp => new Date(timestamp).toLocaleString('vi-VN', { hour12: false });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const last = points.at(-1), lastTiming = candleTiming(last);
  clock.textContent = historyEnd !== null ? 'Đang xem nến lịch sử · ' + ranges[range].interval + ' · ' + zone : lastTiming.closed ? 'Nến gần nhất đã đóng · chờ nến mới · ' + zone : 'Nến ' + ranges[range].interval + ' · Mở ' + format(last.time) + ' · Đóng ' + format(lastTiming.boundary) + ' · Còn ' + lastTiming.countdown + ' · ' + zone;
  el('chart-detail').textContent = (timing.closed ? 'ĐÃ ĐÓNG' : 'ĐANG CHẠY') + ' · Mở lúc ' + format(point.time) + ' · Đóng lúc ' + format(timing.boundary) + (timing.closed ? '' : ' · Còn ' + timing.countdown) + ' | Giá mở: ' + money(point.open) + ' · Cao: ' + money(point.high) + ' · Thấp: ' + money(point.low) + ' · ' + (timing.closed ? 'Giá đóng: ' : 'Giá hiện tại: ') + money(point.close) + ' USDT';
}
const candleClock = document.createElement('p'); candleClock.id = 'candle-clock'; candleClock.className = 'candle-clock';
el('chart').before(candleClock);
setInterval(renderCandleClock, 1000);
function draw() {
  const canvas = el('chart');
  const { width, height } = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio; canvas.height = height * ratio;
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
  const left = 8, right = Math.max(left + 1, width - 85), top = 15, bottom = height - 35;
  chartBounds = { left, right };
  const low = Math.min(...points.map(p => p.low)), high = Math.max(...points.map(p => p.high));
  const padding = Math.max((high - low) * 0.1, 1);
  const min = low - padding, max = high + padding;
  ctx.font = '11px Arial';
  ctx.strokeStyle = '#dfe5e2'; ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) { const y = top + i * (bottom - top) / 4; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); if(points.length) {ctx.fillStyle='#69766e';ctx.textAlign='left';ctx.fillText(money(max - i * (max-min)/4),right+6,y+4);} }
  if (!points.length) {
    el('chart-detail').textContent = '';
    ctx.fillStyle = '#69766e'; ctx.font = '14px Arial'; ctx.textAlign = 'center';
    ctx.fillText('Đang chờ dữ liệu giá BTC', width / 2, height / 2);
    el('low').textContent = ''; el('high').textContent = ''; return;
  }
  const xAt = i => left + i / Math.max(1, points.length - 1) * (right - left);
  const yAt = p => top + (max - p) / (max - min) * (bottom - top);
  ctx.beginPath();
  points.forEach((p, i) => { const x = xAt(i), y = yAt(p.close); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = '#178261'; ctx.lineWidth = 2; ctx.stroke();
  for (const index of [0, Math.floor((points.length-1)/2), points.length-1]) {
    ctx.fillStyle='#69766e'; ctx.textAlign=index===0?'left':index===points.length-1?'right':'center';
    ctx.fillText(new Date(points[index].time).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}),xAt(index),height-10);
  }
  const index = selectedPoint === null ? points.length - 1 : Math.min(selectedPoint, points.length - 1);
  const point = points[index];
  ctx.strokeStyle='#8a9890';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(xAt(index),top);ctx.lineTo(xAt(index),bottom);ctx.stroke();
  ctx.fillStyle='#178261';ctx.beginPath();ctx.arc(xAt(index),yAt(point.close),4,0,Math.PI*2);ctx.fill();
  renderCandleClock();
  el('low').textContent = 'Thấp: ' + money(low) + ' USDT';
  el('high').textContent = 'Cao: ' + money(high) + ' USDT';
}
el('chart-range').addEventListener('change', () => { range = el('chart-range').value; historyEnd = null; points = []; el('chart-detail').textContent = ''; draw(); loadHistory(); });
el('chart-previous').addEventListener('click', () => { if (!historyBusy && points.length) { historyEnd = points[0].time - 1; loadHistory(); } });
el('chart-latest').addEventListener('click', () => { historyEnd = null; loadHistory(); });
el('chart').addEventListener('pointermove', event => {
  if (!points.length || !chartBounds) return;
  const x = event.clientX - el('chart').getBoundingClientRect().left;
  selectedPoint = Math.max(0, Math.min(points.length - 1, Math.round((x - chartBounds.left) / (chartBounds.right - chartBounds.left) * (points.length - 1)))); draw();
});
el('chart').addEventListener('pointerdown', event => {
  if (!points.length || !chartBounds) return;
  const x = event.clientX - el('chart').getBoundingClientRect().left;
  selectedPoint = Math.max(0, Math.min(points.length - 1, Math.round((x - chartBounds.left) / (chartBounds.right - chartBounds.left) * (points.length - 1)))); draw();
});
el('chart').addEventListener('keydown', event => {
  if (!points.length || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
  event.preventDefault(); selectedPoint = Math.max(0, Math.min(points.length - 1, (selectedPoint ?? points.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1))); draw();
});
function executeTrade(side, amount, origin = 'manual', sellQuantity = null) {
  if (!isFresh()) return false;
  if (!Number.isFinite(amount) || amount <= 0 || !['buy', 'sell'].includes(side)) return false;
  const fee = amount * FEE, quantity = sellQuantity ?? amount / price;
  if (side === 'buy' && wallet.cash < amount + fee) { el('message').textContent = 'Số dư USDT không đủ, bao gồm phí.'; return false; }
  if (side === 'sell' && wallet.btc < quantity) { el('message').textContent = 'Số dư BTC không đủ để bán.'; return false; }
  wallet.cash += side === 'buy' ? -(amount + fee) : amount - fee;
  wallet.btc += side === 'buy' ? quantity : -quantity;
  wallet.trades.push({ time: new Date().toISOString(), side, price, quantity, amount, fee, origin, strategy: origin === 'auto' ? rule.mode : null });
  if (origin === 'auto' && side === 'buy') entryPrice = price;
  if (origin === 'auto') autoQuantity = side === 'buy' ? autoQuantity + quantity : Math.max(0, autoQuantity - quantity);
  else if (side === 'sell') autoQuantity = Math.min(autoQuantity, wallet.btc);
  el('message').textContent = 'Đã ' + (side === 'buy' ? 'mua' : 'bán') + ' ' + quantity.toFixed(8) + ' BTC mô phỏng.';
  persist(); return true;
}
function runAutomation() {
  if (!autoEnabled || !rule || !isFresh()) return;
  const previousDecision = lastDecision;
  let success = true;
  const stop = entryPrice * (1 - rule.stopLoss / 100), target = entryPrice * (1 + rule.takeProfit / 100);
  if (autoQuantity > 0 && (price <= stop || price >= target || (rule.mode === 'threshold' && price >= rule.sell))) {
    success = executeTrade('sell', autoQuantity * price, 'auto', autoQuantity);
    lastDecision = strategyCandles.at(-1)?.time || 0;
  } else if (autoQuantity === 0) {
    if (rule.mode === 'threshold') { if (price <= rule.buy) success = executeTrade('buy', rule.amount, 'auto'); }
    else if (Date.now() - candleFetchedAt < 90000 && strategyCandles.length >= 31) {
      const candle = strategyCandles.at(-1);
      if (lastDecision !== candle.time) {
        lastDecision = candle.time;
        if (strategySignal(strategyCandles, rule.mode)) success = executeTrade('buy', rule.amount, 'auto');
      }
    }
  }
  if (!success) { autoEnabled = false; el('message').textContent += ' Tự động đã dừng.'; }
  if (previousDecision !== lastDecision || !success) persist();
}
function strategySignal(candles, mode) {
  const values = candles.map(c => c.close);
  const average = list => list.reduce((a, b) => a + b, 0) / list.length;
  if (values.length < 31) return false;
  if (mode === 'trend') return average(values.slice(-10)) > average(values.slice(-30)) && average(values.slice(-11,-1)) <= average(values.slice(-31,-1));
  if (mode === 'breakout') return values.at(-1) > Math.max(...candles.slice(-21,-1).map(c => c.high));
  if (mode === 'reversion') return values.at(-2) < average(values.slice(-21,-1)) * 0.985 && values.at(-1) > values.at(-2);
  return false;
}
async function loadStrategyCandles() {
  if (strategyLoading) return;
  strategyLoading = true;
  try {
    const candles = parseCandles(await getJSON('/klines?symbol=BTCUSDT&interval=15m&limit=100')).filter(c => c.closeTime < Date.now());
    if (candles.length < 31 || Date.now() - candles.at(-1).closeTime > 960000) throw new Error('Stale candles');
    strategyCandles = candles; candleFetchedAt = Date.now();
    el('signal-status').textContent = 'Nến đã đóng gần nhất: ' + new Date(candles.at(-1).closeTime).toLocaleString('vi-VN') + ' · Binance BTC/USDT';
    runAutomation(); render();
  } catch { candleFetchedAt = 0; el('signal-status').textContent = 'Chưa có nến mới · tạm dừng tìm điểm mua; chốt lời/cắt lỗ vẫn theo giá mới.'; }
  finally { strategyLoading = false; }
}
function showStrategyFields() {
  document.querySelectorAll('.threshold-field').forEach(field => { field.hidden = el('strategy-mode').value !== 'threshold'; });
  const mode = el('strategy-mode').value;
  const strategy = strategies[mode];
  el('strategy-detail').replaceChildren();
  const heading = document.createElement('h3'); heading.textContent = strategy.name; el('strategy-detail').append(heading);
  for (const [label, text] of [['Mục tiêu', strategy.description], ['Điều kiện mua', strategy.entry], ['Điều kiện bán', strategy.exit], ['Điểm cần theo dõi', strategy.risk]]) {
    const p = document.createElement('p'); const strong = document.createElement('strong'); strong.textContent = label + ': '; p.append(strong, document.createTextNode(text)); el('strategy-detail').append(p);
  }
  document.querySelectorAll('.strategy-choice').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.mode === mode)); });
}
const strategyDetail = document.createElement('div'); strategyDetail.id = 'strategy-detail'; strategyDetail.className = 'strategy-detail';
const activeStrategy = document.createElement('p'); activeStrategy.id = 'active-strategy'; activeStrategy.className = 'active-strategy';
const runtimeDisplay = document.createElement('div'); runtimeDisplay.className = 'job-runtime';
const runtimeLabel = document.createElement('span'); runtimeLabel.textContent = 'Tổng thời gian job đã chạy';
const runtimeValue = document.createElement('strong'); runtimeValue.id = 'job-runtime'; runtimeValue.textContent = '00:00:00';
runtimeDisplay.title = 'Cộng dồn khi bot được bật và trang đang hoạt động; không tính thời gian đóng trang hoặc bị treo/ngủ.';
runtimeDisplay.append(runtimeLabel, runtimeValue);
const strategyMonitor = document.createElement('section'); strategyMonitor.id = 'strategy-monitor'; strategyMonitor.className = 'strategy-monitor';
const botSetup = document.createElement('div'); botSetup.id = 'bot-setup';
const appliedConfig = document.createElement('dl'); appliedConfig.id = 'applied-config'; appliedConfig.className = 'applied-config';
const selectorField = el('strategy-mode').parentElement;
selectorField.className = 'bot-strategy-selector';
botSetup.append(selectorField, strategyDetail, el('strategy-form'));
el('bot-live-status').after(appliedConfig, botSetup);
el('bot-live-status').append(activeStrategy, runtimeDisplay, el('auto-status'), el('signal-status'));
el('bot-monitor-slot').append(strategyMonitor);
document.querySelector('.strategy .switch').hidden = true;
document.querySelector('.strategy').hidden = true;
el('strategy-form').querySelector('button[type="submit"]').textContent = 'Áp dụng và chạy';
el('strategy-mode').parentElement.hidden = false;
el('strategy-mode').addEventListener('change', showStrategyFields);
el('strategy-form').addEventListener('submit', event => {
  event.preventDefault();
  const buy = Number(el('buy-below').value), sell = Number(el('sell-above').value), amount = Number(el('auto-amount').value);
  const mode = el('strategy-mode').value, takeProfit = Number(el('take-profit').value), stopLoss = Number(el('stop-loss').value);
  if (autoQuantity > 0) { el('auto-status').textContent = 'Đóng vị thế hiện tại trước khi đổi chiến lược.'; return; }
  if (![amount,takeProfit,stopLoss].every(Number.isFinite) || amount < 1 || takeProfit < 0.1 || takeProfit > 100 || stopLoss < 0.1 || stopLoss >= 100 || (mode === 'threshold' && (!Number.isFinite(buy) || !Number.isFinite(sell) || buy <= 0 || sell <= buy))) { el('auto-status').textContent = 'Kiểm tra vốn, chốt lời, cắt lỗ và ngưỡng giá.'; return; }
  rule = { buy, sell, amount, mode, takeProfit, stopLoss }; autoEnabled = true; lastDecision = 0;
  el('message').textContent = '';
  persist();
  renderConnection();
});
el('auto-enabled').addEventListener('change', () => {
  if (!rule) { el('auto-enabled').checked = false; el('auto-status').textContent = 'Áp dụng chiến lược trước khi bật tự động.'; return; }
  autoEnabled = el('auto-enabled').checked;
  persist();
  renderConnection();
});
el('stop-strategy').addEventListener('click', () => {
  autoEnabled = false;
  persist();
  el('message').textContent = autoQuantity > 0 ? 'Đã dừng chiến lược. BTC đang giữ chưa bán; chốt lời/cắt lỗ tự động cũng đã dừng.' : 'Đã dừng chiến lược. Không đặt thêm lệnh tự động.';
  renderConnection();
});
el('resume-strategy').addEventListener('click', () => {
  if (!rule) return;
  autoEnabled = true;
  persist();
  el('message').textContent = 'Đã chạy lại ' + strategies[rule.mode].name + '.';
  renderConnection();
});
el('reset').addEventListener('click', () => {
  if (!window.confirm('Đặt lại ví về 10.000 USDT và xóa lịch sử mô phỏng?')) return;
  wallet = fresh(); autoQuantity = 0; autoEnabled = false; el('message').textContent = 'Đã đặt lại ví mô phỏng.'; persist(); render();
});
window.addEventListener('resize', draw);
window.addEventListener('coin-storage-error', () => {
  autoEnabled = false;
  el('message').textContent = 'Không lưu được dữ liệu tài khoản. Bot đã dừng; giữ trang mở và thử kết nối lại.';
  renderConnection();
});
window.addEventListener('offline', () => { connected = false; renderConnection(); });
window.addEventListener('online', () => { updatePrice(); });
setInterval(renderConnection, 1000);
setInterval(() => {
  if (!autoEnabled) return;
  try { persistSession(); }
  catch { el('message').textContent = 'Không lưu được thời gian chạy. Bộ đếm vẫn tiếp tục trong phiên này.'; }
}, 15000);
window.addEventListener('pagehide', () => { try { persistSession(); window.coinFlush?.(); } catch {} });
setInterval(() => { if (socket?.readyState === WebSocket.OPEN && !streamFresh()) socket.close(); }, 20000);
render();
if (rule) { el('buy-below').value = rule.buy || ''; el('sell-above').value = rule.sell || ''; el('auto-amount').value = rule.amount; el('strategy-mode').value = rule.mode; el('take-profit').value = rule.takeProfit; el('stop-loss').value = rule.stopLoss; }
showStrategyFields();
updatePrice();
connectStream();
document.querySelector('header .source > span').textContent = 'Binance · luồng giá trực tiếp';
el('connection-details').querySelector('p:nth-of-type(2)').textContent = 'Giá và nến trực tiếp qua WebSocket · REST dự phòng mỗi 5 giây';
loadHistory();
loadStrategyCandles();
setInterval(loadStrategyCandles, 30000);
setInterval(() => { if (historyEnd === null && !historyBusy) loadHistory(); }, 60000);
