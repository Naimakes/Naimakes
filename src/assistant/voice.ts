import { useCallback, useEffect, useRef, useState } from "react";

// 语音输入用浏览器自带的语音识别（Chrome、Edge、Safari 支持），识别在浏览器或系统服务里完成，本站不保存录音。
type Result = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<Result> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type Constructor = new () => Recognition;

const constructor = (): Constructor | null => {
  const w = window as unknown as { SpeechRecognition?: Constructor; webkitSpeechRecognition?: Constructor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

export const voiceSupported = () => typeof window !== "undefined" && !!constructor();

const errors: Record<string, string> = {
  "not-allowed": "没有麦克风权限，请在浏览器地址栏旁允许使用麦克风。",
  "service-not-allowed": "没有麦克风权限，请在浏览器设置里允许使用麦克风。",
  "audio-capture": "没有检测到麦克风。",
  network: "语音识别需要联网，请检查网络后重试。",
  "language-not-supported": "当前浏览器不支持这种语言的语音输入。",
};

/**
 * 听写：把识别出的文字接在开始听写时输入框里已有的文字后面，边说边显示。
 * `onText` 每次收到完整的新内容；`onError` 收到可以直接展示的中文说明。
 */
export function useVoiceInput({ onText, onError }: { onText: (text: string) => void; onError: (message: string) => void }) {
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const handlers = useRef({ onText, onError });
  handlers.current = { onText, onError };

  const stop = useCallback(() => {
    recognition.current?.stop();
  }, []);

  const start = useCallback((base: string) => {
    const Speech = constructor();
    if (!Speech) return handlers.current.onError("当前浏览器不支持语音输入，可以换用 Chrome、Edge 或 Safari。");
    if (recognition.current) return;
    const instance = new Speech();
    instance.lang = /^zh/i.test(navigator.language) || !navigator.language ? "zh-CN" : navigator.language;
    instance.continuous = true;
    instance.interimResults = true;
    const gap = base && !/\s$/.test(base) ? " " : "";
    let finished = "";
    instance.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) finished += piece;
        else interim += piece;
      }
      handlers.current.onText(base + gap + finished + interim);
    };
    instance.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      handlers.current.onError(errors[event.error] || "语音输入出了点问题，请重试。");
    };
    instance.onend = () => {
      recognition.current = null;
      setListening(false);
    };
    recognition.current = instance;
    try {
      instance.start();
      setListening(true);
    } catch {
      recognition.current = null;
      handlers.current.onError("语音输入暂时无法开始，请稍后再试。");
    }
  }, []);

  useEffect(() => () => recognition.current?.abort(), []);
  return { listening, start, stop };
}
