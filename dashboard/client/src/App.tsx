import { Switch, Route, useLocation } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { Layout } from "@/components/layout";
import { TutorialProvider } from "@/hooks/useTutorial";
import OverviewPage from "@/pages/overview";
import SessionsPage from "@/pages/sessions";
import SessionDetailPage from "@/pages/session-detail";
import PromptsPage from "@/pages/prompts";
import TracesPage from "@/pages/traces";
import IntegrityPage from "@/pages/integrity";
import AuditPage from "@/pages/audit";
import SettingsPage from "@/pages/settings";
import RepositoriesPage from "@/pages/repositories";
import TerminalPage from "@/pages/terminal";
import EvidencePage from "@/pages/evidence";
import ChatPage from "@/pages/chat";
import AgentPage from "@/pages/agent";
import OnboardingPage from "@/pages/onboarding";
import MonitorPage from "@/pages/monitor";
import PolicyPage from "@/pages/policy";
import DocsPage from "@/pages/docs";
import NotFound from "@/pages/not-found";
import { HelpButton } from "@/components/help/HelpButton";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";

/**
 * Redirect first-time users to /onboarding when no config file exists.
 * Only fires once on app load; does not redirect if already on /onboarding.
 */
function FirstRunRedirect() {
  const [location, navigate] = useLocation();
  const { data } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/setup/status"],
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (data && !data.configured && location !== "/onboarding") {
      navigate("/onboarding");
    }
  }, [data, location, navigate]);

  return null;
}

function Router() {
  return (
    <>
      <FirstRunRedirect />
      <Layout>
        <Switch>
          <Route path="/" component={OverviewPage} />
          <Route path="/onboarding" component={OnboardingPage} />
          <Route path="/monitor" component={MonitorPage} />
          <Route path="/sessions" component={SessionsPage} />
          <Route path="/sessions/:id" component={SessionDetailPage} />
          <Route path="/prompts" component={PromptsPage} />
          <Route path="/traces" component={TracesPage} />
          <Route path="/integrity" component={IntegrityPage} />
          <Route path="/audit" component={AuditPage} />
          <Route path="/policy" component={PolicyPage} />
          <Route path="/docs" component={DocsPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/repositories" component={RepositoriesPage} />
          <Route path="/terminal" component={TerminalPage} />
          <Route path="/evidence" component={EvidencePage} />
          <Route path="/chat" component={ChatPage} />
          <Route path="/agent" component={AgentPage} />
          <Route component={NotFound} />
        </Switch>
      </Layout>
      {/* Render outside Layout so they're not inside overflow:auto */}
      <HelpButton />
      <TutorialOverlay />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <TutorialProvider>
            <Toaster />
            <Router />
          </TutorialProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
