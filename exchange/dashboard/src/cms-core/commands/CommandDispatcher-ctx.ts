import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useState } from 'react';
import { createSimpleContext } from 'react-concise';
import { useRegisteredCommands, BoundCommand } from './CommandRegistry-ctx';

type CommandDispatcherProps = {};

type CommandDispatcherValue = {
  enabled: boolean;
  sentence: string;
  candidates: BoundCommand[];
  setEnabled: Dispatch<SetStateAction<boolean>>;
};

const defaultValue: CommandDispatcherValue = {
  enabled: true,
  sentence: '',
  candidates: [],
  setEnabled: () => { }
};

const useCommandDispatcherValue: (props: CommandDispatcherProps) => CommandDispatcherValue = () => {
  const commands = useRegisteredCommands();

  const [sentence, setSentence] = useState<string>(defaultValue.sentence);
  const [enabled, setEnabled] = useState<boolean>(defaultValue.enabled);

  const candidates = useMemo(() => commands.filter(command => command.shortcut.startsWith(sentence)), [commands, sentence]);
  const command = useMemo(() => candidates.find(command => command.shortcut === sentence), [candidates, sentence]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    // Ne pas traiter les événements clavier si un champ de saisie est actif
    const activeElement = document.activeElement as HTMLElement;
    if (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.tagName === 'SELECT' ||
      activeElement.isContentEditable ||
      activeElement.closest('.ant-modal-wrap')
    ) {
      return;
    }

    if (event.key === 'Escape') {
      setSentence(s => s !== '' ? '' : '[ESC]');
      return;
    }

    if (event.key === 'Backspace') {
      setSentence(s => s.length > 0 ? s.substring(0, s.length - 1) : s);
      return;
    }

    if (event.key.length > 1)
      return;

    setSentence(s => s + event.key.toLowerCase());

  }, [enabled]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (!enabled) return;

    if (command) {
      setSentence('');
      command.execute();
    }

  }, [enabled, command]);

  useEffect(() => {
    if (!enabled) return;

    if (sentence.length > 0 && candidates.length === 0) {
      setSentence('');
    }

  }, [sentence, enabled]);

  return { sentence, candidates, enabled, setEnabled };
};

const hookBasedContext = createSimpleContext(useCommandDispatcherValue, defaultValue);

export const CommandDispatcherProvider = hookBasedContext.Provider;
export const useCommandDispatcherContext = hookBasedContext.useContext;
