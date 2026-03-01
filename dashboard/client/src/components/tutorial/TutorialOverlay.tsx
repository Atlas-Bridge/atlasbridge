import { useTutorial } from "@/hooks/useTutorial";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, X, Sparkles } from "lucide-react";

export function TutorialOverlay() {
  const { isActive, currentStep, currentStepIndex, totalSteps, next, skip } =
    useTutorial();

  if (!isActive || !currentStep) return null;

  const isLastStep = currentStepIndex === totalSteps - 1;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-[998] animate-in fade-in duration-200" />

      {/* Tutorial card */}
      <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
          <CardContent className="p-6 space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <span className="text-xs text-muted-foreground font-medium">
                  Step {currentStepIndex + 1} of {totalSteps}
                </span>
              </div>
              <button
                onClick={skip}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Skip tutorial"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Progress bar */}
            <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{
                  width: `${((currentStepIndex + 1) / totalSteps) * 100}%`,
                }}
              />
            </div>

            {/* Content */}
            <div>
              <h3 className="text-lg font-semibold">{currentStep.title}</h3>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                {currentStep.description}
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-2">
              <Button variant="ghost" size="sm" onClick={skip}>
                Skip tour
              </Button>
              <Button size="sm" onClick={next} className="gap-2">
                {isLastStep ? "Finish" : "Next"}
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
