import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n/useTranslation';
import { useAppStore } from '../store/useAppStore';
import { useVoice } from './useVoice';

export interface TourFeatureStep {
  id: string;
  title: string;
  path: string;
  speechText: string;
  icon: string;
  badge: string;
}

const FEATURE_TOUR_STEPS: TourFeatureStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Aetheria',
    path: '/',
    speechText:
      'Welcome to Aetheria. I am your clean-air assistant, here to protect you and your family from severe winter smog and urban air pollution.',
    icon: 'shield_with_house',
    badge: 'Introduction'
  },
  {
    id: 'sanctuary',
    title: 'Sanctuary: Real-Time Air & Daily Routine',
    path: '/',
    speechText:
      'On your Sanctuary dashboard, you can track live station AQI dials, boundary layer inversion mixing, and your personalized low-emission daily routine based on your home and travel profile.',
    icon: 'home',
    badge: 'Live Air & Routine'
  },
  {
    id: 'oracle',
    title: 'Smog Oracle: GenAI Assistant',
    path: '/oracle',
    speechText:
      'The Smog Oracle gives you immediate GenAI guidance. Ask about DIY MERV-13 filters, room sealing, N95 mask fits, or scan a photo of your purifier to get structured clean-air action cards.',
    icon: 'auto_awesome',
    badge: 'GenAI Intelligence'
  },
  {
    id: 'route',
    title: 'Clean-Air Walking Route Navigator',
    path: '/route',
    speechText:
      'Plan your walking, cycling, or transit trips using real OpenStreetMap roads. We calculate the lowest PM2.5 exposure corridor so you avoid heavy roadside diesel exhaust.',
    icon: 'alt_route',
    badge: 'Lowest Exposure GPS'
  },
  {
    id: 'impact',
    title: 'Community Impact & District Guilds',
    path: '/impact',
    speechText:
      'Join neighborhood clean-air pledges to reduce hearth smoke and vehicle idling. Track collective emissions avoided and celebrate district leaderboards.',
    icon: 'globe',
    badge: 'Collective Action'
  },
  {
    id: 'vault',
    title: 'Lifestyle Hacks & DIY Vault',
    path: '/vault',
    speechText:
      'Discover verified, budget-friendly indoor hacks. Build your own Corsi-Rosenthal box fan purifier, seal drafty windows, and shift to sustainable induction cooking.',
    icon: 'diamond',
    badge: 'Verified Hacks'
  },
  {
    id: 'health_alert',
    title: 'Health Shield & Inversion Alerts',
    path: '/health',
    speechText:
      'Protect vulnerable children and elderly family members with dose logs, asthma early-warning symptoms, and web push alerts when thermal inversions trap ground smog.',
    icon: 'health_and_safety',
    badge: 'Health Protection'
  }
];

