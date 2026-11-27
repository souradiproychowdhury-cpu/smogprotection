import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { mapUsAqiToSpectrum } from '@aetheria/shared';
import { AppScrollBackground } from './AppScrollBackground';
import { useAppStore } from '../store/useAppStore';
import { useTranslation } from '../i18n/useTranslation';

interface LayoutProps {
  children: React.ReactNode;
  onOpenAqiDetails: () => void;
  onOpenLanguage: () => void;
  onOpenProfile: () => void;
}

export const Layout: React.FC<LayoutProps> = ({
  children,
  onOpenAqiDetails,
  onOpenLanguage,
  onOpenProfile
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const air = useAppStore((s) => s.air);
  const isOffline = useAppStore((s) => s.isOffline);
  const emergencyNumber = useAppStore((s) => s.emergencyNumber);

  const cat = mapUsAqiToSpectrum(air?.aqi ?? 0);

  const primaryTabs = [
    { path: '/', label: t('nav.sanctuary'), icon: 'shield_with_house' },
    { path: '/oracle', label: t('nav.oracle'), icon: 'auto_awesome' },
    { path: '/impact', label: t('nav.impact'), icon: 'globe' },
    { path: '/vault', label: t('nav.vault'), icon: 'diamond' }
  ];

  const secondaryLinks = [
    { path: '/health', label: t('nav.health'), icon: 'health_and_safety' },
    { path: '/alert', label: t('nav.alert'), icon: 'warning' },
    { path: '/route', label: t('nav.route'), icon: 'alt_route' },
    { path: '/tutorial', label: t('nav.tutorial'), icon: 'school' },
    { path: '/settings', label: t('nav.settings'), icon: 'settings' }
  ];

  const currentTitle =
    [...primaryTabs, ...secondaryLinks].find((item) => item.path === location.pathname)?.label ||
    t('nav.sanctuary');

  return (
    <div className="min-h-screen relative bg-transparent text-on-surface flex flex-col lg:flex-row overflow-x-hidden">
      {/* Full App Scroll-Driven Atmospheric Background */}
      <AppScrollBackground air={air} />
      {/* Desktop Left Rail (>=1024px) */}
      <nav
        aria-label="Desktop Primary Navigation"
        className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 lg:start-0 z-40 bg-surface-container-lowest/95 border-e border-outline-variant/30 px-4 py-5 justify-between"
      >
        <div className="space-y-6">
          <Link to="/" className="flex items-center gap-3 px-2">
            <svg role="img" aria-label="Aetheria Crest" className="w-9 h-9 shrink-0" viewBox="0 0 64 64" fill="none">
              <path
                d="M32 6L54 16V32C54 45.2 44.6 55.6 32 59C19.4 55.6 10 45.2 10 32V16L32 6Z"
                fill="#151b2b"
                stroke="#ffc174"
                strokeWidth="2.5"
              />
              <path d="M32 14L44 26L32 48L20 26L32 14Z" fill="#f59e0b" stroke="#ffddb8" strokeWidth="1.5" />
              <circle cx="32" cy="28" r="4" fill="#68dba9" />
            </svg>
            <div>
              <div className="font-display-lg-mobile text-body-md font-semibold tracking-wider text-primary leading-tight">
                {t('app.name')}
              </div>
              <div className="font-label-sm text-label-sm uppercase tracking-widest text-on-surface-variant">
                {currentTitle}
              </div>
            </div>
          </Link>

          <div className="space-y-1">
            {primaryTabs.map((tab) => {
              const active = location.pathname === tab.path;
              return (
                <Link
                  key={tab.path}
                  to={tab.path}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-label-lg text-label-lg transition ${
                    active
                      ? 'bg-primary/15 text-primary gilded-rim font-semibold'
                      : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[20px]">{tab.icon}</span>
                  <span>{tab.label}</span>
                </Link>
              );
            })}
          </div>

          <div className="pt-4 border-t border-outline-variant/30 space-y-1">
            <div className="px-3 pb-1 font-label-sm text-label-sm uppercase tracking-widest text-on-surface-variant">
              Protocols & Tools
            </div>
            {secondaryLinks.map((tab) => {
              const active = location.pathname === tab.path;
              return (
                <Link
                  key={tab.path}
                  to={tab.path}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-3 px-3.5 py-2 rounded-xl font-body-sm text-body-sm transition ${
                    active
                      ? 'bg-secondary/15 text-secondary font-semibold'
                      : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
                  <span>{tab.label}</span>
                </Link>
              );
            })}

            {/* Launch Voice Feature Guide */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('aetheria:start-voice-tour'))}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-primary-container to-primary text-on-primary-container font-label-md font-bold hover:brightness-110 shadow-md transition"
              >
                <span className="material-symbols-outlined text-[19px] animate-pulse">record_voice_over</span>
                <span>Voice Feature Guide</span>
              </button>
            </div>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-surface-container text-xs text-on-surface-variant space-y-1">
          <div className="font-semibold text-primary">Emergency: {emergencyNumber}</div>
          <p className="leading-snug">{t('footer.disclaimer')}</p>
        </div>
      </nav>

      {/* Main Column */}
      <div className="flex-1 flex flex-col lg:ps-64 min-w-0">
        {/* Global Fixed Top Header */}
        <header className="sticky top-0 z-40 pt-safe bg-surface/85 backdrop-blur-xl border-b border-outline-variant/25">
          <div className="h-16 max-w-[1440px] mx-auto px-4 lg:px-8 flex items-center justify-between gap-2">
            {/* Brand Mark + Wordmark */}
            <Link to="/" data-tour="header-brand" className="flex items-center gap-2 min-w-0">
              <svg
                role="img"
                aria-label="Aetheria Royal Crest Logo"
                className="w-8 h-8 shrink-0 lg:hidden"
                viewBox="0 0 64 64"
                fill="none"
              >
                <path
                  d="M32 6L54 16V32C54 45.2 44.6 55.6 32 59C19.4 55.6 10 45.2 10 32V16L32 6Z"
                  fill="#151b2b"
                  stroke="#ffc174"
                  strokeWidth="2.5"
                />
                <path d="M32 14L44 26L32 48L20 26L32 14Z" fill="#f59e0b" stroke="#ffddb8" strokeWidth="1.5" />
                <circle cx="32" cy="28" r="4" fill="#68dba9" />
              </svg>
              <div className="flex flex-col min-w-0">
                <span className="font-display-lg-mobile text-body-md font-semibold tracking-wider text-primary leading-tight lg:hidden">
                  {t('app.name')}
                </span>
                <span className="font-label-sm text-label-sm uppercase tracking-widest text-on-surface-variant leading-none truncate">
                  {currentTitle}
                </span>
              </div>
            </Link>

            {/* Right Controls */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {isOffline && (
                <span className="px-2 py-1 rounded-full bg-error-container/70 text-on-error-container font-label-sm text-[10px] font-bold uppercase">
                  {t('header.offline')}
                </span>
              )}

              {/* Live AQI Status Pill */}
              <button
                type="button"
                data-tour="header-aqi-pill"
                onClick={onOpenAqiDetails}
                aria-label={`Live Air Quality ${air ? `AQI ${air.aqi} ${cat.shortLabel}` : 'Loading'}`}
                className={`min-h-[36px] flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-high/90 border ${cat.borderClass} shadow-sm hover:brightness-110 transition`}
              >
                <span className="relative flex h-2 w-2">
                  <span
                    className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                    style={{ backgroundColor: cat.haloColor }}
                  />
                  <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: cat.color }} />
                </span>
                <span className="font-label-sm text-label-sm font-bold tracking-wider uppercase" style={{ color: cat.textColor }}>
                  {air ? `${air.aqi} · ${cat.shortLabel}` : '...'}
                </span>
              </button>

              {/* Language Selector */}
              <button
                type="button"
                data-tour="header-lang"
                onClick={onOpenLanguage}
                aria-label={t('header.langLabel')}
                className="min-w-[36px] min-h-[36px] px-2 rounded-full bg-surface-container-high hover:bg-surface-bright text-on-surface flex items-center justify-center gap-1 text-xs font-semibold transition"
              >
                <span className="material-symbols-outlined text-[18px] text-tertiary">translate</span>
                <span className="hidden sm:inline uppercase">{language.code}</span>
              </button>

              {/* Voice Tour / Feature Guide Button */}
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('aetheria:start-voice-tour'))}
                aria-label="Start Voice Feature Guide"
                title="Explore App with Voice Assistant"
                className="h-9 px-2.5 rounded-full bg-gradient-to-r from-primary-container to-primary text-on-primary-container hover:brightness-110 flex items-center gap-1.5 text-xs font-bold border border-primary/40 shadow-sm transition"
              >
                <span className="material-symbols-outlined text-[17px] animate-pulse">record_voice_over</span>
                <span className="hidden sm:inline">Voice Tour</span>
              </button>

              {/* Help / Tutorial Button */}
              <button
                type="button"
                data-tour="header-help"
                onClick={() => navigate('/tutorial')}
                aria-label={t('header.helpLabel')}
                className="w-9 h-9 rounded-full bg-surface-container-high hover:bg-surface-bright text-primary flex items-center justify-center transition"
              >
                <span className="material-symbols-outlined text-[20px]">help</span>
              </button>

              {/* Profile Avatar Button */}
              <button
                type="button"
                data-tour="header-profile"
                onClick={onOpenProfile}
                aria-label={t('header.profileLabel')}
                className="w-9 h-9 rounded-full bg-primary hover:brightness-110 text-on-primary flex items-center justify-center shadow-md transition"
              >
                <span className="material-symbols-outlined text-[19px]">person</span>
              </button>

              {/* Settings Direct Button */}
              <button
                type="button"
                onClick={() => navigate('/settings')}
                aria-label={t('nav.settings')}
                title="Settings & Preferences"
                className={`w-9 h-9 rounded-full ${
                  location.pathname === '/settings'
                    ? 'bg-primary text-on-primary font-bold shadow-md'
                    : 'bg-surface-container-high hover:bg-surface-bright text-on-surface'
                } flex items-center justify-center transition`}
              >
                <span className="material-symbols-outlined text-[19px]">settings</span>
              </button>
            </div>
          </div>
        </header>

        {/* Main Content Area (12-col responsive max-w-1440px on desktop, full width mobile) */}
        <main id="main-content" className="relative z-10 flex-1 w-full max-w-[1440px] mx-auto px-margin-mobile lg:px-8 pt-4 pb-28 lg:pb-12">
          {children}

          {/* Disclaimer Footer */}
          <footer className="mt-10 pt-5 border-t border-outline-variant/25 text-center sm:text-left flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-on-surface-variant">
            <p>{t('footer.disclaimer')} ({emergencyNumber})</p>
            <div className="flex items-center gap-4 shrink-0">
              <Link to="/health" className="text-primary hover:underline">{t('nav.health')}</Link>
              <Link to="/alert" className="text-primary hover:underline">{t('nav.alert')}</Link>
              <Link to="/route" className="text-primary hover:underline">{t('nav.route')}</Link>
              <Link to="/settings" className="text-primary hover:underline">{t('nav.settings')}</Link>
            </div>
          </footer>
        </main>
      </div>

      {/* Mobile Bottom Nav (<1024px) */}
      <nav
        aria-label="Mobile Primary Navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 pb-safe bg-surface/90 backdrop-blur-xl border-t border-outline-variant/25 shadow-[0_-2px_12px_rgba(0,0,0,0.35)]"
      >
        <div className="h-16 px-2 flex items-center justify-around">
          {primaryTabs.map((tab) => {
            const active = location.pathname === tab.path;
            return (
              <Link
                key={tab.path}
                to={tab.path}
                aria-current={active ? 'page' : undefined}
                className={`min-w-[56px] min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition ${
                  active ? 'text-primary font-bold' : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-[22px]">{tab.icon}</span>
                <span className="font-label-sm text-label-sm tracking-wide">{tab.label}</span>
              </Link>
            );
          })}
          {/* Settings tab on mobile */}
          <Link
            to="/settings"
            aria-current={location.pathname === '/settings' ? 'page' : undefined}
            className={`min-w-[56px] min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition ${
              location.pathname === '/settings' ? 'text-primary font-bold' : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-[22px]">settings</span>
            <span className="font-label-sm text-label-sm tracking-wide">{t('nav.settings')}</span>
          </Link>
        </div>
      </nav>
    </div>
  );
};
