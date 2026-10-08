const el = id => document.getElementById(id);
const gate = el('auth-screen');
gate.hidden = false;
const config = window.FIREBASE_CONFIG;
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
    const serverURL = window.BTC_SERVER_URL?.replace(/\/$/, '');
    let serverWorker = null;
    async function serverRequest(path, body) {
      const token = await auth.currentUser.getIdToken();
      const response = await fetch(serverURL + '/api/btc-bot/' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(body === undefined ? 15000 : 60000), cache: 'no-store'
      });
      if (!response.ok) {
        let message = 'Bot server chưa sẵn sàng. Kiểm tra triển khai và cấu hình Render.';
        try { message = (await response.json()).error || message; } catch {}
        throw new Error(message);
      }
      return response.json();
    }
    function acceptServerState(result) {
      if ((result.worker?.lastTickAt || 0) < (serverWorker?.lastTickAt || 0)) return;
      store = result.state || {}; serverWorker = result.worker;
      if (window.coinServer) window.coinServer.worker = serverWorker;
      window.dispatchEvent(new Event('coin-server-state'));
    }
    function save() {
      if (serverURL) return;
      if (!store || !accountRef) return;
      const state = { ...store };
      el('sync-status').textContent = 'Đang lưu…';
      writeQueue = writeQueue.then(async () => {
        await dbSDK.setDoc(accountRef, { state, updatedAt: dbSDK.serverTimestamp() });
        el('sync-status').textContent = 'Đã lưu';
      }).catch(() => {
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
      if (!serverURL) {
        el('stop-strategy').click();
        clearTimeout(saveTimer); save(); await writeQueue;
        if (failed) { el('logout').disabled = false; return; }
      }
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
        if (serverURL) {
          let result;
          try { result = await serverRequest('state'); }
          catch {
            const snapshot = await dbSDK.getDocFromServer(accountRef);
            result = snapshot.exists() ? snapshot.data() : { state: {} };
          }
          store = result.state || {}; serverWorker = result.worker;
          window.coinServer = {
            worker: serverWorker,
            command: async (command, body = {}) => {
              const result = await serverRequest(command, body); acceptServerState(result);
              return result;
            }
          };
        } else {
          const snapshot = await dbSDK.getDocFromServer(accountRef);
          store = snapshot.exists() ? snapshot.data().state || {} : {};
          if (snapshot.data()?.serverManaged) throw new Error('Tài khoản đã chuyển sang bot server. Cần cấu hình BTC_SERVER_URL.');
        }
        window.coinRuntimeKey = 'btc-monitor-runtime-' + user.uid;
        window.coinStore = {
          getItem: key => store[key] ?? null,
          setItem: (key, value) => {
            if (serverURL) return;
            store[key] = value; failed = false;
            el('sync-status').textContent = 'Đang lưu…';
            clearTimeout(saveTimer); saveTimer = setTimeout(save, 100);
          }
        };
        window.coinFlush = () => { clearTimeout(saveTimer); save(); };
        started = true;
        const script = document.createElement('script'); script.src = 'app.js';
        script.onload = () => {
          gate.hidden = true; el('dashboard').hidden = false; window.dispatchEvent(new Event('resize'));
          if (serverURL) dbSDK.onSnapshot(accountRef, snapshot => {
            if (!snapshot.metadata.fromCache && snapshot.exists() && snapshot.data().serverManaged === true) acceptServerState(snapshot.data());
            el('sync-status').textContent = snapshot.metadata.fromCache ? 'Dữ liệu lưu tạm · chờ kết nối' : 'Đồng bộ bot server';
          }, () => { el('sync-status').textContent = 'Mất đồng bộ bot server'; });
          if (serverURL) {
            let polling = false;
            async function refreshServer() {
              if (polling || !auth.currentUser || document.hidden) return;
              polling = true;
              try {
                acceptServerState(await serverRequest('state'));
                el('sync-status').textContent = 'Đồng bộ bot server';
              } catch {
                el('sync-status').textContent = 'Chưa kết nối bot server · biểu đồ vẫn hoạt động';
              } finally { polling = false; }
            }
            setInterval(refreshServer, 10000);
            document.addEventListener('visibilitychange', refreshServer);
            window.addEventListener('online', refreshServer);
            refreshServer();
          }
        };
        script.onerror = () => { el('auth-message').textContent = 'Không tải được ứng dụng. Hãy tải lại trang.'; };
        el('account-name').textContent = user.email || user.displayName;
        el('sync-status').textContent = 'Đã tải dữ liệu'; el('account-bar').hidden = false;
        document.body.append(script);
      } catch (error) { el('auth-message').textContent = error.message || 'Không đọc được dữ liệu tài khoản. Kiểm tra Firestore và quyền truy cập.'; }
    });
  } catch { el('auth-message').textContent = 'Không tải được dịch vụ đăng nhập. Kiểm tra kết nối rồi tải lại trang.'; }
}
