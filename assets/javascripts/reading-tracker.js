(function () {
  "use strict";
  if (window.dailyArxivReadingTracker) return;
  window.dailyArxivReadingTracker = true;
  const S = window.PaperReadingState;
  const base = new URL("../../", document.currentScript.src);
  let catalog = null, storageError = "", pending = null, pendingRaw = null;
  const icons = {
    read: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path class="rt-check" d="m7 12 3 3 7-7"/></svg>',
    deepRead: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>'
  };
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function status(text) {
    let node = document.getElementById("reading-status");
    if (!node) {
      node = element("p", "", "reading-status");
      node.id = "reading-status";
      node.setAttribute("role", "status");
      (document.querySelector("article.md-content__inner") || document.body).prepend(node);
    }
    node.textContent = text;
  }
  function raw() { return localStorage.getItem(S.KEY); }
  function load() {
    storageError = "";
    try {
      const value = raw();
      const result = value ? S.validate(JSON.parse(value)) : S.empty();
      const probe = S.KEY + "-probe";
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
      return result;
    } catch (error) {
      storageError = "阅读状态不可用：" + error.message + "。请先备份原始数据，再处理浏览器存储设置。";
      return S.empty();
    }
  }
  function persist(data) {
    localStorage.setItem(S.KEY, JSON.stringify(S.validate(data)));
  }
  function controls(key) {
    const box = element("span", undefined, "reading-controls");
    box.dataset.readingId = S.id(key);
    for (const field of S.fields) {
      const button = element("button", undefined, "reading-toggle");
      button.type = "button";
      button.dataset.readingField = field;
      button.innerHTML = icons[field];
      box.append(button);
    }
    return box;
  }
  function initLists() {
    document.querySelectorAll(".paper-list").forEach(list => {
      if (!list.querySelector(".paper-card[data-paper-id]") || list.dataset.readingReady) return;
      list.dataset.readingReady = "true";
      const bar = element("div", undefined, "reading-filter");
      for (const [field, label] of [["unread", "仅看未读"], ["deep", "仅看精读"]]) {
        const wrapper = element("label");
        const input = element("input");
        input.type = "checkbox";
        input.dataset.readingFilter = field;
        wrapper.append(input, document.createTextNode(label));
        bar.append(wrapper);
      }
      bar.append(element("span", "", "reading-count"));
      list.before(bar);
      const empty = element("p", "没有符合当前筛选条件的论文。", "reading-empty");
      empty.hidden = true;
      list.after(empty);
      list.querySelectorAll(".paper-card[data-paper-id]").forEach(card => card.prepend(controls(card.dataset.paperId)));
    });
    document.querySelectorAll("[data-reading-detail]").forEach(node => {
      if (!node.querySelector(".reading-controls")) node.append(controls(node.dataset.readingDetail));
    });
  }
  function render() {
    const state = load();
    if (storageError) status(storageError);
    document.querySelectorAll(".reading-controls").forEach(box => {
      const record = S.get(state, box.dataset.readingId);
      box.querySelectorAll("button").forEach(button => {
        const field = button.dataset.readingField;
        button.setAttribute("aria-pressed", String(record[field]));
        const label = field === "read" ? (record.read ? "取消已读" : "标记已读") : (record.deepRead ? "移出精读清单" : "加入精读清单");
        button.setAttribute("aria-label", label);
        button.title = label;
        button.disabled = Boolean(storageError);
      });
    });
    document.querySelectorAll(".paper-list[data-reading-ready]").forEach(list => {
      const bar = list.previousElementSibling;
      const unread = bar.querySelector('[data-reading-filter="unread"]').checked;
      const deep = bar.querySelector('[data-reading-filter="deep"]').checked;
      const cards = [...list.querySelectorAll(".paper-card[data-paper-id]")];
      let readCount = 0, visible = 0;
      cards.forEach(card => {
        const record = S.get(state, card.dataset.paperId);
        if (record.read) readCount++;
        card.hidden = unread && record.read || deep && !record.deepRead;
        if (!card.hidden) visible++;
      });
      const unit = list.hasAttribute("data-reading-all") ? " 条" : " 篇";
      bar.querySelector(".reading-count").textContent = "已读 " + readCount + " / " + cards.length + unit + " · 显示 " + visible + unit;
      list.nextElementSibling.hidden = visible !== 0;
    });
    const stats = document.querySelector("[data-reading-stats]");
    if (stats && catalog) {
      const read = catalog.filter(p => S.get(state, p.id).read).length;
      const deep = catalog.filter(p => S.get(state, p.id).deepRead).length;
      stats.textContent = storageError ? "存储异常，请先恢复数据" : "全站 " + catalog.length + " 条（论文 " + catalog.filter(p => p.kind !== "announcement").length + "，官方发布 " + catalog.filter(p => p.kind === "announcement").length + "）· 已读 " + read + " · 未读 " + (catalog.length - read) + " · 精读 " + deep;
    }
  }
  function download(name, content, type = "text/markdown;charset=utf-8") {
    const url = URL.createObjectURL(new Blob([content], {type}));
    const link = element("a");
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function preview() {
    const panel = document.querySelector("[data-reading-preview]");
    panel.replaceChildren();
    const local = load();
    if (storageError) throw new Error(storageError);
    const plan = S.plan(local, pending, new Set(catalog.map(p => p.id)));
    pendingRaw = raw();
    const different = new Set([...plan.newRecords, ...[...plan.changes, ...plan.conflicts].map(change => change.id)]).size;
    panel.append(element("p", "文件有效，共 " + plan.count + " 条；与本地不同 " + different + " 条；可自动合并 " + plan.changes.length + " 个字段；冲突 " + plan.conflicts.length + " 个；未知 ID " + plan.unknown.length + " 条。"));
    panel.append(element("p", "时间戳只作参考。冲突默认保留本地，可逐项选择导入值；点击确认才会写入。"));
    for (const [i, conflict] of plan.conflicts.entries()) {
      const row = element("label", conflict.id + " · " + (conflict.field === "read" ? "已读" : "精读") + "：本地 " + conflict.local + "（" + conflict.localTime + "），导入 " + conflict.incoming + "（" + conflict.incomingTime + "）", "reading-conflict");
      const select = element("select");
      select.dataset.conflict = i;
      for (const [value, label] of [["local", "保留本地"], ["incoming", "采用导入"]]) {
        const option = element("option", label); option.value = value; select.append(option);
      }
      row.append(select); panel.append(row);
    }
    if (plan.unknown.length) panel.append(element("p", "暂未收录的 ID 将保留：" + plan.unknown.join("、")));
    const button = element("button", "确认合并阅读状态", "reading-action");
    button.type = "button"; button.dataset.readingApply = "true"; panel.append(button);
    panel.hidden = false;
  }
  async function initialize() {
    initLists(); render();
    if (!document.querySelector("[data-reading-manager]")) return;
    try {
      if (!catalog) {
        const response = await fetch(new URL("assets/papers-index.json", base));
        if (!response.ok) throw new Error("全站索引加载失败");
        const index = await response.json();
        if (index.schemaVersion !== 1 || !Array.isArray(index.papers)) throw new Error("全站索引版本不兼容");
        catalog = index.papers;
      }
      const list = document.querySelector("[data-reading-all]");
      if (!list) return;
      if (!list.dataset.loaded) {
        for (const paper of catalog) {
          const card = element("article", undefined, "paper-card");
          card.dataset.paperId = paper.id;
          const heading = element("h3");
          const link = element("a", paper.title);
          link.href = new URL(paper.url, base).href; heading.append(link);
          card.append(heading, element("p", paper.id + " · 收录 " + paper.date + " · " + paper.tags.join("、")));
          list.append(card);
        }
        list.dataset.loaded = "true";
      }
      initLists(); render();
    } catch (error) { status(error.message); }
  }
  document.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    try {
      if (button.dataset.readingField) {
        event.preventDefault(); event.stopPropagation();
        const state = load();
        if (storageError) throw new Error(storageError);
        const key = button.parentElement.dataset.readingId;
        const field = button.dataset.readingField;
        const next = S.toggle(state, key, field);
        persist(next);
        render(); status(field === "read" ? (S.get(next, key).read ? "已标记为已读" : "已标记为未读") : (S.get(next, key).deepRead ? "已加入精读清单" : "已移出精读清单"));
      }
      if (button.dataset.readingExport) {
        const state = load();
        if (storageError || !catalog) throw new Error(storageError || "索引尚未加载");
        const type = button.dataset.readingExport;
        const names = {state: "reading-state.md", unread: "unread-papers.md", deep: "deep-reading.md"};
        download(names[type], S.exportMarkdown(state, catalog, type, base.href));
      }
      if (button.dataset.readingRaw) download("reading-state-raw.json", raw() || "{}", "application/json");
      if (button.dataset.readingApply) {
        if (raw() !== pendingRaw) { preview(); status("本地状态已变化，请重新检查预览后确认"); return; }
        const state = load();
        if (storageError) throw new Error(storageError);
        const plan = S.plan(state, pending, new Set(catalog.map(p => p.id)));
        const choices = [...document.querySelectorAll("[data-conflict]")].map(select => select.value);
        persist(S.merge(state, plan, choices));
        document.querySelector("[data-reading-preview]").hidden = true;
        pending = null; render(); status("阅读状态已导入");
      }
    } catch (error) { status(error.message); }
  });
  document.addEventListener("change", async event => {
    if (event.target.dataset.readingFilter) render();
    if (event.target.matches("[data-reading-import]")) {
      const file = event.target.files[0];
      if (!file) return;
      try {
        if (file.size > 5 * 1024 * 1024) throw new Error("文件超过 5 MB");
        pending = S.parseMarkdown(await file.text());
        if (!catalog) throw new Error("请等待全站索引加载完成");
        preview();
      } catch (error) {
        pending = null;
        const panel = document.querySelector("[data-reading-preview]");
        if (panel) { panel.hidden = true; panel.replaceChildren(); }
        status(error.message);
      }
      event.target.value = "";
    }
  });
  window.addEventListener("storage", event => { if (event.key === S.KEY || event.key === null) render(); });
  window.addEventListener("pageshow", render);
  if (typeof document$ !== "undefined") document$.subscribe(initialize);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
  else initialize();
})();
