const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const theme = require("./config/theme.js");

const ROOT_DIR = __dirname;
const CONTENT_DIR = path.join(ROOT_DIR, "content");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const BASE_PATH_PATTERN = /^\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const DEFAULT_PORT = Number.parseInt(process.env.PORT || "4300", 10);
const DEFAULT_BASE_PATH = normalizeBasePath(process.env.BASE_PATH);
const MAX_URL_LENGTH = 2048;

const STATIC_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'none'",
  "frame-src 'none'",
  "manifest-src 'self'",
  "media-src 'none'",
  "worker-src 'none'",
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

const normalizeCopy = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");

const formatInlineText = (value) =>
  escapeHtml(value)
    .replace(
      /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi,
      '<a href="mailto:$1">$1</a>'
    )
    .replace(
      /\bhttps?:\/\/[^\s<]+/gi,
      (url) =>
        `<a href="${url}" target="_blank" rel="noreferrer noopener">${url}</a>`
    );

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

  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return "";
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const normalized = withLeadingSlash.replace(/\/+$/, "");
  return BASE_PATH_PATTERN.test(normalized) ? normalized : "";
}

const isPathInside = (rootPath, targetPath) => {
  const relativePath = path.relative(rootPath, targetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
};

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
  const placeholders = (Array.isArray(data.placeholders) ? data.placeholders : [])
    .map((placeholder) => {
      const name = normalizeCopy(placeholder?.name);
      const slug = slugify(placeholder?.slug || name);

      if (!name || !slug) {
        return null;
      }

      return {
        name,
        slug,
        title: normalizeCopy(placeholder?.title) || `${name} FAQ update in progress`,
        description:
          normalizeCopy(placeholder?.description) ||
          "This section is currently being updated. Please check back soon."
      };
    })
    .filter(Boolean);
  const topicsBySlug = new Map();

  placeholders.forEach((placeholder) => {
    topicsBySlug.set(placeholder.slug, {
      slug: placeholder.slug,
      name: placeholder.name
    });
  });

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
    placeholders,
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

const getDefaultFaqTopicSlug = (document) => {
  const availableTopics = Array.isArray(document?.topics) ? document.topics : [];

  if (availableTopics.some((topic) => topic.slug === "customer-care")) {
    return "customer-care";
  }

  return availableTopics[0]?.slug || "";
};

const buildFaqTopicHref = (basePath, topicSlug, defaultTopic) =>
  withBasePath(
    basePath,
    topicSlug && topicSlug !== defaultTopic
      ? `/faq?topic=${encodeURIComponent(topicSlug)}`
      : "/faq"
  );

const filterFaqPlaceholders = (placeholders, topicSlug) => {
  if (!topicSlug) {
    return placeholders;
  }

  return placeholders.filter((placeholder) => placeholder.slug === topicSlug);
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
  const detailsList = details.length
    ? `<ul class="detail-list">${details
        .map((detail) => `<li>${formatInlineText(detail)}</li>`)
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
        <p>${formatInlineText(item.answer)}</p>
        ${detailsList}
      </div>
    </article>
  `;
};

const renderFaqBanner = (placeholder) => `
  <article class="faq-banner">
    <p class="eyebrow">Update in progress</p>
    <h2 class="faq-banner-title">${escapeHtml(placeholder.title)}</h2>
    <p class="faq-banner-copy">${formatInlineText(placeholder.description)}</p>
  </article>
`;

const buildFaqSummary = (filtered, activeTopicLabel, visiblePlaceholders) => {
  if (!filtered.items.length && !visiblePlaceholders.length) {
    return "No questions matched the current filters.";
  }

  if (!filtered.items.length && visiblePlaceholders.length) {
    return activeTopicLabel
      ? `${activeTopicLabel} content is being updated.`
      : `${visiblePlaceholders.length} ${visiblePlaceholders.length === 1 ? "section is" : "sections are"} being updated.`;
  }

  const fragments = [
    `${filtered.items.length} ${filtered.items.length === 1 ? "question" : "questions"}`
  ];

  if (activeTopicLabel) {
    fragments.push(`in ${activeTopicLabel}`);
  }

  const summary = [`Showing ${fragments.join(" ")}.`];

  if (visiblePlaceholders.length) {
    summary.push(
      `${visiblePlaceholders.length} ${
        visiblePlaceholders.length === 1 ? "section is" : "sections are"
      } being updated.`
    );
  }

  return summary.join(" ");
};

const renderFaqPage = (requestUrl, basePath) => {
  const document = getFaqDocument();
  const defaultTopic = getDefaultFaqTopicSlug(document);
  const requestedTopic = slugify(requestUrl.searchParams.get("topic"));
  const activeTopic = document.topics.some((topic) => topic.slug === requestedTopic)
    ? requestedTopic
    : defaultTopic;
  const filtered = filterFaqs(
    document.items,
    "",
    activeTopic
  );
  const visiblePlaceholders = filterFaqPlaceholders(
    document.placeholders,
    activeTopic
  );
  const activeTopicLabel =
    document.topics.find((topic) => topic.slug === activeTopic)?.name || "";
  const summary = buildFaqSummary(
    filtered,
    activeTopicLabel,
    visiblePlaceholders
  );
  const itemCountByTopic = new Map();
  const placeholderTopics = new Set(
    document.placeholders.map((placeholder) => placeholder.slug)
  );

  document.items.forEach((item) => {
    (item.topics || []).forEach((topicName) => {
      const slug = slugify(topicName);
      itemCountByTopic.set(slug, (itemCountByTopic.get(slug) || 0) + 1);
    });
  });

  const topicChips = document.topics
    .map(
      (topic) => `
        <a
          href="${escapeHtml(
            buildFaqTopicHref(basePath, topic.slug, defaultTopic)
          )}"
          class="topic-chip${activeTopic === topic.slug ? " is-selected" : ""}"
          ${activeTopic === topic.slug ? 'aria-current="page"' : ""}
          data-faq-topic-chip
          data-topic-value="${escapeHtml(topic.slug)}"
        >
          <span class="topic-chip-title">${escapeHtml(topic.name)}</span>
          ${
            placeholderTopics.has(topic.slug)
              ? ""
              : `<span class="topic-chip-count">${
                  itemCountByTopic.get(topic.slug) || 0
                }</span>`
          }
        </a>
      `
    )
    .join("");
  const cards = [...visiblePlaceholders.map(renderFaqBanner), ...filtered.items.map(renderFaqCard)].join("");
  const content = cards
    ? cards
    : `
      <article class="empty-card">
        <p class="eyebrow">No match</p>
        <h2>Nothing matched that search yet.</h2>
        <p>Try another category.</p>
      </article>
    `;

  return renderShell({
    title: "FAQ | DotKE Documents",
    description: "Helpful answers about customer care, .KE domains, and support updates.",
    routeTag: "FAQ",
    basePath,
    body: `
      <section class="hero-grid hero-grid-single">
        <article class="hero-card hero-card-main">
          <h1 class="hero-title">${escapeHtml(document.hero.title)}</h1>
          ${
            document.hero.description
              ? `<p class="hero-copy">${escapeHtml(document.hero.description)}</p>`
              : ""
          }
        </article>
      </section>

      <section class="surface-card search-surface">
        <div
          class="search-form"
          data-faq-filter
          data-default-topic="${escapeHtml(defaultTopic)}"
        >
          <div class="filter-heading">
            <p class="eyebrow">Browse by Category</p>
          </div>
          <div class="topic-chip-row" role="navigation" aria-label="FAQ categories">
            ${topicChips}
          </div>
        </div>
        <div class="search-meta">
          <p class="result-copy" data-faq-summary aria-live="polite">${escapeHtml(summary)}</p>
        </div>
      </section>

      <section class="faq-list" data-faq-list>${content}</section>
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

const appendVaryHeader = (res, value) => {
  const currentValue =
    typeof res.getHeader === "function" ? res.getHeader("Vary") : "";
  const currentParts = String(currentValue || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const nextParts = String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const merged = Array.from(new Set([...currentParts, ...nextParts]));

  if (merged.length) {
    res.setHeader("Vary", merged.join(", "));
  }
};

const applyResponseHeaders = (res, contentType, cacheControl, extraHeaders = {}) => {
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Origin-Agent-Cluster", "?1");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Accept-Ranges", "none");
  appendVaryHeader(res, "X-Forwarded-Prefix");

  if (contentType.startsWith("text/html")) {
    res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  }

  Object.entries(extraHeaders).forEach(([name, value]) => {
    if (name.toLowerCase() === "vary") {
      appendVaryHeader(res, value);
      return;
    }

    res.setHeader(name, value);
  });
};

const send = (
  res,
  method,
  statusCode,
  body,
  contentType,
  cacheControl,
  extraHeaders = {}
) => {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);

  res.statusCode = statusCode;
  res.setHeader("Content-Length", String(payload.length));
  applyResponseHeaders(res, contentType, cacheControl, extraHeaders);

  if (method === "HEAD") {
    res.end();
    return;
  }

  res.end(payload);
};

const sendRedirect = (res, method, statusCode, location) =>
  send(
    res,
    method,
    statusCode,
    "",
    "text/plain; charset=utf-8",
    "no-store",
    { Location: location }
  );

const serveFile = (method, pathname, res) => {
  const rawTarget =
    pathname === "/favicon.svg"
      ? path.join(PUBLIC_DIR, "favicon.svg")
      : path.join(PUBLIC_DIR, pathname.replace(/^\/+/, ""));

  const safeTarget = path.normalize(rawTarget);

  if (!isPathInside(PUBLIC_DIR, safeTarget)) {
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
  try {
    const method = req.method || "GET";

    if (method !== "GET" && method !== "HEAD") {
      send(
        res,
        method,
        405,
        JSON.stringify({ error: "Method not allowed" }),
        "application/json; charset=utf-8",
        "no-store",
        { Allow: "GET, HEAD" }
      );
      return;
    }

    if (String(req.url || "").length > MAX_URL_LENGTH) {
      send(
        res,
        method,
        414,
        JSON.stringify({ error: "Request URL too long" }),
        "application/json; charset=utf-8",
        "no-store"
      );
      return;
    }

    const requestUrl = new URL(req.url || "/", "http://localhost");
    const normalizedPathname = normalizePathname(requestUrl.pathname);

    if (requestUrl.pathname !== normalizedPathname) {
      sendRedirect(res, method, 308, `${normalizedPathname}${requestUrl.search}`);
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
        status: "ok"
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
      const visiblePlaceholders = filterFaqPlaceholders(
        document.placeholders,
        filtered.topic
      );

      sendJson(res, method, {
        meta: {
          total: document.items.length,
          filtered: filtered.items.length,
          query: filtered.displayQuery,
          topic: filtered.topic,
          topics: document.topics,
          defaultTopic: getDefaultFaqTopicSlug(document),
          filteredPlaceholders: visiblePlaceholders.length
        },
        items: filtered.items,
        placeholders: visiblePlaceholders
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
      sendRedirect(res, method, 308, withBasePath(basePath, "/faq"));
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
  } catch (error) {
    process.stderr.write(`dotke-documents request failure: ${error?.message || "unknown error"}\n`);

    if (res.writableEnded) {
      return;
    }

    send(
      res,
      req.method || "GET",
      500,
      JSON.stringify({ error: "Internal server error" }),
      "application/json; charset=utf-8",
      "no-store"
    );
  }
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
