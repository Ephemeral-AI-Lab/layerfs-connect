// Electron reports its platform through the preload. In a plain browser,
// ?mac=1 lays the chrome out as on macOS (room for the traffic lights).
export const platform = window.desktop?.platform ?? 'web'
export const macChrome = platform === 'darwin' || new URLSearchParams(location.search).has('mac')
export const TOP_ROW_PX = 46
export const TRAFFIC_LIGHTS_PX = 78
export const CHROME_CLUSTER_PX = 28
