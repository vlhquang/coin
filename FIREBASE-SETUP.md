# Google login and private storage on GitHub Pages

1. Create a project at https://console.firebase.google.com and register a Web app.
2. Copy its public firebaseConfig object into `firebase-config.js` as `window.FIREBASE_CONFIG = { ... };`. Do not add a service account or exchange secret.
3. Enable Authentication > Sign-in method > Google. Set the support email.
4. Under Authentication > Settings > Authorized domains, add your GitHub Pages hostname (`username.github.io`) and localhost for development.
5. Create a Cloud Firestore database, then publish the exact rules from `firestore.rules` in its Rules tab. Do not use public test rules.
6. Publish these static files on GitHub Pages. Open the HTTPS URL and sign in with Google.
7. Verify account A cannot see account B's wallet; signed-out requests must be denied by Firestore rules.

Each account stores its wallet, trade history, strategy and bot state in `users/{uid}/private/portfolio`. The dashboard does not load until Google authentication and a successful server read. Refresh restores the saved bot state. Old local-only data is not automatically uploaded to an account.

The Firebase web configuration and static code are public on GitHub Pages. Private account data is protected by Firestore rules, not by hiding HTML. Do not commit private portfolio exports, credentials or exchange keys.

Server mode is now configured through `BTC_SERVER_URL=https://vlhquang.onrender.com`. Deploy and enable the BTC worker in the karaoke repository following `docs/btc-bot-render.md`, and publish the updated rules. Until that server is enabled, the dashboard reports that it cannot load the server state. In server mode, closing the browser or logging out does not stop a running bot; use the Stop button. Execution still requires an always-on Render instance. No live exchange orders are implemented.
