export interface SupportedLanguageOption {
  code: string;
  bcp47: string;
  englishName: string;
  nativeName: string;
  rtl: boolean;
}

export const LANGUAGE_OPTIONS: SupportedLanguageOption[] = [
  { code: 'en', bcp47: 'en-US', englishName: 'English', nativeName: 'English', rtl: false },
  { code: 'hi', bcp47: 'hi-IN', englishName: 'Hindi', nativeName: 'हिन्दी', rtl: false },
  { code: 'bn', bcp47: 'bn-IN', englishName: 'Bengali', nativeName: 'বাংলা', rtl: false },
  { code: 'ta', bcp47: 'ta-IN', englishName: 'Tamil', nativeName: 'தமிழ்', rtl: false },
  { code: 'te', bcp47: 'te-IN', englishName: 'Telugu', nativeName: 'తెలుగు', rtl: false },
  { code: 'mr', bcp47: 'mr-IN', englishName: 'Marathi', nativeName: 'मराठी', rtl: false },
  { code: 'gu', bcp47: 'gu-IN', englishName: 'Gujarati', nativeName: 'ગુજરાતી', rtl: false },
  { code: 'kn', bcp47: 'kn-IN', englishName: 'Kannada', nativeName: 'ಕನ್ನಡ', rtl: false },
  { code: 'ml', bcp47: 'ml-IN', englishName: 'Malayalam', nativeName: 'മലയാളം', rtl: false },
  { code: 'pa', bcp47: 'pa-IN', englishName: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', rtl: false },
  { code: 'ur', bcp47: 'ur-PK', englishName: 'Urdu', nativeName: 'اردو', rtl: true },
  { code: 'ar', bcp47: 'ar-SA', englishName: 'Arabic', nativeName: 'العربية', rtl: true },
  { code: 'es', bcp47: 'es-ES', englishName: 'Spanish', nativeName: 'Español', rtl: false },
  { code: 'fr', bcp47: 'fr-FR', englishName: 'French', nativeName: 'Français', rtl: false },
  { code: 'pt', bcp47: 'pt-BR', englishName: 'Portuguese', nativeName: 'Português', rtl: false },
  { code: 'ru', bcp47: 'ru-RU', englishName: 'Russian', nativeName: 'Русский', rtl: false },
  { code: 'zh', bcp47: 'zh-CN', englishName: 'Chinese', nativeName: '中文', rtl: false },
  { code: 'ja', bcp47: 'ja-JP', englishName: 'Japanese', nativeName: '日本語', rtl: false },
  { code: 'ko', bcp47: 'ko-KR', englishName: 'Korean', nativeName: '한국어', rtl: false },
  { code: 'id', bcp47: 'id-ID', englishName: 'Indonesian', nativeName: 'Bahasa Indonesia', rtl: false },
  { code: 'tr', bcp47: 'tr-TR', englishName: 'Turkish', nativeName: 'Türkçe', rtl: false },
  { code: 'sw', bcp47: 'sw-KE', englishName: 'Swahili', nativeName: 'Kiswahili', rtl: false }
];
