import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Bookmark, Eye, Heart, Layers, MessageCircle, Radio, UserPlus } from "lucide-react";
import { GlassSegments } from "../ui/GlassSegments";
import { MotionCount } from "../motion/MicroInteraction";
import { api, type InsightMetric, type InsightSeries } from "../api";
import { InsightChart } from "./InsightChart";

export const metricInfo: Record<InsightMetric, { label: string; total: string; color: string; Icon: typeof Eye }> = {
  views: { label: "阅读", total: "阅读量", color: "#2a78d6", Icon: Eye },
  likes: { label: "点赞", total: "点赞量", color: "#eb6834", Icon: Heart },
  bookmarks: { label: "收藏", total: "收藏量", color: "#1baf7a", Icon: Bookmark },
  comments: { label: "评论", total: "评论量", color: "#eda100", Icon: MessageCircle },
  followers: { label: "关注", total: "关注量", color: "#e87ba4", Icon: UserPlus },
};

const ranges = [
  { id: "1d", label: "24 小时" },
  { id: "7d", label: "7 天" },
  { id: "30d", label: "30 天" },
  { id: "all", label: "全部时间" },
];
const POLL = 4000;

export function InsightPanel({
  endpoint,
  metrics,
  totalPrefix = "",
  onTotals,
}: {
  endpoint: string;
  metrics: InsightMetric[];
  totalPrefix?: string;
  onTotals?: (totals: InsightSeries["totals"]) => void;
}) {
  const [metric, setMetric] = useState<InsightMetric | "all">("views");
  const [range, setRange] = useState("all");
  const [data, setData] = useState<InsightSeries | null>(null);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const totalsRef = useRef(onTotals);
  totalsRef.current = onTotals;
  useEffect(() => {
    setData(null);
    setMetric("views");
  }, [endpoint]);
  useEffect(() => {
    let active = true;
    let timer = 0;
    let first = true;
    const load = () => {
      if (!first && document.visibilityState !== "visible") {
        timer = window.setTimeout(load, POLL);
        return;
      }
      first = false;
      api<InsightSeries>(`${endpoint}?range=${range}`)
        .then((r) => {
          if (!active) return;
          setData(r);
          setError("");
          setLive(true);
          totalsRef.current?.(r.totals);
        })
        .catch((e) => {
          if (!active) return;
          setError((e as Error).message);
          setLive(false);
        })
        .finally(() => {
          if (active) timer = window.setTimeout(load, POLL);
        });
    };
    load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [endpoint, range]);
  const shown = metric === "all" ? metrics : [metric];
  return (
    <section className="insight-panel" aria-label="数据概览">
      <div className="insight-tiles" style={{ "--tiles": metrics.length } as CSSProperties}>
        {metrics.map((id) => {
          const { total, Icon } = metricInfo[id];
          return (
            <button
              key={id}
              type="button"
              className={`insight-tile ${metric === id ? "is-active" : ""}`}
              aria-pressed={metric === id}
              onClick={() => setMetric(id)}
            >
              <span>
                <Icon size={14} />
                {totalPrefix}
                {total}
              </span>
              <strong>{data ? <MotionCount value={data.totals[id] ?? 0} /> : "—"}</strong>
            </button>
          );
        })}
      </div>
      <div className="insight-controls">
        <GlassSegments<InsightMetric | "all">
          className="insight-segs is-compact"
          label="选择折线图数据"
          value={metric}
          onChange={setMetric}
          items={[
            { id: "all", label: "全部", icon: <Layers size={14} /> },
            ...metrics.map((id) => {
              const { label, Icon } = metricInfo[id];
              return { id, label, icon: <Icon size={14} /> };
            }),
          ]}
        />
        <GlassSegments
          className="insight-segs insight-range is-compact"
          label="时间范围"
          value={range}
          onChange={setRange}
          items={ranges}
        />
      </div>
      <div className="insight-chart-card">
        <div className="insight-chart-head">
          <h4>
            {metric === "all" ? "全部数据" : metricInfo[metric].total}
            <small>{metric === "all" ? "累计增长对比" : "累计变化"}</small>
          </h4>
          <span className={`insight-live ${live ? "is-live" : ""}`} title="每 4 秒自动刷新">
            <Radio size={13} />
            {live ? "实时" : "连接中"}
          </span>
        </div>
        {error && !data ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : data ? (
          <InsightChart
            label={`${shown.map((id) => metricInfo[id].total).join("、")}折线图`}
            times={data.times}
            indexed={metric === "all"}
            series={shown.map((id) => ({
              id,
              label: metricInfo[id].total,
              color: metricInfo[id].color,
              values: data.series[id] || [],
            }))}
          />
        ) : (
          <div className="insight-chart-skeleton" aria-label="正在加载数据" />
        )}
      </div>
    </section>
  );
}
