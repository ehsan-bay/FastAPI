import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { Capacitor } from "@capacitor/core";
import ErrorBoundary from "./components/ErrorBoundary";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import { AuthProvider, useAuth } from "./lib/auth";
import { needsServerSetup } from "./lib/api";
import "./lib/prefs";
import Login from "./pages/Login";
import Home from "./pages/Home";

// Service worker = offline PWA. Not needed inside the native app shell.
if (!Capacitor.isNativePlatform()) registerSW({ immediate: true });

const Food = lazy(() => import("./pages/Food"));
const Coach = lazy(() => import("./pages/Coach"));
const Mind = lazy(() => import("./pages/Mind"));
const More = lazy(() => import("./pages/More"));
const Skin = lazy(() => import("./pages/Skin"));
const Lab = lazy(() => import("./pages/Lab"));
const Sleep = lazy(() => import("./pages/Sleep"));
const Vitals = lazy(() => import("./pages/Vitals"));
const Meds = lazy(() => import("./pages/Meds"));
const Settings = lazy(() => import("./pages/Settings"));
const Scan = lazy(() => import("./pages/Scan"));
const Pay = lazy(() => import("./pages/Pay"));
const PayResult = lazy(() => import("./pages/PayResult"));
const Wallet = lazy(() => import("./pages/Wallet"));
const Admin = lazy(() => import("./pages/Admin"));
const Voice = lazy(() => import("./pages/Voice"));
const XRay = lazy(() => import("./pages/XRay"));

function Routed() {
  const { user, loading } = useAuth();
  if (needsServerSetup()) return <Settings firstRun />;
  if (loading) return <Spinner />;
  if (!user) return <Login />;
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="food" element={<Food />} />
          <Route path="coach" element={<Coach />} />
          <Route path="mind" element={<Mind />} />
          <Route path="more" element={<More />} />
          <Route path="skin" element={<Skin />} />
          <Route path="lab" element={<Lab />} />
          <Route path="sleep" element={<Sleep />} />
          <Route path="vitals" element={<Vitals />} />
          <Route path="meds" element={<Meds />} />
          <Route path="settings" element={<Settings />} />
          <Route path="scan" element={<Scan />} />
          <Route path="pay/result/:id" element={<PayResult />} />
          <Route path="pay/:token" element={<Pay />} />
          <Route path="wallet" element={<Wallet />} />
          <Route path="admin" element={<Admin />} />
          <Route path="voice" element={<Voice />} />
          <Route path="xray" element={<XRay />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Routed />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
