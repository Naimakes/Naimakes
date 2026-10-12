import { ShapeThumb } from "./ShapeThumb";
import "./assistant-agents.css";

type Look = { shape: string; color: string; name?: string };

// 智能体的头像：一个小圆盘里放着它的形状。
export function AgentAvatar({ agent, size = 36, className = "" }: { agent: Look; size?: number; className?: string }) {
  return (
    <span className={"agent-avatar " + className} style={{ width: size, height: size }} title={agent.name}>
      <ShapeThumb shape={agent.shape} color={agent.color} size={Math.round(size * 0.74)} />
    </span>
  );
}

// 单聊是一个头像；群聊把两三个头像拼在同一个方块里。
export function AgentCluster({ agents, size = 40 }: { agents: Look[]; size?: number }) {
  const list = agents.slice(0, 3);
  if (list.length <= 1) return <AgentAvatar agent={list[0] ?? { shape: "blob", color: "gray" }} size={size} />;
  const sub = Math.round(size * (list.length === 2 ? 0.68 : 0.58));
  const far = size - sub;
  const spots = list.length === 2 ? [[0, 0], [far, far]] : [[Math.round(far / 2), 0], [0, far], [far, far]];
  return (
    <span className="agent-cluster" style={{ width: size, height: size }} title={list.map((a) => a.name).filter(Boolean).join("、")}>
      {list.map((agent, i) => (
        <span key={i} className="agent-cluster-item" style={{ left: spots[i][0], top: spots[i][1] }}>
          <AgentAvatar agent={agent} size={sub} />
        </span>
      ))}
    </span>
  );
}
