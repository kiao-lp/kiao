import { ThemeConfig, theme } from 'antd';

export const kiaoSoberDarkTokens = {
    colors: {
        bg: '#0D1117',
        text: '#E6EDF3',
        accent: '#58A6FF',
        accentBg: '#161B22',
        border: '#30363D',
        muted: '#8B949E',
        textDisabled: '#6E7681',
        link: '#4493F8',
        linkVisited: '#A5C8F0',
        code: '#FF7B72',
        codeBg: '#1C2128',
        inputBg: '#0D1117',
        inputBgFocus: '#12181F',
    }
};

export const kiaoSoberDarkTheme: ThemeConfig = {
    algorithm: theme.darkAlgorithm,
    token: {
        colorPrimary: kiaoSoberDarkTokens.colors.accent,
        colorInfo: kiaoSoberDarkTokens.colors.link,
        colorLink: kiaoSoberDarkTokens.colors.link,
        colorSuccess: '#3fb950',
        colorWarning: '#d29922',
        colorError: kiaoSoberDarkTokens.colors.code,
        colorBgBase: kiaoSoberDarkTokens.colors.bg,
        colorBgContainer: kiaoSoberDarkTokens.colors.accentBg,
        colorBgLayout: kiaoSoberDarkTokens.colors.bg,
        colorText: kiaoSoberDarkTokens.colors.text,
        colorTextSecondary: kiaoSoberDarkTokens.colors.muted,
        colorBorder: kiaoSoberDarkTokens.colors.border,
        colorSplit: kiaoSoberDarkTokens.colors.border,

        fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
        fontSize: 14,
        borderRadius: 6,
        borderRadiusLG: 8,
        borderRadiusSM: 4,
    },
    components: {
        Button: {
            colorPrimary: kiaoSoberDarkTokens.colors.accent,
            primaryColor: kiaoSoberDarkTokens.colors.accentBg,
            borderRadius: 6,
            controlHeight: 36,
        },
        Input: {
            colorBgContainer: kiaoSoberDarkTokens.colors.inputBg,
            colorBorder: kiaoSoberDarkTokens.colors.border,
            activeBorderColor: kiaoSoberDarkTokens.colors.accent,
            hoverBorderColor: kiaoSoberDarkTokens.colors.accent,
        },
        Card: {
            colorBgContainer: kiaoSoberDarkTokens.colors.accentBg,
            borderRadiusLG: 8,
            headerBg: 'transparent',
        },
        Typography: {
            // The sober themes rank headings by weight and size, not by hue.
            colorTextHeading: kiaoSoberDarkTokens.colors.text,
        }
    }
};
