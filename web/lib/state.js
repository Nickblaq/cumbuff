"use client";

import { useCallback, useEffect, useState } from "react";

// Persist a piece of UI state in localStorage so preferences survive reloads.
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw == null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage may be unavailable; ignore */
    }
  }, [key, value]);

  return [value, setValue];
}

// Keep a value in the URL hash so a view is deep-linkable and shareable.
export function useHashParam(fallback) {
  const [value, setValueState] = useState(fallback);

  useEffect(() => {
    const read = () => {
      const hash = window.location.hash.replace(/^#/, "");
      const params = new URLSearchParams(hash);
      const next = params.get("view");
      if (next) setValueState(next);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const setValue = useCallback((next) => {
    setValueState(next);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#view=${encodeURIComponent(next)}`);
    }
  }, []);

  return [value, setValue];
}
