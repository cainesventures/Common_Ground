/**
 * Remounts on every navigation (unlike layout.tsx), so each page eases in
 * instead of snapping. Opacity and a few pixels of movement only: no layout
 * property changes, so it adds nothing to CLS, and the reduced-motion block
 * in globals.css switches it off for anyone who asked for less motion.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="anim-page">{children}</div>
}
