import { BrandMark } from "../layout/BrandMark";
export function LoadingPopup() {
  return (
    <div className="loading-popup" role="status" aria-live="polite" aria-label="正在加载">
      <div className="loading-popup-card">
        <BrandMark />
        <div className="loading-popup-line" aria-hidden="true" />
      </div>
    </div>
  );
}
