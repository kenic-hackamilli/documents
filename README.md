# DotKE Documents

Standalone documents service for public document routes:

- `/faq`
- `/privacy-policy`
- `/privacy` alias
- `/t&c`
- `/terms-and-conditions` alias

It is designed to be hosted as its own service and consumed by any client, including a mobile WebView.

## Why this shape

- Content lives in JSON files under `content/`
- Theme tokens live in `config/theme.js`
- The server exposes route pages and JSON APIs
- FAQ topic filtering works without needing a new app release
- No external runtime dependencies are required

## Local run

```bash
cd documents
npm start
```

The server listens on:

- `HOST`, defaulting to `0.0.0.0`
- `PORT`, defaulting to `4300`
- `BASE_PATH`, optional. Set this to `/documents` if you are mounting the service under `https://your-domain/documents`

## Routes

- `GET /` redirects to `/faq`
- `GET /faq`
- `GET /privacy-policy`
- `GET /privacy`
- `GET /t&c`
- `GET /terms-and-conditions`
- `GET /api/health`
- `GET /api/faqs`
- `GET /api/privacy-policy`
- `GET /api/terms-and-conditions`

## Content editing

- Update FAQ entries in [content/faqs.json](/Users/danielfrance/Desktop/dotKE/documents/content/faqs.json)
- Update policy sections in [content/privacy-policy.json](/Users/danielfrance/Desktop/dotKE/documents/content/privacy-policy.json)
- Update terms sections in [content/terms-and-conditions.json](/Users/danielfrance/Desktop/dotKE/documents/content/terms-and-conditions.json)
- Update copied brand colors and document theme tokens in [config/theme.js](/Users/danielfrance/Desktop/dotKE/documents/config/theme.js)

## Hosting notes

- Host the service behind your preferred reverse proxy or process manager
- If you proxy it under a subpath such as `/documents`, set `BASE_PATH=/documents` in the service environment
- Point the app directly to the route it needs instead of using a shared in-page menu
- Use `/api/faqs`, `/api/privacy-policy`, and `/api/terms-and-conditions` if you later replace the current HTML frontend
- Keep content changes and service deployments versioned independently from the mobile app

## Verification

```bash
cd documents
npm test
```
