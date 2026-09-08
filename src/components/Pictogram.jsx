/**
 * Small line pictograms that carry the meaning of a label without relying on
 * reading it.
 *
 * The operator on the floor reads very little English, so every field label,
 * table heading and action gets a matching glyph. They are deliberately plain:
 * one stroke weight, `currentColor`, no fill, no colour of their own and no
 * animation, so they sit beside the text as a hint rather than competing with
 * the numbers, which are the thing that actually matters on this screen.
 */

const PATHS = {
  // material / stock
  material: 'M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z M3.5 7.5 12 12l8.5-4.5 M12 12v9',
  stock: 'M4 8h16v12H4z M4 8l2-4h12l2 4 M9 12h6',
  weight: 'M12 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z M6 8h12l2.5 12H3.5L6 8Z',
  bag: 'M6 8h12l1 12H5L6 8Z M9 8V6a3 3 0 0 1 6 0v2',
  // process
  machine: 'M4 9h10v10H4z M14 12h3l3-3v10h-6 M7 12v4',
  production: 'M4 19h16 M6 19V9l4 3V9l4 3V6l4 3v10',
  wastage: 'M4 7h16 M9 7V5h6v2 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  order: 'M7 4h10v16H7z M10 9h4 M10 13h4',
  truck: 'M3 7h11v9H3z M14 10h4l3 3v3h-7 M7.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z M17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  // meta
  date: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
  clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z M12 8v4l3 2',
  note: 'M5 4h14v16H5z M8 9h8 M8 13h8 M8 17h4',
  person: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M4 20a8 8 0 0 1 16 0',
  // actions
  add: 'M12 5v14 M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Z M14 6l4 4',
  remove: 'M6 7h12 M10 7V5h4v2 M8 7l.8 12h6.4L16 7 M10 11v5 M14 11v5',
  check: 'M5 13l4 4L19 7',
  warning: 'M12 4 2.5 20h19L12 4Z M12 10v4 M12 17h.01',
  down: 'M12 5v13 M6 13l6 6 6-6',
  up: 'M12 19V6 M6 11l6-6 6 6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z M16 16l4 4',
  export: 'M12 16V4 M8 8l4-4 4 4 M4 16v4h16v-4',
}

export default function Pictogram({ name, className = '', size = 16, title }) {
  const d = PATHS[name]
  if (!d) return null
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {d.split(' M').map((segment, i) => (
        <path key={i} d={i === 0 ? segment : `M${segment}`} />
      ))}
    </svg>
  )
}

/** Label with its glyph — the pairing used by every form field and heading. */
export function IconLabel({ icon, children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Pictogram name={icon} size={14} className="text-text-secondary/70" />
      {children}
    </span>
  )
}
