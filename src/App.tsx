import { Route, Routes, useLocation } from "react-router-dom";
import { Footer } from "./app/components/Footer";
import { AdminPage } from "./pages/AdminPage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { DashboardPage } from "./pages/DashboardPage";
import { HomePage } from "./pages/HomePage";
import { LocalGuideEditorPage } from "./pages/LocalGuideEditorPage";
import { LocalGuidesPage } from "./pages/LocalGuidesPage";
import { LoginPage } from "./pages/LoginPage";
import { MapTourPage } from "./pages/MapTourPage";

export default function App() {
  const location = useLocation();
  const isMapToursHome =
    location.pathname === "/map-tour" || location.pathname === "/map-tour/";
  const hideFooter =
    location.pathname.startsWith("/tour/") ||
    location.pathname.startsWith("/guide/") ||
    location.pathname.startsWith("/local-guides/") ||
    (!isMapToursHome && location.pathname.startsWith("/map-tour/"));

  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/local-guides" element={<LocalGuidesPage />} />
        <Route path="/local-guides/:id" element={<LocalGuideEditorPage />} />
        <Route path="/guide/:slug" element={<LocalGuideEditorPage />} />
        <Route path="/map-tour" element={<MapTourPage />} />
        <Route path="/map-tour/:id" element={<MapTourPage />} />
        <Route path="/tour/:slug" element={<MapTourPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
      {hideFooter ? null : <Footer />}
    </>
  );
}
