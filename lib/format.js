export function formatHealth(value) {
  if (!value?.ok) return `oryx health FAIL: ${value?.error || "unknown"}`;
  return `oryx health OK (${value.status ?? ""})`;
}

export function formatChannels(value) {
  if (!value?.ok) return `oryx channels FAIL: ${value?.error || "unknown"}`;
  const rows = Array.isArray(value.data) ? value.data : [];
  if (!rows.length) return "oryx channels: (none)";
  return rows
    .map((c) => `- ${c.name} type=${c.type} agent=${c.agent ?? "-"} enabled=${c.enabled}`)
    .join("\n");
}

export function formatStatus(value) {
  if (!value?.ok) return `oryx im status FAIL: ${value?.error || "unknown"}`;
  const rows = Array.isArray(value.data) ? value.data : [];
  if (!rows.length) return "oryx im status: (none)";
  return rows
    .map((s) => `- ${s.name} [${s.state ?? "?"}] type=${s.type ?? "-"} agent=${s.agent ?? "-"}`)
    .join("\n");
}

export function formatNotify(value) {
  if (!value?.ok) return `oryx notify list FAIL: ${value?.error || "unknown"}`;
  const rows = Array.isArray(value.data) ? value.data : [];
  if (!rows.length) return "oryx notify channels: (none)";
  return rows.map((c) => `- ${c.name} type=${c.type}`).join("\n");
}

export function formatInvoke(value) {
  if (!value?.ok) return `oryx invoke FAIL: ${value?.error || "unknown"}`;
  const tid = value.traceId ? ` (trace ${value.traceId})` : "";
  return `oryx[${value.agent}]${tid}:\n${value.reply || "(empty)"}`;
}
