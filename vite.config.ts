import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import checkoutHandler from "./api/billing/checkout";
import mapTourCheckoutHandler from "./api/billing/map-tour-checkout";
import portalHandler from "./api/billing/portal";

const devApiHandlers = new Map([
  ["/api/billing/checkout", checkoutHandler],
  ["/api/billing/map-tour-checkout", mapTourCheckoutHandler],
  ["/api/billing/portal", portalHandler],
]);

export default defineConfig({
  plugins: [
    react(),
    {
      name: "localmapr-dev-api",
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          const pathname = new URL(
            request.url ?? "",
            "http://localhost",
          ).pathname;
          const handler = devApiHandlers.get(pathname);

          if (!handler) {
            next();
            return;
          }

          try {
            await handler(request, response);
          } catch (error) {
            console.error(`Dev API failed for ${pathname}`, error);
            if (!response.headersSent) {
              response.statusCode = 500;
              response.setHeader("Content-Type", "application/json");
              response.end(
                JSON.stringify({ error: "Local API handler failed." }),
              );
            }
          }
        });
      },
    },
  ],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
