import { lazy, Suspense, useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { LiquidButton } from "../motion/LiquidButton";
import { FluidTabs } from "../motion/FluidTabs";
import { useMotionPreferences } from "../motion/motion-preferences";
import { transitions } from "../motion/motion-tokens";
import { atomTopics } from "./atom-topics";
const Orbital = lazy(() => import("./AtomOrbital"));
export default function HomeExperience({ welcome = false, onDiscover, onBoard, onExplore }: { welcome?: boolean; onDiscover: () => void; onBoard: (id: string) => void; onExplore: () => void }) {
  const [selected, setSelected] = useState(0);
  const { reduced } = useMotionPreferences();
  const reveal = reduced ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: transitions.responsive };
  return <div className="home-page is-single-screen">
    <section className="home-intro" aria-label={welcome ? "首页：欢迎来到 Naimakes 论坛" : "首页：下一种可能"}>
      <div className="home-hero-pin">
        <div className="home-hero-type">
          <motion.h1 key={welcome ? "welcome" : "idea"} {...reveal}>{welcome ? <>欢迎来到<br/><span>Naimakes 论坛。</span></> : <>从一个想法，<br/><span>到下一种可能。</span></>}</motion.h1>
          <p>连接好奇的头脑。<br/>让智能、宇宙与创造，在这里相遇。</p>
          <div className="home-hero-actions"><LiquidButton type="button" className="button home-primary" onClick={onDiscover}>进入社区 <ArrowUpRight size={17}/></LiquidButton><LiquidButton type="button" className="home-text-link" onClick={onExplore}>开始探索 <ArrowRight size={14}/></LiquidButton></div>
        </div>
        <div className="home-atom"><Suspense fallback={<div className="home-scene-loading">正在展开新的可能…</div>}><Orbital variant={selected} onVariant={setSelected} onExplore={onBoard}/></Suspense></div>
        <div className="home-hero-bottom"><FluidTabs className="home-topic-tabs" active={String(selected)} label="选择原子轨道主题">{atomTopics.map((topic,i) => <LiquidButton key={topic.id} type="button" role="tab" aria-selected={selected === i} tabIndex={selected === i ? 0 : -1} className={selected === i ? "active" : ""} onClick={() => setSelected(i)}><span className="home-tab-number">0{i+1}</span><span>{topic.title}</span><ArrowUpRight size={13}/></LiquidButton>)}</FluidTabs></div>
      </div>
    </section>
  </div>;
}
