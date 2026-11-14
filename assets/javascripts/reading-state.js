(function (root) {
  "use strict";
  const KEY = "daily-arxiv-reading-state-v1";
  const fields = ["read", "deepRead"];
  const emptyRecord = () => ({read: false, deepRead: false, readUpdatedAt: null, deepReadUpdatedAt: null});
  const empty = () => ({schemaVersion: 1, papers: Object.create(null)});
  function id(value) {
    if (typeof value !== "string") throw new Error("论文 ID 必须为字符串");
    const normalized = value.replace(/v\d+$/, "");
    if (!/^(\d{4}\.\d{4,5}|source:[a-f0-9]{24,64})$/.test(normalized)) throw new Error("无效论文 ID");
    return normalized;
  }
  function validate(input) {
    if (!input || input.schemaVersion !== 1 || !input.papers || Array.isArray(input.papers) || typeof input.papers !== "object")
      throw new Error("阅读状态格式损坏或版本不兼容，请保留原始备份");
    const output = empty();
    for (const [raw, record] of Object.entries(input.papers)) {
      const key = id(raw);
      if (Object.hasOwn(output.papers, key)) throw new Error("重复论文 ID");
      if (!record || typeof record !== "object") throw new Error("论文状态无效");
      const value = emptyRecord();
      for (const field of fields) {
        const stamp = record[field + "UpdatedAt"];
        if (typeof record[field] !== "boolean") throw new Error("状态必须为布尔值");
        if (stamp !== null && (typeof stamp !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(stamp) || !Number.isFinite(Date.parse(stamp)) || new Date(stamp).toISOString() !== stamp.replace(/Z$/, stamp.includes(".") ? "Z" : ".000Z")))
          throw new Error("修改时间必须为 UTC ISO 8601");
        if (record[field] && !stamp) throw new Error("已设置的状态缺少修改时间");
        value[field] = record[field];
        value[field + "UpdatedAt"] = stamp ? new Date(stamp).toISOString() : null;
      }
      output.papers[key] = value;
    }
    return output;
  }
  function get(state, key) { return state.papers[id(key)] || emptyRecord(); }
  function toggle(state, key, field, now = new Date().toISOString()) {
    if (!fields.includes(field)) throw new Error("未知状态字段");
    const next = validate(state);
    const record = {...get(next, key)};
    const previous = record[field + "UpdatedAt"];
    record[field] = !record[field];
    record[field + "UpdatedAt"] = new Date(Math.max(Date.parse(now), previous ? Date.parse(previous) + 1 : 0)).toISOString();
    next.papers[id(key)] = record;
    return next;
  }
  function escapeText(text) { return String(text).replace(/[\\\[\]<>\r\n]/g, c => c === "\n" || c === "\r" ? " " : "\\" + c); }
  function exportMarkdown(state, papers, type, base) {
    const data = validate(state);
    const byId = new Map(papers.map(p => [p.id, p]));
    const sync = type === "state";
    const keys = sync ? Object.keys(data.papers).sort() : papers.filter(p => type === "unread" ? !get(data, p.id).read : get(data, p.id).deepRead).map(p => p.id);
    const title = sync ? "Paper Reading State" : type === "unread" ? "未读论文清单" : "精读论文清单";
    const lines = ["# " + title, ""];
    if (sync) lines.push("Format: daily-arxiv-reading-state", "Schema-Version: 1", "");
    lines.push("导出时间：" + new Date().toISOString(), "", "共 " + keys.length + " 条", "");
    for (const key of keys) {
      const paper = byId.get(key);
      const record = get(data, key);
      const url = paper ? paper.arxivUrl || paper.sourceUrl : (key.startsWith("source:") ? "#" : "https://arxiv.org/abs/" + key);
      lines.push("- [" + (record.read ? "x" : " ") + "] [" + escapeText(paper ? paper.title : key) + "](" + url + ")" + (record.deepRead ? " #精读" : ""));
      lines.push("  - ID：" + key, "  - 精读：" + (record.deepRead ? "是" : "否"));
      if (paper) lines.push("  - 网站笔记：" + new URL(paper.url, base).href, "  - 收录日期：" + paper.date, "  - 标签：" + paper.tags.join("、"));
      if (sync) lines.push("  <!-- daily-arxiv-state " + JSON.stringify({id: key, ...record}) + " -->");
      lines.push("");
    }
    return lines.join("\n");
  }
  function parseMarkdown(text) {
    if (new TextEncoder().encode(text).length > 5 * 1024 * 1024) throw new Error("文件超过 5 MB");
    if (!/^Format: daily-arxiv-reading-state\r?$/m.test(text) || !/^Schema-Version: 1\r?$/m.test(text))
      throw new Error("请选择完整的 reading-state.md 同步文件，普通清单不能用于恢复");
    const result = empty();
    const comments = [...text.matchAll(/<!-- daily-arxiv-state (.*?) -->/g)];
    const declarations = text.match(/<!--\s*daily-arxiv-state/g) || [];
    if (declarations.length !== comments.length) throw new Error("同步元数据不完整");
    for (const match of comments) {
      let record;
      try { record = JSON.parse(match[1]); }
      catch (_) { throw new Error("同步元数据 JSON 无效"); }
      if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("同步元数据必须为状态对象");
      const key = id(record.id);
      if (Object.hasOwn(result.papers, key)) throw new Error("同步文件包含重复 ID");
      delete record.id;
      result.papers[key] = record;
    }
    const count = text.match(/^共 (\d+) 条\r?$/m);
    if (!count || Number(count[1]) !== comments.length) throw new Error("同步文件条数与元数据不一致");
    return validate(result);
  }
  function plan(local, incoming, known) {
    const changes = [], conflicts = [], unknown = [], newRecords = [];
    for (const [key, record] of Object.entries(incoming.papers)) {
      if (!known.has(key)) unknown.push(key);
      if (!Object.hasOwn(local.papers, key)) newRecords.push(key);
      for (const field of fields) {
        const current = get(local, key);
        const stamp = field + "UpdatedAt";
        if (!record[stamp]) continue;
        if (current[field] !== record[field] && current[stamp]) {
          conflicts.push({id: key, field, local: current[field], incoming: record[field], localTime: current[stamp], incomingTime: record[stamp]});
        } else if (!current[stamp] || Date.parse(record[stamp]) > Date.parse(current[stamp])) {
          changes.push({id: key, field, value: record[field], time: record[stamp]});
        }
      }
    }
    return {changes, conflicts, unknown, newRecords, count: Object.keys(incoming.papers).length};
  }
  function merge(local, preview, choices) {
    const next = validate(local);
    for (const key of preview.newRecords) next.papers[key] = {...get(next, key)};
    const changes = [...preview.changes];
    preview.conflicts.forEach((conflict, index) => {
      if (choices[index] === "incoming") changes.push({id: conflict.id, field: conflict.field, value: conflict.incoming, time: conflict.incomingTime});
    });
    for (const change of changes) {
      const record = {...get(next, change.id)};
      record[change.field] = change.value;
      record[change.field + "UpdatedAt"] = change.time;
      next.papers[change.id] = record;
    }
    return next;
  }
  const api = {KEY, fields, empty, get, id, validate, toggle, exportMarkdown, parseMarkdown, plan, merge};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PaperReadingState = api;
})(globalThis);
