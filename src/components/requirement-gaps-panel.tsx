"use client";

import { useEffect, useState } from "react";
import type { RequirementGap } from "@/lib/types";

async function requestGaps(requirementCode: string) {
  const response = await fetch(`/api/v1/requirements/${encodeURIComponent(requirementCode)}/gaps`, { cache: "no-store" });
  const payload = await response.json() as { data?: RequirementGap[]; error?: string };
  if (!response.ok || !payload.data) throw new Error(payload.error || "无法读取待补充项。");
  return payload.data;
}

export function RequirementGapsPanel({ requirementCode }: { requirementCode: string }) {
  const [gaps, setGaps] = useState<RequirementGap[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const refresh = () => void requestGaps(requirementCode).then((items) => { if (active) { setGaps(items); setError(""); } }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "无法读取待补充项。"); });
    refresh();
    const onCreated = (event: Event) => {
      if ((event as CustomEvent<{ requirementCode?: string }>).detail?.requirementCode === requirementCode) refresh();
    };
    window.addEventListener("requirement-gap-created", onCreated);
    return () => { active = false; window.removeEventListener("requirement-gap-created", onCreated); };
  }, [requirementCode]);

  return <section className="requirement-gaps"><header><div><small>PRD 缺口</small><h2>待明确问题</h2></div><span>{gaps.length} 项</span></header>{error ? <p className="requirement-gaps-error">{error}</p> : gaps.length ? <ul>{gaps.map((gap) => <li key={gap.id}><b>{gap.question}</b><small>由 {gap.createdBy} 于 {gap.createdAt} 提出</small></li>)}</ul> : <p>暂无待明确问题。智能体识别到 PRD 未定义时，可直接添加到这里。</p>}</section>;
}
