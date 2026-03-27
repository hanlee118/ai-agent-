import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type UiLocale = "zh-CN" | "en-US";

type LocaleContextValue = {
  locale: UiLocale;
  setLocale: (locale: UiLocale) => void;
  isEnglish: boolean;
};

const LOCALE_STORAGE_KEY = "occ-ui-locale";

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<UiLocale>(() => {
    if (typeof window === "undefined") {
      return "zh-CN";
    }

    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return saved === "en-US" ? "en-US" : "zh-CN";
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale: setLocaleState,
    isEnglish: locale === "en-US"
  }), [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within LocaleProvider");
  }

  return context;
}

