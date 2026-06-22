import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SettingsProvider } from "./contexts/SettingsContext";
import "./App.css";

try {
  const s = JSON.parse(localStorage.getItem("hyperdesk_settings") || "{}");
  document.documentElement.setAttribute("data-theme", s.theme || "dark");
} catch {
  // ignore malformed settings, default theme attribute is already absent
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 3000 },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <SettingsProvider>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </SettingsProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
