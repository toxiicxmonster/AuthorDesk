/** A small, consistent line-icon set (24×24, stroke = currentColor) so icons match every theme. */
const PATHS: Record<string, string> = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  home: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
  write: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  board: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z',
  people: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M17 11a3 3 0 100-6M22 21v-1a5 5 0 00-4-4.9',
  timeline: 'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z',
  threads: 'M5 20c0-6 14-4 14-10M5 4c0 6 14 4 14 10M5 4v.01M19 20v.01',
  notes: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  backup: 'M12 3v12M7 10l5 5 5-5M4 17v3h16v-3',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5',
  review: 'M10 6h10M10 12h10M10 18h10M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18l1.5 1.5L7.5 17',
  settings: 'M12.93 2.55L14.76 2.91L15.44 5.56L16.63 6.36L19.34 5.97L20.38 7.52L18.99 9.88L19.26 11.28L21.45 12.93L21.09 14.76L18.44 15.44L17.64 16.63L18.03 19.34L16.48 20.38L14.12 18.99L12.72 19.26L11.07 21.45L9.24 21.09L8.56 18.44L7.37 17.64L4.66 18.03L3.62 16.48L5.01 14.12L4.74 12.72L2.55 11.07L2.91 9.24L5.56 8.56L6.36 7.37L5.97 4.66L7.52 3.62L9.88 5.01L11.28 4.74zM12 15a3 3 0 100-6 3 3 0 000 6z',
  link: 'M10 14a4 4 0 006 0l3-3a4 4 0 00-6-6l-1 1M14 10a4 4 0 00-6 0l-3 3a4 4 0 006 6l1-1',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z',
  focus: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M12 13a1 1 0 100-2 1 1 0 000 2z',
  quote: 'M7 7h4v4c0 3-2 5-4 6M15 7h4v4c0 3-2 5-4 6',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3',
  heading: 'M6 4v16M18 4v16M6 12h12',
  sceneBreak: 'M6 12h.01M12 12h.01M18 12h.01',
  unlink: 'M10 14a4 4 0 006 0l3-3a4 4 0 00-6-6l-1 1M14 10a4 4 0 00-6 0l-3 3a4 4 0 006 6l1-1M3 3l18 18',
  help: 'M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9.5a2.5 2.5 0 114 2c-1 .6-1.5 1.2-1.5 2.5M12 17h.01',
  theme: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 3v18',
  panel: 'M4 4h16v16H4zM15 4v16',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12M18 6L6 18',
  filter: 'M4 5h16l-6 8v6l-4-2v-4z',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  series: 'M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.9-1 3.6 15.5-3.9 1z',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  highlight: 'M8 15l-3 4h5l2-2M8 15l8-10 4 3-8 9zM8 15l4 2M3 21h18',
  comment: 'M4 5h16v11H10l-5 4v-4H4zM8 9h8M8 12h5',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, filled, className }: { name: IconName; size?: number; filled?: boolean; className?: string }) {
  return (
    <svg
      className={`icon${className ? ' ' + className : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={name === 'more' || name === 'sceneBreak' ? 3.5 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
      {name === 'theme' && <path d="M12 3a9 9 0 010 18z" fill="currentColor" stroke="none" />}
    </svg>
  );
}
