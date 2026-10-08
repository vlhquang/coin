const el = id => document.getElementById(id);
const gate = el('auth-screen');
gate.hidden = false;
const config = window.FIREBASE_CONFIG;
const diagnosticEntries = [];
window.coinDiagnostic = (source, detail, level = 'info') => {
  const entry = new Date().toLocaleTimeString('vi-VN') + ' · ' + source + ' · ' + detail;
  diagnosticEntries.unshift(entry);
  diagnosticEntries.length = Math.min(diagnosticEntries.length, 30);
  const list = el('diagnostic-log');
  if (list) list.replaceChildren(...diagnosticEntries.map(text => {
    const item = document.createElement('li'); item.textContent = text; return item;
  }));
  console[level === 'error' ? 'error' : 'info']('[BTC Monitor]', source, detail);
};
window.addEventListener('error', event => window.coinDiagnostic('Ứng dụng', event.message || 'Lỗi JavaScript', 'error'));
window.addEventListener('unhandledrejection', () => window.coinDiagnostic('Ứng dụng', 'Tác vụ bất đồng bộ thất bại', 'error'));
if (!config?.apiKey || !config?.projectId || !config?.authDomain) {
  el('google-login').disabled = true;
  el('auth-message').textContent = 'Chưa cấu hình Google đăng nhập. Cần cấu hình Firebase trước khi mở dữ liệu tài khoản.';
} else if (location.protocol === 'file:') {
  el('google-login').disabled = true;
  el('auth-message').textContent = 'Đăng nhập cần mở qua localhost hoặc trang GitHub Pages, không dùng file trực tiếp.';
} else {
  try {
    const base = 'https://www.gstatic.com/firebasejs/12.4.0/';
    const [{ initializeApp }, authSDK, dbSDK] = await Promise.all([
      import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')
    ]);
    const app = initializeApp(config), auth = authSDK.getAuth(app), db = dbSDK.getFirestore(app);
    await authSDK.setPersistence(auth, authSDK.browserLocalPersistence);
    let started = false, writeQueue = Promise.resolve(), saveTimer = null;
    let store = null, accountRef = null, failed = false;
    el('bot-diagnostics').textContent = 'Bot chạy trong trình duyệt · Giá và nến lấy trực tiếp từ Binance · Dữ liệu riêng lưu trên Firebase. Đóng trang hoặc máy ngủ sẽ ngừng xử lý. Chỉ chạy bot trên một tab/thiết bị.';
    window.coinDiagnostic('Khởi động', 'Phiên bản browser-20261008-2 · không kết nối Render');
    function save() {
      if (!store || !accountRef) return;
      const state = { ...store };
      el('sync-status').textContent = 'Đang lưu…';
      writeQueue = writeQueue.then(async () => {
        await dbSDK.setDoc(accountRef, { state, serverManaged: false, updatedAt: dbSDK.serverTimestamp() });
        el('sync-status').textContent = 'Đã lưu';
      }).catch(error => {
        window.coinDiagnostic('Firestore', 'Lưu thất bại: ' + (error.code || 'unknown'), 'error');
        failed = true; el('sync-status').textContent = 'Lưu thất bại';
        window.dispatchEvent(new Event('coin-storage-error'));
      });
    }
    el('google-login').addEventListener('click', async () => {
      el('google-login').disabled = true;
      try { await authSDK.signInWithPopup(auth, new authSDK.GoogleAuthProvider()); }
      catch { el('auth-message').textContent = 'Không đăng nhập được. Kiểm tra popup, tên miền và cấu hình Google trong Firebase.'; }
      finally { el('google-login').disabled = false; }
    });
    el('logout').addEventListener('click', async () => {
      el('logout').disabled = true;
        el('stop-strategy').click();
        clearTimeout(saveTimer); save(); await writeQueue;
        if (failed) { el('logout').disabled = false; return; }
      try { await authSDK.signOut(auth); location.reload(); }
      catch { el('sync-status').textContent = 'Đăng xuất thất bại. Hãy thử lại.'; el('logout').disabled = false; }
    });
    authSDK.onAuthStateChanged(auth, async user => {
      if (!user) {
        el('dashboard').hidden = true; el('account-bar').hidden = true; gate.hidden = false;
        if (started) location.reload();
        return;
      }
      if (started) return;
      el('auth-message').textContent = 'Đang tải dữ liệu riêng của bạn…';
      try {
        accountRef = dbSDK.doc(db, 'users', user.uid, 'private', 'portfolio');
          store = await dbSDK.runTransaction(db, async transaction => {
            const snapshot = await transaction.get(accountRef);
            const data = snapshot.exists() ? snapshot.data() : {};
            const state = { ...(data.state || {}) };
            if (data.serverManaged) {
              const key = 'btc-monitor-session-v1';
              const session = JSON.parse(state[key] || '{}');
              state[key] = JSON.stringify({ ...session, enabled: false });
              transaction.set(accountRef, { state, serverManaged: false, updatedAt: dbSDK.serverTimestamp() });
            }
            return state;
          });
        window.coinRuntimeKey = 'btc-monitor-runtime-' + user.uid;
        window.coinStore = {
          getItem: key => store[key] ?? null,
          setItem: (key, value) => {
            store[key] = value; failed = false;
            el('sync-status').textContent = 'Đang lưu…';
            clearTimeout(saveTimer); saveTimer = setTimeout(save, 100);
          }
        };
        window.coinFlush = () => { clearTimeout(saveTimer); save(); };
        started = true;
        const script = document.createElement('script'); script.src = 'app.js?v=browser-20261008-2';
        script.onload = () => {
          gate.hidden = true; el('dashboard').hidden = false; window.dispatchEvent(new Event('resize'));
        };
        script.onerror = () => { el('auth-message').textContent = 'Không tải được ứng dụng. Hãy tải lại trang.'; };
        el('account-name').textContent = user.email || user.displayName;
        el('sync-status').textContent = 'Đã tải dữ liệu'; el('account-bar').hidden = false;
        document.body.append(script);
      } catch (error) {
        window.coinDiagnostic('Firestore', error.code || 'Không tải được dữ liệu', 'error');
        el('auth-message').textContent = 'Không đọc/chuyển được dữ liệu tài khoản. Hãy Publish firestore.rules mới trong Firebase rồi tải lại trang.';
      }
    });
  } catch { el('auth-message').textContent = 'Không tải được dịch vụ đăng nhập. Kiểm tra kết nối rồi tải lại trang.'; }
}
