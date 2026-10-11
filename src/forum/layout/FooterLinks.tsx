import "./footer-links.css";

type FooterPage = "about" | "guidelines" | "privacy";
const links: { page: FooterPage; label: string }[] = [
  { page: "about", label: "关于 Naimakes" },
  { page: "guidelines", label: "社区共识" },
  { page: "privacy", label: "隐私说明" },
];

export function FooterLinks({ onOpen }: { onOpen: (page: FooterPage) => void }) {
  return <div className="footer-links" role="group" aria-label="站点信息">
    {links.map(({ page, label }) => <button key={page} type="button" className="footer-text-link"
      aria-haspopup="dialog" data-motion-source="" onClick={() => onOpen(page)}>{label}</button>)}
  </div>;
}
