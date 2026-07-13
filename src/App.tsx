import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { Footer } from "./app/components/Footer";
import { AdminPage } from "./pages/AdminPage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { ContactPage } from "./pages/ContactPage";
import { DashboardPage } from "./pages/DashboardPage";
import { HelpPage } from "./pages/HelpPage";
import { HomePage } from "./pages/HomePage";
import { LocalGuideEditorPage } from "./pages/LocalGuideEditorPage";
import { LocalGuidesPage } from "./pages/LocalGuidesPage";
import { LoginPage } from "./pages/LoginPage";
import { MapTourPage } from "./pages/MapTourPage";
import { PricingPage } from "./pages/PricingPage";

function LegacyMapStoryRedirect({ publicStory = false }: { publicStory?: boolean }) {
  const params = useParams();
  const value = publicStory ? params.slug : params.id;
  const target = publicStory ? `/story/${value ?? ""}` : `/map-stories/${value ?? ""}`;

  return <Navigate to={target} replace />;
}

export default function App() {
  const location = useLocation();
  const isMapStoriesHome =
    location.pathname === "/map-stories" || location.pathname === "/map-stories/";
  const hideFooter =
    location.pathname.startsWith("/story/") ||
    location.pathname.startsWith("/tour/") ||
    location.pathname.startsWith("/guide/") ||
    location.pathname.startsWith("/local-guides/") ||
    (!isMapStoriesHome && location.pathname.startsWith("/map-stories/")) ||
    location.pathname.startsWith("/map-tour/");

  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/local-guides" element={<LocalGuidesPage />} />
        <Route path="/local-guides/:id" element={<LocalGuideEditorPage />} />
        <Route path="/guide/:slug" element={<LocalGuideEditorPage />} />
        <Route path="/map-stories" element={<MapTourPage />} />
        <Route path="/map-stories/:id" element={<MapTourPage />} />
        <Route path="/story/:slug" element={<MapTourPage />} />
        <Route path="/map-tour" element={<Navigate to="/map-stories" replace />} />
        <Route path="/map-tour/:id" element={<LegacyMapStoryRedirect />} />
        <Route path="/tour/:slug" element={<LegacyMapStoryRedirect publicStory />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
      {hideFooter ? null : <Footer />}
    </>
  );
}
