// src/components/ConfirmModal.tsx
import React from "react";
import { Modal } from "antd";

interface ConfirmModalProps {
    open: boolean;
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
    onCancel: () => void;
    confirmColor?: "red" | "blue" | "green" | "orange" | "black";
    size?: "mini" | "tiny" | "small" | "large"; // Mapped to width or kept for compatibility
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
    open,
    title = "Confirm",
    message,
    confirmText = "Confirm",
    cancelText = "Cancel",
    confirmColor = "red",
    // eslint-disable-next-line @typescript-eslint/no-unused-vars

    onConfirm,
    onCancel
}) => (
    <Modal
        title={title}
        open={open}
        onCancel={onCancel}
        onOk={onConfirm}
        okText={confirmText}
        cancelText={cancelText}
        okButtonProps={{ danger: confirmColor === 'red' }}
    >
        <p>{message}</p>
    </Modal>
);

export default ConfirmModal;
