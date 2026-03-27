const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const theme = require("./config/theme.js");

const ROOT_DIR = __dirname;
const CONTENT_DIR = path.join(ROOT_DIR, "content");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DEFAULT_PORT = Number.parseInt(process.env.PORT || "4300", 10);
const DEFAULT_BASE_PATH = normalizeBasePath(process.env.BASE_PATH);

const STATIC_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join("; ");

const contentCache = new Map();

const slugify = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 140);

const normalizePathname = (pathname) => {
  if (!pathname || pathname === "/") {
    return "/";
  }

  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
};

function normalizeBasePath(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed || trimmed === "/") {
    return "";
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

const withBasePath = (basePath, pathname = "/") => {
  const normalizedPath =
    !pathname || pathname === "/"
      ? "/"
      : pathname.startsWith("/")
        ? pathname
        : `/${pathname}`;

  if (!basePath) {
    return normalizedPath;
  }

  if (normalizedPath === "/") {
    return `${basePath}/`;
  }

  return `${basePath}${normalizedPath}`;
};

const stripBasePath = (pathname, basePath) => {
  if (!basePath) {
    return pathname;
  }

  if (pathname === basePath) {
    return "/";
  }

  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length) || "/";
  }

  return pathname;
};

const readHeaderValue = (value) =>
  Array.isArray(value) ? value[0] : value;

const isKnownDocumentPath = (pathname) =>
  pathname === "/" ||
  pathname === "/faq" ||
  pathname === "/privacy-policy" ||
  pathname === "/privacy" ||
  pathname === "/t&c" ||
  pathname === "/t%26c" ||
  pathname === "/terms-and-conditions" ||
  pathname === "/terms" ||
  pathname === "/api" ||
  pathname === "/assets" ||
  pathname === "/favicon.svg" ||
  pathname === "/assets/theme.css" ||
  pathname.startsWith("/assets/") ||
  pathname === "/api/health" ||
  pathname === "/api/faqs" ||
  pathname === "/api/privacy-policy" ||
  pathname === "/api/terms-and-conditions";

const inferBasePath = (pathname) => {
  const match = pathname.match(/^\/([^/]+)(\/.*)?$/);
  if (!match) {
    return "";
  }

  const inferredBasePath = `/${match[1]}`;
  const remainder = match[2] || "";

  if (isKnownDocumentPath(inferredBasePath)) {
    return "";
  }

  if (!remainder) {
    return inferredBasePath;
  }

  return isKnownDocumentPath(remainder) ? inferredBasePath : "";
};

const resolveBasePath = (req, normalizedPathname) =>
  normalizeBasePath(readHeaderValue(req.headers?.["x-forwarded-prefix"])) ||
  DEFAULT_BASE_PATH ||
  inferBasePath(normalizedPathname);

