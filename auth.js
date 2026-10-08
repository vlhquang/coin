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
    function save() {
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
        const snapshot = await dbSDK.getDocFromServer(accountRef);
        store = snapshot.exists() ? snapshot.data().state || {} : {};
        window.coinStore = {
          getItem: key => store[key] ?? null,
          setItem: (key, value) => {
            store[key] = value; failed = false;
            el('sync-status').textContent = 'Đang lưu…';
            clearTimeout(saveTimer); saveTimer = setTimeout(save, 100);
          }
        };
        started = true;
        const script = document.createElement('script'); script.src = 'app.js';
        script.onload = () => { gate.hidden = true; el('dashboard').hidden = false; window.dispatchEvent(new Event('resize')); };
        script.onerror = () => { el('auth-message').textContent = 'Không tải được ứng dụng. Hãy tải lại trang.'; };
        el('account-name').textContent = user.email || user.displayName;
        el('sync-status').textContent = 'Đã tải dữ liệu'; el('account-bar').hidden = false;
        document.body.append(script);
      } catch { el('auth-message').textContent = 'Không đọc được dữ liệu tài khoản. Kiểm tra Firestore và quyền truy cập; dữ liệu chưa bị thay đổi.'; }
    });
  } catch { el('auth-message').textContent = 'Không tải được dịch vụ đăng nhập. Kiểm tra kết nối rồi tải lại trang.'; }
}
