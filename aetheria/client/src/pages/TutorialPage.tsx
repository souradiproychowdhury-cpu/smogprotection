import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ModalDialog } from '../components/ModalDialog';
import { api } from '../lib/api';
import { idbGet, idbSet } from '../lib/idb';
import { useAppStore } from '../store/useAppStore';
import { useTranslation } from '../i18n/useTranslation';
import { useVoice } from '../voice/useVoice';

interface TopicLesson {
  id: string;
  icon: string;
  title: string;
  summary: string;
  steps: string[];
  practiceRoute: string;
  practiceSelector: string;
  practiceSuccess: string;
}

const BASE_LESSONS: TopicLesson[] = [
  {
    id: 'aqi-colors',
    icon: 'palette',
    title: 'Understand the AQI Colours',
    summary: 'Learn what Green, Teal, Amber, and Crimson mean for your family.',
    steps: [
      'Green (0–25 Pristine): Safe for normal outdoor activity and window ventilation.',
      'Teal (26–75 Temperate): Acceptable for most people; sensitive groups watch symptoms.',
      'Amber (76–150 Smog Intrusion): Close drafty windows and run filtration.',
      'Crimson (151+ Hazardous): Stay indoors with sealed rooms; wear N95/FFP2 outside.'
    ],
    practiceRoute: '/',
    practiceSelector: "[data-tour='header-aqi-pill']",
    practiceSuccess: 'Nice! You opened the Live AQI Telemetry breakdown.'
  },
  {
    id: 'diy-filter',
    icon: 'cyclone',
    title: 'Make a DIY Air Filter',
    summary: 'Cut bedroom PM2.5 by 50–80% with a box fan and MERV-13 filter.',
    steps: [
      'Open the Vault tab at the bottom (or left rail on desktop).',
      'Tap "Open Guide" on the DIY Box-Fan MERV-13 Filter card.',
      'Seal the filter tightly to the fan intake side with tape or bungee cord.'
    ],
    practiceRoute: '/vault',
    practiceSelector: "[data-tour='vault-filters']",
    practiceSuccess: 'Awesome! You reached the Vault filter controls.'
  },
  {
    id: 'voice-assistant',
    icon: 'mic',
    title: 'Use the Voice Assistant',
    summary: 'Speak in any language to check AQI, navigate, or log inhaler doses.',
    steps: [
      'Tap the gold floating microphone button in the bottom-right corner.',
      'Say commands like "What is the air quality?", "Open health profile", or "Change language to Hindi".',
      'Review the transcript or tap Listen on any Oracle answer.'
    ],
    practiceRoute: '/',
    practiceSelector: "[data-tour='global-mic']",
    practiceSuccess: 'Great! You activated the global Voice Assistant.'
  },
  {
    id: 'child-alerts',
    icon: 'notifications_active',
    title: 'Set Up Alerts for My Child',
    summary: 'Get inversion warnings and send school advisories in your language.',
    steps: [
      'Open Health Shield from Sanctuary or the footer/rail.',
      'Select or add your child’s profile and triggers.',
      'Open Inversion Alert to enable push notifications and draft a school message.'
    ],
    practiceRoute: '/alert',
    practiceSelector: "[data-tour='alert-physics']",
    practiceSuccess: 'Well done! You inspected the Thermal Inversion alert view.'
  },
  {
    id: 'clean-route',
    icon: 'alt_route',
    title: 'Find a Clean Walking Route',
    summary: 'Pick corridors that minimize total inhaled PM2.5 over time.',
    steps: [
      'Open Clean-Air Route from Sanctuary or Oracle.',
      'Enter your starting point and destination.',
      'Compare exposure (concentration × time) and tap Start Voice-Guided Corridor.'
    ],
    practiceRoute: '/route',
    practiceSelector: "[data-tour='route-planner']",
    practiceSuccess: 'Great! You are in the Clean-Air Route planner.'
  },
  {
    id: 'join-guild',
    icon: 'groups',
    title: 'Join My Neighbourhood Guild',
    summary: 'Take daily clean-air pledges and see local smog reduction.',
    steps: [
      'Open the Impact tab.',
      'Review the live pollution map around your neighbourhood.',
      'Tap "Take Pledge Today" on any Solidarity Protocol initiative.'
    ],
    practiceRoute: '/impact',
    practiceSelector: "[data-tour='impact-pledges']",
    practiceSuccess: 'Excellent! You found the neighbourhood pledge cards.'
  }
];

