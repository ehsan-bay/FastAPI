import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Activity, Camera, HeartPulse, House, LayoutGrid, Mic, NotebookPen, Pill, Plus, Utensils, type LucideIcon } from "lucide-react";
import { flushPendingSleep } from "../lib/sleepStore";
import { watchCareAlerts } from "../lib/careAlerts";
import { IconChip, Sheet, type Tone } from "./ui";

const NAV: [string, LucideIcon, string][] = [
  ["/", House, "خانه"],
  ["/food", Utensils, "تغذیه"],
  ["+", Plus, "ثبت"],
  ["/meds", Pill, "داروها"],
  ["/more", LayoutGrid, "بیشتر"],
];

/** One place for every quick entry, opened from the center button. */
const QUICK: [string, LucideIcon, Tone, string][] = [
  ["/voice", Mic, "blue", "با صدا"],
  ["/food", Camera, "orange", "عکس غذا"],
  ["/vitals", HeartPulse, "red", "فشار و قند"],
  ["/meds", Pill, "rose", "مصرف دارو"],
  ["/mind", NotebookPen, "violet", "حال امروز"],
  ["/heart", Activity, "teal", "ضربان قلب"],
];

export default function Layout() {
  const [quick, setQuick] = useState(false);
  const loc = useLocation();
  useEffect(() => {
    setQuick(false);
  }, [loc.pathname]);

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
          to === "+" ? (
            <div key={to} className="nav-fab">
              <button onClick={() => setQuick(true)} aria-label="ثبت سریع" aria-haspopup="dialog">
                <span className="plus"><Plus size={26} strokeWidth={2.4} /></span>
                <span>{label}</span>
              </button>
            </div>
          ) : (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
              <span className="nav-ico"><Icon size={22} strokeWidth={1.9} /></span>
              <span>{label}</span>
            </NavLink>
          ),
        )}
      </nav>
      <Sheet open={quick} onClose={() => setQuick(false)} title="چه چیزی ثبت کنیم؟">
        <div className="quick-grid">
          {QUICK.map(([to, Icon, tone, label]) => (
            <Link key={to + label} to={to} onClick={() => setQuick(false)}>
              <IconChip icon={Icon} tone={tone} />
              {label}
            </Link>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
