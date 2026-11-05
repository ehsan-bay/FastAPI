import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Brain, House, LayoutGrid, Mic, Utensils, type LucideIcon } from "lucide-react";
import { flushPendingSleep } from "../lib/sleepStore";
import { watchCareAlerts } from "../lib/careAlerts";

const NAV: [string, LucideIcon, string][] = [
  ["/", House, "خانه"],
  ["/food", Utensils, "تغذیه"],
  ["/voice", Mic, "ثبت صوتی"],
  ["/mind", Brain, "ذهن"],
  ["/more", LayoutGrid, "بیشتر"],
];

export default function Layout() {
  // Upload any sleep night left on the phone: at start, when back online, and when the app returns to the foreground.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "visible") flushPendingSleep();
    };
    flush();
    watchCareAlerts();
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
        {NAV.map(([to, Icon, label]) =>
          to === "/voice" ? (
            <div key={to} className="nav-fab">
              <NavLink to={to} aria-label={label} className={({ isActive }) => (isActive ? "active" : "")}>
                <Mic size={28} strokeWidth={2.2} />
                <span>{label}</span>
              </NavLink>
            </div>
          ) : (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
              <span className="nav-ico"><Icon size={22} strokeWidth={2} /></span>
              <span>{label}</span>
            </NavLink>
          ),
        )}
      </nav>
    </div>
  );
}
