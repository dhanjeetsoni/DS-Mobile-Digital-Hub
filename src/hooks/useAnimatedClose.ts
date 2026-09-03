import { useCallback, useState } from "react";

/**
 * Step 9.3 — Popup/Modal Animations.
 *
 * Every modal in this app is conditionally *mounted* by its parent
 * (`{showX && <XModal onClose={() => setShowX(false)} />}`), so the instant
 * the real `onClose` fires, React rips the DOM node out on the next render —
 * there's no window for a CSS "closing" transition to actually play, no
 * matter what the stylesheet says. This hook fixes that without changing who
 * owns the "is this modal open" state:
 *
 *   const { closing, requestClose } = useAnimatedClose(onClose);
 *   <div className={`overlay show ${closing ? "closing" : ""}`}>
 *     <div className={`modal ${closing ? "closing" : ""}`}>
 *       <button onClick={requestClose}>&times;</button>   // instead of onClick={onClose}
 *
 * `requestClose()` flips `closing` true (which the .closing CSS animation in
 * index.css plays over CLOSE_MS), then calls the *real* `onClose` after that
 * delay so the parent unmounts only once the fade/scale-out has actually
 * finished on screen. Calling `requestClose` again mid-animation is a no-op
 * (guards against a double Enter+click firing two timers).
 */
export const CLOSE_MS = 180;

export function useAnimatedClose(onClose: () => void, ms: number = CLOSE_MS) {
  const [closing, setClosing] = useState(false);

  // A few modals do more than "just close" on their exit action — e.g.
  // AddGiftModal's "Gift Karein" button both adds the gift AND closes the
  // modal via a single parent callback (`onSelect`), not the plain `onClose`
  // prop. `runClosing` lets those spots play the same fade/scale-out before
  // firing whatever callback the parent actually needs, instead of only
  // supporting the plain onClose case.
  const runClosing = useCallback(
    (after: () => void = onClose) => {
      setClosing((already) => {
        if (already) return already;
        window.setTimeout(after, ms);
        return true;
      });
    },
    [onClose, ms]
  );

  const requestClose = useCallback(() => runClosing(onClose), [runClosing, onClose]);

  return { closing, requestClose, runClosing };
}
