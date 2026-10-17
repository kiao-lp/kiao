import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportPanel } from './ReportPanel';
import { reportOn } from './report';
import type { Gltf } from './glb';

/** A model with something to say under every heading of the panel. */
const furnished = (): Gltf => ({
    asset: { version: '2.0', generator: 'Blender glTF 4.1', copyright: '© Acme' },
    extensionsUsed: ['KHR_materials_ior', 'KHR_draco_mesh_compression'],
    extensionsRequired: ['KHR_draco_mesh_compression'],
    scene: 0,
    scenes: [{ name: 'Product', nodes: [0] }],
    nodes: [{ name: 'Chair', mesh: 0 }],
    meshes: [{ name: 'Chair', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    materials: [{ name: 'Oak' }],
    animations: [{ name: 'Rock', channels: [{ sampler: 0 }], samplers: [{ input: 2, output: 3 }] }],
    accessors: [
        { count: 24, bufferView: 0, min: [-0.3, 0, -0.3], max: [0.3, 0.9, 0.3] },
        { count: 36, bufferView: 1 },
        { count: 4, min: [0], max: [1.5] },
        { count: 4 },
    ],
    bufferViews: [{ byteLength: 288 }, { byteLength: 72 }],
    buffers: [{ byteLength: 360 }],
});

const panelFor = (json: Gltf, onClose = vi.fn()) => {
    const report = reportOn({
        json,
        binary: new Uint8Array(400),
        container: 'binary',
        byteLength: 1000,
        jsonLength: 600,
        binaryLength: 400,
    });
    render(<ReportPanel report={report} onClose={onClose} />);
    return onClose;
};

describe('ReportPanel', () => {
    it('reads out what the file says about itself', () => {
        panelFor(furnished());

        expect(screen.getByText('Blender glTF 4.1')).toBeInTheDocument();
        expect(screen.getByText('© Acme')).toBeInTheDocument();
        // Extension names lose the vendor prefix every one of them shares.
        expect(screen.getByText('draco_mesh_compression')).toBeInTheDocument();
    });

    it('weighs the model in the units of the thing being weighed', () => {
        panelFor(furnished());

        expect(screen.getByText('1000 B')).toBeInTheDocument();       // the file
        expect(screen.getByText('12')).toBeInTheDocument();           // triangles
        expect(screen.getByText('60.0 cm × 90.0 cm × 60.0 cm')).toBeInTheDocument();
        expect(screen.getByText('1.5 s')).toBeInTheDocument();        // the clip
    });

    it('shows the byte budget as parts of the whole file', () => {
        panelFor(furnished());

        expect(screen.getByText('geometry')).toBeInTheDocument();
        expect(screen.getByText('structure')).toBeInTheDocument();
        expect(screen.getByText('36%')).toBeInTheDocument();          // 360 bytes of 1000
    });

    it('puts the reason a model will not draw among the findings', () => {
        panelFor(furnished());

        expect(screen.getByText(/KHR_draco_mesh_compression is required/)).toBeInTheDocument();
        expect(document.querySelector('[data-finding="required-extension"]')).toBeTruthy();
    });

    it('says outright when a file has nothing wrong with it', () => {
        const plain = furnished();
        delete plain.extensionsUsed;
        delete plain.extensionsRequired;
        panelFor(plain);

        expect(screen.getByText('Nothing unusual to report.')).toBeInTheDocument();
        expect(screen.getByText('No extensions.')).toBeInTheDocument();
    });

    it('closes from its own cross, and offers nothing else to press', async () => {
        const onClose = panelFor(furnished());

        // Read-only: the one control in the panel is the way out of it.
        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(1);

        await userEvent.click(screen.getByLabelText('Close the inspector'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
