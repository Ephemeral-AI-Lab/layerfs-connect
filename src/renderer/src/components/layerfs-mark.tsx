import type { SVGProps } from 'react'

/** The LayerFS mark, the same drawing as the LayerFS repo's layerfs-mark.svg. */
export function LayerfsMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="6 6 188 188" fill="none" aria-hidden="true" {...props}>
      <path
        d="M88.5 22 L111.5 22 L170 135 L148.5 135 L100 49.5 L51.5 135 L30 135 Z"
        fill="#93B1E0"
        stroke="#93B1E0"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M27 161 L57 161 L100 117 L143 161 L173 161"
        stroke="#2F5BB5"
        strokeWidth="10.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="100" cy="117" r="15.5" fill="#2F5BB5" />
      <circle cx="27" cy="161" r="15.5" fill="#2F5BB5" />
      <circle cx="173" cy="161" r="15.5" fill="#2F5BB5" />
    </svg>
  )
}
