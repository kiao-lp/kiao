import React from 'react';
import { Button } from 'antd';
import { CloseOutlined, InfoCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { Tooltip } from '@cms-core';
import type { Anomaly, ExtensionUse, ImageWeight, ModelReport } from './report';
import {
    formatBytes, formatCount, formatDuration, formatExtent, formatPixels, formatShare,
} from './format';

/**
 * The report, read out.
 *
 * Four questions in the order a reader asks them: what is this file, what is in it, what does it
 * cost, and is anything about it worth knowing before it is used. Everything shown is something
 * the file declares about itself — nothing here is measured off the drawing, which is what lets
 * the same panel stand in front of a model that would not draw at all.
 *
 * It reads and does not touch: no scene is switched, no material is edited, nothing is selected.
 * A panel that could change the model would have to be sure of what it was changing, and this one
 * is deliberately sure of nothing but what it was told.
 */
export const ReportPanel: React.FC<{ report: ModelReport; onClose: () => void }> = ({
    report, onClose,
}) => {
    const { identity, inventory, weight, anomalies } = report;

    return (
        <aside className="model3d-report" aria-label="Model inspector">
            {/* The way out is on the leading edge, as a drawer's is — and as far as it can be
                from the CMS's own cross, which floats over this corner to close the document. */}
            <header className="model3d-report-head">
                <Tooltip title="Close the inspector">
                    <Button
                        size="small"
                        type="text"
                        icon={<CloseOutlined />}
                        onClick={onClose}
                        aria-label="Close the inspector"
                    />
                </Tooltip>
                <span>Inspector</span>
            </header>

            <Section title="Identity">
                <Rows>
                    <Row label="Generator">{identity.generator || <Unstated />}</Row>
                    {identity.copyright && <Row label="Copyright">{identity.copyright}</Row>}
                    <Row label="glTF">
                        {identity.version || <Unstated />}
                        {identity.minVersion && ` · needs ${identity.minVersion} at least`}
                    </Row>
                    <Row label="Container">
                        {identity.container === 'binary' ? 'binary glTF' : 'JSON glTF document'}
                    </Row>
                </Rows>
                <div className="model3d-chips">
                    {report.extensions.length === 0
                        ? <span className="model3d-quiet">No extensions.</span>
                        : report.extensions.map(extension => (
                            <Extension key={extension.name} extension={extension} />
                        ))}
                </div>
            </Section>

            <Section title="Inventory">
                <Rows>
                    <Row label="Scenes">
                        {formatCount(inventory.scenes)}
                        {inventory.drawnScene >= 0 && ` · drawn: ${inventory.drawnSceneName}`}
                    </Row>
                    <Row label="Nodes">
                        {formatCount(inventory.nodes)}
                        {` · ${formatCount(inventory.roots)} root${inventory.roots === 1 ? '' : 's'} in view`}
                    </Row>
                    <Row label="Meshes">
                        {formatCount(inventory.meshes)}
                        {` · ${formatCount(inventory.primitives)} primitive${inventory.primitives === 1 ? '' : 's'}`}
                        {inventory.morphTargets > 0 && ` · ${formatCount(inventory.morphTargets)} morph targets`}
                    </Row>
                    <Row label="Materials">{formatCount(inventory.materials)}</Row>
                    <Row label="Textures">
                        {formatCount(inventory.textures)}
                        {` · ${formatCount(inventory.images)} image${inventory.images === 1 ? '' : 's'}`}
                    </Row>
                    <Row label="Skeletons">
                        {inventory.skins === 0 ? 'none' : (
                            `${formatCount(inventory.skins)} · up to ${formatCount(inventory.joints)} joints`
                        )}
                    </Row>
                    <Row label="Cameras">{formatCount(inventory.cameras)}</Row>
                </Rows>
                {inventory.animations.length > 0 && (
                    <table className="model3d-table">
                        <tbody>
                            {inventory.animations.map((clip, index) => (
                                <tr key={`${clip.name}-${index}`}>
                                    <td className="model3d-cell-name">{clip.name}</td>
                                    <td>{formatDuration(clip.duration)}</td>
                                    <td>{formatCount(clip.channels)} ch.</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Section>

            <Section title="Weight">
                <Rows>
                    <Row label="File">{formatBytes(weight.bytes)}</Row>
                </Rows>
                <Budget report={report} />
                <Rows>
                    <Row label="Triangles">
                        {formatCount(weight.triangles)}
                        {weight.triangles !== weight.uniqueTriangles
                            && ` · ${formatCount(weight.uniqueTriangles)} once each`}
                    </Row>
                    <Row label="Vertices">{formatCount(weight.vertices)}</Row>
                    {weight.pixels > 0 && <Row label="Pixels">{formatPixels(weight.pixels)}</Row>}
                    <Row label="Extent">
                        {weight.extent
                            ? formatExtent(weight.extent.size)
                            : <span className="model3d-quiet">nothing declares a position</span>}
                    </Row>
                </Rows>
                {weight.images.length > 0 && <Images images={weight.images} />}
            </Section>

            <Section title="Findings">
                {anomalies.length === 0
                    ? <p className="model3d-quiet">Nothing unusual to report.</p>
                    : (
                        <ul className="model3d-findings">
                            {anomalies.map((anomaly, index) => (
                                <Finding key={`${anomaly.kind}-${index}`} anomaly={anomaly} />
                            ))}
                        </ul>
                    )}
            </Section>
        </aside>
    );
};

export default ReportPanel;

/* ----------------------------------------------------------------------------- the pieces ---- */

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <section className="model3d-report-section">
        <h3>{title}</h3>
        {children}
    </section>
);

const Rows: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <dl className="model3d-rows">{children}</dl>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <>
        <dt>{label}</dt>
        <dd>{children}</dd>
    </>
);

/** A field the file left blank — which for a generator or a copyright is most of them. */
const Unstated: React.FC = () => <span className="model3d-quiet">not stated</span>;

/** What one extension is, and what this viewer does about it. */
const Extension: React.FC<{ extension: ExtensionUse }> = ({ extension }) => {
    const note = extension.support === 'decoder-missing' ? 'decoder not shipped here'
        : extension.support === 'ignored' ? 'not implemented here'
            : '';
    return (
        <span
            className={`model3d-chip model3d-chip-${extension.support}`}
            title={[extension.name, extension.required ? 'required' : 'used', note]
                .filter(Boolean).join(' · ')}
        >
            {extension.name.replace(/^(KHR|EXT)_/, '')}
            {extension.required && <b> !</b>}
        </span>
    );
};

/** Where the file's bytes went: one bar, and the same figures written out under it. */
const Budget: React.FC<{ report: ModelReport }> = ({ report }) => {
    const { budget, bytes } = report.weight;
    return (
        <>
            <div className="model3d-bar" role="presentation">
                {budget.map(line => (
                    <span
                        key={line.kind}
                        className={`model3d-bar-part model3d-kind-${line.kind}`}
                        style={{ flexGrow: line.bytes }}
                        title={`${line.kind}: ${formatBytes(line.bytes)}`}
                    />
                ))}
            </div>
            <table className="model3d-table">
                <tbody>
                    {budget.map(line => (
                        <tr key={line.kind}>
                            <td className="model3d-cell-name">
                                <span className={`model3d-swatch model3d-kind-${line.kind}`} />
                                {line.kind}
                            </td>
                            <td>{formatBytes(line.bytes)}</td>
                            <td>{formatShare(line.bytes, bytes)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </>
    );
};

/** Every image the file carries, heaviest first — the usual answer to "why is this so large". */
const Images: React.FC<{ images: ImageWeight[] }> = ({ images }) => (
    <table className="model3d-table">
        <tbody>
            {images.map((image, index) => (
                <tr key={`${image.name}-${index}`}>
                    <td className="model3d-cell-name" title={image.name}>{image.name}</td>
                    <td>
                        {image.width > 0
                            ? `${image.width} × ${image.height}`
                            : <span className="model3d-quiet">size unread</span>}
                    </td>
                    <td>{image.bytes > 0 ? formatBytes(image.bytes) : '—'}</td>
                </tr>
            ))}
        </tbody>
    </table>
);

const Finding: React.FC<{ anomaly: Anomaly }> = ({ anomaly }) => (
    <li className={`model3d-finding model3d-finding-${anomaly.level}`} data-finding={anomaly.kind}>
        {anomaly.level === 'warning' ? <WarningOutlined /> : <InfoCircleOutlined />}
        <span>{anomaly.text}</span>
    </li>
);
