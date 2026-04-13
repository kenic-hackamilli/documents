import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const loadCreateRequestHandler = (basePath = "") => {
  if (basePath) {
    process.env.BASE_PATH = basePath;
  } else {
    delete process.env.BASE_PATH;
  }

  const modulePath = require.resolve("../server.js");
  delete require.cache[modulePath];

  return require("../server.js").createRequestHandler;
};

const request = async (url, method = "GET", options = {}) => {
  const createRequestHandler = loadCreateRequestHandler(options.basePath);
  const handler = createRequestHandler();
  const headers = new Map();

  return await new Promise((resolve, reject) => {
    const req = {
      method,
      url,
      headers: options.headers || {}
    };
    const res = {
      statusCode: 200,
      writableEnded: false,
      setHeader(name, value) {
        headers.set(String(name).toLowerCase(), String(value));
      },
      getHeader(name) {
        return headers.get(String(name).toLowerCase());
      },
      end(body) {
        this.writableEnded = true;
        resolve({
          status: this.statusCode,
          headers,
          body:
            typeof body === "string"
              ? body
              : Buffer.isBuffer(body)
                ? body.toString("utf8")
                : ""
        });
      }
    };

    try {
      handler(req, res);
    } catch (error) {
      reject(error);
    }
  });
};

test("GET / redirects to /faq", async () => {
  const response = await request("/");

  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "/faq");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("GET /faq renders the FAQ page", async () => {
  const response = await request("/faq");

  assert.equal(response.status, 200);
  assert.match(response.body, />FAQs</i);
  assert.match(response.body, /Find quick answers to common questions about domains, payments, and support\./i);
  assert.match(response.body, /Customer Care/i);
  assert.match(response.body, /customercare@kenic\.or\.ke/i);
  assert.match(response.body, /data-faq-topic-chip/i);
  assert.match(response.body, /href="\/faq\?topic=finance"/i);
  assert.match(response.body, /Browse by Category/i);
  assert.match(response.body, /Showing 8 questions in Customer Care\./i);
  assert.match(response.body, />8<\/span>/i);
  assert.match(response.body, />9<\/span>/i);
  assert.doesNotMatch(response.body, /Tech FAQ update in progress/i);
  assert.doesNotMatch(response.body, /<span class="topic-badge">Customer Care<\/span>/i);
  assert.doesNotMatch(response.body, />Live</i);
  assert.doesNotMatch(response.body, />Soon</i);
  assert.doesNotMatch(response.body, /data-faq-search-input/i);
  assert.doesNotMatch(response.body, /Search the knowledge base/i);
  assert.doesNotMatch(response.body, /data-faq-native-select/i);
  assert.doesNotMatch(response.body, /data-faq-select-enhanced/i);
  assert.doesNotMatch(response.body, /data-faq-submit/i);
  assert.doesNotMatch(response.body, /data-faq-reset/i);
  assert.doesNotMatch(response.body, /All topics/i);
  assert.doesNotMatch(response.body, /Reset filters/i);
  assert.doesNotMatch(response.body, /aria-label="Primary"/i);
  assert.doesNotMatch(response.body, /GET \/api\/faqs/i);
  assert.doesNotMatch(response.body, />\/faq</i);
});

test("GET /faq sets hardened response headers", async () => {
  const response = await request("/faq");

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("origin-agent-cluster"), "?1");
  assert.equal(response.headers.get("accept-ranges"), "none");
  assert.match(response.headers.get("content-security-policy"), /base-uri 'none'/i);
  assert.match(response.headers.get("content-security-policy"), /form-action 'none'/i);
  assert.match(response.headers.get("vary"), /x-forwarded-prefix/i);
});

test("GET /faq with a placeholder topic renders the update banner", async () => {
  const response = await request("/faq?topic=tech");

  assert.equal(response.status, 200);
  assert.match(response.body, /Tech FAQ update in progress/i);
  assert.match(response.body, /Tech content is being updated\./i);
  assert.doesNotMatch(response.body, /Showing 8 questions in Customer Care\./i);
});

test("GET /faq with the finance topic renders finance FAQs", async () => {
  const response = await request("/faq?topic=finance");

  assert.equal(response.status, 200);
  assert.match(response.body, /How do I top up my account\?/i);
  assert.match(response.body, /Billing &amp; Payments:|Billing & Payments:/i);
  assert.match(response.body, /billing@kenic\.or\.ke/i);
  assert.match(response.body, /Showing 9 questions in Finance\./i);
});

test("GET /faq ignores invalid forwarded prefixes", async () => {
  const response = await request("/faq", "GET", {
    headers: {
      "x-forwarded-prefix": "/documents?bad=1"
    }
  });

  assert.equal(response.status, 200);
  assert.match(response.body, /data-base-path=""/i);
  assert.doesNotMatch(response.body, /documents\?bad=1/i);
});

