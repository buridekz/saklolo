import { CircleHelp, Flame, HeartPulse, ShieldAlert, Waves, type LucideIcon } from 'lucide-react';
import type { Category, Report } from '../data';

export const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  Medical: HeartPulse,
  Fire: Flame,
  Safety: ShieldAlert,
  Flood: Waves,
  Other: CircleHelp,
};

/** Stale-location threshold, matching the resident screen. */
export const STALE_LOCATION_MS = 2 * 60 * 1000;

export const clockTime = (value: string) =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const fullTime = (value: string) =>
  new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Compact relative age such as "now", "4m", "2h 5m", "3d". */
export function age(value: string, now: number) {
  const seconds = Math.max(0, Math.round((now - Date.parse(value)) / 1000));
  if (seconds < 45) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export const ageLabel = (value: string, now: number) => {
  const text = age(value, now);
  return text === 'now' ? 'just now' : `${text} ago`;
};

export const shortId = (report: Report) => report.id.slice(0, 8).toUpperCase();

export const isOpen = (report: Report) => report.status !== 'acknowledged';

export const locationLine = (report: Report) =>
  report.landmark || (report.location ? 'GPS location shared' : 'Location needs confirmation');

export const sourceLabel = (report: Report) =>
  report.source === 'voice' ? 'Voice' : report.source === 'sos' ? 'SOS' : 'Form';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
