
export interface TemplateCollectionV0 {
    index: string;
    name?: string;
    rootTemplate: TemplateV0;
    subTemplates: TemplateV0[];
}

export interface TemplateV0 {
    id: string;
    textTemplate: string;
    defaultText?: string;
}
