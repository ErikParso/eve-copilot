import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const ADSENSE_CLIENT = 'ca-pub-8344270379537588';

/**
 * Dynamically loads the Google AdSense Loader script only on content-rich pages.
 * Prevents AdSense from running on blank utility/redirect pages (like /auth/callback)
 * to comply with Google AdSense Policies regarding "screens without publisher content".
 */
export function AdSenseScriptLoader() {
  const { pathname } = useLocation();

  useEffect(() => {
    // 1. Never load AdSense on the OAuth callback page or empty utility pages.
    if (pathname.includes('/auth/callback')) {
      return;
    }

    // 2. Only load on main content pages
    const contentPages = ['/couriers', '/market', '/kills'];
    const isContentPage = contentPages.some((page) => pathname.startsWith(page));
    if (!isContentPage) {
      return;
    }

    // 3. Inject the script dynamically if it doesn't already exist
    const scriptId = 'adsense-script-loader';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.async = true;
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
      script.crossOrigin = 'anonymous';
      document.head.appendChild(script);
    }
  }, [pathname]);

  return null;
}
