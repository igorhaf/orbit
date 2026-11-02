'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useBranding } from './branding';

type NavigationEnvironment = {
  document: Pick<Document, 'body' | 'querySelector'>;
  window: Pick<Window, 'setTimeout' | 'clearTimeout'>;
  MutationObserver: typeof MutationObserver;
};

/**
 * Waits for the current route's heading without polling. Pages that fetch their
 * title after navigation are announced when React inserts the heading.
 */
export function watchNavigationHeading(
  pathname: string,
  isCurrentPath: () => boolean,
  publish: (announcement: string, title: string) => void,
  productName: string,
  environment: NavigationEnvironment = { document, window, MutationObserver },
) {
  let cancelled = false;
  let timer: number | undefined;
  let observer: MutationObserver | undefined;

  const stopObserver = () => {
    observer?.disconnect();
    observer = undefined;
  };

  const announce = () => {
    if (cancelled || !isCurrentPath()) {
      stopObserver();
      return false;
    }

    const heading = environment.document.querySelector<HTMLElement>('main h1')?.innerText.trim();
    if (!heading) return false;

    publish(`Página: ${heading}`, `${heading} | ${productName}`);
    stopObserver();
    return true;
  };

  timer = environment.window.setTimeout(() => {
    timer = undefined;
    if (announce()) return;

    observer = new environment.MutationObserver(() => {
      if (announce()) return;
      if (cancelled || !isCurrentPath()) stopObserver();
    });
    observer.observe(environment.document.body, { childList: true, characterData: true, subtree: true });

    // Close the gap between the first query and subscribing to mutations.
    announce();
  }, 50);

  return () => {
    cancelled = true;
    if (timer !== undefined) environment.window.clearTimeout(timer);
    timer = undefined;
    stopObserver();
  };
}

export function NavigationAnnouncer() {
  const pathname = usePathname();
  const brand = useBranding();
  const productName = brand.app_name;
  const [lastAnnouncement, setLastAnnouncement] = useState<{ pathname: string; text: string } | null>(null);
  const currentPathname = useRef(pathname);

  useLayoutEffect(() => {
    currentPathname.current = pathname;
  }, [pathname]);

  useEffect(() => {
    return watchNavigationHeading(
      pathname,
      () => currentPathname.current === pathname,
      (nextAnnouncement, title) => {
        document.title = title;
        setLastAnnouncement({ pathname, text: nextAnnouncement });
      },
      productName,
    );
  }, [pathname, productName]);

  const announcement = lastAnnouncement?.pathname === pathname ? lastAnnouncement.text : '';
  return <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>;
}
