import { useCallback, useEffect } from 'react';
import { createStateContext } from 'react-concise';
import classNames from 'classnames';

// context
const selectionContext = createStateContext<string[]>('selection', []);
export const SelectionProvider = selectionContext.Provider;
export const useSelectionContext = selectionContext.useContext;

// hook
export const useIsSelected = () => {
  const [selection] = useSelectionContext();
  return useCallback((element: string) => selection.includes(element), [selection]);
};

export const useElementSelection = (element: string, deselectOnDestroy: boolean) => {
  const [selection, setSelection] = useSelectionContext();

  const selected = selection.includes(element);

  const addToSelection = useCallback(
    () => setSelection(selection => !selection.includes(element) ? [...selection, element] : selection),
    [element, setSelection]
  );

  const select = useCallback(
    () => setSelection([element]),
    [element, setSelection]
  );

  const deselect = useCallback(
    () => setSelection(selection => selection.filter(e => e !== element)),
    [element, setSelection]
  );

  useEffect(() => () => {
    if (deselectOnDestroy) {
      deselect();
    }
  }, [deselectOnDestroy, deselect]);

  return { selected, select, addToSelection, deselect };
}

// component
export const Selectable: React.FC<{ id: string, children?: React.ReactNode }> = ({ id, children }) => {
  const isSelected = useIsSelected();
  return <div className={classNames({ selected: isSelected(id) })}>{children}</div>
}
