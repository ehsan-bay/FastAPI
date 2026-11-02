import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { flushPendingSleep } from "../lib/sleepStore";

const NAV = [
  ["/", "🏠", "خانه"],
  ["/food", "🍽️", "تغذیه"],
  ["/coach", "🏋️", "ورزش"],
  ["/mind", "🧠", "ذهن"],
  ["/more", "☰", "بیشتر"],
] as const;

export default function Layout() {
  // Upload any sleep night left on the phone: at start, when back online, and when the app returns to the foreground.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "visible") flushPendingSleep();
    };
    flush();
    const timer = window.setInterval(flush, 5 * 60_000);
    window.addEventListener("online", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, []);

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
