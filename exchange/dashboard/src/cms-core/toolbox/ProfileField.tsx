import React from 'react';
import styles from './AgentProfiles.module.css';

export const ProfileField: React.FC<{ label: string; help?: React.ReactNode; children: React.ReactNode }> = ({ label, help, children }) => (
    <div className={styles.field}>
        <span className={styles.fieldLabel}>{label}</span>
        {children}
        {help && <div className={styles.hint}>{help}</div>}
    </div>
);
