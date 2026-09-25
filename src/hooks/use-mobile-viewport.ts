import { useEffect } from "react";

export function useMobileViewport() {
  useEffect(() => {
    let kb = 0;
    let blurTimeout: ReturnType<typeof setTimeout>;

    const computeKb = () => {
      if (!window.visualViewport) return;
      
      const vv = window.visualViewport;
      kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      
      // Android resizes-content path / desktop -> never double-lift
      if (vv.height >= window.innerHeight - 1) {
        kb = 0;
      }
      
      document.documentElement.style.setProperty('--kb', kb + 'px');
    };

    const handleResizeOrScroll = () => {
      computeKb();
    };

    const handleFocusOut = () => {
      // On blur/focus-out of inputs -> reset --kb to 0px after 150ms
      blurTimeout = setTimeout(() => {
        kb = 0;
        document.documentElement.style.setProperty('--kb', kb + 'px');
      }, 150);
    };

    const handleFocusIn = () => {
      clearTimeout(blurTimeout);
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", handleResizeOrScroll);
      window.visualViewport.addEventListener("scroll", handleResizeOrScroll);
    }
    
    document.addEventListener("focusout", handleFocusOut);
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", handleResizeOrScroll);
        window.visualViewport.removeEventListener("scroll", handleResizeOrScroll);
      }
      document.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("focusin", handleFocusIn);
      clearTimeout(blurTimeout);
      document.documentElement.style.removeProperty('--kb');
    };
  }, []);
}
