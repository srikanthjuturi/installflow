export interface Kpi {
  key: string;
  label: string;
  value: string;
  sub: string;
  /**
   * The movement chip — OPTIONAL, and currently never set.
   *
   * A delta is the same count as it stood earlier, and nothing records that:
   * there is no snapshot table, and today's rows cannot answer it because a
   * ticket closed on Tuesday was open on Monday and leaves no trace of having
   * been. The approved design draws a chip here; it stays empty rather than
   * carrying a percentage with no source, which is the one thing the house rule
   * forbids outright.
   *
   * The field survives so the tile needs no rework when something real backs it.
   */
  delta?: string;
  /** Whether the movement is good news — not whether the number rose. */
  good?: boolean;
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
  /**
   * The ticket board, carrying whatever this dashboard is narrowed to.
   *
   * Composed once beside the attention links rather than in each card, so every
   * route off this screen keeps its scope — a "View all" that quietly widened
   * back to the whole country would answer a question nobody asked.
   */
  ticketsHref: string;
}
