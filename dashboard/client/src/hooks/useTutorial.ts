import {
  useState,
  useCallback,
  useEffect,
  createContext,
  useContext,
} from "react";
import type { ReactNode } from "react";
import { useLocation } from "wouter";
import React from "react";

export interface TutorialStep {
  id: string;
  title: string;
  description: string;
  targetPath: string;
  targetSelector?: string;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "overview",
    title: "Your Command Center",
    description:
      "This is the Overview page. It shows how many AI sessions are running, pending prompts needing your attention, and overall system health at a glance.",
    targetPath: "/",
  },
  {
    id: "sessions",
    title: "Monitor Your AI Tools",
    description:
      "This is where you start and stop monitors. The VS Code monitor detects Claude Code sessions automatically. The Desktop monitor watches Claude and ChatGPT desktop apps. For browser-based AI (Claude.ai, ChatGPT, Gemini), install the Chrome extension from the extension/dist/ folder.",
    targetPath: "/sessions",
  },
  {
    id: "chat",
    title: "Respond to Prompts",
    description:
      "When your AI tool asks a question it can't answer itself, it shows up here. Type your response and AtlasBridge sends it back to the AI tool.",
    targetPath: "/chat",
  },
  {
    id: "policy",
    title: "Define Your Rules",
    description:
      "Policies tell AtlasBridge what to auto-approve and what to ask you about. Use the visual builder or write YAML directly. Pick a preset to get started quickly.",
    targetPath: "/policy",
  },
  {
    id: "docs",
    title: "Documentation",
    description:
      "Everything you need to know about writing policies, understanding autonomy modes, and configuring AtlasBridge. All accessible without leaving the app.",
    targetPath: "/docs",
  },
  {
    id: "settings",
    title: "Settings & Configuration",
    description:
      "Configure monitors, manage providers, adjust autonomy mode, and customise your AtlasBridge experience. You can also re-run the setup wizard from here.",
    targetPath: "/settings",
  },
  {
    id: "done",
    title: "You're Ready!",
    description:
      "AtlasBridge is now watching your AI tools. You'll see activity in the dashboard as it happens. Click the ? button anytime to replay this tour or re-run setup.",
    targetPath: "/",
  },
];

const STORAGE_KEY = "atlasbridge_tutorial_completed";
const TRIGGER_KEY = "atlasbridge_start_tutorial";

interface TutorialContextValue {
  isActive: boolean;
  currentStep: TutorialStep | null;
  currentStepIndex: number;
  totalSteps: number;
  start: () => void;
  next: () => void;
  skip: () => void;
  isCompleted: boolean;
}

const TutorialContext = createContext<TutorialContextValue | null>(null);

export function TutorialProvider({ children }: { children: ReactNode }) {
  const [isActive, setIsActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [, navigate] = useLocation();

  // Check if tutorial should auto-start (from onboarding "Take the tour" button)
  useEffect(() => {
    const shouldStart = localStorage.getItem(TRIGGER_KEY);
    if (shouldStart === "true") {
      localStorage.removeItem(TRIGGER_KEY);
      setIsActive(true);
      setCurrentStepIndex(0);
    }
  }, []);

  const currentStep = isActive ? TUTORIAL_STEPS[currentStepIndex] : null;

  const start = useCallback(() => {
    setCurrentStepIndex(0);
    setIsActive(true);
    navigate(TUTORIAL_STEPS[0].targetPath);
  }, [navigate]);

  const next = useCallback(() => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex >= TUTORIAL_STEPS.length) {
      setIsActive(false);
      localStorage.setItem(STORAGE_KEY, "true");
      navigate("/");
      return;
    }
    setCurrentStepIndex(nextIndex);
    navigate(TUTORIAL_STEPS[nextIndex].targetPath);
  }, [currentStepIndex, navigate]);

  const skip = useCallback(() => {
    setIsActive(false);
    localStorage.setItem(STORAGE_KEY, "true");
  }, []);

  const isCompleted = localStorage.getItem(STORAGE_KEY) === "true";

  const value: TutorialContextValue = {
    isActive,
    currentStep,
    currentStepIndex,
    totalSteps: TUTORIAL_STEPS.length,
    start,
    next,
    skip,
    isCompleted,
  };

  return React.createElement(TutorialContext.Provider, { value }, children);
}

export function useTutorial(): TutorialContextValue {
  const ctx = useContext(TutorialContext);
  if (!ctx) {
    throw new Error("useTutorial must be used within a TutorialProvider");
  }
  return ctx;
}
