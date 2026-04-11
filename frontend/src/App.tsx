import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import { Layout } from "@/components/layout/Layout";
import { Dashboard } from "@/pages/Dashboard";
import { NewScan } from "@/pages/NewScan";
import { ScanProgress } from "@/pages/ScanProgress";
import { ScanResults } from "@/pages/ScanResults";
import { SimilarDirectories } from "@/pages/SimilarDirectories";
import { ActionsLog } from "@/pages/ActionsLog";
import { SavedScans } from "@/pages/SavedScans";
import { Settings } from "@/pages/Settings";
import { AssimilateDuplicates } from "@/pages/AssimilateDuplicates";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster theme="dark" position="bottom-right" richColors />
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/scans/new" element={<NewScan />} />
            <Route path="/scans/saved" element={<SavedScans />} />
            <Route path="/scans/:id" element={<ScanResults />} />
            <Route path="/scans/:id/progress" element={<ScanProgress />} />
            <Route path="/scans/:id/similar" element={<SimilarDirectories />} />
            <Route path="/scans/:id/assimilate" element={<AssimilateDuplicates />} />
            <Route path="/actions" element={<ActionsLog />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
