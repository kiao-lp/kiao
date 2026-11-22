import React from 'react';
import styles from './FormField.module.css';

export const FormField: React.FC<{ label: string; help?: React.ReactNode; children: React.ReactNode }> = ({ label, help, children }) => (
    <div className={styles.field}>
        <span className={styles.fieldLabel}>{label}</span>
        {children}
        {help && <div className={styles.hint}>{help}</div>}
    </div>
);
