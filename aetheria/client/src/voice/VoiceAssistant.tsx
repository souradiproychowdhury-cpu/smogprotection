import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useTranslation } from '../i18n/useTranslation';
import { useVoice } from './useVoice';

export const VoiceAssistant: React.FC = () => {
  const voiceOnlyMode = useAppStore((s) => s.a11y.voiceOnlyMode);
  const setA11y = useAppStore((s) => s.setA11y);
  const { selectCustomLanguage } = useTranslation();

  const {
    listening,
    speaking,
    transcript,
    setTranscript,
    replyText,
    pendingConfirm,
    setPendingConfirm,
    detectedSwitchLang,
    setDetectedSwitchLang,
    startListening,
    stopListening,
    speakText,
    stopSpeaking,
    executeTranscript
  } = useVoice();

  const [panelOpen, setPanelOpen] = useState(false);

  const handleToggleMic = () => {
    setPanelOpen(true);
    if (listening) stopListening();
    else startListening();
  };

  // Voice-Only Accessibility Mode full-screen overlay
  if (voiceOnlyMode) {
    return (
      <div
        role="region"
        aria-label="Voice-Only Accessibility Mode"
        className="fixed inset-0 z-[80] bg-surface flex flex-col justify-between p-6 text-center"
      >
        <div className="flex items-center justify-between">
          <span className="font-headline-sm text-headline-sm text-primary font-bold">
            Aetheria Voice Mode
          </span>
          <button
            type="button"
            onClick={() => setA11y({ voiceOnlyMode: false })}
            className="px-4 py-2 rounded-xl bg-surface-container-high text-on-surface font-label-lg"
          >
            Exit Voice Mode
          </button>
        </div>

        <div className="space-y-6 max-w-xl mx-auto">
          <p className="font-body-lg text-body-lg text-on-surface-variant">
            You can say: “What is the air quality?”, “Open my health profile”, “Log inhaler dose”, or “Ask how to make a filter”.
          </p>

          {transcript && (
            <div className="p-4 rounded-2xl bg-surface-container text-xl text-on-surface">
              “{transcript}”
            </div>
          )}

          {replyText && (
            <div className="p-5 rounded-2xl bg-surface-container-high gilded-rim text-2xl font-medium text-primary leading-relaxed">
              {replyText}
            </div>
          )}

          <div className="flex justify-center">
            <button
              type="button"
              onClick={listening ? stopListening : startListening}
              aria-label={listening ? 'Stop listening' : 'Tap to speak'}
              className={`w-36 h-36 rounded-full flex flex-col items-center justify-center shadow-2xl transition-all ${
                listening
                  ? 'bg-secondary text-on-secondary animate-pulse scale-105'
                  : 'bg-gradient-to-br from-primary-container to-primary text-on-primary-container'
              }`}
            >
              <span className="material-symbols-outlined text-[48px]">
                {listening ? 'graphic_eq' : 'mic'}
              </span>
              <span className="font-label-lg font-bold mt-1">
                {listening ? 'Listening...' : 'Tap to Talk'}
              </span>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => replyText && speakText(replyText)}
            className="min-h-[52px] px-6 py-3 rounded-xl bg-surface-container-high text-on-surface font-label-lg flex items-center gap-2"
          >
            <span className="material-symbols-outlined">volume_up</span>
            <span>Repeat</span>
          </button>
          <button
            type="button"
            onClick={stopSpeaking}
            className="min-h-[52px] px-6 py-3 rounded-xl bg-error-container text-on-error-container font-label-lg flex items-center gap-2"
          >
            <span className="material-symbols-outlined">stop</span>
            <span>Stop Audio</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Floating Global Mic Button */}
      <button
        type="button"
        data-tour="global-mic"
        onClick={handleToggleMic}
        aria-label={listening ? 'Stop voice assistant' : 'Tap to speak to Aetheria'}
        className={`fixed bottom-20 lg:bottom-8 end-4 lg:end-8 z-[45] w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all ${
          listening
            ? 'bg-secondary text-on-secondary ring-4 ring-secondary/40 animate-pulse'
            : 'bg-gradient-to-br from-primary-container to-primary text-on-primary-container shadow-[0_0_24px_rgba(245,158,11,0.45)] hover:scale-105'
        }`}
      >
        <span className="material-symbols-outlined text-[26px]">
          {listening ? 'graphic_eq' : 'mic'}
        </span>
      </button>

      {/* Voice Transcript & Action Panel */}
      {(panelOpen || listening || pendingConfirm) && (
        <aside
          aria-label="Voice Assistant"
          className="fixed bottom-36 lg:bottom-24 end-4 lg:end-8 z-[55] w-[min(92vw,23rem)] rounded-2xl bg-surface-container-low/95 backdrop-blur-2xl p-4 shadow-2xl gilded-rim space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  listening ? 'bg-error animate-ping' : speaking ? 'bg-secondary animate-pulse' : 'bg-primary'
                }`}
              />
              <span className="font-label-md text-label-md text-primary font-bold">
                {listening ? 'Recording Audio...' : speaking ? 'Speaking...' : 'Hey Aetheria'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                stopListening();
                stopSpeaking();
                setPanelOpen(false);
              }}
              aria-label="Close voice panel"
              className="p-1 rounded-full hover:bg-surface-container-high"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="voice-transcript-edit" className="font-label-sm text-label-sm text-on-surface-variant">
              Transcript (edit if noisy, then Run)
            </label>
            <div className="flex gap-1.5">
              <input
                id="voice-transcript-edit"
                type="text"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Say: 'what is the air quality' or 'open health'"
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant/50 text-sm text-on-surface"
              />
              <button
                type="button"
                onClick={() => executeTranscript(transcript)}
                disabled={!transcript.trim()}
                className="px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-sm font-bold disabled:opacity-40"
              >
                Run
              </button>
            </div>
          </div>

          {detectedSwitchLang && (
            <div className="p-2.5 rounded-xl bg-tertiary/15 border border-tertiary/30 flex items-center justify-between gap-2 text-xs">
              <span>Detected {detectedSwitchLang.language}. Switch app language?</span>
              <button
                type="button"
                onClick={async () => {
                  await selectCustomLanguage(detectedSwitchLang.language);
                  setDetectedSwitchLang(null);
                }}
                className="px-2 py-1 rounded bg-tertiary text-on-tertiary font-bold shrink-0"
              >
                Switch
              </button>
            </div>
          )}

          {pendingConfirm && (
            <div className="p-3 rounded-xl bg-error-container/40 border border-error/40 space-y-2">
              <p className="text-xs text-on-error-container font-medium">{pendingConfirm.prompt}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const fn = pendingConfirm.onConfirm;
                    setPendingConfirm(null);
                    await fn();
                  }}
                  className="flex-1 py-1.5 rounded-lg bg-primary text-on-primary font-label-sm font-bold"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setPendingConfirm(null)}
                  className="flex-1 py-1.5 rounded-lg bg-surface-container-high text-on-surface font-label-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {replyText && (
            <div className="p-2.5 rounded-xl bg-surface-container text-xs text-on-surface flex items-start justify-between gap-2">
              <span>{replyText}</span>
              <button
                type="button"
                onClick={() => speakText(replyText)}
                aria-label="Read reply aloud"
                className="text-primary shrink-0"
              >
                <span className="material-symbols-outlined text-[18px]">volume_up</span>
              </button>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={listening ? stopListening : startListening}
              className="flex-1 py-2 rounded-xl bg-gradient-to-r from-primary-container to-primary text-on-primary-container font-label-md font-bold flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[18px]">
                {listening ? 'stop' : 'mic'}
              </span>
              <span>{listening ? 'Stop' : 'Speak'}</span>
            </button>
            {speaking && (
              <button
                type="button"
                onClick={stopSpeaking}
                className="px-3 py-2 rounded-xl bg-surface-container-high text-error font-label-md font-semibold"
              >
                Mute
              </button>
            )}
          </div>
        </aside>
      )}
    </>
  );
};
