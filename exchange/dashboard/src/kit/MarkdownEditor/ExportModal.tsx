import React, { useEffect, useState } from 'react';
import { Modal, Radio, Typography } from 'antd';
import { DEFAULT_PDF_THEME, loadPdfThemes, useWorkerClient, type PdfTheme } from '@cms-core';

export type ExportFormat = 'pdf' | 'docx';

export interface ExportModalProps {
    open: boolean;
    onClose: () => void;
    onExportPdf: (theme: PdfTheme) => void;
    onExportDocx: (theme: PdfTheme) => Promise<void> | void;
}

/**
 * One export dialog for the markdown toolbar: the format (PDF or Word) and
 * the store theme live on one view, behind the toolbar's export button.
 */
export const ExportModal: React.FC<ExportModalProps> = ({ open, onClose, onExportPdf, onExportDocx }) => {
    const client = useWorkerClient();
    const [format, setFormat] = useState<ExportFormat>('pdf');
    const [themeId, setThemeId] = useState(DEFAULT_PDF_THEME.id);
    const [themes, setThemes] = useState<PdfTheme[]>([DEFAULT_PDF_THEME]);
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoading(true);
        loadPdfThemes(client).then(loaded => {
            if (cancelled) return;
            setThemes(loaded);
            setLoading(false);
            if (!loaded.some(theme => theme.id === themeId)) {
                setThemeId(loaded[0]?.id ?? DEFAULT_PDF_THEME.id);
            }
        });
        return () => { cancelled = true; };
        // themeId is read, not watched: a stale choice is repaired, never reset.
    }, [client, open]);

    const handleExport = async () => {
        const theme = themes.find(theme => theme.id === themeId) ?? DEFAULT_PDF_THEME;
        if (format === 'pdf') {
            onExportPdf(theme);
            onClose();
            return;
        }
        if (exporting) return;
        setExporting(true);
        try {
            await onExportDocx(theme);
        } finally {
            setExporting(false);
        }
        onClose();
    };

    return (
        <Modal
            title="Export"
            open={open}
            onOk={handleExport}
            onCancel={onClose}
            okText="Export"
            okButtonProps={{ loading: exporting }}
            width={480}
            destroyOnHidden
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="export-format-group">
                    <Typography.Text strong>Format</Typography.Text>
                    <Radio.Group
                        value={format}
                        onChange={(e) => setFormat(e.target.value)}
                        options={[
                            { value: 'pdf', label: 'PDF' },
                            { value: 'docx', label: 'Word (.docx)' },
                        ]}
                    />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="export-theme-group">
                    <Typography.Text strong>Theme</Typography.Text>
                    {loading ? (
                        <Typography.Text type="secondary">Loading themes…</Typography.Text>
                    ) : (
                        <Radio.Group
                            value={themeId}
                            onChange={(e) => setThemeId(e.target.value)}
                            options={themes.map(theme => ({ value: theme.id, label: theme.label }))}
                        />
                    )}
                </div>
            </div>
        </Modal>
    );
};
