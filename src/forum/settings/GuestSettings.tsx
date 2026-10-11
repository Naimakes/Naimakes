import { lazy, Suspense } from "react";
import { ArrowLeft, LogIn } from "lucide-react";
import { LiquidButton } from "../motion/LiquidButton";
import { LoadingPopup } from "../ui/LoadingPopup";
import "../profile/profile.css";
import "./settings.css";

const AssistantSettings = lazy(() => import("../../assistant/AssistantSettings"));

export default function GuestSettings({ onSignIn, onBack }: { onSignIn: () => void; onBack: () => void }) {
  return (
    <section className="settings-page" aria-labelledby="settings-guest-title">
      <header className="settings-page-head">
        <LiquidButton type="button" className="button secondary settings-back" onClick={onBack}>
          <ArrowLeft size={15} />
          返回社区
        </LiquidButton>
        <h1 id="settings-guest-title">设置</h1>
        <p>未登录时，Naimakes 的形状和颜色保存在当前设备；登录后可以管理个人资料、通知和隐私，并在设备之间同步。</p>
      </header>
      <div className="profile-body settings-body">
        <section className="profile-card settings-signin">
          <div>
            <h2>登录后解锁全部设置</h2>
            <p className="profile-card-note">个人资料、头像、通知、隐私与账户管理都集中在这里。</p>
          </div>
          <LiquidButton type="button" className="button primary" onClick={onSignIn}>
            <LogIn size={16} />
            登录 / 加入社区
          </LiquidButton>
        </section>
        <Suspense fallback={<LoadingPopup />}>
          <AssistantSettings />
        </Suspense>
      </div>
    </section>
  );
}
