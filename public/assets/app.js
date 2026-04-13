let faqResizeBound = false;

const normalizeBasePath = (value) => {
  const trimmed = String(value || "").trim();

  if (!trimmed || trimmed === "/") {
    return "";
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, "");
};

const buildAppPath = (pathname) => {
  const basePath = normalizeBasePath(document.body?.dataset.basePath);
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;

  return basePath ? `${basePath}${normalizedPath}` : normalizedPath;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

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

const slugify = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const matchesTopic = (item, topicSlug) => {
  if (!topicSlug) {
    return true;
  }

  return (item.topics || []).some((topic) => slugify(topic) === topicSlug);
};

const buildFaqSummary = (items, activeTopicLabel, placeholders = []) => {
  if (!items.length && !placeholders.length) {
    return "No questions matched the current filters.";
  }

  if (!items.length && placeholders.length) {
    return activeTopicLabel
      ? `${activeTopicLabel} content is being updated.`
      : `${placeholders.length} ${placeholders.length === 1 ? "section is" : "sections are"} being updated.`;
  }

  const fragments = [
    `${items.length} ${items.length === 1 ? "question" : "questions"}`,
  ];

  if (activeTopicLabel) {
    fragments.push(`in ${activeTopicLabel}`);
  }

  const summary = [`Showing ${fragments.join(" ")}.`];

  if (placeholders.length) {
    summary.push(
      `${placeholders.length} ${
        placeholders.length === 1 ? "section is" : "sections are"
      } being updated.`
    );
  }

  return summary.join(" ");
};

const renderFaqCard = (item, index) => {
  const panelId = `faq-panel-${slugify(item.id || item.question || String(index + 1))}-${index + 1}`;
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
    <h2 class="faq-banner-title">${escapeHtml(placeholder.title || "")}</h2>
    <p class="faq-banner-copy">${formatInlineText(placeholder.description || "")}</p>
    <div class="topic-badges">
      <span class="topic-badge">${escapeHtml(placeholder.name || "")}</span>
    </div>
  </article>
`;

const renderFaqEmptyState = () => `
  <article class="empty-card">
    <p class="eyebrow">No match</p>
    <h2>Nothing matched that search yet.</h2>
    <p>Try another category.</p>
  </article>
`;

const getChipTopicValue = (chip) => chip?.dataset?.topicValue || "";

const getVisibleFaqPlaceholders = (placeholders, topicSlug) => {
  if (!topicSlug) {
    return placeholders;
  }

  return placeholders.filter((placeholder) => placeholder.slug === topicSlug);
};

const renderFaqResults = (items, placeholders) => {
  const parts = [
    ...placeholders.map(renderFaqBanner),
    ...items.map(renderFaqCard),
  ];

  return parts.length ? parts.join("") : renderFaqEmptyState();
};

const updatePanelState = (button, panel, expanded, animate) => {
  button.setAttribute("aria-expanded", String(expanded));

  if (expanded) {
    panel.hidden = false;
    panel.classList.add("is-open");
    panel.style.maxHeight = `${panel.scrollHeight}px`;
    return;
  }

  if (!animate) {
    panel.hidden = true;
    panel.classList.remove("is-open");
    panel.style.maxHeight = "0px";
    return;
  }

  panel.style.maxHeight = `${panel.scrollHeight}px`;

  requestAnimationFrame(() => {
    panel.classList.remove("is-open");
    panel.style.maxHeight = "0px";
  });

  window.setTimeout(() => {
    if (button.getAttribute("aria-expanded") === "false") {
      panel.hidden = true;
    }
  }, 240);
};

const getHeaderOffset = () => {
  const header = document.querySelector(".site-header");

  if (!header) {
    return 0;
  }

  const { position } = window.getComputedStyle(header);

  if (position !== "sticky" && position !== "fixed") {
    return 0;
  }

  return header.getBoundingClientRect().height;
};

const revealAccordionContent = (button, panel) => {
  window.requestAnimationFrame(() => {
    const triggerRect = button.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const headerOffset = getHeaderOffset();
    const viewportBottom = window.innerHeight;
    const topPadding = 12;
    const bottomPadding = 20;
    const needsReposition =
      triggerRect.top < headerOffset + topPadding ||
      panelRect.bottom > viewportBottom - bottomPadding;

    if (!needsReposition) {
      return;
    }

    const targetTop = window.scrollY + triggerRect.top - headerOffset - topPadding;
    window.scrollTo({
      top: Math.max(targetTop, 0),
      behavior: "smooth",
    });
  });
};

const bindFaqAccordions = () => {
  const triggers = document.querySelectorAll("[data-faq-trigger]");

  triggers.forEach((button) => {
    if (button.dataset.bound === "true") {
      return;
    }

    const panelId = button.getAttribute("aria-controls");
    const panel = panelId ? document.getElementById(panelId) : null;

    if (!panel) {
      return;
    }

    button.dataset.bound = "true";
    updatePanelState(
      button,
      panel,
      button.getAttribute("aria-expanded") === "true",
      false
    );

    button.addEventListener("click", () => {
      const isExpanded = button.getAttribute("aria-expanded") === "true";
      const nextExpanded = !isExpanded;

      updatePanelState(button, panel, nextExpanded, true);

      if (nextExpanded) {
        revealAccordionContent(button, panel);
      }
    });
  });

  if (!faqResizeBound) {
    faqResizeBound = true;
    window.addEventListener("resize", () => {
      document.querySelectorAll(".faq-panel.is-open").forEach((panel) => {
        panel.style.maxHeight = `${panel.scrollHeight}px`;
      });
    });
  }
};

const syncFaqUrl = ({ topic, defaultTopic }) => {
  if (!window.history?.replaceState) {
    return;
  }

  const nextUrl = new URL(window.location.href);
  nextUrl.search = "";

  if (topic && topic !== defaultTopic) {
    nextUrl.searchParams.set("topic", topic);
  }

  window.history.replaceState({}, "", `${nextUrl.pathname}${nextUrl.search}`);
};

const initCustomTopicSelect = ({
  select,
  enhanced,
  trigger,
  label,
  menu,
  onChange,
}) => {
  if (!select || !enhanced || !trigger || !label || !menu) {
    return {
      closeMenu() {},
      syncSelectedValue() {},
    };
  }

  menu.hidden = false;

  const getOptions = () => Array.from(menu.querySelectorAll("[data-faq-option]"));

  const syncSelectedValue = (nextValue = select.value) => {
    const availableOptions = Array.from(select.options);
    const selectedOption =
      availableOptions.find((option) => option.value === nextValue) || availableOptions[0] || null;
    const selectedValue = selectedOption?.value || "";

    select.value = selectedValue;
    label.textContent = selectedOption?.textContent?.trim() || "All topics";

    getOptions().forEach((optionButton) => {
      const isSelected = optionButton.value === selectedValue;
      optionButton.classList.toggle("is-selected", isSelected);
      optionButton.setAttribute("aria-selected", String(isSelected));
    });
  };

  const closeMenu = ({ restoreFocus = false } = {}) => {
    enhanced.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");

    if (restoreFocus) {
      trigger.focus();
    }
  };

  const focusOption = (value) => {
    const options = getOptions();
    const focusTarget = options.find((option) => option.value === value) || options[0] || null;
    focusTarget?.focus();
  };

  const openMenu = () => {
    enhanced.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    window.requestAnimationFrame(() => focusOption(select.value));
  };

  const toggleMenu = () => {
    if (enhanced.classList.contains("is-open")) {
      closeMenu();
      return;
    }

    openMenu();
  };

  const moveOptionFocus = (current, direction) => {
    const options = getOptions();
    const currentIndex = options.indexOf(current);

    if (currentIndex === -1 || !options.length) {
      return;
    }

    const nextIndex = (currentIndex + direction + options.length) % options.length;
    options[nextIndex]?.focus();
  };

  const commitSelection = (nextValue) => {
    syncSelectedValue(nextValue);
    closeMenu({ restoreFocus: true });
    onChange?.(select.value);
  };

  syncSelectedValue();

  trigger.addEventListener("click", () => {
    toggleMenu();
  });

  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openMenu();
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleMenu();
    }
  });

  getOptions().forEach((optionButton) => {
    optionButton.addEventListener("click", () => {
      commitSelection(optionButton.value);
    });

    optionButton.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu({ restoreFocus: true });
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveOptionFocus(optionButton, 1);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveOptionFocus(optionButton, -1);
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        getOptions()[0]?.focus();
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        const options = getOptions();
        options[options.length - 1]?.focus();
      }
    });
  });

  document.addEventListener("click", (event) => {
    if (enhanced.hidden || !enhanced.classList.contains("is-open")) {
      return;
    }

    if (enhanced.contains(event.target)) {
      return;
    }

    closeMenu();
  });

  window.addEventListener(
    "scroll",
    () => {
      if (enhanced.classList.contains("is-open")) {
        closeMenu();
      }
    },
    { passive: true }
  );

  window.addEventListener("resize", () => {
    if (enhanced.classList.contains("is-open")) {
      closeMenu();
    }
  });

  return {
    closeMenu,
    syncSelectedValue,
  };
};

const initFaqFilters = async () => {
  const filter = document.querySelector("[data-faq-filter]");

  if (!filter) {
    return;
  }

  const topicChips = Array.from(
    filter.querySelectorAll("[data-faq-topic-chip]")
  );
  const summary = document.querySelector("[data-faq-summary]");
  const faqList = document.querySelector("[data-faq-list]");

  if (!topicChips.length || !faqList || !summary) {
    return;
  }

  let allItems = null;
  let allPlaceholders = [];
  const defaultTopic =
    filter.dataset.defaultTopic ||
    getChipTopicValue(
      topicChips.find((chip) => getChipTopicValue(chip) === "customer-care") || {}
    ) ||
    getChipTopicValue(topicChips[0] || {}) ||
    "";
  let selectedTopic =
    getChipTopicValue(
      topicChips.find((chip) => chip.classList.contains("is-selected")) || {}
    ) ||
    defaultTopic;

  const syncSelectedTopic = (nextTopic) => {
    selectedTopic = nextTopic || defaultTopic;

    topicChips.forEach((chip) => {
      const isSelected = getChipTopicValue(chip) === selectedTopic;
      chip.classList.toggle("is-selected", isSelected);
      if (isSelected) {
        chip.setAttribute("aria-current", "page");
      } else {
        chip.removeAttribute("aria-current");
      }
    });
  };

  const getSelectedTopicLabel = () =>
    topicChips
      .find((chip) => getChipTopicValue(chip) === selectedTopic)
      ?.querySelector(".topic-chip-title")
      ?.textContent?.trim() || "";

  const renderCurrentState = () => {
    if (!allItems) {
      return;
    }

    const topic = slugify(selectedTopic) || defaultTopic;
    const filteredItems = allItems.filter((item) => matchesTopic(item, topic));
    const visiblePlaceholders = getVisibleFaqPlaceholders(
      allPlaceholders,
      topic
    );
    const activeTopicLabel = getSelectedTopicLabel();
    summary.textContent = buildFaqSummary(
      filteredItems,
      activeTopicLabel,
      visiblePlaceholders
    );
    faqList.innerHTML = renderFaqResults(filteredItems, visiblePlaceholders);

    syncFaqUrl({ topic, defaultTopic });
    bindFaqAccordions();
  };

  topicChips.forEach((chip) => {
    chip.addEventListener("click", (event) => {
      if (!allItems) {
        return;
      }

      event.preventDefault();
      syncSelectedTopic(getChipTopicValue(chip));
      renderCurrentState();
    });
  });

  try {
    const response = await window.fetch(buildAppPath("/api/faqs"), {
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const payload = await response.json();

    if (!Array.isArray(payload.items)) {
      throw new Error("Invalid FAQ payload");
    }

    allItems = payload.items;
    allPlaceholders = Array.isArray(payload.placeholders)
      ? payload.placeholders
      : [];
    syncSelectedTopic(selectedTopic || payload.meta?.defaultTopic || defaultTopic);
    renderCurrentState();
  } catch (error) {
    window.console.error("Failed to enable live FAQ filtering", error);
  }
};

const bindPolicyToc = () => {
  const links = Array.from(document.querySelectorAll("[data-policy-link]"));

  if (!links.length || !("IntersectionObserver" in window)) {
    return;
  }

  const sections = links
    .map((link) => {
      const id = link.getAttribute("href")?.slice(1);
      return id ? document.getElementById(id) : null;
    })
    .filter(Boolean);

  const setCurrent = (id) => {
    links.forEach((link) => {
      const isCurrent = link.getAttribute("href") === `#${id}`;
      link.classList.toggle("is-current", isCurrent);
    });
  };

  const observer = new IntersectionObserver(
    (entries) => {
      const visibleEntry = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

      if (visibleEntry?.target?.id) {
        setCurrent(visibleEntry.target.id);
      }
    },
    {
      rootMargin: "-30% 0px -55% 0px",
      threshold: [0.1, 0.35, 0.75]
    }
  );

  sections.forEach((section) => observer.observe(section));
};

const boot = () => {
  bindFaqAccordions();
  initFaqFilters();
  bindPolicyToc();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
