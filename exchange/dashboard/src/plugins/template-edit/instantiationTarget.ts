import { TEMPLATE_EXTENSION } from '@kiao-dashboard-kit/template-lang';

export const instantiationTargetOf = (templatePath: string): string | null =>
    templatePath.endsWith(TEMPLATE_EXTENSION)
        ? `${templatePath.slice(0, -TEMPLATE_EXTENSION.length)}.md`
        : null;
