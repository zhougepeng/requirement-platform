import type { ReactNode, SVGProps } from "react";

type IconName = "book" | "folder" | "search" | "chevron" | "link" | "external" | "desktop" | "mobile" | "send" | "plus" | "arrow" | "message" | "check" | "file" | "star" | "settings" | "trash" | "close" | "users" | "refresh" | "edit";

const paths: Record<IconName, ReactNode> = {
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16"/><path d="M8 7h8M8 11h6"/></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>,
  search: <><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></>,
  chevron: <path d="m9 18 6-6-6-6"/>,
  link: <><path d="M10 13a5 5 0 0 0 7.07.07l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15"/><path d="M14 11a5 5 0 0 0-7.07-.07l-2 2A5 5 0 0 0 12 20l1.15-1.15"/></>,
  external: <><path d="M14 3h7v7"/><path d="m10 14 11-11"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></>,
  desktop: <><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></>,
  mobile: <rect x="7" y="2" width="10" height="20" rx="2"/>,
  send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  arrow: <><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></>,
  message: <path d="M21 11.5a8.38 8.38 0 0 1-9 8.46 8.5 8.5 0 0 1-3.8-.9L3 21l1.7-4.2A8.5 8.5 0 1 1 21 11.5Z"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></>,
  star: <path d="m12 3 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.92 1.06-6.2L3 9.53l6.22-.9z"/>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.1 2.1-.06-.06A1.65 1.65 0 0 0 15.8 18.6a1.65 1.65 0 0 0-1 1.5v.1h-3v-.1a1.65 1.65 0 0 0-1-1.5 1.65 1.65 0 0 0-1.82.33l-.06.06-2.1-2.1.06-.06A1.65 1.65 0 0 0 7.2 15a1.65 1.65 0 0 0-1.5-1H5.6v-3h.1a1.65 1.65 0 0 0 1.5-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06 2.1-2.1.06.06A1.65 1.65 0 0 0 10.8 6.4a1.65 1.65 0 0 0 1-1.5v-.1h3v.1a1.65 1.65 0 0 0 1 1.5 1.65 1.65 0 0 0 1.82-.33l.06-.06 2.1 2.1-.06.06A1.65 1.65 0 0 0 19.4 10c.25.6.83 1 1.5 1h.1v3h-.1c-.67 0-1.25.4-1.5 1Z"/></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  refresh: <><path d="M20 11a8.1 8.1 0 0 0-14.8-3L3 11"/><path d="M3 4v7h7"/><path d="M4 13a8.1 8.1 0 0 0 14.8 3L21 13"/><path d="M21 20v-7h-7"/></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  edit: <><path d="m4 20 4.5-1 10.9-10.9a2.12 2.12 0 0 0-3-3L6.5 16z"/><path d="m14.5 6.5 3 3"/></>,
};

export function Icon({ name, className, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...props}>{paths[name]}</svg>;
}
