import React from "react";
import { CN, DE, FR, GB, US } from 'country-flag-icons/react/3x2';

import "./LanguageFlag.css";

/**
 * SVG flags render on platforms without Unicode regional indicator glyphs.
 */
const FLAGS = {
    CN: { Flag: CN, title: "China" },
    DE: { Flag: DE, title: "Germany" },
    FR: { Flag: FR, title: "France" },
    GB: { Flag: GB, title: "United Kingdom" },
    US: { Flag: US, title: "United States" },
} as const;

/** The flag a bare language code flies, when the tag names no country of its own. */
const LANGUAGE_COUNTRY: Record<string, keyof typeof FLAGS> = {
    EN: "GB",
    FR: "FR",
    DE: "DE",
    ZH: "CN",
};

/**
 * The flag of a language tag — a bare code (`fr`) or a full locale (`en-US`, whose country wins
 * over its language, so US English flies the Stars and Stripes and plain `en` the Union Jack).
 * A tag no flag is known for is written out as text.
 */
export const LanguageFlag: React.FC<{ lang: string }> = ({ lang }) => {
    const [language, country] = lang.toUpperCase().split(/[-_]/);
    const flag = FLAGS[country as keyof typeof FLAGS] ?? FLAGS[LANGUAGE_COUNTRY[language]];

    if (!flag)
        return <span className="kiao-flag-text">{lang}</span>;

    const { Flag, title } = flag;
    return <Flag title={title} className="kiao-flag" />;
}
