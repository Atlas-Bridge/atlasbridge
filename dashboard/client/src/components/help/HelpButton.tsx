import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  HelpCircle, X, Sparkles, RotateCcw, BookOpen, ExternalLink,
} from "lucide-react";
import { useTutorial } from "@/hooks/useTutorial";

export function HelpButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [, navigate] = useLocation();
  const { start: startTutorial, isActive: tutorialActive } = useTutorial();

  // Don't show help button during tutorial
  if (tutorialActive) return null;

  return (
    <>
      {/* Floating help button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center justify-center"
        aria-label="Help"
        data-testid="help-button"
      >
        {isOpen ? (
          <X className="w-5 h-5" />
        ) : (
          <HelpCircle className="w-5 h-5" />
        )}
      </button>

      {/* Help drawer */}
      {isOpen && (
        <div className="fixed bottom-20 right-6 z-50 w-72 animate-in slide-in-from-bottom-2 duration-200">
          <Card className="shadow-2xl">
            <CardContent className="p-4 space-y-2">
              <h4 className="text-sm font-semibold mb-3">Help & Resources</h4>

              <button
                onClick={() => {
                  setIsOpen(false);
                  startTutorial();
                }}
                className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors text-left"
              >
                <Sparkles className="w-4 h-4 text-primary shrink-0" />
                <div>
                  <p className="text-sm font-medium">Replay Tutorial</p>
                  <p className="text-xs text-muted-foreground">
                    Walk through the guided tour again
                  </p>
                </div>
              </button>

              <button
                onClick={() => {
                  setIsOpen(false);
                  navigate("/onboarding");
                }}
                className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors text-left"
              >
                <RotateCcw className="w-4 h-4 text-amber-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Re-run Setup Wizard</p>
                  <p className="text-xs text-muted-foreground">
                    Change AI tools, mode, or monitors
                  </p>
                </div>
              </button>

              <button
                onClick={() => {
                  setIsOpen(false);
                  navigate("/docs");
                }}
                className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors text-left"
              >
                <BookOpen className="w-4 h-4 text-blue-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Documentation</p>
                  <p className="text-xs text-muted-foreground">
                    Guides, policy reference, FAQ
                  </p>
                </div>
              </button>

              <div className="border-t pt-2 mt-2">
                <a
                  href="https://github.com/auredia/atlasbridge"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors text-left"
                >
                  <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-sm font-medium">GitHub Repository</p>
                    <p className="text-xs text-muted-foreground">
                      Source code, issues, contributing
                    </p>
                  </div>
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
