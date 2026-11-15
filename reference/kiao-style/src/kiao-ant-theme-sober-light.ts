import { ThemeConfig, theme } from 'antd';

export const kiaoSoberLightTokens = {
    colors: {
        bg: '#F8FAFC',
        text: '#0F172A',
        accent: '#1D4ED8',
        accentBg: '#FFFFFF',
        border: '#E2E8F0',
        muted: '#64748B',
        textDisabled: '#94A3B8',
        link: '#2563EB',
        linkVisited: '#1E40AF',
        code: '#B42318',
        codeBg: '#F1F5F9',
        inputBg: '#FFFFFF',
        inputBgFocus: '#FFFFFF',
    }
};

export const kiaoSoberLightTheme: ThemeConfig = {
    algorithm: theme.defaultAlgorithm,
    token: {
        colorPrimary: kiaoSoberLightTokens.colors.accent,
        colorInfo: kiaoSoberLightTokens.colors.link,
        colorLink: kiaoSoberLightTokens.colors.link,
        colorSuccess: '#16a34a',
        colorWarning: '#d97706',
        colorError: kiaoSoberLightTokens.colors.code,
        colorBgBase: kiaoSoberLightTokens.colors.bg,
        colorBgContainer: kiaoSoberLightTokens.colors.accentBg,
        colorBgLayout: kiaoSoberLightTokens.colors.bg,
        colorText: kiaoSoberLightTokens.colors.text,
        colorTextSecondary: kiaoSoberLightTokens.colors.muted,
        colorBorder: kiaoSoberLightTokens.colors.border,
        colorSplit: kiaoSoberLightTokens.colors.border,

        fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
        fontSize: 14,
        borderRadius: 6,
        borderRadiusLG: 8,
        borderRadiusSM: 4,
    },
    components: {
        Button: {
            colorPrimary: kiaoSoberLightTokens.colors.accent,
            primaryColor: '#FFFFFF',
            borderRadius: 6,
            controlHeight: 36,
        },
        Input: {
            colorBgContainer: kiaoSoberLightTokens.colors.inputBg,
            colorBorder: kiaoSoberLightTokens.colors.border,
            activeBorderColor: kiaoSoberLightTokens.colors.accent,
            hoverBorderColor: kiaoSoberLightTokens.colors.accent,
        },
        Card: {
            colorBgContainer: kiaoSoberLightTokens.colors.accentBg,
            borderRadiusLG: 8,
            headerBg: 'transparent',
        },
        Typography: {
            // The sober themes rank headings by weight and size, not by hue.
            colorTextHeading: kiaoSoberLightTokens.colors.text,
        }
    }
};
