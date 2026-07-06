import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import mapTourCheckoutHandler from "./api/billing/map-tour-checkout";

const devApiHandlers = new Map([
  ["/api/billing/map-tour-checkout", mapTourCheckoutHandler],
]);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  for (const [key, value] of Object.entries(env)) {
    process.env[key] ??= value;
  }

  return {
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
  };
});
