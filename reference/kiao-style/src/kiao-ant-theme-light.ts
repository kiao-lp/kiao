import { ThemeConfig, theme } from 'antd';

export const kiaoLightTokens = {
    colors: {
        bg: '#F9FAFB',
        text: '#111827',
        accent: '#2563EB',
        accentBg: '#FFFFFF',
        border: '#E5E7EB',
        muted: '#6B7280',
        textDisabled: '#9CA3AF',
        link: '#2563EB',
        linkVisited: '#4B5563',
        code: '#BE123C',
        codeBg: '#F3F4F6',
        inputBg: '#FFFFFF',
        inputBgFocus: '#EFF6FF',
    }
};

export const kiaoLightTheme: ThemeConfig = {
    algorithm: theme.defaultAlgorithm,
    token: {
        colorPrimary: kiaoLightTokens.colors.accent,
        colorInfo: kiaoLightTokens.colors.link,
        colorLink: kiaoLightTokens.colors.link,
        colorSuccess: '#16a34a',
        colorWarning: '#d97706',
        colorError: kiaoLightTokens.colors.code,
        colorBgBase: kiaoLightTokens.colors.bg,
        colorBgContainer: kiaoLightTokens.colors.accentBg,
        colorBgLayout: kiaoLightTokens.colors.bg,
        colorText: kiaoLightTokens.colors.text,
        colorTextSecondary: kiaoLightTokens.colors.muted,
        colorBorder: kiaoLightTokens.colors.border,
        colorSplit: kiaoLightTokens.colors.border,

        fontFamily: '"Atkinson Hyperlegible", "Inter", sans-serif',
        fontSize: 15,
        borderRadius: 8,
        borderRadiusLG: 20,
        borderRadiusSM: 10,
    },
    components: {
        Button: {
            colorPrimary: kiaoLightTokens.colors.accent,
            primaryColor: '#FFFFFF',
            borderRadius: 20,
            controlHeight: 40,
        },
        Input: {
            colorBgContainer: kiaoLightTokens.colors.inputBg,
            colorBorder: kiaoLightTokens.colors.border,
            activeBorderColor: kiaoLightTokens.colors.accent,
            hoverBorderColor: kiaoLightTokens.colors.accent,
        },
        Card: {
            colorBgContainer: kiaoLightTokens.colors.accentBg,
            borderRadiusLG: 26,
            headerBg: 'transparent',
        },
        Typography: {
            colorTextHeading: kiaoLightTokens.colors.accent,
        }
    }
};
