import type { SVGProps } from 'react'

/**
 * LayerFS Connect's mark: a handshake, the environment's hand light and the
 * agent's dark, in the LayerFS icon set's two tones (styles.css sets them per
 * theme). resources/icon.svg is the same drawing on the app tile.
 */
export function ConnectMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="345 144 340 340" fill="none" aria-hidden="true" {...props}>
      <g strokeLinecap="round" strokeLinejoin="round" strokeWidth="24">
        <g stroke="var(--lfs-light, #93B1E0)">
          <path d="M362 302 L420 210 L488 226" />
          <path d="M392 318 L500 410 Q520 425 540 405 Q560 412 574 390 Q594 388 598 364 Q612 352 600 332 L556 262" />
          <path d="M520 300 L556 352" />
          <path d="M498 316 L528 362" />
        </g>
        <g stroke="var(--lfs-dark, #2F5BB5)">
          <path d="M668 306 L606 208 L540 210 Q520 212 504 226 L466 258 Q448 276 462 296 Q478 314 500 300 L546 274" />
          <path d="M602 334 L640 302" />
        </g>
      </g>
    </svg>
  )
}
