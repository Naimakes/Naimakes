import type { TextareaHTMLAttributes } from "react";

export function LineField({
  onValue,
  className = "",
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "rows"> & {
  onValue: (value: string) => void;
}) {
  return (
    <textarea
      {...props}
      rows={1}
      className={`line-field ${className}`.trim()}
      onChange={(e) => onValue(e.target.value.replace(/\s*\n\s*/g, " "))}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.currentTarget.form?.requestSubmit();
        }
      }}
    />
  );
}
