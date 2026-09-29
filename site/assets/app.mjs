import { evaluate } from "./forecast.mjs";

const el = (id) => document.getElementById(id);
const state = { snapshot: null };
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});

function dateMs(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(value) {
  const parsed = dateMs(value);
  return parsed === null ? "时间未明确" : dateFormatter.format(parsed);
}

function formatWindow(record) {
  const start = record?.scheduleWindow?.startAt;
  const end = record?.scheduleWindow?.endAt;
  if (!start || !end) return "时间未明确";
  if (start === end) return formatDate(start);
  return `${formatDate(start)} — ${formatDate(end)}`;
}

function relativeTime(value) {
  const parsed = dateMs(value);
  if (parsed === null) return "更新时间未知";
  const minutes = Math.max(0, Math.round((Date.now() - parsed) / 60000));
  if (minutes < 2) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["x.com", "twitter.com", "status.openai.com"].includes(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function sourceLink(url, label) {
  const safe = safeSourceUrl(url);
  if (!safe) return null;
  const link = document.createElement("a");
  link.href = safe;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  return link;
}

function setText(id, value) { el(id).textContent = value; }

function serviceDescription(value) {
  return value === "All Systems Operational" ? "所有服务运行正常" : value ?? "未知";
}

function addEvidence(list, { title, detail, icon, color = "neutral", linkUrl, linkLabel }) {
  const item = document.createElement("article");
  item.className = "evidence-item";
  const badge = document.createElement("span");
  badge.className = `signal-icon ${color}`;
  badge.setAttribute("aria-hidden", "true");
  badge.textContent = icon;
  const copy = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = detail;
  copy.append(heading, paragraph);
  const link = sourceLink(linkUrl, linkLabel ?? "查看原始来源 ↗");
  if (link) copy.append(link);
  item.append(badge, copy);
  list.append(item);
}

function renderEvidence(result, snapshot) {
  const list = el("evidence-list");
  list.replaceChildren();
  if (result.scheduled) {
    addEvidence(list, {
      title: "找到覆盖未来 48 小时的公开排期",
      detail: `${formatWindow(result.scheduled)} · ${result.scheduled.schedulePrecision === "date" ? "仅精确到日期" : "精确到时刻"}`,
      icon: "↗", color: "green", linkUrl: result.scheduled.source?.url,
    });
  } else {
    addEvidence(list, {
      title: "没有覆盖未来 48 小时的公开排期",
      detail: "这只表示当前数据源未记录到明确排期，不能证明不会重置。",
      icon: "—",
    });
  }
  if (result.latestCompleted) {
    addEvidence(list, {
      title: "最近一次确认的全局重置",
      detail: `${formatDate(result.latestCompleted.completedAt ?? result.latestCompleted.effectiveAt ?? result.latestCompleted.announcedAt)} · ${relativeTime(result.latestCompleted.completedAt ?? result.latestCompleted.effectiveAt ?? result.latestCompleted.announcedAt)}`,
      icon: "↺", linkUrl: result.latestCompleted.source?.url,
    });
  }
  if (result.activeIncidents.length > 0) {
    const incident = result.activeIncidents[0];
    addEvidence(list, {
      title: "相关服务事件仍在处理中",
      detail: `${incident.name} · ${incident.status}`,
      icon: "!", color: "amber", linkUrl: incident.url,
    });
  } else {
    addEvidence(list, {
      title: "暂无未解决的相关服务事件",
      detail: `OpenAI 状态：${serviceDescription(snapshot.status?.description)}。服务状态仅作为背景信息。`,
      icon: "●", linkUrl: "https://status.openai.com/", linkLabel: "查看状态页 ↗",
    });
  }
  setText("evidence-count", `${list.children.length} 条`);
}

function recordTitle(record) {
  const type = record.resetType === "banked" ? "重置卡" : record.resetType === "global_and_banked" ? "全局重置 + 重置卡" : "全局重置";
  if (record.kind === "reset_completed") return `已确认 · ${type}`;
  const phase = record.scheduleState === "fulfilled" ? "已兑现" : record.scheduleState === "elapsed" ? "窗口已过" : "已排期";
  return `${phase} · ${type}`;
}

function renderHistory(snapshot) {
  const list = el("history-list");
  list.replaceChildren();
  const records = [...snapshot.records]
    .sort((a, b) => (dateMs(b.announcedAt ?? b.completedAt ?? b.effectiveAt) ?? 0)
      - (dateMs(a.announcedAt ?? a.completedAt ?? a.effectiveAt) ?? 0))
    .slice(0, 5);
  if (!records.length) {
    const empty = document.createElement("p");
    empty.className = "empty-note";
    empty.textContent = "暂无公开记录。";
    list.append(empty);
    return;
  }
  for (const record of records) {
    const item = document.createElement("article");
    item.className = "history-item";
    const dot = document.createElement("span");
    dot.className = `history-marker${record.resetType === "banked" ? " banked" : ""}`;
    dot.setAttribute("aria-hidden", "true");
    const body = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = recordTitle(record);
    const description = document.createElement("p");
    const summary = (record.text ?? "").replace(/\s+/g, " ").trim() || "暂无公开摘要";
    description.textContent = summary.length > 125 ? `${summary.slice(0, 125)}…` : summary;
    body.append(title, description);
    const link = sourceLink(record.source?.url, " 原帖 ↗");
    if (link) description.append(link);
    const timestamp = document.createElement("time");
    const stamp = record.announcedAt ?? record.completedAt ?? record.effectiveAt;
    if (stamp) timestamp.dateTime = stamp;
    timestamp.textContent = formatDate(stamp);
    item.append(dot, body, timestamp);
    list.append(item);
  }
}

function renderFacts(result, snapshot) {
  const pending = snapshot.records
    .filter((record) => record.kind === "reset_scheduled" && record.scheduleState === "pending")
    .filter((record) => ["global", "global_and_banked"].includes(record.resetType))
    .filter((record) => (dateMs(record.scheduleWindow?.endAt) ?? 0) >= Date.now())
    .sort((a, b) => (dateMs(a.scheduleWindow?.startAt) ?? 0) - (dateMs(b.scheduleWindow?.startAt) ?? 0))[0];
  setText("schedule-value", pending ? formatWindow(pending) : "暂无明确排期");
  setText("schedule-detail", pending
    ? (pending.schedulePrecision === "date" ? "日期范围，具体时刻未知" : "已公布具体时刻")
    : "来自公开信号记录");
  const last = result.latestCompleted;
  setText("last-reset-value", last ? formatDate(last.completedAt ?? last.effectiveAt ?? last.announcedAt) : "暂无记录");
  setText("last-reset-detail", last
    ? (last.scope?.plans?.includes("all") ? "记录标注：全部套餐" : "具体适用范围请查看来源")
    : "无法据此推算下一次重置");
  const indicator = snapshot.status?.indicator;
  setText("service-value", indicator === "none" ? "运行正常" : serviceDescription(snapshot.status?.description));
  setText("service-detail", result.activeIncidents.length > 0
    ? `${result.activeIncidents.length} 条相关事件未解决`
    : "官方状态页 · 仅供参考");
}

function render(snapshot) {
  const result = evaluate(snapshot, new Date(), 48);
  if (!result.available) throw new Error("Invalid snapshot data");
  const checkedAt = snapshot.checkedAt;
  setText("data-status", result.stale ? `数据较旧 · ${relativeTime(checkedAt)}` : `最近抓取 · ${relativeTime(checkedAt)}`);
  el("status-dot").classList.toggle("stale", result.stale);
  el("stale-banner").hidden = !result.stale;
  setText("forecast-headline", result.headline);
  setText("forecast-tag", result.tone === "announced" ? "有公开排期" : result.tone === "watch" ? "关注服务状态" : "暂无明确排期");
  el("forecast-tag").className = `tiny-pill ${result.tone}`;
  setText("forecast-detail", result.scheduled
    ? `已公布的时间范围为 ${formatWindow(result.scheduled)}。排期可能变化，是否到账仍以账号用量页面为准。`
    : "目前未发现指向未来 48 小时的明确全局重置排期。新公告出现后，分数会随数据更新。");
  setText("score-value", String(result.score));
  el("score-gauge").style.setProperty("--score", result.score);
  el("score-gauge").setAttribute("aria-label", `线索指数 ${result.score} 分，满分 100 分；这不是发生概率`);
  const reasonList = el("reason-list");
  reasonList.replaceChildren();
  for (const reason of result.reasons) {
    const item = document.createElement("li");
    item.textContent = reason;
    reasonList.append(item);
  }
  renderEvidence(result, snapshot);
  renderFacts(result, snapshot);
  renderHistory(snapshot);
}

async function loadSnapshot() {
  const button = el("refresh-button");
  button.disabled = true;
  el("error-banner").hidden = true;
  try {
    const response = await fetch(`./data/snapshot.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const snapshot = await response.json();
    render(snapshot);
    state.snapshot = snapshot;
  } catch (error) {
    if (!state.snapshot) {
      el("error-banner").hidden = false;
      setText("data-status", "数据不可用");
      setText("forecast-headline", "暂时无法读取预测");
      setText("forecast-detail", "请稍后刷新，或直接查看公开来源。 ");
    } else {
      el("error-banner").textContent = "最新数据读取失败，当前仍显示上次成功读取的结果。";
      el("error-banner").hidden = false;
    }
    console.error("Snapshot load failed", error);
  } finally {
    button.disabled = false;
  }
}

el("refresh-button").addEventListener("click", loadSnapshot);
setInterval(() => { if (state.snapshot) render(state.snapshot); }, 60_000);
loadSnapshot();
