import React from "react";
import { CN, DE, FR, GB, US } from 'country-flag-icons/react/3x2';

import "./KiaoFlag.css";

/**
 * The flags KIAO flies, by ISO country code. They are SVG rather than the Unicode regional
 * indicators (🇫🇷) they replace: Windows ships no glyph for those, and draws the two letters
 * instead — a flag has to be drawn everywhere, not only where the font happens to know it.
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
export const KiaoFlag: React.FC<{ lang: string }> = ({ lang }) => {
    const [language, country] = lang.toUpperCase().split(/[-_]/);
    const flag = FLAGS[country as keyof typeof FLAGS] ?? FLAGS[LANGUAGE_COUNTRY[language]];

    if (!flag)
        return <span className="kiao-flag-text">{lang}</span>;

    const { Flag, title } = flag;
    return <Flag title={title} className="kiao-flag" />;
}
