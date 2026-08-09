/// <reference types="vite/client" />
/// <reference types="vite-plugin-monkey/client" />
/// <reference types="vite-plugin-monkey/global" />
/// <reference types="vite-plugin-monkey/style" />

interface Window {
  __BLOGSCLUB_AUTO_SIGNIN__?: boolean;
  initGeetest4?: GeetestInitializer;
}

interface CaptchaInstance {
  onReady(callback: () => void): CaptchaInstance;
  onClose?: (callback: () => void) => CaptchaInstance;
  onError(callback: (error: unknown) => void): CaptchaInstance;
  onSuccess(callback: () => void): CaptchaInstance;
  getValidate(): Record<string, unknown>;
  showCaptcha(): void;
  reset(): void;
}

type GeetestInitializer = (options: Record<string, string>, callback: (instance: CaptchaInstance) => void) => void;
