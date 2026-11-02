import { NavLink, Outlet } from "react-router-dom";

const NAV = [
  ["/", "🏠", "خانه"],
  ["/food", "🍽️", "تغذیه"],
  ["/coach", "🏋️", "ورزش"],
  ["/mind", "🧠", "ذهن"],
  ["/more", "☰", "بیشتر"],
] as const;

export default function Layout() {
  return (
    <div className="shell">
      <Outlet />
      <nav className="bottom-nav" aria-label="منوی اصلی">
        {NAV.map(([to, icon, label]) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
            <span className="nav-icon">{icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
