import { LiquidButton } from "../motion/LiquidButton";
import { useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { ModalRegistration as Modal } from "../motion/OverlayHost";
import GlassDateTime from "../ui/GlassDateTime";
import { GlassSegments } from "../ui/GlassSegments";
import {
  defaultFeedFilters,
  feedCommentFilters,
  feedRanges,
  feedSorts,
  filtersSummary,
  windowInvalid,
  type FeedFilters,
} from "./feed-filters";

function nowLocal() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function Row({
  label,
  options,
  value,
  onPick,
  columns,
  children,
}: {
  label: string;
  options: { id: string; label: string }[];
  value: string;
  onPick: (id: string) => void;
  columns?: number;
  children?: ReactNode;
}) {
  return (
    <section className="filter-row">
      <h3>{label}</h3>
      <GlassSegments<string>
        className="filter-segs"
        label={label}
        value={value}
        onChange={onPick}
        columns={columns}
        items={options.map((option) => ({ id: option.id, label: option.label }))}
      />
      {children}
    </section>
  );
}

export default function FeedFilterDialog({
  filters,
  onApply,
  onClose,
}: {
  filters: FeedFilters;
  onApply: (next: FeedFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<FeedFilters>(filters);
  const patch = (part: Partial<FeedFilters>) =>
    setDraft((d) => ({ ...d, ...part }));
  const invalid = windowInvalid(draft);
  const max = nowLocal();
  const hint = feedSorts.find((s) => s.id === draft.sort)?.hint || "";
  return (
    <Modal title="排序与筛选" onClose={onClose} className="feed-filter-modal">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) onApply(draft);
        }}
      >
        <Row
          label="排序方式"
          options={feedSorts}
          value={draft.sort}
          onPick={(sort) => patch({ sort })}
        />
        <Row
          label="发布时间"
          options={feedRanges}
          columns={3}
          value={draft.range}
          onPick={(range) => patch({ range })}
        >
          {draft.range === "custom" && (
            <div className="filter-date-range">
              <div className="filter-date-field">
                <span>开始</span>
                <GlassDateTime
                  label="开始时间"
                  value={draft.from}
                  max={max}
                  fallbackTime="00:00"
                  onChange={(from) => patch({ from })}
                />
              </div>
              <span aria-hidden="true">至</span>
              <div className="filter-date-field">
                <span>结束</span>
                <GlassDateTime
                  label="结束时间"
                  value={draft.to}
                  max={max}
                  fallbackTime="23:59"
                  onChange={(to) => patch({ to })}
                />
              </div>
            </div>
          )}
          {draft.range === "custom" && (
            <p className={"filter-note" + (invalid ? " filter-invalid" : "")}>
              {invalid
                ? "开始时间需早于结束时间。"
                : "两端都可以留空，只填一个即表示「之后」或「之前」。"}
            </p>
          )}
        </Row>
        <Row
          label="留言数量"
          options={feedCommentFilters}
          value={draft.comments}
          onPick={(comments) => patch({ comments })}
        />
        <div className="filter-summary">
          <span>当前规则</span>
          <b>{filtersSummary(draft)}</b>
          {hint && <small>{hint}</small>}
        </div>
        <div className="filter-actions">
          <LiquidButton
            type="button"
            className="text-button"
            onClick={() => setDraft(defaultFeedFilters)}
          >
            <RotateCcw size={14} />
            重置
          </LiquidButton>
          <div>
            <LiquidButton type="button" className="button secondary" onClick={onClose}>
              取消
            </LiquidButton>
            <LiquidButton type="submit" className="button primary" disabled={invalid}>
              确定
            </LiquidButton>
          </div>
        </div>
      </form>
    </Modal>
  );
}