const readContent = (filename) => {
  const filePath = path.join(CONTENT_DIR, filename);
  const stats = fs.statSync(filePath);
  const cached = contentCache.get(filePath);

  if (cached && cached.mtimeMs === stats.mtimeMs) {
    return cached.data;
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  contentCache.set(filePath, { mtimeMs: stats.mtimeMs, data: parsed });
  return parsed;
};

const getFaqDocument = () => {
  const data = readContent("faqs.json");
  const items = Array.isArray(data.items) ? data.items : [];
  const topicsBySlug = new Map();

  items.forEach((item) => {
    const topics = Array.isArray(item.topics) ? item.topics : [];

    topics.forEach((topicName) => {
      const slug = slugify(topicName);
      if (topicsBySlug.has(slug)) {
        return;
      }

      topicsBySlug.set(slug, {
        slug,
        name: topicName
      });
    });
  });

  return {
    ...data,
    items,
    topics: Array.from(topicsBySlug.values()).sort((left, right) =>
      left.name.localeCompare(right.name)
    )
  };
};

const getStructuredDocument = (filename) => {
  const data = readContent(filename);

  return {
    ...data,
    sections: Array.isArray(data.sections) ? data.sections : [],
    highlights: Array.isArray(data.highlights) ? data.highlights : []
  };
};

const getPrivacyDocument = () => getStructuredDocument("privacy-policy.json");

const getTermsDocument = () => getStructuredDocument("terms-and-conditions.json");

const matchesTopic = (item, topicSlug) => {
  if (!topicSlug) {
    return true;
  }

  return (item.topics || []).some((topic) => slugify(topic) === topicSlug);
};

const matchesQuery = (item, query) => {
  if (!query) {
    return true;
  }

  const haystack = [
    item.question,
    item.answer,
    ...(item.topics || []),
    ...(item.details || []),
    item.audience
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
};

const filterFaqs = (items, rawQuery, rawTopic) => {
  const displayQuery = normalizeText(rawQuery);
  const query = displayQuery.toLowerCase();
  const topic = slugify(rawTopic);

  return {
    displayQuery,
    query,
    topic,
    items: items.filter(
      (item) => matchesQuery(item, query) && matchesTopic(item, topic)
    )
  };
};

const renderShell = ({
  title,
  description,
  routeTag,
  body,
  footerNote,
  basePath
}) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(description)}" />
    <title>${escapeHtml(title)}</title>
    <link rel="icon" href="${escapeHtml(withBasePath(basePath, "/favicon.svg"))}" type="image/svg+xml" />
    <link rel="stylesheet" href="${escapeHtml(withBasePath(basePath, "/assets/theme.css"))}" />
    <link rel="stylesheet" href="${escapeHtml(withBasePath(basePath, "/assets/styles.css"))}" />
    <script type="module" src="${escapeHtml(withBasePath(basePath, "/assets/app.js"))}"></script>
  </head>
  <body data-base-path="${escapeHtml(basePath)}">
    <div class="site-shell">
      <header class="site-header">
        <div class="container header-row">
          <div class="brand">
            <span class="brand-mark" aria-hidden="true">DK</span>
            <span class="brand-copy">
              <span class="brand-title">DotKE Documents</span>
              <span class="brand-subtitle">Help and privacy information</span>
            </span>
          </div>
          ${routeTag ? `<span class="route-pill">${escapeHtml(routeTag)}</span>` : ""}
        </div>
      </header>
      <main class="site-main container">${body}</main>
      ${
        footerNote
          ? `<footer class="site-footer container">
              <div class="footer-card">
                <p class="eyebrow">Production Note</p>
                <p class="footer-copy">${escapeHtml(footerNote)}</p>
              </div>
            </footer>`
          : ""
      }
    </div>
  </body>
</html>`;

const renderFaqCard = (item, index) => {
  const panelId = `faq-panel-${index + 1}`;
  const isOpen = index === 0;
  const details = Array.isArray(item.details) ? item.details : [];
  const topicBadges = (item.topics || [])
    .map((topic) => `<span class="topic-badge">${escapeHtml(topic)}</span>`)
    .join("");
  const detailsList = details.length
    ? `<ul class="detail-list">${details
        .map((detail) => `<li>${escapeHtml(detail)}</li>`)
        .join("")}</ul>`
    : "";

  return `
    <article class="faq-card">
      <button
        class="faq-trigger"
        type="button"
        aria-expanded="${isOpen ? "true" : "false"}"
        aria-controls="${panelId}"
        data-faq-trigger
      >
        <span class="faq-trigger-copy">
          <span class="faq-kicker">${escapeHtml(item.audience || "Knowledge Base")}</span>
          <span class="faq-question">${escapeHtml(item.question)}</span>
        </span>
        <span class="faq-trigger-icon" aria-hidden="true"></span>
      </button>
      <div
        id="${panelId}"
        class="faq-panel${isOpen ? " is-open" : ""}"
        ${isOpen ? "" : "hidden"}
      >
        <p>${escapeHtml(item.answer)}</p>
        ${detailsList}
        <div class="topic-badges">${topicBadges}</div>
      </div>
    </article>
  `;
};

const buildFaqSummary = (filtered, activeTopicLabel) => {
  if (!filtered.items.length) {
    return "No questions matched the current filters.";
  }

  const fragments = [
    `${filtered.items.length} ${filtered.items.length === 1 ? "question" : "questions"}`
  ];

  if (activeTopicLabel) {
    fragments.push(`in ${activeTopicLabel}`);
  }

  return `Showing ${fragments.join(" ")}.`;
};

const renderFaqPage = (requestUrl, basePath) => {
  const document = getFaqDocument();
  const filtered = filterFaqs(
    document.items,
    "",
    requestUrl.searchParams.get("topic")
  );

  const activeTopic = filtered.topic;
  const activeTopicLabel =
    document.topics.find((topic) => topic.slug === activeTopic)?.name || "";
  const summary = buildFaqSummary(filtered, activeTopicLabel);
  const selectedTopicLabel = activeTopicLabel || "All topics";
  const topicOptions = [
    `<option value="">All topics</option>`,
    ...document.topics.map(
      (topic) =>
        `<option value="${escapeHtml(topic.slug)}"${
          activeTopic === topic.slug ? " selected" : ""
        }>${escapeHtml(topic.name)}</option>`
    )
  ].join("");
  const topicOptionButtons = [
    `<button type="button" class="select-option${
      activeTopic ? "" : " is-selected"
    }" role="option" aria-selected="${activeTopic ? "false" : "true"}" data-faq-option value="">All topics</button>`,
    ...document.topics.map(
      (topic) => `
        <button
          type="button"
          class="select-option${activeTopic === topic.slug ? " is-selected" : ""}"
          role="option"
          aria-selected="${activeTopic === topic.slug ? "true" : "false"}"
          data-faq-option
          value="${escapeHtml(topic.slug)}"
        >
          ${escapeHtml(topic.name)}
        </button>
      `
    )
  ].join("");
  const cards = filtered.items.length
    ? filtered.items.map(renderFaqCard).join("")
    : `
      <article class="empty-card">
        <p class="eyebrow">No match</p>
        <h2>Nothing matched that search yet.</h2>
        <p>Try a different topic or switch back to All topics.</p>
      </article>
    `;

  return renderShell({
    title: "FAQ | DotKE Documents",
    description: "Helpful answers about .KE domains, DNS, privacy, and account safety.",
    routeTag: "FAQ",
    basePath,
    body: `
      <section class="hero-grid hero-grid-single">
        <article class="hero-card hero-card-main">
          <p class="eyebrow">${escapeHtml(document.hero.eyebrow)}</p>
          <h1 class="hero-title">${escapeHtml(document.hero.title)}</h1>
          <p class="hero-copy">${escapeHtml(document.hero.description)}</p>
        </article>
      </section>

      <section class="surface-card search-surface">
        <div class="search-form" data-faq-filter-form>
          <div class="filter-grid">
            <div class="filter-field">
              <span class="search-label" id="faq-topic-label">Topic</span>
              <div class="filter-select" data-faq-topic-filter>
                <select id="faq-topic" name="topic" data-faq-topic-select hidden aria-hidden="true" tabindex="-1">
                  ${topicOptions}
                </select>
                <div class="select-enhanced" data-faq-select-enhanced>
                  <button
                    type="button"
                    class="select-trigger"
                    aria-haspopup="listbox"
                    aria-controls="faq-topic-menu"
                    aria-expanded="false"
                    aria-labelledby="faq-topic-label faq-topic-current"
                    data-faq-select-trigger
                  >
                    <span class="select-trigger-copy" id="faq-topic-current" data-faq-select-label>
                      ${escapeHtml(selectedTopicLabel)}
                    </span>
                    <span class="select-trigger-icon" aria-hidden="true">
                      <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
                        <path d="M5.25 7.5 10 12.25 14.75 7.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
                      </svg>
                    </span>
                  </button>
                  <div
                    class="select-menu"
                    id="faq-topic-menu"
                    role="listbox"
                    data-faq-select-menu
                    hidden
                  >
                    ${topicOptionButtons}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="search-meta">
          <p class="result-copy" data-faq-summary aria-live="polite">${escapeHtml(summary)}</p>
        </div>
      </section>

      <section class="faq-list" data-faq-list>${cards}</section>
    `
  });
};

