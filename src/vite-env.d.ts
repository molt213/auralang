/// <reference types="vite/client" />

// Document Picture-in-Picture (Chrome 116+); the bundled DOM lib does not ship
// these types yet.
interface DocumentPictureInPictureApi {
  requestWindow: (options?: {
    width?: number
    height?: number
    disallowReturnToOpener?: boolean
  }) => Promise<Window>
  readonly window: Window | null
}

interface Window {
  documentPictureInPicture?: DocumentPictureInPictureApi
}

declare module '*.png' {
  const src: string
  export default src
}

declare module '*.svg' {
  const src: string
  export default src
}
