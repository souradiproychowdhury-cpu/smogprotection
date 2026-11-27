import React, { useEffect, useRef, useState } from 'react';
import type { AirQualityData } from '@aetheria/shared';
import { useAppStore } from '../store/useAppStore';

interface AppScrollBackgroundProps {
  air?: AirQualityData | null;
}

const TOTAL_FRAMES = 8;
const FRAME_PATHS = Array.from({ length: TOTAL_FRAMES }, (_, i) => `/frames/frame_000${i + 1}.jpg`);

interface AtmosphericTelemetry {
  altitudeM: number;
  layerTitle: string;
  sublabel: string;
  badgeColor: string;
  estimatedPm25: number;
}

export const AppScrollBackground: React.FC<AppScrollBackgroundProps> = ({ air }) => {
  const backgroundEnabled = useAppStore((s) => s.a11y.backgroundAnimation !== false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [images, setImages] = useState<HTMLImageElement[]>([]);
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [sanctuaryFilter, setSanctuaryFilter] = useState(false);
  const [chipMinimized, setChipMinimized] = useState(false);
  const [uiProgress, setUiProgress] = useState(0);

  // Mutable refs for smooth 60fps RAF loop without React re-render churn
  const progressRef = useRef(0);
  const targetProgressRef = useRef(0);
  const sanctuaryFilterRef = useRef(sanctuaryFilter);
  sanctuaryFilterRef.current = sanctuaryFilter;

  // Preload all 8 extracted cinematic video frames
  useEffect(() => {
    let mounted = true;
    const loadedList: HTMLImageElement[] = [];
    let count = 0;

    FRAME_PATHS.forEach((src, idx) => {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        if (!mounted) return;
        loadedList[idx] = img;
        count++;
        if (count === TOTAL_FRAMES) {
          setImages(loadedList);
          setImagesLoaded(true);
        }
      };
      img.onerror = () => {
        if (!mounted) return;
        count++;
        if (count === TOTAL_FRAMES) {
          setImages(loadedList);
          setImagesLoaded(true);
        }
      };
    });

    return () => {
      mounted = false;
    };
  }, []);

  // Compute telemetry based on current ui progress
  const telemetry: AtmosphericTelemetry = (() => {
    const basePm25 = air?.pm25 ?? 145;
    if (uiProgress < 0.33) {
      return {
        altitudeM: Math.round(480 - uiProgress * 420),
        layerTitle: 'Upper Troposphere Boundary',
        sublabel: 'Dim Sun Penetration · Clean Stratum Mixing',
        badgeColor: '#ffc174',
        estimatedPm25: Math.round(basePm25 * 0.55)
      };
    }
    if (uiProgress < 0.7) {
      return {
        altitudeM: Math.round(340 - (uiProgress - 0.33) * 380),
        layerTitle: 'Thermal Inversion Cap Lid',
        sublabel: 'Cold Ground Air Traps Vehicular & Hearth Exhaust',
        badgeColor: '#f59e0b',
        estimatedPm25: Math.round(basePm25 * 0.88)
      };
    }
    return {
      altitudeM: Math.round(180 - (uiProgress - 0.7) * 320),
      layerTitle: 'Ground-Level Smog Canyon',
      sublabel: 'Critical Inhaled Particulate Zone Under Trapped Lid',
      badgeColor: '#ef4444',
      estimatedPm25: Math.round(basePm25 * 1.35)
    };
  })();

  // Track global window scroll position + wheel support for short pages
  useEffect(() => {
    if (!backgroundEnabled) return;

    const computeScrollTarget = () => {
      const docHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.offsetHeight,
        document.body.clientHeight,
        document.documentElement.clientHeight
      );
      const scrollableDistance = docHeight - window.innerHeight;
      if (scrollableDistance > 80) {
        const rawRatio = window.scrollY / scrollableDistance;
        targetProgressRef.current = Math.max(0, Math.min(1, rawRatio));
      }
    };

    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          computeScrollTarget();
          ticking = false;
        });
        ticking = true;
      }
    };

    // Wheel listener allows atmospheric scrubbing even on shorter pages
    const handleWheel = (e: WheelEvent) => {
      const docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      const scrollableDistance = docHeight - window.innerHeight;
      // If page is short, allow wheel delta to directly drive the background animation
      if (scrollableDistance <= 120) {
        const delta = e.deltaY * 0.0008;
        targetProgressRef.current = Math.max(0, Math.min(1, targetProgressRef.current + delta));
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', computeScrollTarget, { passive: true });
    window.addEventListener('wheel', handleWheel, { passive: true });
    computeScrollTarget();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', computeScrollTarget);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [backgroundEnabled]);

  // Main canvas animation and cross-fade render loop
  // NOTE: Dependency array only includes stable refs/images so it NEVER tears down while running!
  useEffect(() => {
    if (!backgroundEnabled || !imagesLoaded || images.length === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let startTime = performance.now();
    let isRunning = true;
    let lastUiSync = 0;

    const resizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas, { passive: true });

    const loop = (timestamp: number) => {
      if (!isRunning) return;

      const elapsed = timestamp - startTime;

      // Smooth buttery lerp between current progress and scroll target
      const diff = targetProgressRef.current - progressRef.current;
      progressRef.current += diff * 0.12;

      // Subtle organic breathing drift when idle
      const breath = Math.sin(elapsed * 0.0007) * 0.012;
      const effective = Math.max(0, Math.min(1, progressRef.current + breath));

      // Throttled UI state sync for telemetry widget (every ~100ms)
      if (timestamp - lastUiSync > 100) {
        setUiProgress(effective);
        lastUiSync = timestamp;
      }

      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      // Frame mapping across the 8 video frames
      const framePosition = effective * (TOTAL_FRAMES - 1);
      const frameIndex = Math.min(TOTAL_FRAMES - 1, Math.floor(framePosition));
      const nextIndex = Math.min(TOTAL_FRAMES - 1, frameIndex + 1);
      const fraction = framePosition - frameIndex;

      const imgA = images[frameIndex];
      const imgB = images[nextIndex];

      // Draw image with aspect-ratio cover math
      const drawCover = (img: HTMLImageElement, alpha = 1) => {
        if (!img || !img.complete || img.naturalWidth <= 0) return;
        const imgRatio = img.naturalWidth / img.naturalHeight;
        const canvasRatio = w / h;
        let dw = w;
        let dh = h;
        let dx = 0;
        let dy = 0;

        if (canvasRatio > imgRatio) {
          dh = w / imgRatio;
          dy = (h - dh) / 2;
        } else {
          dw = h * imgRatio;
          dx = (w - dw) / 2;
        }

        ctx.globalAlpha = alpha;
        ctx.drawImage(img, dx, dy, dw, dh);
      };

      if (imgA) drawCover(imgA, 1);
      if (fraction > 0.005 && imgB) drawCover(imgB, fraction);

      ctx.globalAlpha = 1;

      // Atmospheric grade overlay:
      // Keep it subtle (25%-45% opacity) so the sky, clouds, sun & smog frames are clearly VISIBLE!
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(13, 19, 34, 0.22)');
      grad.addColorStop(0.35, 'rgba(15, 23, 42, 0.28)');
      grad.addColorStop(0.7, 'rgba(11, 16, 28, 0.38)');
      grad.addColorStop(1, 'rgba(6, 10, 20, 0.48)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Soft vignette for edge contrast
      const radial = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.8);
      radial.addColorStop(0, 'rgba(0, 0, 0, 0)');
      radial.addColorStop(1, 'rgba(4, 7, 15, 0.52)');
      ctx.fillStyle = radial;
      ctx.fillRect(0, 0, w, h);

      // Sanctuary Clean Air Filter aura (when active)
      if (sanctuaryFilterRef.current) {
        ctx.save();
        const aura = ctx.createLinearGradient(0, 0, 0, h);
        aura.addColorStop(0, 'rgba(245, 158, 11, 0.08)');
        aura.addColorStop(0.5, 'rgba(16, 185, 129, 0.16)');
        aura.addColorStop(1, 'rgba(5, 150, 105, 0.24)');
        ctx.fillStyle = aura;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }

      requestAnimationFrame(loop);
    };

    const rafId = requestAnimationFrame(loop);

    return () => {
      isRunning = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [backgroundEnabled, imagesLoaded, images]);

  if (!backgroundEnabled) return null;

  return (
    <>
      {/* Full App Fixed Canvas Background */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none z-0 overflow-hidden select-none"
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full block brightness-105 contrast-105 saturate-110 transition-opacity duration-700"
          style={{ opacity: imagesLoaded ? 1 : 0 }}
        />

        {/* Ambient atmospheric horizon glow */}
        <div
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-[85vw] h-[45vh] rounded-full blur-[100px] pointer-events-none opacity-25 transition-colors duration-1000"
          style={{
            backgroundColor: sanctuaryFilter
              ? '#68dba9'
              : telemetry.estimatedPm25 > 180
              ? '#ef4444'
              : '#f59e0b'
          }}
        />
      </div>

      {/* Floating Atmospheric Depth Telemetry & Scrubber Widget */}
      <aside
        aria-label="Atmospheric Inversion Depth Monitor"
        className="fixed bottom-20 lg:bottom-6 end-4 z-30 transition-all duration-300"
      >
        {chipMinimized ? (
          <button
            type="button"
            onClick={() => setChipMinimized(false)}
            title="Expand Atmospheric Depth Monitor"
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container-high/90 border border-outline-variant/35 text-on-surface text-xs font-semibold shadow-xl backdrop-blur-md hover:bg-surface-bright transition gilded-rim"
          >
            <span
              className="w-2.5 h-2.5 rounded-full animate-ping"
              style={{ backgroundColor: telemetry.badgeColor }}
            />
            <span className="font-mono text-[11px] font-bold text-primary">{telemetry.altitudeM}m</span>
            <span className="text-[10px] text-on-surface-variant hidden sm:inline">{telemetry.layerTitle}</span>
            <span className="material-symbols-outlined text-[16px] text-primary">unfold_more</span>
          </button>
        ) : (
          <div className="rounded-2xl bg-surface-container-high/95 border border-outline-variant/40 shadow-2xl p-3.5 backdrop-blur-xl text-on-surface w-[290px] sm:w-[320px] space-y-2.5 gilded-rim">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: telemetry.badgeColor }}
                />
                <span className="font-label-sm uppercase tracking-wider text-[10px] text-primary font-bold truncate">
                  Cinematic Inversion Depth
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSanctuaryFilter(!sanctuaryFilter)}
                  title={sanctuaryFilter ? 'Clean Air Sanctuary Aura Active' : 'Filter Sky (Simulate Clean Air)'}
                  className={`px-2 py-0.5 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                    sanctuaryFilter
                      ? 'bg-secondary/20 text-secondary'
                      : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {sanctuaryFilter ? 'filter_alt' : 'filter_alt_off'}
                  </span>
                  <span className="text-[10px]">{sanctuaryFilter ? 'Filtered' : 'Filter'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setChipMinimized(true)}
                  title="Minimize monitor"
                  className="p-1 rounded-lg hover:bg-surface-container text-on-surface-variant hover:text-on-surface text-xs"
                >
                  <span className="material-symbols-outlined text-[15px]">close_fullscreen</span>
                </button>
              </div>
            </div>

            <div className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-1">
                <span className="font-label-md font-bold text-on-surface text-xs truncate">
                  {telemetry.layerTitle}
                </span>
                <span className="font-mono font-bold text-xs text-primary shrink-0">
                  {telemetry.altitudeM}m
                </span>
              </div>
              <p className="text-[10px] text-on-surface-variant line-clamp-1 leading-tight">
                {telemetry.sublabel}
              </p>
            </div>

            {/* Manual Scrub Slider + Scroll Progress Indicator */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[9px] font-mono text-on-surface-variant">
                <span>480m Troposphere</span>
                <span>Scrub: {Math.round(uiProgress * 100)}%</span>
                <span>80m Canyon</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={uiProgress}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  targetProgressRef.current = val;
                  progressRef.current = val;
                  setUiProgress(val);
                }}
                className="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-surface-container accent-primary"
                title="Scrub atmospheric inversion altitude"
              />
            </div>
          </div>
        )}
      </aside>
    </>
  );
};
