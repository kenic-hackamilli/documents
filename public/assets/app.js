let faqResizeBound = false;

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

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

const buildFaqSummary = (items, activeTopicLabel) => {
  if (!items.length) {
    return "No questions matched the current filters.";
  }

  const fragments = [
    `${items.length} ${items.length === 1 ? "question" : "questions"}`,
  ];

  if (activeTopicLabel) {
    fragments.push(`in ${activeTopicLabel}`);
  }

  return `Showing ${fragments.join(" ")}.`;
};

const renderFaqCard = (item, index) => {
  const panelId = `faq-panel-${slugify(item.id || item.question || String(index + 1))}-${index + 1}`;
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

const renderFaqEmptyState = () => `
  <article class="empty-card">
    <p class="eyebrow">No match</p>
    <h2>Nothing matched that search yet.</h2>
    <p>Try a different topic or switch back to All topics.</p>
  </article>
`;

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

const syncFaqUrl = ({ topic }) => {
  if (!window.history?.replaceState) {
    return;
  }

  const nextUrl = new URL(window.location.href);
  nextUrl.search = "";

  if (topic) {
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
  const form = document.querySelector("[data-faq-filter-form]");

  if (!form) {
    return;
  }

  const topicSelect = form.querySelector("[data-faq-topic-select]");
  const enhancedSelect = form.querySelector("[data-faq-select-enhanced]");
  const selectTrigger = form.querySelector("[data-faq-select-trigger]");
  const selectLabel = form.querySelector("[data-faq-select-label]");
  const selectMenu = form.querySelector("[data-faq-select-menu]");
  const summary = document.querySelector("[data-faq-summary]");
  const faqList = document.querySelector("[data-faq-list]");

  if (!topicSelect || !faqList || !summary) {
    return;
  }

  let allItems = null;

  const getSelectedTopicLabel = () => {
    const selectedOption = topicSelect.options[topicSelect.selectedIndex];
    return topicSelect.value ? selectedOption?.textContent?.trim() || "" : "";
  };

  const renderCurrentState = () => {
    if (!allItems) {
      return;
    }

    const topic = slugify(topicSelect.value);
    const filteredItems = allItems.filter((item) => matchesTopic(item, topic));
    const activeTopicLabel = getSelectedTopicLabel();
    summary.textContent = buildFaqSummary(filteredItems, activeTopicLabel);
    faqList.innerHTML = filteredItems.length
      ? filteredItems.map(renderFaqCard).join("")
      : renderFaqEmptyState();

    syncFaqUrl({ topic });
    bindFaqAccordions();
  };

  const customSelect = initCustomTopicSelect({
    select: topicSelect,
    enhanced: enhancedSelect,
    trigger: selectTrigger,
    label: selectLabel,
    menu: selectMenu,
    onChange: () => {
      renderCurrentState();
    },
  });

  topicSelect.addEventListener("change", () => {
    customSelect.syncSelectedValue(topicSelect.value);
    renderCurrentState();
  });

  try {
    const response = await window.fetch("/api/faqs", {
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
