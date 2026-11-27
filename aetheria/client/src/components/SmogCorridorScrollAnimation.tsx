import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AirQualityData } from '@aetheria/shared';

interface SmogCorridorScrollAnimationProps {
  air: AirQualityData | null;
}

const TOTAL_FRAMES = 8;
const FRAME_PATHS = Array.from({ length: TOTAL_FRAMES }, (_, i) => `/frames/frame_000${i + 1}.jpg`);

interface AltitudeTelemetry {
  altitudeM: number;
  label: string;
  sublabel: string;
  hazardLevel: 'moderate' | 'high' | 'severe';
  estimatedPm25: number;
}

export const SmogCorridorScrollAnimation: React.FC<SmogCorridorScrollAnimationProps> = ({ air }) => {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [images, setImages] = useState<HTMLImageElement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [progress, setProgress] = useState(0); // 0 to 1
  const [sanctuaryMode, setSanctuaryMode] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const playTimerRef = useRef<number | null>(null);

  // Preload all 8 video frames
  useEffect(() => {
    let mounted = true;
    const loadedImages: HTMLImageElement[] = [];
    let count = 0;

    FRAME_PATHS.forEach((src, idx) => {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        if (!mounted) return;
        loadedImages[idx] = img;
        count++;
        if (count === TOTAL_FRAMES) {
          setImages(loadedImages);
          setLoaded(true);
        }
      };
      img.onerror = () => {
        if (!mounted) return;
        count++;
        if (count === TOTAL_FRAMES) {
          setImages(loadedImages);
          setLoaded(true);
        }
      };
    });

    return () => {
      mounted = false;
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
  }, []);

  // Compute telemetry based on scrub progress
  const telemetry: AltitudeTelemetry = (() => {
    const basePm25 = air?.pm25 ?? 145;
    if (progress < 0.3) {
      return {
        altitudeM: Math.round(480 - progress * 400),
        label: 'Upper Atmosphere Boundary',
        sublabel: 'Dim Sun Penetration · Free-Troposphere Mixing',
        hazardLevel: 'moderate',
        estimatedPm25: Math.round(basePm25 * 0.55)
      };
    }
    if (progress < 0.7) {
      return {
        altitudeM: Math.round(360 - progress * 240),
        label: 'Thermal Inversion Cap Layer',
        sublabel: 'Factory Chimney & Vehicle Exhaust Trapped Under Cold Lid',
        hazardLevel: 'high',
        estimatedPm25: Math.round(basePm25 * 0.85)
      };
    }
    return {
      altitudeM: Math.round(180 - (progress - 0.7) * 400),
      label: 'Ground-Level Urban Smog Canyon',
      sublabel: 'Critical Inhaled Particulate Zone · Severe Vehicle & Hearth Entrapment',
      hazardLevel: 'severe',
      estimatedPm25: Math.round(basePm25 * 1.35)
    };
  })();

  // Render to canvas with cross-fade interpolation
  const renderFrame = (ratio: number) => {
    const canvas = canvasRef.current;
    if (!canvas || images.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    const framePosition = ratio * (TOTAL_FRAMES - 1);
    const frameIndex = Math.min(TOTAL_FRAMES - 1, Math.floor(framePosition));
    const nextIndex = Math.min(TOTAL_FRAMES - 1, frameIndex + 1);
    const fraction = framePosition - frameIndex;

    ctx.clearRect(0, 0, w, h);

    const imgA = images[frameIndex];
    const imgB = images[nextIndex];

    if (imgA && imgA.complete && imgA.naturalWidth > 0) {
      ctx.globalAlpha = 1;
      ctx.drawImage(imgA, 0, 0, w, h);
    }

    if (fraction > 0.01 && imgB && imgB.complete && imgB.naturalWidth > 0) {
      ctx.globalAlpha = fraction;
      ctx.drawImage(imgB, 0, 0, w, h);
    }

    ctx.globalAlpha = 1;

    // If Sanctuary Mode is active, overlay golden filtration shield effect
    if (sanctuaryMode) {
      ctx.save();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(245, 158, 11, 0.12)');
      grad.addColorStop(0.5, 'rgba(16, 185, 129, 0.18)');
      grad.addColorStop(1, 'rgba(6, 78, 59, 0.35)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Clean particle aura
      ctx.strokeStyle = 'rgba(104, 219, 169, 0.5)';
      ctx.lineWidth = 4;
      ctx.strokeRect(4, 4, w - 8, h - 8);
      ctx.restore();
    }
  };

  // Update canvas on progress or sanctuaryMode change
  useEffect(() => {
    if (loaded && images.length > 0) {
      renderFrame(progress);
    }
  }, [progress, loaded, images, sanctuaryMode]);

  // Handle window scroll tracking
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let ticking = false;

    const handleScroll = () => {
      if (isPlaying) return; // don't override while user clicked play
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const rect = container.getBoundingClientRect();
          const windowHeight = window.innerHeight;

          // Compute progress based on container position relative to viewport
          const totalDistance = windowHeight + rect.height;
          const currentPos = windowHeight - rect.top;
          const rawProgress = currentPos / totalDistance;
          const clamped = Math.max(0, Math.min(1, rawProgress));

          setProgress(clamped);
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, [isPlaying]);

  // Auto-play preview loop
  const togglePlay = () => {
    if (isPlaying) {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      let currentP = progress >= 0.98 ? 0 : progress;
      playTimerRef.current = window.setInterval(() => {
        currentP += 0.02;
        if (currentP >= 1) {
          currentP = 0;
        }
        setProgress(currentP);
      }, 50);
    }
  };

  return (
    <section
      ref={containerRef}
      className="relative rounded-3xl bg-surface-container-high/90 border border-outline-variant/35 shadow-2xl p-4 sm:p-6 overflow-hidden gilded-rim space-y-4"
    >
      {/* Background glow halo */}
      <div
        className="absolute -top-20 -right-20 w-80 h-80 rounded-full blur-3xl opacity-20 pointer-events-none transition-colors duration-700"
        style={{
          backgroundColor:
            sanctuaryMode ? '#68dba9' : telemetry.hazardLevel === 'severe' ? '#ef4444' : '#f59e0b'
        }}
      />

      {/* Header & Badges */}
      <div className="flex flex-wrap items-center justify-between gap-3 relative z-10">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-label-sm uppercase tracking-widest text-primary font-bold">
              Cinematic Inversion Exploration
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-primary/20 text-primary">
              Scroll-Driven Scrubber
            </span>
          </div>
          <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center gap-2">
            <span>Urban Smog Canyon &amp; Thermal Inversion Trap</span>
          </h2>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause preview' : 'Play cinematic animation'}
            className="px-3.5 py-1.5 rounded-xl bg-surface-container hover:bg-surface-bright text-on-surface text-xs font-bold flex items-center gap-1.5 border border-outline-variant/40 transition shadow-sm"
          >
            <span className="material-symbols-outlined text-[16px] text-primary">
              {isPlaying ? 'pause' : 'play_arrow'}
            </span>
            <span>{isPlaying ? 'Pause' : 'Auto-Play Flyover'}</span>
          </button>

          <button
            type="button"
            onClick={() => setSanctuaryMode(!sanctuaryMode)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-sm border ${
              sanctuaryMode
                ? 'bg-secondary text-on-secondary border-secondary shadow-[0_0_16px_rgba(104,219,169,0.35)]'
                : 'bg-surface-container text-on-surface border-outline-variant/40 hover:bg-surface-bright'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">
              {sanctuaryMode ? 'verified' : 'filter_vintage'}
            </span>
            <span>{sanctuaryMode ? 'Sanctuary Filter: ON' : 'Simulate Clean Sanctuary'}</span>
          </button>
        </div>
      </div>

      <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed max-w-3xl relative z-10">
        Extracted from real-world megacity smog flyover video frames. Scroll down the page or drag the slider
        to descend through the atmospheric inversion layer — watch how dual chimney emissions and ground traffic
        plumes are compressed under the thermal lid.
      </p>

      {/* Main Canvas + Telemetry Overlays */}
      <div className="relative rounded-2xl overflow-hidden border border-outline-variant/40 bg-black aspect-video max-h-[460px] shadow-2xl flex items-center justify-center">
        <canvas
          ref={canvasRef}
          width={1280}
          height={720}
          className={`w-full h-full object-cover transition-filter duration-300 ${
            sanctuaryMode ? 'filter contrast-110 brightness-105' : ''
          }`}
        />

        {/* Fallback skeleton if loading */}
        {!loaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface-container-lowest/80 backdrop-blur-md text-primary text-xs space-y-2">
            <span className="material-symbols-outlined text-3xl animate-spin">cyclone</span>
            <span>Buffering Inversion Video Frames...</span>
          </div>
        )}

        {/* Top HUD Telemetry Bar */}
        <div className="absolute top-3 inset-x-3 flex items-center justify-between gap-2 z-20 pointer-events-none">
          <div className="px-3 py-1.5 rounded-xl bg-surface-container-lowest/85 backdrop-blur-md border border-outline-variant/40 text-xs flex items-center gap-2 shadow-lg">
            <span className="material-symbols-outlined text-[16px] text-primary">altitude</span>
            <span className="font-mono font-bold text-on-surface">
              Altitude: ~{telemetry.altitudeM} m
            </span>
            <span className="text-on-surface-variant">·</span>
            <span className="text-on-surface font-semibold hidden sm:inline">
              {telemetry.label}
            </span>
          </div>

          <div className="px-3 py-1.5 rounded-xl bg-surface-container-lowest/85 backdrop-blur-md border border-outline-variant/40 text-xs flex items-center gap-2 shadow-lg">
            <span
              className={`w-2 h-2 rounded-full ${
                telemetry.hazardLevel === 'severe'
                  ? 'bg-error animate-ping'
                  : telemetry.hazardLevel === 'high'
                  ? 'bg-amber-500'
                  : 'bg-secondary'
              }`}
            />
            <span className="font-mono font-bold text-on-surface">
              Est. Inhaled PM2.5: {telemetry.estimatedPm25} µg/m³
            </span>
          </div>
        </div>

        {/* Sanctuary Mode Banner if Active */}
        {sanctuaryMode && (
          <div className="absolute top-14 left-3 px-3 py-1.5 rounded-xl bg-secondary-container/95 border border-secondary text-on-secondary-container text-xs font-bold flex items-center gap-2 shadow-xl z-20 animate-fade-in pointer-events-none">
            <span className="material-symbols-outlined text-[16px]">air_purifier_gen</span>
            <span>Sanctuary Shield: -85% PM2.5 Particulate Filtration Active</span>
          </div>
        )}

        {/* Bottom HUD Strip */}
        <div className="absolute bottom-3 inset-x-3 flex flex-col sm:flex-row items-center justify-between gap-2 z-20">
          <div className="px-3 py-1.5 rounded-xl bg-surface-container-lowest/90 backdrop-blur-md border border-outline-variant/40 text-[11px] text-on-surface-variant flex items-center gap-2 shadow-lg max-w-lg">
            <span className="material-symbols-outlined text-primary text-[15px] shrink-0">info</span>
            <span className="truncate">{telemetry.sublabel}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/alert')}
              className="px-3 py-1.5 rounded-xl bg-surface-container-high/90 hover:bg-surface-bright text-primary text-xs font-bold border border-outline-variant/50 backdrop-blur-md transition shadow flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[15px]">warning</span>
              <span>Inversion Physics</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/route')}
              className="px-3 py-1.5 rounded-xl bg-primary text-on-primary text-xs font-bold shadow-md hover:brightness-110 transition flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[15px]">alt_route</span>
              <span>Clean Route</span>
            </button>
          </div>
        </div>
      </div>

      {/* Scrubbing Control Bar */}
      <div className="space-y-1.5 relative z-10 pt-1">
        <div className="flex items-center justify-between text-xs text-on-surface-variant font-label-sm">
          <span>Scroll down or drag slider to scrub through flyover (Frame {Math.round(progress * 7) + 1} of 8)</span>
          <span className="font-mono text-primary font-bold">{Math.round(progress * 100)}% Trajectory</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] font-mono text-on-surface-variant shrink-0">480m Sun</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={progress}
            onChange={(e) => {
              if (isPlaying) setIsPlaying(false);
              setProgress(Number(e.target.value));
            }}
            aria-label="Inversion corridor frame scrubber"
            className="w-full accent-amber-500 cursor-pointer h-2 bg-surface-container rounded-lg"
          />
          <span className="text-[11px] font-mono text-error font-bold shrink-0">Ground Lid</span>
        </div>
      </div>
    </section>
  );
};
