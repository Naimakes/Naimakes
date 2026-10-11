import { LiquidButton } from "../motion/LiquidButton";
import { type ReactNode } from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { ModalRegistration as Modal } from "../motion/OverlayHost";

export default function Confirm({
  title,
  heading,
  description,
  confirmLabel,
  cancelLabel = "取消",
  busy = false,
  icon,
  tone = "danger",
  onConfirm,
  onClose,
}: {
  title: string;
  heading: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string | null;
  busy?: boolean;
  icon?: ReactNode;
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} className="confirm-modal">
      <div className="confirm-body">
        <span className="confirm-icon">
          {icon || <AlertTriangle size={22} strokeWidth={1.6} />}
        </span>
        <h2>{heading}</h2>
        <p>{description}</p>
      </div>
      <div className="confirm-actions">
        {cancelLabel !== null && (
          <LiquidButton type="button" className="button secondary" onClick={onClose}>
            {cancelLabel}
          </LiquidButton>
        )}
        <LiquidButton
          type="button"
          className={"button " + tone}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy && <LoaderCircle size={15} className="spin" />}
          {confirmLabel}
        </LiquidButton>
      </div>
    </Modal>
  );
}
