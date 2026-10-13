// OpenAI 兼容接口（/chat/completions）的客户端：DeepSeek 原生接口、OpenAI、通义千问、Kimi 等都用这一种格式。
// 对外提供和 Anthropic SDK 用法相近的两件事：messages.create 一次性生成，run 流式回答并执行工具。
// 助手其余部分仍按 Anthropic 的消息格式（system、content 块、tools 的 input_schema）组织参数，这里负责转换。

export class CompatError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

const finishReasons = { stop: "end_turn", length: "max_tokens", tool_calls: "tool_use", function_call: "tool_use", content_filter: "refusal" };

export function createCompatClient({ apiKey, baseURL, dialect: given, timeout = 120000, reasoning = true }) {
  const base = String(baseURL).replace(/\/+$/, "");
  const host = (() => {
    try {
      return new URL(base).hostname;
    } catch {
      return "";
    }
  })();
  // 几家在参数上的差别：DeepSeek 要传回 reasoning_content、用 thinking 开关思考；OpenAI 用 max_completion_tokens。
  const dialect = given || (host.endsWith("deepseek.com") ? "deepseek" : host === "api.openai.com" ? "openai" : "generic");
  const url = base + "/chat/completions";

  const part = (block) => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "image") return { type: "image_url", image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } };
    if (block.type === "document") {
      const file_data = `data:${block.source.media_type || "application/pdf"};base64,${block.source.data}`;
      return dialect === "deepseek" ? { type: "file", filename: block.title || "file.pdf", file_data } : { type: "file", file: { filename: block.title || "file.pdf", file_data } };
    }
    return null;
  };

  function chatMessages(system, messages) {
    const out = [];
    const text = typeof system === "string" ? system : (system || []).map((b) => b.text).join("\n\n");
    if (text) out.push({ role: "system", content: text });
    for (const m of messages) {
      if (typeof m.content === "string") {
        // DeepSeek 在带工具的请求里要求每条助手消息都带 reasoning_content；之前几轮的思考内容没有保存，传空的。
        out.push({ role: m.role, content: m.content, ...(m.role === "assistant" && dialect === "deepseek" ? { reasoning_content: "" } : {}) });
        continue;
      }
      const parts = m.content.map(part).filter(Boolean);
      out.push({ role: m.role, content: m.role === "user" ? parts : parts.map((p) => p.text || "").join("") });
    }
    return out;
  }

  function body(params, messages, stream) {
    const out = {
      model: params.model,
      messages,
      [dialect === "openai" ? "max_completion_tokens" : "max_tokens"]: params.max_tokens,
      stream,
    };
    if (params.tools?.length)
      out.tools = params.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    if (params.thinking?.type === "disabled") {
      if (dialect === "deepseek") out.thinking = { type: "disabled" };
    } else if (reasoning && params.output_config?.effort) {
      const effort = params.output_config.effort;
      // DeepSeek 自己会把 low…max 映射到它支持的档位；其他家一般只认 low / medium / high。
      out.reasoning_effort = dialect === "deepseek" ? effort : effort === "xhigh" || effort === "max" ? "high" : effort;
    }
    return out;
  }

  // 发起请求；连接失败、限流和服务端错误各重试一次。超时按「多久没有收到数据」计算，长回答不会被掐断。
  async function post(payload, signal) {
    for (let attempt = 0; ; attempt++) {
      const abort = new AbortController();
      const stop = () => abort.abort();
      signal?.addEventListener("abort", stop, { once: true });
      let timer = setTimeout(stop, timeout);
      const alive = () => {
        clearTimeout(timer);
        timer = setTimeout(stop, timeout);
      };
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
      };
      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { authorization: "Bearer " + apiKey, "content-type": "application/json", accept: payload.stream ? "text/event-stream" : "application/json" },
          body: JSON.stringify(payload),
          signal: abort.signal,
        });
      } catch (error) {
        done();
        if (signal?.aborted) throw error;
        if (attempt < 1) continue;
        throw new CompatError(abort.signal.aborted ? "请求超时" : "连接失败：" + (error?.cause?.code || error?.message || error), 0);
      }
      if (response.ok) return { response, alive, done };
      const text = await response.text().catch(() => "");
      done();
      if (attempt < 1 && (response.status === 429 || response.status >= 500)) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      let message = text.slice(0, 300);
      try {
        const data = JSON.parse(text);
        message = data?.error?.message || data?.message || message;
      } catch {}
      throw new CompatError(message || "HTTP " + response.status, response.status);
    }
  }

  async function* events(response, alive) {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      alive();
      buffer += decoder.decode(chunk, { stream: true });
      let cut;
      while ((cut = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, "");
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        if (data === "[DONE]") return;
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        if (event.error) throw new CompatError(event.error.message || "接口返回了错误", event.error.code === "rate_limit_exceeded" ? 429 : 500);
        yield event;
      }
    }
  }

  // 一轮流式回答：文字边到边交给 onText，最后返回完整的文字、思考内容和工具调用。
  async function turn(payload, signal, onText) {
    const { response, alive, done } = await post(payload, signal);
    const calls = [];
    let content = "";
    let thought;
    let finish = null;
    try {
      for await (const event of events(response, alive)) {
        const choice = event.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta || {};
        if (typeof delta.reasoning_content === "string") thought = (thought || "") + delta.reasoning_content;
        if (typeof delta.content === "string" && delta.content) {
          content += delta.content;
          onText(delta.content);
        }
        for (const [i, call] of (delta.tool_calls || []).entries()) {
          const slot = (calls[call.index ?? i] ||= { id: "", name: "", arguments: "" });
          if (call.id) slot.id = call.id;
          if (call.function?.name) slot.name += call.function.name;
          if (call.function?.arguments) slot.arguments += call.function.arguments;
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
    } finally {
      done();
    }
    return { content, thought, calls: calls.filter((c) => c && c.name).map((c, i) => ({ ...c, id: c.id || `call_${Date.now().toString(36)}_${i}` })), finish };
  }

  async function runTool(tools, call) {
    const tool = tools.get(call.name);
    if (!tool) return `Error: 没有名为 ${call.name} 的工具。`;
    let raw;
    try {
      raw = call.arguments.trim() ? JSON.parse(call.arguments) : {};
    } catch {
      return "Error: 工具参数不是合法的 JSON，请重新调用。";
    }
    try {
      const input = tool.parse ? tool.parse(raw) : raw;
      const result = await tool.run(input, { toolUse: { id: call.id, name: call.name, input } });
      return typeof result === "string" ? result : JSON.stringify(result);
    } catch (error) {
      return "Error: " + (error?.message || String(error));
    }
  }

  // 之前几轮对话压成一段记录，放进最后一个问题里。DeepSeek 拒绝缺少思考内容的历史消息时用它重试。
  function flatten(messages) {
    const system = messages.filter((m) => m.role === "system");
    const rest = messages.filter((m) => m.role !== "system");
    const last = rest[rest.length - 1];
    const earlier = rest.slice(0, -1).map((m) => `${m.role === "user" ? "用户" : "助手"}：${typeof m.content === "string" ? m.content : ""}`);
    if (!earlier.length) return null;
    const note = `<earlier_conversation>\n${earlier.join("\n\n")}\n</earlier_conversation>\n\n`;
    const content = typeof last.content === "string" ? note + last.content : [{ type: "text", text: note }, ...last.content];
    return [...system, { role: "user", content }];
  }

  return {
    dialect,
    messages: {
      async create(params, { signal } = {}) {
        const { response, done } = await post(body(params, chatMessages(params.system, params.messages), false), signal);
        let data;
        try {
          data = await response.json();
        } finally {
          done();
        }
        const choice = data?.choices?.[0];
        return { content: [{ type: "text", text: choice?.message?.content || "" }], stop_reason: finishReasons[choice?.finish_reason] || "end_turn" };
      },
    },

    // 跑完整个回答：模型要调用工具就执行，再把结果交回去，直到模型答完或用完 max_iterations 轮。
    async run(params, signal, onText) {
      const tools = new Map((params.tools || []).map((t) => [t.name, t]));
      let messages = chatMessages(params.system, params.messages);
      let wrote = false;
      for (let round = 0; round < (params.max_iterations || 10); round++) {
        let gap = wrote;
        const write = (text) => {
          onText((gap ? "\n\n" : "") + text);
          gap = false;
          wrote = true;
        };
        let result;
        try {
          result = await turn(body(params, messages, true), signal, write);
        } catch (error) {
          const retry = round === 0 && dialect === "deepseek" && error instanceof CompatError && error.status === 400 && /reasoning/i.test(error.message) && flatten(messages);
          if (!retry) throw error;
          messages = retry;
          result = await turn(body(params, messages, true), signal, write);
        }
        if (!result.calls.length) return { stop_reason: finishReasons[result.finish] || "end_turn" };
        messages.push({
          role: "assistant",
          content: result.content || null,
          ...(result.thought !== undefined || dialect === "deepseek" ? { reasoning_content: result.thought || "" } : {}),
          tool_calls: result.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments || "{}" } })),
        });
        for (const call of result.calls) messages.push({ role: "tool", tool_call_id: call.id, content: await runTool(tools, call) });
      }
      return { stop_reason: "tool_use" };
    },
  };
}
