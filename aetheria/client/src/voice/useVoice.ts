import { useCallback, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { scheduleLocalReminder, showLocalNotification } from '../lib/notifications';
import { useAppStore } from '../store/useAppStore';
import { useTranslation } from '../i18n/useTranslation';
import rawTourSteps from '../tutorial/steps.json';

let sharedAudioEl: HTMLAudioElement | null = null;

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export function useVoice() {
  const navigate = useNavigate();
  const location = useLocation();
  const { language, selectCustomLanguage } = useTranslation();

  const a11y = useAppStore((s) => s.a11y);
  const air = useAppStore((s) => s.air);
  const profile = useAppStore((s) => s.profile);
  const activeDependentId = useAppStore((s) => s.activeDependentId);
  const administerDose = useAppStore((s) => s.administerDose);
  const vaultChecklist = useAppStore((s) => s.vaultChecklist);
  const toggleVaultChecklist = useAppStore((s) => s.toggleVaultChecklist);
  const setTutorial = useAppStore((s) => s.setTutorial);
  const addOracleMessage = useAppStore((s) => s.addOracleMessage);
  const pushToast = useAppStore((s) => s.pushToast);

  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [replyText, setReplyText] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{
    prompt: string;
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [detectedSwitchLang, setDetectedSwitchLang] = useState<{
    language: string;
    bcp47: string;
  } | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (sharedAudioEl) {
      sharedAudioEl.pause();
      sharedAudioEl = null;
    }
    setSpeaking(false);
  }, []);

  const speakText = useCallback(
    async (text: string, overrideLangBcp47?: string) => {
      if (!text.trim()) return;
      stopSpeaking();
      const targetBcp = overrideLangBcp47 || language.bcp47 || 'en-US';
      const baseLang = targetBcp.split('-')[0].toLowerCase();

      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const voices = window.speechSynthesis.getVoices();
        const match =
          voices.find((v) => v.lang.toLowerCase() === targetBcp.toLowerCase()) ||
          voices.find((v) => v.lang.toLowerCase().startsWith(baseLang));

        if (match || baseLang === 'en') {
          const utter = new SpeechSynthesisUtterance(text);
          if (match) utter.voice = match;
          utter.lang = targetBcp;
          utter.rate = a11y.speechRate || 1.0;
          utter.onstart = () => setSpeaking(true);
          utter.onend = () => setSpeaking(false);
          utter.onerror = () => setSpeaking(false);
          setSpeaking(true);
          window.speechSynthesis.speak(utter);
          return;
        }
      }

      // Fallback to Gemini TTS for languages without a local browser voice
      if (navigator.onLine) {
        try {
          setSpeaking(true);
          const tts = await api.tts(text, language.englishName || language.nativeName);
          if (tts.available && tts.audioBase64) {
            const audio = new Audio(`data:${tts.mimeType || 'audio/wav'};base64,${tts.audioBase64}`);
            audio.playbackRate = a11y.speechRate || 1.0;
            sharedAudioEl = audio;
            audio.onended = () => setSpeaking(false);
            audio.onerror = () => setSpeaking(false);
            await audio.play();
            return;
          }
        } catch {
          // fallback to browser speechSynthesis best-effort
        }
      }

      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = targetBcp;
        utter.rate = a11y.speechRate || 1.0;
        utter.onend = () => setSpeaking(false);
        setSpeaking(true);
        window.speechSynthesis.speak(utter);
      } else {
        setSpeaking(false);
      }
    },
    [a11y.speechRate, language.bcp47, language.englishName, language.nativeName, stopSpeaking]
  );

  const executeTranscript = useCallback(
    async (spokenText: string) => {
      const clean = spokenText.trim();
      if (!clean) {
        pushToast('No speech detected. Tap the microphone to try again.', 'info');
        return;
      }
      setTranscript(clean);

      // Handle voice yes/no confirmation when a destructive/send action is waiting
      if (pendingConfirm) {
        if (/^(yes|confirm|send|ok|haan|ha|sí|oui|হ্যাঁ)/i.test(clean)) {
          const fn = pendingConfirm.onConfirm;
          setPendingConfirm(null);
          await fn();
          return;
        }
        if (/^(no|cancel|stop|mat|nahi|না)/i.test(clean)) {
          setPendingConfirm(null);
          const msg = 'Cancelled. Nothing was sent.';
          setReplyText(msg);
          speakText(msg);
          return;
        }
      }

      try {
        const intentRes = await api.voiceIntent(
          clean,
          language.englishName || 'English',
          location.pathname
        );

        let spokenReply = intentRes.replyText;

        switch (intentRes.intent) {
          case 'navigate': {
            const route = intentRes.params.route || '/';
            navigate(route);
            break;
          }
          case 'read_aqi': {
            if (air) {
              const safeNote =
                air.aqi > 150
                  ? 'Hazardous smog — keep infants, seniors, and asthma patients indoors with filtration.'
                  : air.aqi > 75
                  ? 'Smog intrusion — limit strenuous outdoor play for sensitive groups.'
                  : 'Air quality is relatively safe right now.';
              spokenReply = `In ${air.locationName}, US AQI is ${air.aqi} (${air.categoryLabel}). PM2.5 is ${air.pm25} micrograms per cubic meter, ${air.whoMultiple} times the WHO guideline. ${safeNote}`;
            } else {
              spokenReply = 'Air quality data is still loading. Please try again in a moment.';
            }
            break;
          }
          case 'log_dose': {
            administerDose(activeDependentId);
            pushToast('Inhaler dose logged', 'success');
            navigate('/health');
            break;
          }
          case 'mark_checklist': {
            const target = vaultChecklist.find((item) => !item.checked) || vaultChecklist[0];
            if (target) {
              toggleVaultChecklist(target.id);
              spokenReply = `Marked "${target.title}" as done.`;
              pushToast(`Updated checklist: ${target.title}`, 'success');
            }
            break;
          }
          case 'set_reminder': {
            const label = intentRes.params.label || 'Open windows for brief ventilation';
            scheduleLocalReminder('Aetheria Clean-Air Reminder', label, 15000);
            showLocalNotification('Reminder Scheduled', label);
            pushToast(`Reminder set: ${label}`, 'success');
            break;
          }
          case 'send_alert': {
            setPendingConfirm({
              prompt: intentRes.replyText || 'Shall I open and dispatch the school/caregiver alert? Say Yes or tap Confirm.',
              onConfirm: () => {
                navigate('/alert');
                pushToast('Alert ready to dispatch on Inversion Alert screen', 'success');
                speakText('Alert screen opened. Tap Send to dispatch.');
              }
            });
            setReplyText(intentRes.replyText);
            speakText(intentRes.replyText);
            return;
          }
          case 'start_route': {
            const dest = intentRes.params.destination || '';
            navigate(`/route${dest ? `?to=${encodeURIComponent(dest)}` : ''}`);
            break;
          }
          case 'change_language': {
            const targetLang = intentRes.params.language || 'Hindi';
            await selectCustomLanguage(targetLang);
            spokenReply = `Switched language to ${targetLang}.`;
            break;
          }
          case 'tutorial_control': {
            const action = intentRes.params.action || 'start';
            const tutState = useAppStore.getState().tutorial;
            const totalSteps = rawTourSteps.length;
            if (action === 'start') {
              setTutorial({ active: true, paused: false, stepIndex: 0 });
            } else if (action === 'next') {
              const nextIdx = Math.min(totalSteps - 1, tutState.stepIndex + 1);
              setTutorial({ active: true, stepIndex: nextIdx });
            } else if (action === 'back') {
              const prevIdx = Math.max(0, tutState.stepIndex - 1);
              setTutorial({ active: true, stepIndex: prevIdx });
            } else if (action === 'repeat') {
              const step = rawTourSteps[tutState.stepIndex] || rawTourSteps[0];
              spokenReply = `${step.title}. ${step.body}`;
              setTutorial({ active: true });
            } else if (action === 'pause') {
              setTutorial({ paused: true });
            } else if (action === 'stop') {
              setTutorial({ active: false, autoPlay: false });
            }
            break;
          }
          case 'oracle_question':
          default: {
            const q = intentRes.params.question || clean;
            navigate('/oracle');
            addOracleMessage({
              id: `u-${Date.now()}`,
              role: 'user',
              text: q,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
            const oracle = await api.streamOracle({
              message: q,
              language: language.englishName || 'English',
              profile,
              lat: air?.lat,
              lon: air?.lon,
              locationName: air?.locationName,
              localTime: new Date().toLocaleTimeString()
            });
            addOracleMessage({
              id: `o-${Date.now()}`,
              role: 'oracle',
              text: oracle.data.summary,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              card: oracle.data,
              isAiFallback: oracle.isAiFallback,
              notice: oracle.notice
            });
            spokenReply = `${oracle.data.title}. ${oracle.data.summary}`;
            break;
          }
        }

        setReplyText(spokenReply);
        speakText(spokenReply);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Voice processing failed';
        setReplyText(msg);
        pushToast(msg, 'error');
      }
    },
    [
      activeDependentId,
      addOracleMessage,
      air,
      language.englishName,
      location.pathname,
      navigate,
      pendingConfirm,
      profile,
      pushToast,
      selectCustomLanguage,
      setTutorial,
      speakText,
      toggleVaultChecklist,
      vaultChecklist,
      administerDose
    ]
  );

  const startMediaRecorderFallback = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      pushToast('Microphone recording is not supported in this browser.', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      setListening(true);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        setListening(false);
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = String(reader.result || '').split(',')[1];
          if (!base64) return;
          try {
            const stt = await api.stt(base64, blob.type || 'audio/webm', language.englishName);
            if (
              stt.detectedBcp47 &&
              stt.detectedBcp47.split('-')[0].toLowerCase() !== language.code.toLowerCase()
            ) {
              setDetectedSwitchLang({ language: stt.detectedLanguage, bcp47: stt.detectedBcp47 });
            }
            await executeTranscript(stt.transcript);
          } catch {
            pushToast('Could not transcribe audio. Try typing or check GEMINI_API_KEY.', 'error');
          }
        };
        reader.readAsDataURL(blob);
      };

      recorder.start();
      setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 6000);
    } catch {
      setListening(false);
      pushToast('Microphone permission denied. Allow mic access in browser settings.', 'error');
    }
  }, [executeTranscript, language.code, language.englishName, pushToast]);

  const startListening = useCallback(() => {
    stopSpeaking();
    setDetectedSwitchLang(null);

    if (!navigator.onLine) {
      pushToast('You are offline — voice intent requires connection. Showing cached data.', 'info');
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRec) {
      startMediaRecorderFallback();
      return;
    }

    try {
      const rec = new SpeechRec();
      recognitionRef.current = rec;
      rec.lang = language.bcp47 || 'en-US';
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      let latest = '';

      setListening(true);
      setTranscript('');

      rec.onresult = (e) => {
        const last = e.results[e.results.length - 1];
        if (last && last[0]) {
          latest = last[0].transcript;
          setTranscript(latest);
        }
      };

      rec.onerror = (e) => {
        setListening(false);
        if (e.error === 'not-allowed') {
          pushToast('Microphone permission denied. Enable mic access in your browser address bar.', 'error');
        } else if (e.error === 'language-not-supported') {
          startMediaRecorderFallback();
        } else if (e.error === 'no-speech') {
          pushToast('No speech heard — tap the mic and speak clearly.', 'info');
        } else {
          pushToast(`Speech recognition error: ${e.error}`, 'error');
        }
      };

      rec.onend = () => {
        setListening(false);
        if (latest.trim()) {
          executeTranscript(latest);
        }
      };

      rec.start();
    } catch {
      startMediaRecorderFallback();
    }
  }, [executeTranscript, language.bcp47, pushToast, startMediaRecorderFallback, stopSpeaking]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setListening(false);
  }, []);

  return {
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
  };
}
