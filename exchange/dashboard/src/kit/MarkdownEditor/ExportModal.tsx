import React, { useEffect, useRef, useState } from 'react';
import { Modal, Radio, Typography, message } from 'antd';
import { DEFAULT_PDF_THEME, loadPdfThemes, useWorkerClient, type PdfTheme } from '@kiao-dashboard-core';

export type ExportFormat = 'pdf' | 'docx';

export interface ExportModalProps {
    open: boolean;
    onClose: () => void;
    onExportPdf: (theme: PdfTheme) => void;
    onExportDocx: (theme: PdfTheme) => Promise<void> | void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ open, onClose, onExportPdf, onExportDocx }) => {
    const client = useWorkerClient();
    const [format, setFormat] = useState<ExportFormat>('pdf');
    const [themeId, setThemeId] = useState(DEFAULT_PDF_THEME.id);
    const [themes, setThemes] = useState<PdfTheme[]>([DEFAULT_PDF_THEME]);
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);
    const writing = useRef(false);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoading(true);
        loadPdfThemes(client).then(loaded => {
            if (cancelled) return;
            setThemes(loaded);
            setLoading(false);
            setThemeId(selected => loaded.some(theme => theme.id === selected) ? selected : loaded[0]?.id ?? DEFAULT_PDF_THEME.id);
        });
        return () => { cancelled = true; };
    }, [client, open]);

    const handleExport = async () => {
        if (loading || writing.current) return;
        const theme = themes.find(theme => theme.id === themeId) ?? DEFAULT_PDF_THEME;
        if (format === 'pdf') {
            onExportPdf(theme);
            onClose();
            return;
        }
        writing.current = true;
        setExporting(true);
        try {
            await onExportDocx(theme);
            onClose();
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : String(cause));
        } finally {
            writing.current = false;
            setExporting(false);
        }
    };

    return (
        <Modal
            title="Export"
            open={open}
            onOk={handleExport}
            onCancel={() => { if (!writing.current) onClose(); }}
            closable={!exporting}
            okText="Export"
            confirmLoading={exporting || loading}
            okButtonProps={{ disabled: exporting || loading, 'aria-label': 'Export', 'aria-busy': exporting || loading }}
            cancelButtonProps={{ disabled: exporting }}
            width={480}
            destroyOnHidden
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="export-format-group">
                    <Typography.Text strong>Format</Typography.Text>
                    <Radio.Group
                        value={format}
                        disabled={exporting}
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
                        <Typography.Text type="secondary" role="status">Loading themes…</Typography.Text>
                    ) : (
                        <Radio.Group
                            value={themeId}
                            disabled={exporting}
                            onChange={(e) => setThemeId(e.target.value)}
                            options={themes.map(theme => ({ value: theme.id, label: theme.label }))}
                        />
                    )}
                </div>
            </div>
        </Modal>
    );
};
