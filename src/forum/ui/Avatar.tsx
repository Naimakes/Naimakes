import { openProfile, profileUrl } from "../profile/profile-nav";

export default function Avatar({
  name,
  initials,
  avatar,
  className = "",
  size,
  userId,
}: {
  name?: string;
  initials?: string;
  avatar?: string;
  className?: string;
  size?: number;
  userId?: string;
}) {
  const label = initials || name?.slice(0, 2).toUpperCase() || "—";
  const style = size ? { width: size, height: size } : undefined;
  const face = (
    <span
      className={`avatar ${avatar ? "has-photo" : ""} ${className}`.trim()}
      style={style}
    >
      {avatar ? (
        <img src={avatar} alt={name ? name + " 的头像" : "头像"} loading="lazy" />
      ) : (
        label
      )}
    </span>
  );
  if (!userId) return face;
  return (
    <a
      className="avatar-link"
      href={profileUrl(userId)}
      title={name ? name + " 的个人中心" : "个人中心"}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
        event.preventDefault();
        event.stopPropagation();
        openProfile(userId);
      }}
    >
      {face}
    </a>
  );
}
