# Djezzy Messenger — Netlify + Firebase Firestore

This is a Netlify Functions adaptation of the provided Messenger bot, using Firestore for persistent sessions and OTP state. Djezzy API behavior has not been validated against live services.

## Set up
1. Create a Firebase Firestore database in production mode. **Do not open client-side rules**; the server Admin SDK uses a service account.
2. Generate a Firebase service-account JSON key and keep it private. Base64-encode the entire JSON file locally and set its result as the **secret** Netlify environment variable `FIREBASE_SERVICE_ACCOUNT_BASE64`. Do not commit the JSON file or paste it in chat.
3. Generate a separate cryptographically random 32-byte key and base64-encode it; set `SESSION_ENCRYPTION_KEY` in Netlify. **Keep this key backed up securely**: losing it makes stored Djezzy sessions unreadable. Do not change it casually.
4. Set `PAGE_ACCESS_TOKEN`, `VERIFY_TOKEN`, `META_APP_SECRET`, `CLIENT_ID`, `CLIENT_SECRET`, and optionally `DJEZZY_PROXY_URL` as secret Netlify environment variables. Rotate previously exposed credentials (including proxy password) before production use.
5. Deploy via a connected clean Git repository (recommended), or build/deploy with Netlify CLI. **Do not drag-and-drop the source ZIP as a static site**; dependencies/functions require a proper build.
6. Set Meta Messenger webhook callback to `https://YOUR-SITE.netlify.app/webhook`, verify with `VERIFY_TOKEN`, and subscribe to the required Page events.

## Security and limitations
- Firestore sessions are encrypted using AES-256-GCM before storage. OTP steps expire logically after 15 minutes (Firestore may retain expired fields until the next interaction).
- Keep Firestore client security rules locked down. Do not expose any service account or encryption key in frontend code or Git.
- Meta signature verification uses `META_APP_SECRET` and the original raw request body.
- Processing is synchronous within the function. Slow Djezzy calls may exceed Netlify limits or Meta's webhook response deadline; Meta may retry events, and **deduplication/serialized processing is not yet implemented**. Avoid production activation until these behaviors are tested and handled.
- Functions and free tiers have quotas; no uptime or successful activation is guaranteed.
- This ZIP is source code for deployment, not an already deployed bot.
