import { BoundCommand as Command } from "./CommandRegistry-ctx";

export interface CommandGeneratorConfig<T> {
  name: string;
  prefix: string;
  enabled: boolean;
  execute: (val: T) => void;
  options: { [key: string]: T };
}

const generateCommand = <T,>(config: CommandGeneratorConfig<T>) => {
  const { options, prefix, name, enabled, execute } = config;

  const shortcuts = Object.keys(options).join("|");

  return ([shortcut, value]: [shortcut: string, value: T]) => ({
    group: `${prefix}{${shortcuts}}`,
    shortcut,
    title: <>{prefix}&#123;{shortcuts}&#125; {name}</>,
    enabled,
    execute: async () => {
      await execute(value);
    }
  });
}

export const generateCommandSeries = <T,>(config: CommandGeneratorConfig<T>) => {
  return Object.entries(config.options)
    .map(([key, val]) => ([`${config.prefix}${key}`, val] as [key: string, val: T]))
    .map(generateCommand<T>(config));
}

// tools

export const useFirstCommandOfEachGroup = (commands: Command[]): Command[] => commands.filter(command => command.group)
  .reduce(
    (unique: Command[], item) => unique.some(itemB => itemB.group === item.group) ? unique : [...unique, item],
    []
  );

export const useNonGroupedCommands = (commands: Command[]): Command[] => commands.filter(command => !command.group);
