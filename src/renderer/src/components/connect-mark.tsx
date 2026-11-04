import type { ImgHTMLAttributes } from 'react'

import logo from '@/assets/connect-logo.png'

/**
 * LayerFS Connect's mark: a handshake, the environment's hand cobalt (--primary,
 * #316cb9) and the agent's slate charcoal (#2f3640), raised on a pale blue-white
 * soft-matte tile (#f4f8fd to #e6eef9, with a hairline edge) so it sits lighter
 * than the sidebar. resources/icon.png is the same tile at app-icon size.
 */
export function ConnectMark(props: ImgHTMLAttributes<HTMLImageElement>) {
  return <img src={logo} alt="" aria-hidden="true" draggable={false} {...props} />
}