export const WelcomeVoiceAssistant: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { language } = useTranslation();
  const a11y = useAppStore((s) => s.a11y);
  const pushToast = useAppStore((s) => s.pushToast);

  const { speakText, stopSpeaking, speaking } = useVoice();

  const [active, setActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  const step = FEATURE_TOUR_STEPS[currentStepIndex];

  // Speak current step aloud
  const speakCurrentStep = useCallback(
    (stepIndex: number) => {
      const targetStep = FEATURE_TOUR_STEPS[stepIndex];
      if (!targetStep) return;
      speakText(targetStep.speechText, language.bcp47);
    },
    [language.bcp47, speakText]
  );

  // Auto-activate on first open
  useEffect(() => {
    const welcomed = localStorage.getItem('aetheria_voice_welcomed');
    if (!welcomed) {
      setActive(true);
      setCurrentStepIndex(0);

      // Attempt initial speak
      try {
        speakText(FEATURE_TOUR_STEPS[0].speechText, language.bcp47);
      } catch {
        setNeedsGesture(true);
      }

      // Check if browser blocked speech autoplay
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        if (!window.speechSynthesis.speaking && !hasInteracted) {
          setNeedsGesture(true);
        }
      }

      localStorage.setItem('aetheria_voice_welcomed', 'true');
    }

    // Global listener to trigger voice guide on custom event
    const handleTrigger = () => {
      setActive(true);
      setMinimized(false);
      setCurrentStepIndex(0);
      speakText(FEATURE_TOUR_STEPS[0].speechText, language.bcp47);
      setNeedsGesture(false);
    };

    window.addEventListener('aetheria:start-voice-tour', handleTrigger);
    return () => window.removeEventListener('aetheria:start-voice-tour', handleTrigger);
  }, [hasInteracted, language.bcp47, speakText]);

  // Handle first user gesture to unlock speech synthesis
  const handleUserGestureStart = () => {
    setNeedsGesture(false);
    setHasInteracted(true);
    speakCurrentStep(currentStepIndex);
  };

  const handleNext = () => {
    const nextIdx = currentStepIndex + 1;
    if (nextIdx < FEATURE_TOUR_STEPS.length) {
      setCurrentStepIndex(nextIdx);
      const nextStep = FEATURE_TOUR_STEPS[nextIdx];
      // Navigate to the relevant screen so the user sees it in action
      if (location.pathname !== nextStep.path) {
        navigate(nextStep.path);
      }
      speakCurrentStep(nextIdx);
    } else {
      // Finished tour
      stopSpeaking();
      setActive(false);
      pushToast('Voice feature tour complete! Tap the Guide button anytime to replay.', 'success');
    }
  };

  const handlePrev = () => {
    const prevIdx = Math.max(0, currentStepIndex - 1);
    setCurrentStepIndex(prevIdx);
    const prevStep = FEATURE_TOUR_STEPS[prevIdx];
    if (location.pathname !== prevStep.path) {
      navigate(prevStep.path);
    }
    speakCurrentStep(prevIdx);
  };

  const handleReplay = () => {
    speakCurrentStep(currentStepIndex);
  };

  const handleClose = () => {
    stopSpeaking();
    setActive(false);
    setNeedsGesture(false);
  };

  // If user requested voice tour or on open:
  if (!active && !needsGesture) return null;

  return (
    <>
      {/* Floating gesture unlock pill if browser blocked autoplay */}
      {needsGesture && !hasInteracted && (
        <aside
          aria-label="Activate Voice Assistant"
          onClick={handleUserGestureStart}
          className="fixed top-20 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-full bg-gradient-to-r from-amber-500 via-primary to-emerald-400 text-surface-container-lowest font-bold text-xs sm:text-sm shadow-2xl flex items-center gap-2 cursor-pointer hover:scale-105 transition-all animate-bounce"
        >
          <span className="material-symbols-outlined text-[20px] animate-pulse">volume_up</span>
          <span>Welcome to Aetheria! Tap here to start your interactive voice guide</span>
          <span className="material-symbols-outlined text-[16px]">touch_app</span>
        </aside>
      )}

      {/* Main Interactive Voice Tour Floating HUD */}
      {active && (
        <aside
          role="region"
          aria-label="Aetheria Voice Tour Guide"
          className={`fixed bottom-24 lg:bottom-8 start-4 lg:start-72 z-[55] w-[min(94vw,28rem)] rounded-3xl bg-surface-container-low/95 backdrop-blur-2xl border border-primary/30 p-4 sm:p-5 shadow-2xl gilded-rim transition-all duration-300 ${
            minimized ? 'h-auto py-3' : ''
          }`}
        >
          {/* Header row */}
          <div className="flex items-center justify-between gap-2 border-b border-outline-variant/30 pb-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              {/* Animated Soundwave Avatar */}
              <div
                className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 ${
                  speaking
                    ? 'bg-gradient-to-br from-primary to-secondary text-on-primary shadow-[0_0_16px_rgba(245,158,11,0.5)] animate-pulse'
                    : 'bg-surface-container-high text-primary'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">
                  {speaking ? 'graphic_eq' : 'smart_toy'}
                </span>
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-label-md font-bold text-primary truncate">Aetheria Voice Guide</span>
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-primary/20 text-primary shrink-0">
                    {step.badge}
                  </span>
                </div>
                <div className="text-[11px] text-on-surface-variant font-mono">
                  Step {currentStepIndex + 1} of {FEATURE_TOUR_STEPS.length}
                </div>
              </div>
            </div>

            {/* Window controls */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMinimized(!minimized)}
                aria-label={minimized ? 'Expand voice guide' : 'Minimize voice guide'}
                className="w-7 h-7 rounded-lg hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {minimized ? 'expand_less' : 'expand_more'}
                </span>
              </button>
              <button
                type="button"
                onClick={handleClose}
                aria-label="Close voice guide"
                className="w-7 h-7 rounded-lg hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
          </div>

          {!minimized && (
            <div className="space-y-3 pt-3">
              {/* Spoken subtitle card */}
              <div className="p-3.5 rounded-2xl bg-surface-container border border-outline-variant/35 text-xs sm:text-sm text-on-surface leading-relaxed relative overflow-hidden">
                <div className="flex items-center gap-1.5 font-bold text-primary mb-1">
                  <span className="material-symbols-outlined text-[16px]">{step.icon}</span>
                  <span>{step.title}</span>
                </div>
                <p className="italic text-on-surface/90">"{step.speechText}"</p>

                {speaking && (
                  <div className="flex items-center gap-1 mt-2 text-[10px] text-secondary font-bold uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-ping" />
                    <span>Speaking now...</span>
                  </div>
                )}
              </div>

              {/* Progress bar */}
              <div className="w-full bg-surface-container-high h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-gradient-to-r from-primary to-secondary h-full transition-all duration-300"
                  style={{ width: `${((currentStepIndex + 1) / FEATURE_TOUR_STEPS.length) * 100}%` }}
                />
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleReplay}
                    aria-label="Replay audio"
                    className="px-2.5 py-1.5 rounded-xl bg-surface-container-high hover:bg-surface-bright text-on-surface text-xs font-semibold flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[15px] text-primary">replay</span>
                    <span>Replay</span>
                  </button>

                  {speaking && (
                    <button
                      type="button"
                      onClick={stopSpeaking}
                      className="px-2.5 py-1.5 rounded-xl bg-error-container/40 text-on-error-container text-xs font-semibold flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[15px]">volume_off</span>
                      <span>Mute</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {currentStepIndex > 0 && (
                    <button
                      type="button"
                      onClick={handlePrev}
                      className="px-3 py-1.5 rounded-xl bg-surface-container-high hover:bg-surface-bright text-on-surface text-xs font-semibold"
                    >
                      Back
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleNext}
                    className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-primary to-primary-fixed text-on-primary-container text-xs font-bold shadow-md hover:brightness-110 flex items-center gap-1"
                  >
                    <span>
                      {currentStepIndex === FEATURE_TOUR_STEPS.length - 1 ? 'Finish Tour' : 'Next Feature'}
                    </span>
                    <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </aside>
      )}
    </>
  );
};
