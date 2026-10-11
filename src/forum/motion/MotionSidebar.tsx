import { useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PanelRightClose, PanelRightOpen, Compass } from "lucide-react";
import { LiquidButton } from "./LiquidButton";
import { useMotionPreferences } from "./motion-preferences";
import { transitions } from "./motion-tokens";
export function MotionSidebar({ children, shortcuts, activeId }: { children: ReactNode; activeId?: string; shortcuts: { id: string; label: string; icon: ReactNode; onClick: () => void }[] }) {
  const [collapsed, setCollapsed] = useState(false), id = useId(), toggle = useRef<HTMLButtonElement>(null);
  const { reduced } = useMotionPreferences();
  return <motion.aside layout className={`community-sidebar motion-sidebar ${collapsed ? "is-collapsed" : ""}`} transition={transitions.surface} style={{ borderRadius: 20 }}>
    <div className="sidebar-control"><span aria-hidden="true"><Compass size={15} />社区导航</span><LiquidButton ref={toggle} type="button" className="icon-button" aria-controls={id} aria-expanded={!collapsed} aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"} onClick={() => setCollapsed((value) => !value)}>{collapsed ? <PanelRightOpen size={17} /> : <PanelRightClose size={17} />}</LiquidButton></div>
    <AnimatePresence initial={false} mode="popLayout">
      {!collapsed ? <motion.div id={id} className="sidebar-content" key="content" initial={reduced ? false : { opacity: 0, x: 6, filter: "blur(4px)" }} animate={{ opacity: 1, x: 0, filter: "blur(0px)" }} exit={{ opacity: 0, x: 4, filter: "blur(4px)", transition: { duration: 0.12 } }} transition={transitions.surface}>{children}</motion.div>
        : <motion.nav key="rail" className="sidebar-rail" aria-label="版块快捷导航" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{shortcuts.map((item) => <LiquidButton key={item.id} type="button" className="icon-button" aria-current={item.id === activeId ? "page" : undefined} aria-label={item.label} title={item.label} onClick={item.onClick}>{item.icon}</LiquidButton>)}</motion.nav>}
    </AnimatePresence>
  </motion.aside>;
}
