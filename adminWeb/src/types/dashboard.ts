export interface Kpi {
  key: string;
  label: string;
  value: string;
  sub: string;
  delta: string;
  /** Whether the movement is good news — not whether the number rose. */
  good: boolean;
}

export interface SlaBreakdown {
  ok: number;
  warn: number;
  breach: number;
}

export interface FunnelStage {
  n: string;
  label: string;
}

export interface AttentionItem {
  key: string;
  title: string;
  sub: string;
  count: string;
  to: string;
  tone: "danger" | "ai" | "warn" | "info";
}

export interface DashboardSummary {
  kpis: Kpi[];
  sla: SlaBreakdown;
  funnel: FunnelStage[];
  attention: AttentionItem[];
}
