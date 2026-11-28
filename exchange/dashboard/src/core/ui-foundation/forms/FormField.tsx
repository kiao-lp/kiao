import React from 'react';
import classNames from 'classnames';
import styles from './FormField.module.css';

interface FormFieldProps {
    label: React.ReactNode;
    htmlFor?: string;
    help?: React.ReactNode;
    className?: string;
    children: React.ReactNode;
}

export const FormField: React.FC<FormFieldProps> = ({ label, htmlFor, help, className, children }) => (
    <div className={classNames(styles.field, className)}>
        {htmlFor
            ? <label htmlFor={htmlFor} className={styles.fieldLabel}>{label}</label>
            : <span className={styles.fieldLabel}>{label}</span>}
        {children}
        {help && <div className={styles.hint}>{help}</div>}
    </div>
);

export const FormFields: React.FC<React.ComponentPropsWithoutRef<'fieldset'>> = ({ className, ...props }) => (
    <fieldset className={classNames(styles.fields, className)} {...props} />
);
