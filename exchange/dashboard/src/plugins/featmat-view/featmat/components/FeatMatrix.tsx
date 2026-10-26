import React, { useState, useMemo, useCallback } from 'react';
import type { FeatMatrixProps, MoscowLevel } from '../lib/featmat-model';
import { supportLevel, supportComment } from '../lib/featmat-model';
import { SUPPORT_INFO, MOSCOW_INFO, MOSCOW_LEVELS, HELP_MARKDOWN } from '../lib/featmat-constants';
import { computeCellScore, cellBackground, computeOptionScore } from '../lib/featmat-scoring';
import { generateFeatMatrixSvg, downloadSvgString } from '../lib/featmat-svg-export';
import { markdownToHtml } from '@cms-kit/diagram-shared';
import './FeatMatrix.css';

// ── Component ────────────────────────────────────────────────────────

export const FeatMatrix: React.FC<FeatMatrixProps> = ({ features, options, requirements, onExportSvg, onRequirementChange }) => {
    const firstReq = requirements?.[0] ?? null;

    const [selectedReqId, setSelectedReqId] = useState<string | null>(firstReq?.id ?? null);
    const [moscow, setMoscow] = useState<Record<string, MoscowLevel>>(() => {
        const init: Record<string, MoscowLevel> = {};
        for (const f of features) init[f.id] = firstReq?.weights[f.id] ?? 'could';
        return init;
    });

    const handleMoscowChange = (featureId: string, level: MoscowLevel) => {
        if (selectedReqId && onRequirementChange) {
            onRequirementChange(selectedReqId, featureId, level);
        } else {
            setSelectedReqId(null); // switch to Custom when the user edits manually
        }
        setMoscow(prev => ({ ...prev, [featureId]: level }));
    };

    const handleRequirementChange = (reqId: string | null) => {
        setSelectedReqId(reqId);
        const req = requirements?.find(r => r.id === reqId) ?? null;
        const newMoscow: Record<string, MoscowLevel> = {};
        for (const f of features) newMoscow[f.id] = req?.weights[f.id] ?? 'could';
        setMoscow(newMoscow);
    };

    const scoredOptions = useMemo(() => {
        return options
            .map(opt => ({ option: opt, score: computeOptionScore(opt, features, moscow) }))
            .sort((a, b) => b.score - a.score);
    }, [options, features, moscow]);

    const maxScore = useMemo(() => {
        if (scoredOptions.length === 0) return 1;
        return Math.max(1, scoredOptions[0].score);
    }, [scoredOptions]);

    const sortedFeatures = useMemo(() => {
        return [...features].sort((a, b) => {
            const wa = MOSCOW_INFO[moscow[a.id] ?? 'could'].weight;
            const wb = MOSCOW_INFO[moscow[b.id] ?? 'could'].weight;
            return wb - wa;
        });
    }, [features, moscow]);

    const handleExportSvg = useCallback(() => {
        const svg = generateFeatMatrixSvg(features, options, moscow);
        if (onExportSvg) {
            onExportSvg(svg);
        } else {
            downloadSvgString(svg);
        }
    }, [features, options, moscow, onExportSvg]);

    return (
        <div className="fm-container">
            <div className="fm-toolbar">
                {requirements && requirements.length > 0 && (
                    <div className="fm-req-selector">
                        <label className="fm-req-label">Requirements</label>
                        <select
                            className="fm-req-select"
                            value={selectedReqId ?? ''}
                            onChange={e => handleRequirementChange(e.target.value || null)}
                        >
                            {requirements.map(req => (
                                <option key={req.id} value={req.id}>{req.label}</option>
                            ))}
                            <option value="">Custom</option>
                        </select>
                        {selectedReqId && requirements.find(r => r.id === selectedReqId)?.description && (
                            <span className="fm-req-desc">
                                {requirements.find(r => r.id === selectedReqId)!.description}
                            </span>
                        )}
                    </div>
                )}
                <div
                    className="fm-help"
                    aria-label="How it works"
                    role="img"
                    tabIndex={0}
                >
                    ?
                    <div
                        className="fm-tooltip fm-help-tooltip"
                        dangerouslySetInnerHTML={{ __html: markdownToHtml(HELP_MARKDOWN) }}
                    />
                </div>
                <button className="fm-export-btn" onClick={handleExportSvg}>Export SVG</button>
            </div>
            <div className="fm-table-wrap">
            <table className="fm-table">
                <thead>
                    <tr>
                        <th className="fm-th-feature">Feature</th>
                        <th className="fm-th-moscow">Priority</th>
                        {scoredOptions.map(({ option, score }) => (
                            <th key={option.id} className="fm-th-option">
                                <div className="fm-option-header">
                                    <span className="fm-option-label">{option.label}</span>
                                    <span className="fm-option-score">{score}</span>
                                    <div className="fm-score-bar">
                                        <div
                                            className="fm-score-fill"
                                            style={{ width: `${(score / maxScore) * 100}%` }}
                                        />
                                    </div>
                                </div>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {sortedFeatures.map(feature => (
                        <tr key={feature.id} className={`fm-row fm-moscow-${moscow[feature.id] ?? 'could'}`}>
                            <td className="fm-td-feature">
                                <span className="fm-feature-label">{feature.label}</span>
                                {feature.description && (
                                    <span className="fm-feature-desc">{feature.description}</span>
                                )}
                            </td>
                            <td className="fm-td-moscow">
                                <select
                                    className="fm-moscow-select"
                                    value={moscow[feature.id] ?? 'could'}
                                    onChange={e => handleMoscowChange(feature.id, e.target.value as MoscowLevel)}
                                >
                                    {MOSCOW_LEVELS.map(level => (
                                        <option key={level} value={level}>
                                            {MOSCOW_INFO[level].label}
                                        </option>
                                    ))}
                                </select>
                            </td>
                            {scoredOptions.map(({ option }) => {
                                const entry = option.support[feature.id];
                                const level = supportLevel(entry);
                                const comment = supportComment(entry);
                                const info = level ? SUPPORT_INFO[level] : undefined;
                                const weight = MOSCOW_INFO[moscow[feature.id] ?? 'could'].weight;
                                const supScore = info ? info.score : 0;
                                const cs = computeCellScore(weight, supScore);
                                return (
                                    <td
                                        key={option.id}
                                        className={`fm-td-support ${level ? `fm-support-${level}` : 'fm-support-unknown'}${comment ? ' fm-has-comment' : ''}`}
                                        title={info?.label}
                                        style={{ backgroundColor: cellBackground(cs) }}
                                    >
                                        {info ? info.emoji : '\u2014'}
                                        {comment && (
                                            <div className="fm-tooltip" dangerouslySetInnerHTML={{ __html: markdownToHtml(comment) }} />
                                        )}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
            </div>
            <div className="fm-legend">
                {Object.entries(SUPPORT_INFO).map(([key, { label, emoji }]) => (
                    <span key={key} className="fm-legend-item">
                        {emoji} {label}
                    </span>
                ))}
            </div>
        </div>
    );
};