const renderPolicySection = (section) => {
  const body = (section.body || [])
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");
  const bullets = (section.bullets || []).length
    ? `<ul class="detail-list">${section.bullets
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("")}</ul>`
    : "";

  return `
    <section class="policy-section" id="${escapeHtml(section.id)}">
      <p class="eyebrow">Section</p>
      <h2>${escapeHtml(section.title)}</h2>
      ${body}
      ${bullets}
    </section>
  `;
};

const renderLegalPage = ({ document, title, description, routeTag, basePath }) =>
  renderShell({
    title,
    description,
    routeTag,
    basePath,
    body: `
      <section class="hero-grid">
        <article class="hero-card hero-card-main">
          <p class="eyebrow">Legal Document</p>
          <h1 class="hero-title">${escapeHtml(document.title)}</h1>
          <p class="hero-copy">${escapeHtml(document.summary)}</p>
          <div class="meta-row">
            <span class="meta-chip">Version ${escapeHtml(document.version)}</span>
            <span class="meta-chip">${escapeHtml(document.owner)}</span>
          </div>
        </article>
        <article class="hero-card highlights-card">
          <p class="eyebrow">Highlights</p>
          <ul class="detail-list">
            ${document.highlights
              .map((highlight) => `<li>${escapeHtml(highlight)}</li>`)
              .join("")}
          </ul>
        </article>
      </section>

      <section class="policy-layout" data-policy-page>
        <aside class="surface-card toc-card">
          <p class="eyebrow">Contents</p>
          <nav class="toc-links" aria-label="Document sections">
            ${document.sections
              .map(
                (section) => `
                  <a href="#${escapeHtml(section.id)}" data-policy-link>
                    ${escapeHtml(section.title)}
                  </a>
                `
              )
              .join("")}
          </nav>
        </aside>
        <article class="policy-article">
          ${document.sections.map(renderPolicySection).join("")}
        </article>
      </section>
    `
  });

