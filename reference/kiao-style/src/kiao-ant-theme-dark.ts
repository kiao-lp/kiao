import { ThemeConfig, theme } from 'antd';

export const kiaoDarkTokens = {
    colors: {
        bg: '#020511',
        text: '#FFFFFF',
        accent: '#FFF2A8',
        accentBg: '#121826',
        border: '#263040',
        muted: '#D5DEEF',
        textDisabled: '#6B7280',
        link: '#3C8DFF',
        linkVisited: '#84A6E0',
        code: '#FF667D',
        codeBg: '#1E222F',
        inputBg: '#0E1320',
        inputBgFocus: '#151A27',
    }
};

export const kiaoDarkTheme: ThemeConfig = {
    algorithm: theme.darkAlgorithm,
    token: {
        colorPrimary: kiaoDarkTokens.colors.accent,
        colorInfo: kiaoDarkTokens.colors.link,
        colorLink: kiaoDarkTokens.colors.link,
        colorSuccess: '#52c41a',
        colorWarning: '#faad14',
        colorError: kiaoDarkTokens.colors.code,
        colorBgBase: kiaoDarkTokens.colors.bg,
        colorBgContainer: kiaoDarkTokens.colors.accentBg,
        colorBgLayout: kiaoDarkTokens.colors.bg,
        colorText: kiaoDarkTokens.colors.text,
        colorTextSecondary: kiaoDarkTokens.colors.muted,
        colorBorder: kiaoDarkTokens.colors.border,
        colorSplit: kiaoDarkTokens.colors.border,

        fontFamily: '"Atkinson Hyperlegible", "Inter", sans-serif',
        fontSize: 15,
        borderRadius: 8,
        borderRadiusLG: 20,
        borderRadiusSM: 10,
    },
    components: {
        Button: {
            colorPrimary: kiaoDarkTokens.colors.accent,
            primaryColor: '#121826',
            borderRadius: 20,
            controlHeight: 40,
        },
        Input: {
            colorBgContainer: kiaoDarkTokens.colors.inputBg,
            colorBorder: kiaoDarkTokens.colors.border,
            activeBorderColor: kiaoDarkTokens.colors.accent,
            hoverBorderColor: kiaoDarkTokens.colors.accent,
        },
        Card: {
            colorBgContainer: kiaoDarkTokens.colors.accentBg,
            borderRadiusLG: 26,
        },
        Typography: {
            colorTextHeading: kiaoDarkTokens.colors.accent,
        }
    }
};
