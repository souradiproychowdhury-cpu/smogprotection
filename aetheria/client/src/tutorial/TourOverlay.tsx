import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { idbGet, idbSet } from '../lib/idb';
import { useAppStore } from '../store/useAppStore';
import { useVoice } from '../voice/useVoice';
import rawSteps from './steps.json';

interface TourStep {
  id: string;
  route: string;
  target: string;
  title: string;
  body: string;
}

const BASE_STEPS = rawSteps as TourStep[];

export const TourOverlay: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const language = useAppStore((s) => s.language);
  const tutorial = useAppStore((s) => s.tutorial);
  const setTutorial = useAppStore((s) => s.setTutorial);
  const pushToast = useAppStore((s) => s.pushToast);
  const { speakText, stopSpeaking } = useVoice();

  const [steps, setSteps] = useState<TourStep[]>(BASE_STEPS);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  // Translate tour steps into active language (cached in IndexedDB)
  useEffect(() => {
    let cancelled = false;
    async function translateSteps() {
      if (language.code === 'en') {
        setSteps(BASE_STEPS);
        return;
      }
      const cacheKey = `tour:${language.code}:v1`;
      const cached = await idbGet<TourStep[]>(cacheKey);
      if (!cancelled && cached && cached.length === BASE_STEPS.length) {
        setSteps(cached);
        return;
      }

      if (!navigator.onLine) {
        setSteps(BASE_STEPS);
        return;
      }

      try {
        const dict: Record<string, string> = {};
        BASE_STEPS.forEach((s) => {
          dict[`${s.id}.title`] = s.title;
          dict[`${s.id}.body`] = s.body;
        });
        const res = await api.translate(language.englishName || language.nativeName, dict);
        if (!cancelled && res.translations) {
          const translated = BASE_STEPS.map((s) => ({
            ...s,
            title: res.translations[`${s.id}.title`] || s.title,
            body: res.translations[`${s.id}.body`] || s.body
          }));
          setSteps(translated);
          await idbSet(cacheKey, translated);
        }
      } catch {
        if (!cancelled) setSteps(BASE_STEPS);
      }
    }
    translateSteps();
    return () => {
      cancelled = true;
    };
  }, [language.code, language.englishName, language.nativeName]);

  const currentStep = steps[tutorial.stepIndex] || steps[0];

  // Navigate to step route & highlight target element
  useEffect(() => {
    if (!tutorial.active || !currentStep) {
      setTargetRect(null);
      return;
    }

    if (location.pathname !== currentStep.route) {
      navigate(currentStep.route);
    }

    const measure = () => {
      const el = document.querySelector(currentStep.target);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const r = el.getBoundingClientRect();
        setTargetRect(r);
      } else {
        setTargetRect(null);
      }
    };

    const timer = setTimeout(measure, 220);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', measure);
    };
  }, [tutorial.active, tutorial.stepIndex, currentStep, location.pathname, navigate]);

  // Auto-play narration & advance
  useEffect(() => {
    if (!tutorial.active || !tutorial.autoPlay || tutorial.paused || !currentStep) return;
    const narration = `${currentStep.title}. ${currentStep.body}`;
    speakText(narration);

    const words = narration.split(/\s+/).length;
    const delayMs = Math.max(7000, Math.min(18000, words * 450));

    const advanceTimer = setTimeout(() => {
      if (tutorial.stepIndex < steps.length - 1) {
        setTutorial({ stepIndex: tutorial.stepIndex + 1 });
      } else {
        setTutorial({ active: false, autoPlay: false, completed: true, stepIndex: 0 });
        pushToast('Guided tour completed!', 'success');
      }
    }, delayMs);

    return () => clearTimeout(advanceTimer);
  }, [
    tutorial.active,
    tutorial.autoPlay,
    tutorial.paused,
    tutorial.stepIndex,
    currentStep,
    steps.length,
    setTutorial,
    speakText,
    pushToast
  ]);

  // Practice mode listener: confirms when user taps the target real control
  useEffect(() => {
    if (!tutorial.practiceTarget) return;
    const selector = tutorial.practiceTarget;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target && target.closest(selector)) {
        const msg = tutorial.practiceSuccessMessage || 'Great job! You tapped the real control.';
        pushToast(msg, 'success');
        speakText(msg);
        setTutorial({ practiceTarget: null, practiceSuccessMessage: null });
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [tutorial.practiceTarget, tutorial.practiceSuccessMessage, pushToast, setTutorial, speakText]);

  if (!tutorial.active) {
    if (!tutorial.practiceTarget) return null;
    return (
      <div
        role="status"
        className="fixed top-20 inset-x-4 max-w-md mx-auto z-[75] rounded-2xl bg-secondary-container text-on-secondary-container px-4 py-3 shadow-2xl flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined">touch_app</span>
          <span className="font-label-md font-bold">Practice Mode: Tap the highlighted area on screen!</span>
        </div>
        <button
          type="button"
          onClick={() => setTutorial({ practiceTarget: null, practiceSuccessMessage: null })}
          className="px-2.5 py-1 rounded-lg bg-black/20 text-xs font-bold"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-labelledby="tour-step-title"
      className="fixed inset-0 z-[75] pointer-events-none"
    >
      {/* Dim backdrop around spotlight */}
      <div className="absolute inset-0 bg-surface-container-lowest/65 backdrop-blur-[1px] pointer-events-auto" />

      {/* Highlight ring over real element */}
      {targetRect && (
        <div
          aria-hidden="true"
          className="fixed rounded-2xl border-2 border-primary shadow-[0_0_0_9999px_rgba(8,14,29,0.55),0_0_24px_rgba(245,158,11,0.65)] pointer-events-none transition-all duration-300"
          style={{
            top: Math.max(4, targetRect.top - 6),
            left: Math.max(4, targetRect.left - 6),
            width: targetRect.width + 12,
            height: targetRect.height + 12
          }}
        />
      )}

      {/* Explanation Card */}
      <div className="fixed bottom-20 lg:bottom-8 inset-x-4 max-w-lg mx-auto rounded-2xl bg-surface-container-low/95 backdrop-blur-2xl p-5 shadow-2xl gilded-rim pointer-events-auto space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="px-2.5 py-0.5 rounded-full bg-primary/20 text-primary font-label-sm font-bold uppercase tracking-wider">
            Step {tutorial.stepIndex + 1} of {steps.length}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => speakText(`${currentStep.title}. ${currentStep.body}`)}
              aria-label="Read step aloud"
              className="px-2.5 py-1 rounded-lg bg-surface-container-high hover:bg-surface-bright text-primary text-xs font-semibold flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[16px]">volume_up</span>
              <span>Listen</span>
            </button>
            <button
              type="button"
              onClick={() => setTutorial({ autoPlay: !tutorial.autoPlay, paused: false })}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                tutorial.autoPlay
                  ? 'bg-secondary text-on-secondary'
                  : 'bg-surface-container-high text-on-surface'
              }`}
            >
              {tutorial.autoPlay ? 'Auto-Play ON' : 'Auto-Play'}
            </button>
            {tutorial.autoPlay && (
              <button
                type="button"
                onClick={() => {
                  stopSpeaking();
                  setTutorial({ paused: !tutorial.paused });
                }}
                className="px-2 py-1 rounded-lg bg-surface-container-high text-on-surface text-xs"
              >
                {tutorial.paused ? 'Resume' : 'Pause'}
              </button>
            )}
          </div>
        </div>

        <div>
          <h2 id="tour-step-title" className="font-headline-sm text-headline-sm text-primary font-semibold">
            {currentStep.title}
          </h2>
          <p className="font-body-sm text-body-sm text-on-surface mt-1 leading-relaxed">
            {currentStep.body}
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex items-center gap-1 overflow-x-auto py-1 no-scrollbar">
          {steps.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              aria-label={`Jump to step ${idx + 1}`}
              onClick={() => setTutorial({ stepIndex: idx })}
              className={`h-1.5 rounded-full transition-all ${
                idx === tutorial.stepIndex ? 'w-5 bg-primary' : 'w-1.5 bg-surface-container-highest'
              }`}
            />
          ))}
        </div>

        {/* Navigation controls */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                stopSpeaking();
                setTutorial({ active: false, autoPlay: false });
              }}
              className="px-3 py-2 rounded-xl bg-surface-container-high text-on-surface-variant hover:text-on-surface font-label-md text-xs font-semibold"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => setTutorial({ stepIndex: 0, paused: false })}
              className="px-3 py-2 rounded-xl bg-surface-container-high text-on-surface-variant hover:text-on-surface font-label-md text-xs font-semibold"
            >
              Replay
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={tutorial.stepIndex === 0}
              onClick={() => setTutorial({ stepIndex: Math.max(0, tutorial.stepIndex - 1) })}
              className="px-3.5 py-2 rounded-xl bg-surface-container-high text-on-surface font-label-md font-semibold disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => {
                stopSpeaking();
                if (tutorial.stepIndex < steps.length - 1) {
                  setTutorial({ stepIndex: tutorial.stepIndex + 1 });
                } else {
                  setTutorial({ active: false, autoPlay: false, completed: true, stepIndex: 0 });
                  pushToast('Guided tour completed!', 'success');
                }
              }}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-primary-container to-primary text-on-primary-container font-label-md font-bold"
            >
              {tutorial.stepIndex === steps.length - 1 ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
