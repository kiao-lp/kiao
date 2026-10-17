import { useCallback } from "react";
import { usePointedElementContext } from "react-advanced-interactions";
import { useSelectionContext } from "..";

export const useSingleTargetElement = () => {
  const [pointedElement] = usePointedElementContext();
  const [selection] = useSelectionContext();

  const all = new Set<string>(selection);
  if (pointedElement) {
    all.add(pointedElement);
  }

  const arr = Array.from(all);

  return arr.length === 1 ? arr[0] : null;
}

export const useCleanSelectionAndPointing = () => {
  const [, setPointedElement] = usePointedElementContext();
  const [, setSelection] = useSelectionContext();

  return useCallback(() => {
    setPointedElement(null);
    setSelection([]);
  }, [setPointedElement, setSelection]);
}
