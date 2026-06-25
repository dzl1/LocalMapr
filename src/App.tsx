import { Route, Routes, useLocation } from "react-router-dom";
import { Footer } from "./app/components/Footer";
import { AdminPage } from "./pages/AdminPage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { DashboardPage } from "./pages/DashboardPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { MapTourPage } from "./pages/MapTourPage";

export default function App() {
  const location = useLocation();
  const hideFooter =
    location.pathname.startsWith("/map-tour") ||
    location.pathname.startsWith("/tour/");

  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/map-tour" element={<MapTourPage />} />
        <Route path="/map-tour/:id" element={<MapTourPage />} />
        <Route path="/tour/:slug" element={<MapTourPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
      {hideFooter ? null : <Footer />}
    </>
  );
}