test("GET /privacy-policy renders the policy page", async () => {
  const response = await request("/privacy-policy");

  assert.equal(response.status, 200);
  assert.match(response.body, /Privacy Policy/i);
  assert.match(response.body, /Data Retention/i);
  assert.match(response.body, />Privacy Policy</i);
  assert.doesNotMatch(response.body, /aria-label="Primary"/i);
  assert.doesNotMatch(response.body, /sample policy is structured/i);
  assert.doesNotMatch(response.body, />\/privacy-policy</i);
});

test("GET /privacy serves the privacy policy alias route", async () => {
  const response = await request("/privacy");

  assert.equal(response.status, 200);
  assert.match(response.body, /Privacy Policy/i);
  assert.doesNotMatch(response.body, />\/privacy-policy</i);
});

test("GET /t&c renders the terms page", async () => {
  const response = await request("/t&c");

  assert.equal(response.status, 200);
  assert.match(response.body, /Terms &amp; Conditions|Terms & Conditions/i);
  assert.match(response.body, /Acceptance of Terms/i);
  assert.match(response.body, />T&amp;C</i);
});

test("GET /api/terms-and-conditions returns the terms document", async () => {
  const response = await request("/api/terms-and-conditions");
  const payload = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(payload.title, "Terms & Conditions");
  assert.ok(Array.isArray(payload.sections));
  assert.ok(payload.sections.length > 0);
});

test("GET /api/health keeps the payload minimal", async () => {
  const response = await request("/api/health");
  const payload = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.deepEqual(payload, { status: "ok" });
});

test("GET /api/faqs filters customer care items by topic", async () => {
  const response = await request("/api/faqs?topic=customer-care");
  const payload = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(payload.meta.topic, "customer-care");
  assert.ok(payload.items.length > 0);
  assert.ok(
    payload.items.every((item) =>
      item.topics.some((topic) => /customer care/i.test(topic))
    )
  );
  assert.equal(payload.placeholders.length, 0);
});

test("GET /api/faqs returns finance FAQ items instead of a placeholder", async () => {
  const response = await request("/api/faqs?topic=finance");
  const payload = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(payload.meta.topic, "finance");
  assert.ok(payload.items.length > 0);
  assert.equal(payload.placeholders.length, 0);
  assert.ok(
    payload.items.some((item) => /How do I top up my account\?/i.test(item.question))
  );
  assert.ok(
    payload.items.some(
      (item) =>
        Array.isArray(item.details) &&
        item.details.some((detail) => /billing@kenic\.or\.ke/i.test(detail))
    )
  );
});

test("GET /api/faqs returns placeholder notices for in-progress topics", async () => {
  const response = await request("/api/faqs?topic=tech");
  const payload = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(payload.meta.topic, "tech");
  assert.equal(payload.items.length, 0);
  assert.equal(payload.placeholders.length, 1);
  assert.match(payload.placeholders[0].title, /Tech FAQ update in progress/i);
});

test("GET /api/health reports status", async () => {
  const response = await request("/api/health");
  const payload = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(payload.status, "ok");
});

test("POST /faq is rejected with an allow header", async () => {
  const response = await request("/faq", "POST");
  const payload = JSON.parse(response.body);

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
  assert.equal(payload.error, "Method not allowed");
});

test("GET /assets/theme.css exposes the copied brand colors", async () => {
  const response = await request("/assets/theme.css");

  assert.equal(response.status, 200);
  assert.match(response.body, /--color-primary:\s*#E30613/i);
  assert.match(response.body, /--color-secondary:\s*#009739/i);
});

test("GET /assets path traversal does not expose files outside public", async () => {
  const response = await request("/assets/../server.js");

  assert.notEqual(response.status, 200);
  assert.doesNotMatch(response.body, /const fs = require/i);
});

test("GET /documents redirects to the base-path FAQ route when BASE_PATH is set", async () => {
  const response = await request("/documents", "GET", { basePath: "/documents" });

  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "/documents/faq");
});

test("GET /documents/faq infers the /documents base path from the request URL", async () => {
  const response = await request("/documents/faq");

  assert.equal(response.status, 200);
  assert.match(response.body, /href="\/documents\/assets\/theme\.css"/i);
  assert.match(response.body, /src="\/documents\/assets\/app\.js"/i);
  assert.match(response.body, /data-base-path="\/documents"/i);
});

test("GET /documents/faq renders asset and API links with the configured base path", async () => {
  const response = await request("/documents/faq", "GET", { basePath: "/documents" });

  assert.equal(response.status, 200);
  assert.match(response.body, /href="\/documents\/assets\/theme\.css"/i);
  assert.match(response.body, /src="\/documents\/assets\/app\.js"/i);
  assert.match(response.body, /data-base-path="\/documents"/i);
});
