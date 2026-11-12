import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion } from './format';

/** Current time, re-rendered on an interval so relative ages stay honest. */
export function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Tracks a CSS media query. */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** Tweens a displayed integer toward `value`; jumps immediately under reduced motion. */
export function useCountUp(value: number) {
  const [display, setDisplay] = useState(value);
  const state = useRef({ current: value });
  useEffect(() => {
    if (prefersReducedMotion()) {
      state.current.current = value;
      setDisplay(value);
      return;
    }
    const tween = gsap.to(state.current, {
      current: value,
      duration: 0.6,
      ease: 'power3.out',
      onUpdate: () => setDisplay(Math.round(state.current.current)),
    });
    return () => { tween.kill(); };
  }, [value]);
  return display;
}