const renderPrivacyPage = (basePath) =>
  renderLegalPage({
    document: getPrivacyDocument(),
    title: "Privacy Policy | DotKE Documents",
    description: "Privacy information about how DotKE collects, uses, stores, and protects personal data.",
    routeTag: "Privacy Policy",
    basePath
  });

const renderTermsPage = (basePath) =>
  renderLegalPage({
    document: getTermsDocument(),
    title: "Terms & Conditions | DotKE Documents",
    description: "Terms and conditions for using DotKE services, accounts, and domain-related workflows.",
    routeTag: "T&C",
    basePath
  });

const renderNotFoundPage = (basePath) =>
  renderShell({
    title: "Not Found | DotKE Documents",
    description: "The requested document route was not found.",
    routeTag: "404",
    basePath,
    body: `
      <section class="single-panel">
        <article class="empty-card">
          <p class="eyebrow">404</p>
          <h1>That document route does not exist.</h1>
          <p>Try the FAQ, Privacy Policy, or T&amp;C route instead.</p>
          <a class="button button-primary" href="${escapeHtml(withBasePath(basePath, "/faq"))}">Go to FAQ</a>
        </article>
      </section>
    `
  });

const buildThemeCss = () => `:root {
  --color-primary: ${theme.colors.primary};
  --color-secondary: ${theme.colors.secondary};
  --color-dark: ${theme.colors.dark};
  --color-light: ${theme.colors.light};
  --color-accent: ${theme.colors.accent};
  --color-info: ${theme.colors.info};
  --color-success: ${theme.colors.success};
  --color-warning: ${theme.colors.warning};
  --color-gray-100: ${theme.colors.gray100};
  --color-gray-200: ${theme.colors.gray200};
  --color-gray-300: ${theme.colors.gray300};
  --color-gray-500: ${theme.colors.gray500};
  --color-gray-700: ${theme.colors.gray700};
  --color-gray-800: ${theme.colors.gray800};
  --color-on-primary: ${theme.colors.onPrimary};
  --color-surface: ${theme.palette.light.surface};
  --color-background: ${theme.documents.canvas};
  --color-paper: ${theme.documents.paper};
  --color-paper-strong: ${theme.documents.paperStrong};
  --color-border: ${theme.documents.border};
  --color-text: ${theme.palette.light.text};
  --radius-sm: ${theme.radius.sm}px;
  --radius-md: ${theme.radius.md}px;
  --radius-lg: ${theme.radius.lg}px;
  --radius-xl: ${theme.radius.xl}px;
  --radius-pill: ${theme.radius.pill}px;
  --motion-fast: ${theme.animation.fast};
  --motion-normal: ${theme.animation.normal};
  --motion-slow: ${theme.animation.slow};
  --shadow-elevated: ${theme.documents.shadow};
  --font-body: ${theme.documents.fontBody};
  --font-display: ${theme.documents.fontDisplay};
}`;

const send = (res, method, statusCode, body, contentType, cacheControl) => {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);

  res.statusCode = statusCode;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", String(payload.length));
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (contentType.startsWith("text/html")) {
    res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  }

  if (method === "HEAD") {
    res.end();
    return;
  }

  res.end(payload);
};