export const TutorialPage: React.FC = () => {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const { speakText } = useVoice();

  const tutorial = useAppStore((s) => s.tutorial);
  const setTutorial = useAppStore((s) => s.setTutorial);
  const pushToast = useAppStore((s) => s.pushToast);

  const [lessons, setLessons] = useState<TopicLesson[]>(BASE_LESSONS);
  const [selectedLesson, setSelectedLesson] = useState<TopicLesson | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [asking, setAsking] = useState(false);

  // Translate lessons dynamically into active language (cached in IDB)
  useEffect(() => {
    let cancelled = false;
    async function translateLessons() {
      if (language.code === 'en') {
        setLessons(BASE_LESSONS);
        return;
      }
      const cacheKey = `lessons:${language.code}:v1`;
      const cached = await idbGet<TopicLesson[]>(cacheKey);
      if (!cancelled && cached && cached.length === BASE_LESSONS.length) {
        setLessons(cached);
        return;
      }
      if (!navigator.onLine) return;
      try {
        const dict: Record<string, string> = {};
        BASE_LESSONS.forEach((l) => {
          dict[`${l.id}.title`] = l.title;
          dict[`${l.id}.summary`] = l.summary;
          l.steps.forEach((s, idx) => {
            dict[`${l.id}.s${idx}`] = s;
          });
        });
        const res = await api.translate(language.englishName || language.nativeName, dict);
        if (!cancelled && res.translations) {
          const translated = BASE_LESSONS.map((l) => ({
            ...l,
            title: res.translations[`${l.id}.title`] || l.title,
            summary: res.translations[`${l.id}.summary`] || l.summary,
            steps: l.steps.map((s, idx) => res.translations[`${l.id}.s${idx}`] || s)
          }));
          setLessons(translated);
          await idbSet(cacheKey, translated);
        }
      } catch {
        // Keep base lessons
      }
    }
    translateLessons();
    return () => {
      cancelled = true;
    };
  }, [language.code, language.englishName, language.nativeName]);

  const handleAskTutorial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || asking) return;
    setAsking(true);
    try {
      const res = await api.askTutorial(question, language.englishName || language.nativeName);
      setAnswer(res.answer);
      speakText(res.answer);
    } catch {
      pushToast('Could not reach tutorial assistant', 'error');
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Guided Tour Hero */}
      <section className="rounded-2xl bg-surface-container-high p-5 shadow-xl gilded-rim space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-label-sm uppercase tracking-widest text-primary font-bold">
              Interactive Walkthrough ({language.nativeName})
            </span>
            <h1 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
              Aetheria Guided Tour & Tutorial Library
            </h1>
          </div>
          {tutorial.stepIndex > 0 && !tutorial.completed && (
            <span className="px-2.5 py-1 rounded-full bg-secondary/15 text-secondary text-xs font-bold">
              Paused at Step {tutorial.stepIndex + 1}
            </span>
          )}
        </div>

        <p className="font-body-sm text-on-surface-variant">
          Take a spotlight tour across every screen with spoken narration in your language, practice tapping real controls, or ask any question below.
        </p>

        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => setTutorial({ active: true, paused: false })}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-primary-container to-primary text-on-primary-container font-label-md font-bold flex items-center gap-2 shadow-lg"
          >
            <span className="material-symbols-outlined text-[18px]">play_arrow</span>
            <span>{tutorial.stepIndex > 0 ? 'Resume Guided Tour' : 'Start 24-Step Guided Tour'}</span>
          </button>

          <button
            type="button"
            onClick={() => setTutorial({ active: true, stepIndex: 0, autoPlay: true, paused: false })}
            className="px-4 py-2.5 rounded-xl bg-secondary-container text-on-secondary-container font-label-md font-bold flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">record_voice_over</span>
            <span>Auto-Play Narrated Tour</span>
          </button>

          <button
            type="button"
            onClick={() => setTutorial({ active: true, stepIndex: 0, autoPlay: false, paused: false })}
            className="px-4 py-2.5 rounded-xl bg-surface-container text-on-surface font-label-md font-semibold flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">replay</span>
            <span>Restart from Step 1</span>
          </button>
        </div>
      </section>

      {/* Ask-the-Tutorial Box */}
      <section className="rounded-2xl bg-surface-container p-5 space-y-3">
        <h2 className="font-headline-sm text-on-surface font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">support_agent</span>
          <span>Ask Anything About How to Use Aetheria</span>
        </h2>

        <form onSubmit={handleAskTutorial} className="flex gap-2">
          <label htmlFor="tutorial-ask-input" className="sr-only">
            Ask a question about using Aetheria
          </label>
          <input
            id="tutorial-ask-input"
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. How do I switch language or log an inhaler dose?"
            className="flex-1 px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
          />
          <button
            type="submit"
            disabled={asking || !question.trim()}
            className="px-4 py-2.5 rounded-xl bg-primary text-on-primary font-label-md font-bold disabled:opacity-50"
          >
            {asking ? 'Thinking...' : 'Ask'}
          </button>
        </form>

        {answer && (
          <div className="p-3.5 rounded-xl bg-surface-container-low text-sm text-on-surface flex items-start justify-between gap-3">
            <p className="leading-relaxed">{answer}</p>
            <button
              type="button"
              onClick={() => speakText(answer)}
              aria-label="Listen to tutorial answer"
              className="text-primary shrink-0"
            >
              <span className="material-symbols-outlined">volume_up</span>
            </button>
          </div>
        )}
      </section>

      {/* Topic Lessons Grid */}
      <section className="space-y-3">
        <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
          Step-by-Step Topic Lessons
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {lessons.map((lesson) => (
            <article
              key={lesson.id}
              className="rounded-2xl bg-surface-container-low p-4 shadow-lg flex flex-col justify-between gap-4 border border-outline-variant/25"
            >
              <div className="space-y-2">
                <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-[22px]">{lesson.icon}</span>
                </div>
                <h3 className="font-headline-sm text-on-surface font-semibold">{lesson.title}</h3>
                <p className="font-body-sm text-on-surface-variant">{lesson.summary}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedLesson(lesson)}
                  className="flex-1 py-2 px-3 rounded-xl bg-surface-container-high hover:bg-surface-bright text-primary font-label-md font-semibold"
                >
                  Open Lesson
                </button>
                <button
                  type="button"
                  onClick={() => speakText(`${lesson.title}. ${lesson.steps.join(' ')}`)}
                  aria-label={`Listen to ${lesson.title}`}
                  className="px-3 py-2 rounded-xl bg-surface-container-high hover:bg-surface-bright text-secondary flex items-center gap-1 font-label-sm font-bold"
                >
                  <span className="material-symbols-outlined text-[18px]">volume_up</span>
                  <span>Listen</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Lesson Detail + Practice Mode Modal */}
      <ModalDialog
        open={Boolean(selectedLesson)}
        onClose={() => setSelectedLesson(null)}
        title={selectedLesson?.title || 'Lesson'}
      >
        {selectedLesson && (
          <div className="space-y-4">
            <p className="text-sm text-on-surface-variant">{selectedLesson.summary}</p>
            <ol className="list-decimal ps-5 space-y-2 text-sm text-on-surface">
              {selectedLesson.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                onClick={() => speakText(`${selectedLesson.title}. ${selectedLesson.steps.join(' ')}`)}
                className="px-4 py-2 rounded-xl bg-surface-container-high text-secondary font-label-md font-semibold flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[18px]">volume_up</span>
                <span>Listen</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const lesson = selectedLesson;
                  setSelectedLesson(null);
                  setTutorial({
                    active: false,
                    practiceTarget: lesson.practiceSelector,
                    practiceSuccessMessage: lesson.practiceSuccess
                  });
                  navigate(lesson.practiceRoute);
                  pushToast('Practice Mode active: tap the control shown!', 'info');
                }}
                className="flex-1 px-4 py-2 rounded-xl bg-gradient-to-r from-primary-container to-primary text-on-primary-container font-label-md font-bold flex items-center justify-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[18px]">touch_app</span>
                <span>Practice Mode (Try It Live)</span>
              </button>
            </div>
          </div>
        )}
      </ModalDialog>
    </div>
  );
};
