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
    const req = { method, url };
    const res = {
      statusCode: 200,
      setHeader(name, value) {
        headers.set(String(name).toLowerCase(), String(value));
      },
      end(body) {
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
});

test("GET /faq renders the FAQ page", async () => {
  const response = await request("/faq");

  assert.equal(response.status, 200);
  assert.match(response.body, /Clear answers for domains, DNS, and online safety/i);
  assert.match(response.body, /Support Knowledge Base/i);
  assert.match(response.body, />FAQ</i);
  assert.match(response.body, /data-faq-select-enhanced/i);
  assert.match(response.body, /id="faq-topic-menu"/i);
  assert.match(response.body, /All topics/i);
  assert.doesNotMatch(response.body, /data-faq-search-input/i);
  assert.doesNotMatch(response.body, /Search the knowledge base/i);
  assert.doesNotMatch(response.body, /data-faq-native-select/i);
  assert.doesNotMatch(response.body, /data-faq-submit/i);
  assert.doesNotMatch(response.body, /data-faq-reset/i);
  assert.doesNotMatch(response.body, /Reset filters/i);
  assert.doesNotMatch(response.body, /aria-label="Primary"/i);
  assert.doesNotMatch(response.body, /GET \/api\/faqs/i);
  assert.doesNotMatch(response.body, />\/faq</i);
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

test("GET /api/faqs filters by topic", async () => {
  const response = await request("/api/faqs?topic=dns");
  const payload = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(payload.meta.topic, "dns");
  assert.ok(payload.items.length > 0);
  assert.ok(
    payload.items.every((item) =>
      item.topics.some((topic) => /dns/i.test(topic))
    )
  );
});

test("GET /api/health reports status", async () => {
  const response = await request("/api/health");
  const payload = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(payload.status, "ok");
});

test("GET /assets/theme.css exposes the copied brand colors", async () => {
  const response = await request("/assets/theme.css");

  assert.equal(response.status, 200);
  assert.match(response.body, /--color-primary:\s*#E30613/i);
  assert.match(response.body, /--color-secondary:\s*#009739/i);
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