const serveFile = (method, pathname, res) => {
  const rawTarget =
    pathname === "/favicon.svg"
      ? path.join(PUBLIC_DIR, "favicon.svg")
      : path.join(PUBLIC_DIR, pathname.replace(/^\/+/, ""));

  const safeTarget = path.normalize(rawTarget);

  if (!safeTarget.startsWith(PUBLIC_DIR)) {
    return false;
  }

  if (!fs.existsSync(safeTarget) || !fs.statSync(safeTarget).isFile()) {
    return false;
  }

  const extension = path.extname(safeTarget).toLowerCase();
  const contentType = STATIC_TYPES[extension] || "application/octet-stream";
  const cacheControl =
    pathname === "/favicon.svg"
      ? "public, max-age=86400"
      : "public, max-age=3600";

  send(res, method, 200, fs.readFileSync(safeTarget), contentType, cacheControl);
  return true;
};

const sendJson = (res, method, payload) =>
  send(
    res,
    method,
    200,
    JSON.stringify(payload, null, 2),
    "application/json; charset=utf-8",
    "no-store"
  );

const createRequestHandler = () => (req, res) => {
    const method = req.method || "GET";

    if (method !== "GET" && method !== "HEAD") {
      send(
        res,
        method,
        405,
        JSON.stringify({ error: "Method not allowed" }),
        "application/json; charset=utf-8",
        "no-store"
      );
      return;
    }

    const requestUrl = new URL(req.url || "/", "http://localhost");
    const normalizedPathname = normalizePathname(requestUrl.pathname);

    if (requestUrl.pathname !== normalizedPathname) {
      res.statusCode = 308;
      res.setHeader("Location", `${normalizedPathname}${requestUrl.search}`);
      res.end();
      return;
    }

    const basePath = resolveBasePath(req, normalizedPathname);
    const pathname = stripBasePath(normalizedPathname, basePath);

    if (pathname === "/assets/theme.css") {
      send(
        res,
        method,
        200,
        buildThemeCss(),
        "text/css; charset=utf-8",
        "public, max-age=3600"
      );
      return;
    }

    if (pathname.startsWith("/assets/") || pathname === "/favicon.svg") {
      if (serveFile(method, pathname, res)) {
        return;
      }
    }

    if (pathname === "/api/health") {
      sendJson(res, method, {
        status: "ok",
        service: "dotke-documents",
        time: new Date().toISOString()
      });
      return;
    }

    if (pathname === "/api/faqs") {
      const document = getFaqDocument();
      const filtered = filterFaqs(
        document.items,
        requestUrl.searchParams.get("q"),
        requestUrl.searchParams.get("topic")
      );

      sendJson(res, method, {
        meta: {
          total: document.items.length,
          filtered: filtered.items.length,
          query: filtered.displayQuery,
          topic: filtered.topic,
          topics: document.topics
        },
        items: filtered.items
      });
      return;
    }

    if (pathname === "/api/privacy-policy") {
      sendJson(res, method, getPrivacyDocument());
      return;
    }

    if (pathname === "/api/terms-and-conditions") {
      sendJson(res, method, getTermsDocument());
      return;
    }

    if (pathname === "/") {
      res.statusCode = 308;
      res.setHeader("Location", withBasePath(basePath, "/faq"));
      res.end();
      return;
    }

    if (pathname === "/faq") {
      send(
        res,
        method,
        200,
        renderFaqPage(requestUrl, basePath),
        "text/html; charset=utf-8",
        "no-store"
      );
      return;
    }

    if (pathname === "/privacy-policy" || pathname === "/privacy") {
      send(
        res,
        method,
        200,
        renderPrivacyPage(basePath),
        "text/html; charset=utf-8",
        "no-store"
      );
      return;
    }

    if (
      pathname === "/t&c" ||
      pathname === "/t%26c" ||
      pathname === "/terms-and-conditions" ||
      pathname === "/terms"
    ) {
      send(
        res,
        method,
        200,
        renderTermsPage(basePath),
        "text/html; charset=utf-8",
        "no-store"
      );
      return;
    }

    send(
      res,
      method,
      404,
      renderNotFoundPage(basePath),
      "text/html; charset=utf-8",
      "no-store"
    );
  };

const createServer = () => http.createServer(createRequestHandler());

if (require.main === module) {
  const server = createServer();
  const host = process.env.HOST || "0.0.0.0";

  server.listen(DEFAULT_PORT, host, () => {
    process.stdout.write(
      `DotKE Documents listening on http://${host}:${DEFAULT_PORT}\n`
    );
  });
}

module.exports = {
  createRequestHandler,
  createServer
};
