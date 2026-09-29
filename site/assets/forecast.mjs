const HOUR = 60 * 60 * 1000;
const GLOBAL_TYPES = new Set(["global", "global_and_banked"]);
const FINISHED_INCIDENTS = new Set(["resolved", "postmortem"]);

function time(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function eventTime(record) {
  return time(record.completedAt) ?? time(record.effectiveAt) ?? time(record.announcedAt) ?? 0;
}

function isRelevantIncident(incident) {
  return /codex|chatgpt work/i.test(incident.name ?? "");
}

export function evaluate(snapshot, now = new Date(), horizonHours = 48) {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(horizonHours) || horizonHours <= 0) {
    throw new TypeError("Invalid forecast time or horizon");
  }
  if (snapshot?.schemaVersion !== 1 || !Array.isArray(snapshot.records)) {
    return { available: false, headline: "暂无可用数据", score: null };
  }

  const horizonEnd = nowMs + horizonHours * HOUR;
  const recordCheck = time(snapshot.sources?.recordsLastSuccessfulCheckAt);
  const fetched = time(snapshot.checkedAt);
  const freshestReliableTime = Math.min(
    fetched ?? Number.POSITIVE_INFINITY,
    recordCheck ?? Number.POSITIVE_INFINITY,
  );
  const ageHours = Number.isFinite(freshestReliableTime)
    ? (nowMs - freshestReliableTime) / HOUR
    : Number.POSITIVE_INFINITY;
  const stale = ageHours > 6 || ageHours < -0.25;

  const globalRecords = snapshot.records.filter((record) => GLOBAL_TYPES.has(record.resetType));
  const scheduled = globalRecords
    .filter((record) => record.kind === "reset_scheduled" && record.scheduleState === "pending")
    .filter((record) => {
      const start = time(record.scheduleWindow?.startAt);
      const end = time(record.scheduleWindow?.endAt);
      return start !== null && end !== null && start <= horizonEnd && end >= nowMs;
    })
    .sort((a, b) => time(a.scheduleWindow.startAt) - time(b.scheduleWindow.startAt));

  const completed = globalRecords
    .filter((record) => record.kind === "reset_completed" && eventTime(record) <= nowMs)
    .sort((a, b) => eventTime(b) - eventTime(a));
  const latestCompleted = completed[0] ?? null;
  const hoursSinceReset = latestCompleted ? (nowMs - eventTime(latestCompleted)) / HOUR : null;

  const activeIncidents = (snapshot.incidents ?? [])
    .filter(isRelevantIncident)
    .filter((incident) => !FINISHED_INCIDENTS.has(incident.status));

  let score = 10;
  let headline = `未来 ${horizonHours} 小时暂无公开排期`;
  let tone = "quiet";
  const reasons = ["无公开排期时，以 10 分作为中性起点。"];

  if (scheduled.length > 0) {
    const primary = scheduled[0];
    score = primary.scheduleBasis === "contextual_inference" ? 65 : 80;
    if (primary.schedulePrecision === "datetime") score += 8;
    if ((time(primary.scheduleWindow.endAt) - time(primary.scheduleWindow.startAt)) > 72 * HOUR) {
      score -= 5;
    }
    score = Math.min(95, Math.max(0, score));
    headline = "公开排期覆盖预测窗口";
    tone = "announced";
    reasons.length = 0;
    reasons.push(primary.scheduleBasis === "contextual_inference"
      ? "公开内容推断出排期：65 分起。"
      : "有明确公开排期：80 分起。");
    if (primary.schedulePrecision === "datetime") reasons.push("精确到时刻：+8 分。");
    if ((time(primary.scheduleWindow.endAt) - time(primary.scheduleWindow.startAt)) > 72 * HOUR) {
      reasons.push("时间窗口超过 72 小时：−5 分。");
    }
  } else {
    if (hoursSinceReset !== null && hoursSinceReset < 48) {
      score -= 6;
      reasons.push("最近 48 小时有已确认重置：−6 分。");
    }
    if (activeIncidents.length > 0) {
      score += 5;
      tone = "watch";
      headline = "有服务事件，暂无重置公告";
      reasons.push("Codex / Work 有未解决服务事件：+5 分；故障不代表一定重置。");
    }
  }

  return {
    available: true,
    horizonHours,
    score,
    headline,
    tone,
    stale,
    ageHours,
    scheduled: scheduled[0] ?? null,
    latestCompleted,
    activeIncidents,
    reasons,
  };
}
