export const TEMPLATE_EXTENSION = ".temp.md";


export const instantiationTargetOf = (templatePath: string): string | null =>
    templatePath.endsWith(TEMPLATE_EXTENSION)
        ? `${templatePath.slice(0, -TEMPLATE_EXTENSION.length)}.md`
        : null;
