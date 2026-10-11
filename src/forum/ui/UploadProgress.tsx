import { useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import "./upload-progress.css";

export function capPercent(fraction: number) {
  return Math.min(99, Math.max(0, Math.floor(fraction * 100)));
}

export function UploadProgress({ percent, size = 13 }: { percent: number; size?: number }) {
  return (
    <span className="upload-progress">
      <LoaderCircle className="spin" size={size} />
      <b>{percent}%</b>
    </span>
  );
}

export function useUploadSession() {
  const entries = useRef(new Set<{ loaded: number; size: number }>());
  const pending = useRef(0);
  const [percent, setPercent] = useState(0);
  const publish = () => {
    let loaded = 0;
    let total = 0;
    entries.current.forEach((entry) => {
      loaded += entry.loaded;
      total += entry.size;
    });
    setPercent(total ? capPercent(loaded / total) : 0);
  };
  const begin = (files: File[]) =>
    files.map((file) => {
      const entry = { loaded: 0, size: Math.max(file.size, 1) };
      entries.current.add(entry);
      pending.current += 1;
      publish();
      return {
        progress: (fraction: number) => {
          entry.loaded = fraction * entry.size;
          publish();
        },
        done: () => {
          entry.loaded = entry.size;
          pending.current -= 1;
          if (!pending.current) entries.current.clear();
          publish();
        },
      };
    });
  return { percent, begin };
}
